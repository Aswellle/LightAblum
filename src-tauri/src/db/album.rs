// src-tauri/src/db/album.rs
//
// 相册数据层 — 完整 CRUD（v2 — 私密相册支持）
//
// v2 新增：
//   Album / AlbumSummary 新增 is_private: bool, has_password: bool 字段
//   create_private(name, password_hash)  — 创建私密相册
//   set_private(id, is_private, password_hash)  — 设置/取消私密
//   get_password_hash(id)  — 获取密码哈希（供 verify 使用）
//   list_summaries 排除私密相册（侧边栏不显示，防泄漏）
//   list_all_summaries  — 包含私密相册（设置管理用）
//   ALBUM_BY_ID_SQL / ALBUM_SUMMARIES_SQL 增加 is_private, has_password 字段

use crate::db::photo::{row_to_photo_thumb, PhotoPage, PhotoThumb, PHOTO_THUMB_SELECT};
use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─────────────────────────────────────────────────────────
//  数据结构
// ─────────────────────────────────────────────────────────

/// 完整相册实体
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub cover_photo_id: Option<String>,
    pub cover_thumbnail: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub sort_order: i32,
    pub photo_count: i64,
    /// v2 新增：是否为私密相册
    pub is_private: bool,
    /// v2 新增：是否设置了密码（true=有密码，false=无密码保护）
    pub has_password: bool,
}

/// 相册摘要（侧边栏列表用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumSummary {
    pub id: String,
    pub name: String,
    pub cover_thumbnail: Option<String>,
    pub photo_count: i64,
    pub updated_at: String,
    /// v2 新增
    pub is_private: bool,
    pub has_password: bool,
}

/// 更新相册的可变字段
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAlbumParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub cover_photo_id: Option<Option<String>>,
    pub sort_order: Option<i32>,
}

// ─────────────────────────────────────────────────────────
//  Row 映射
// ─────────────────────────────────────────────────────────

fn row_to_album(row: &rusqlite::Row<'_>) -> rusqlite::Result<Album> {
    let password_hash: Option<String> = row.get("password_hash")?;
    Ok(Album {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        cover_photo_id: row.get("cover_photo_id")?,
        cover_thumbnail: row.get("cover_thumbnail")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        sort_order: row.get("sort_order")?,
        photo_count: row.get("photo_count")?,
        is_private: row.get::<_, i32>("is_private")? != 0,
        has_password: password_hash.is_some(),
    })
}

fn row_to_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<AlbumSummary> {
    let password_hash: Option<String> = row.get("password_hash")?;
    Ok(AlbumSummary {
        id: row.get("id")?,
        name: row.get("name")?,
        cover_thumbnail: row.get("cover_thumbnail")?,
        photo_count: row.get("photo_count")?,
        updated_at: row.get("updated_at")?,
        is_private: row.get::<_, i32>("is_private")? != 0,
        has_password: password_hash.is_some(),
    })
}

// ─────────────────────────────────────────────────────────
//  写操作
// ─────────────────────────────────────────────────────────

/// 创建普通相册
pub fn create(conn: &Connection, name: &str, description: Option<&str>) -> Result<Album> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO albums (id, name, description, is_private) VALUES (?1, ?2, ?3, 0)",
        params![id, name, description],
    )?;
    get_by_id(conn, &id)?.ok_or_else(|| AppError::Other("Failed to fetch created album".into()))
}

/// 创建私密相册（含密码哈希）
pub fn create_private(conn: &Connection, name: &str, password_hash: &str) -> Result<Album> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO albums (id, name, is_private, password_hash) VALUES (?1, ?2, 1, ?3)",
        params![id, name, password_hash],
    )?;
    get_by_id(conn, &id)?.ok_or_else(|| AppError::Other("Failed to fetch created album".into()))
}

/// 设置或取消相册的私密状态
pub fn set_private(
    conn: &Connection,
    id: &str,
    is_private: bool,
    password_hash: Option<&str>,
) -> Result<Album> {
    conn.execute(
        "UPDATE albums SET is_private = ?1, password_hash = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?3",
        params![is_private as i32, password_hash, id],
    )?;
    get_by_id(conn, id)?.ok_or_else(|| AppError::NotFound(format!("Album {id} not found")))
}

/// 获取相册密码哈希（供 bcrypt 验证使用）
pub fn get_password_hash(conn: &Connection, id: &str) -> Result<Option<String>> {
    match conn.query_row(
        "SELECT password_hash FROM albums WHERE id = ?1",
        params![id],
        |row| row.get::<_, Option<String>>(0),
    ) {
        Ok(hash) => Ok(hash),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// 更新相册属性
pub fn update(conn: &Connection, id: &str, params_in: &UpdateAlbumParams) -> Result<Album> {
    let mut sets: Vec<String> = Vec::new();
    let mut bind: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = params_in.name {
        bind.push(Box::new(name.clone()));
        sets.push(format!("name = ?{}", bind.len()));
    }
    if let Some(ref desc) = params_in.description {
        bind.push(Box::new(desc.clone()));
        sets.push(format!("description = ?{}", bind.len()));
    }
    if let Some(ref cover) = params_in.cover_photo_id {
        match cover {
            Some(cid) => {
                bind.push(Box::new(cid.clone()));
                sets.push(format!("cover_photo_id = ?{}", bind.len()));
            }
            None => sets.push("cover_photo_id = NULL".into()),
        }
    }
    if let Some(order) = params_in.sort_order {
        bind.push(Box::new(order));
        sets.push(format!("sort_order = ?{}", bind.len()));
    }

    if sets.is_empty() {
        return get_by_id(conn, id)?
            .ok_or_else(|| AppError::NotFound(format!("Album {id} not found")));
    }

    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')".into());
    bind.push(Box::new(id.to_string()));
    let sql = format!(
        "UPDATE albums SET {} WHERE id = ?{}",
        sets.join(", "),
        bind.len()
    );
    conn.execute(
        &sql,
        rusqlite::params_from_iter(bind.iter().map(|b| b.as_ref())),
    )?;

    get_by_id(conn, id)?.ok_or_else(|| AppError::NotFound(format!("Album {id} not found")))
}

/// 删除相册（照片不受影响）
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM albums WHERE id = ?1", params![id])?;
    Ok(())
}

/// 向相册添加照片
pub fn add_photos(conn: &Connection, album_id: &str, photo_ids: &[String]) -> Result<()> {
    if photo_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    let max_order: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) FROM album_photos WHERE album_id = ?1",
            params![album_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    for (i, photo_id) in photo_ids.iter().enumerate() {
        tx.execute(
            "INSERT OR IGNORE INTO album_photos (album_id, photo_id, sort_order) VALUES (?1, ?2, ?3)",
            params![album_id, photo_id, max_order + 1 + i as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// 从相册移除照片
pub fn remove_photos(conn: &Connection, album_id: &str, photo_ids: &[String]) -> Result<()> {
    if photo_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for photo_id in photo_ids {
        tx.execute(
            "DELETE FROM album_photos WHERE album_id = ?1 AND photo_id = ?2",
            params![album_id, photo_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// 获取相册当前封面 photo_id（若无封面则返回 None）
pub fn get_cover_photo_id(conn: &Connection, album_id: &str) -> Result<Option<String>> {
    match conn.query_row(
        "SELECT cover_photo_id FROM albums WHERE id = ?1",
        params![album_id],
        |row| row.get::<_, Option<String>>(0),
    ) {
        Ok(id) => Ok(id),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// 在给定一批 photo_ids 中寻找"最佳"封面候选：
///   优先：人像方向（height > width）且分辨率较高
///   次之：该批次中第一张照片
/// 返回最佳候选的 photo_id，若无有效照片则返回 None
pub fn find_best_portrait(conn: &Connection, photo_ids: &[String]) -> Result<Option<String>> {
    if photo_ids.is_empty() {
        return Ok(None);
    }

    // 将 photo_ids 转为 (?1, ?2, ...) 占位符列表，供 IN 查询使用
    let placeholders: Vec<String> = photo_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "SELECT id, width, height FROM photos \
         WHERE id IN ({}) AND is_deleted = 0",
        placeholders.join(", ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = photo_ids
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();

    let mut rows = stmt.query(rusqlite::params_from_iter(params.iter()))?;

    // 收集所有照片，按 分数 = 是否人像(×10000) + 像素总数 排序
    #[derive(Debug, Clone)]
    struct Candidate {
        id: String,
        score: i64,
    }
    let mut candidates: Vec<Candidate> = Vec::new();
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let width: i64 = row.get(1)?;
        let height: i64 = row.get(2)?;
        let is_portrait: i64 = if height > width { 1 } else { 0 };
        let pixels: i64 = width.saturating_mul(height);
        let score = is_portrait * 10_000_000 + pixels;
        candidates.push(Candidate { id, score });
    }

    if candidates.is_empty() {
        return Ok(None);
    }

    // 降序取最高分（人像优先，分辨率次之）
    candidates.sort_by(|a, b| b.score.cmp(&a.score));
    Ok(Some(candidates[0].id.clone()))
}

/// 相册内照片重排序
pub fn reorder_photos(conn: &Connection, album_id: &str, ordered_ids: &[String]) -> Result<()> {
    if ordered_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for (i, photo_id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE album_photos SET sort_order = ?1 WHERE album_id = ?2 AND photo_id = ?3",
            params![i as i64, album_id, photo_id],
        )?;
    }
    tx.execute(
        "UPDATE albums SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?1",
        params![album_id],
    )?;
    tx.commit()?;
    Ok(())
}

// ─────────────────────────────────────────────────────────
//  读操作
// ─────────────────────────────────────────────────────────

pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<Album>> {
    let mut stmt = conn.prepare(ALBUM_BY_ID_SQL)?;
    match stmt.query_row(params![id], row_to_album) {
        Ok(a) => Ok(Some(a)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// 列出所有相册摘要（排除私密相册 — 侧边栏用）
pub fn list_summaries(conn: &Connection) -> Result<Vec<AlbumSummary>> {
    let mut stmt = conn.prepare(ALBUM_SUMMARIES_SQL)?;
    let results = stmt
        .query_map([], row_to_summary)?
        .collect::<std::result::Result<_, _>>()?;
    Ok(results)
}

/// 列出所有相册（含私密 — 设置页/管理用）
pub fn list_all_summaries(conn: &Connection) -> Result<Vec<AlbumSummary>> {
    let mut stmt = conn.prepare(ALBUM_ALL_SUMMARIES_SQL)?;
    let results = stmt
        .query_map([], row_to_summary)?
        .collect::<std::result::Result<_, _>>()?;
    Ok(results)
}

/// 查询相册内的照片（分页）
pub fn list_photos(
    conn: &Connection,
    album_id: &str,
    cursor: Option<&str>,
    limit: u32,
) -> Result<PhotoPage> {
    let cursor_order: Option<i64> = cursor
        .and_then(|c| c.split("::").next())
        .and_then(|v| v.parse().ok());
    let cursor_clause = if let Some(order) = cursor_order {
        format!("AND ap.sort_order > {order}")
    } else {
        String::new()
    };

    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM album_photos WHERE album_id = ?1",
        params![album_id],
        |row| row.get(0),
    )?;

    let sql = format!(
        "SELECT {PHOTO_THUMB_SELECT} FROM photos p \
         INNER JOIN album_photos ap ON p.id = ap.photo_id \
         WHERE ap.album_id = ?1 AND p.is_deleted = 0 \
         {cursor_clause} \
         ORDER BY ap.sort_order ASC LIMIT ?2"
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut items: Vec<PhotoThumb> = stmt
        .query_and_then(params![album_id, limit as i64 + 1], |row| {
            row_to_photo_thumb(row).map_err(crate::error::AppError::from)
        })?
        .collect::<std::result::Result<_, _>>()?;

    let next_cursor = if items.len() > limit as usize {
        items.pop();
        items.last().map(|last| {
            let last_order: i64 = conn
                .query_row(
                    "SELECT sort_order FROM album_photos WHERE album_id = ?1 AND photo_id = ?2",
                    params![album_id, last.id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            format!("{}::{}", last_order, last.id)
        })
    } else {
        None
    };

    Ok(PhotoPage {
        items,
        next_cursor,
        total,
    })
}

// ─────────────────────────────────────────────────────────
//  SQL 常量（v2：新增 is_private, password_hash 字段）
// ─────────────────────────────────────────────────────────

const ALBUM_BY_ID_SQL: &str = r#"
    SELECT
        a.id, a.name, a.description, a.cover_photo_id,
        COALESCE(
            (SELECT p.thumbnail_m FROM photos p WHERE p.id = a.cover_photo_id),
            (SELECT p.thumbnail_m FROM photos p
             INNER JOIN album_photos ap2 ON p.id = ap2.photo_id
             WHERE ap2.album_id = a.id AND p.is_deleted = 0
             ORDER BY ap2.sort_order DESC LIMIT 1)
        ) AS cover_thumbnail,
        a.created_at, a.updated_at, a.sort_order, a.photo_count,
        COALESCE(a.is_private, 0) AS is_private,
        a.password_hash
    FROM albums a
    WHERE a.id = ?1
"#;

/// 侧边栏：排除私密相册
const ALBUM_SUMMARIES_SQL: &str = r#"
    SELECT
        a.id, a.name,
        COALESCE(
            (SELECT p.thumbnail_m FROM photos p WHERE p.id = a.cover_photo_id),
            (SELECT p.thumbnail_m FROM photos p
             INNER JOIN album_photos ap2 ON p.id = ap2.photo_id
             WHERE ap2.album_id = a.id AND p.is_deleted = 0
             ORDER BY ap2.sort_order DESC LIMIT 1)
        ) AS cover_thumbnail,
        a.photo_count, a.updated_at,
        COALESCE(a.is_private, 0) AS is_private,
        a.password_hash
    FROM albums a
    WHERE COALESCE(a.is_private, 0) = 0
    ORDER BY a.sort_order ASC, a.created_at DESC
"#;

/// 全部相册（含私密）— 管理/设置用
const ALBUM_ALL_SUMMARIES_SQL: &str = r#"
    SELECT
        a.id, a.name,
        COALESCE(
            (SELECT p.thumbnail_m FROM photos p WHERE p.id = a.cover_photo_id),
            (SELECT p.thumbnail_m FROM photos p
             INNER JOIN album_photos ap2 ON p.id = ap2.photo_id
             WHERE ap2.album_id = a.id AND p.is_deleted = 0
             ORDER BY ap2.sort_order DESC LIMIT 1)
        ) AS cover_thumbnail,
        a.photo_count, a.updated_at,
        COALESCE(a.is_private, 0) AS is_private,
        a.password_hash
    FROM albums a
    ORDER BY a.is_private ASC, a.sort_order ASC, a.created_at DESC
"#;
