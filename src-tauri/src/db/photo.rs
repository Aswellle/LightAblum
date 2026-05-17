// src-tauri/src/db/photo.rs
//
// 照片数据层 — 完整 CRUD + 分页查询
// Round-4（F-05）：新增 PhotoThumb 精简类型 + query_paged 使用投影 SQL
//
// F-05 修复说明：
//   原 query_paged 执行 SELECT p.*，将 photos 表全部 30+ 列序列化后
//   经 IPC 传输到前端，但前端 PhotoThumb 接口仅需 12 个字段。
//   以 100 条/页计算，每页多传输约 50-80KB 无用 JSON，
//   前端 serde 反序列化开销也随之增加。
//
//   修复：
//     1. 新增 PhotoThumb 结构体（12 字段，与前端接口完全对齐）
//     2. 新增 row_to_photo_thumb 行映射函数
//     3. PhotoPage.items 类型从 Vec<Photo> 改为 Vec<PhotoThumb>
//     4. query_paged 的 SELECT 改为精确列枚举
//        附带 file_size + imported_at（仅用于游标构建，不进入 PhotoThumb 结构）
//
// PrivateAlbum（v1 新增）：
//   query_paged 在非相册视图（album_id = None）时，
//   自动排除属于私密相册（albums.is_private = 1）的照片，
//   使私密相册内的照片在「所有照片」「收藏」「文件夹」等视图中不可见。
//
// 其他说明：
//   - Photo（完整体）保持不变，供 photos_get / photos_get_batch 使用
//   - row_to_photo 保持不变

use crate::error::{AppError, Result};
use crate::query::filter::PhotoFilter;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─────────────────────────────────────────────────────────
//  数据结构
// ─────────────────────────────────────────────────────────

/// 完整照片实体（对应 DB photos 表所有字段）
/// 用于 photos_get / photos_get_batch（EXIF 面板 / 大图预览）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id:            String,
    pub file_path:     String,
    pub file_name:     String,
    pub file_size:     i64,
    pub file_hash:     String,
    pub width:         i32,
    pub height:        i32,
    pub orientation:   i32,
    pub format:        String,
    pub created_at:    String,
    pub modified_at:   String,
    pub imported_at:   String,
    pub folder_path:   String,
    pub gps_lat:       Option<f64>,
    pub gps_lng:       Option<f64>,
    pub camera_make:   Option<String>,
    pub camera_model:  Option<String>,
    pub lens_model:    Option<String>,
    pub focal_length:  Option<f64>,
    pub aperture:      Option<f64>,
    pub shutter_speed: Option<String>,
    pub iso:           Option<i32>,
    pub exposure_comp: Option<f64>,
    pub is_favorite:   bool,
    pub is_deleted:    bool,
    pub deleted_at:    Option<String>,
    pub rating:        i32,
    pub thumbnail_s:   Option<String>,
    pub thumbnail_m:   Option<String>,
    pub thumbnail_l:   Option<String>,
}

/// 网格视图精简型（F-05 新增）
/// 仅包含 photos_list / search_photos / album_photos_list 所需的 12 个字段，
/// 与前端 PhotoThumb 接口严格对齐，消除 IPC 冗余传输。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoThumb {
    pub id:          String,
    pub file_name:   String,
    pub width:       i32,
    pub height:      i32,
    pub orientation: i32,
    pub created_at:  String,
    pub is_favorite: bool,
    pub is_deleted:  bool,
    pub thumbnail_s: Option<String>,
    pub thumbnail_m: Option<String>,
    pub format:      String,
    pub folder_path: String,
}

/// F-05：12 字段精简投影 SQL（被 query_paged / search / album_photos_list 共用）
/// file_size 和 imported_at 额外追加，供游标构建使用，不进入 PhotoThumb
pub const PHOTO_THUMB_SELECT: &str =
    "p.id, p.file_name, p.width, p.height, p.orientation, \
     p.created_at, p.is_favorite, p.is_deleted, \
     p.thumbnail_s, p.thumbnail_m, p.format, p.folder_path, \
     p.file_size, p.imported_at";

/// 分页响应（F-05：items 改为 Vec<PhotoThumb>）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoPage {
    pub items:       Vec<PhotoThumb>,
    pub next_cursor: Option<String>,
    pub total:       i64,
}

/// 插入新照片的数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewPhoto {
    pub file_path:     String,
    pub file_name:     String,
    pub file_size:     i64,
    pub file_hash:     String,
    pub width:         i32,
    pub height:        i32,
    pub orientation:   i32,
    pub format:        String,
    pub created_at:    String,
    pub modified_at:   String,
    pub folder_path:   String,
    pub gps_lat:       Option<f64>,
    pub gps_lng:       Option<f64>,
    pub camera_make:   Option<String>,
    pub camera_model:  Option<String>,
    pub lens_model:    Option<String>,
    pub focal_length:  Option<f64>,
    pub aperture:      Option<f64>,
    pub shutter_speed: Option<String>,
    pub iso:           Option<i32>,
    pub exposure_comp: Option<f64>,
}

// ─────────────────────────────────────────────────────────
//  Row 映射
// ─────────────────────────────────────────────────────────

/// 完整 Photo 行映射（SELECT * 查询使用）
pub fn row_to_photo(row: &rusqlite::Row<'_>) -> rusqlite::Result<Photo> {
    Ok(Photo {
        id:            row.get("id")?,
        file_path:     row.get("file_path")?,
        file_name:     row.get("file_name")?,
        file_size:     row.get("file_size")?,
        file_hash:     row.get("file_hash")?,
        width:         row.get("width")?,
        height:        row.get("height")?,
        orientation:   row.get::<_, Option<i32>>("orientation")?.unwrap_or(1),
        format:        row.get("format")?,
        created_at:    row.get("created_at")?,
        modified_at:   row.get("modified_at")?,
        imported_at:   row.get("imported_at")?,
        folder_path:   row.get("folder_path")?,
        gps_lat:       row.get("gps_lat")?,
        gps_lng:       row.get("gps_lng")?,
        camera_make:   row.get("camera_make")?,
        camera_model:  row.get("camera_model")?,
        lens_model:    row.get::<_, Option<String>>("lens_model").unwrap_or(None),
        focal_length:  row.get("focal_length")?,
        aperture:      row.get("aperture")?,
        shutter_speed: row.get("shutter_speed")?,
        iso:           row.get("iso")?,
        exposure_comp: row.get::<_, Option<f64>>("exposure_comp").unwrap_or(None),
        is_favorite:   row.get::<_, i32>("is_favorite")? != 0,
        is_deleted:    row.get::<_, i32>("is_deleted")? != 0,
        deleted_at:    row.get("deleted_at")?,
        rating:        row.get::<_, Option<i32>>("rating")?.unwrap_or(0),
        thumbnail_s:   row.get("thumbnail_s")?,
        thumbnail_m:   row.get("thumbnail_m")?,
        thumbnail_l:   row.get("thumbnail_l")?,
    })
}

/// F-05：精简 PhotoThumb 行映射（PHOTO_THUMB_SELECT 投影查询使用）
/// 通过列名访问，与列顺序无关，安全
pub fn row_to_photo_thumb(row: &rusqlite::Row<'_>) -> rusqlite::Result<PhotoThumb> {
    Ok(PhotoThumb {
        id:          row.get("id")?,
        file_name:   row.get("file_name")?,
        width:       row.get("width")?,
        height:      row.get("height")?,
        orientation: row.get::<_, Option<i32>>("orientation")?.unwrap_or(1),
        created_at:  row.get("created_at")?,
        is_favorite: row.get::<_, i32>("is_favorite")? != 0,
        is_deleted:  row.get::<_, i32>("is_deleted")? != 0,
        thumbnail_s: row.get("thumbnail_s")?,
        thumbnail_m: row.get("thumbnail_m")?,
        format:      row.get("format")?,
        folder_path: row.get("folder_path")?,
    })
}

// ─────────────────────────────────────────────────────────
//  写操作（不变）
// ─────────────────────────────────────────────────────────

pub fn insert_batch(conn: &Connection, photos: &[NewPhoto]) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut inserted = 0usize;

    for p in photos {
        let rows = tx.execute(
            r#"INSERT OR IGNORE INTO photos
               (id, file_path, file_name, file_size, file_hash,
                width, height, orientation, format,
                created_at, modified_at, folder_path,
                gps_lat, gps_lng, camera_make, camera_model, lens_model,
                focal_length, aperture, shutter_speed, iso, exposure_comp)
               VALUES
               (?1, ?2, ?3, ?4, ?5,
                ?6, ?7, ?8, ?9,
                ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, ?17,
                ?18, ?19, ?20, ?21, ?22)"#,
            params![
                Uuid::new_v4().to_string(),
                p.file_path, p.file_name, p.file_size, p.file_hash,
                p.width, p.height, p.orientation, p.format,
                p.created_at, p.modified_at, p.folder_path,
                p.gps_lat, p.gps_lng, p.camera_make, p.camera_model, p.lens_model,
                p.focal_length, p.aperture, p.shutter_speed, p.iso, p.exposure_comp,
            ],
        )?;
        inserted += rows;
    }

    tx.commit()?;
    Ok(inserted)
}

pub fn update_metadata(conn: &Connection, file_path: &str, p: &NewPhoto) -> Result<bool> {
    let rows = conn.execute(
        r#"UPDATE photos SET
            file_size = ?1, file_hash = ?2,
            width = ?3, height = ?4, orientation = ?5,
            modified_at = ?6,
            gps_lat = ?7, gps_lng = ?8,
            camera_make = ?9, camera_model = ?10, lens_model = ?11,
            focal_length = ?12, aperture = ?13, shutter_speed = ?14,
            iso = ?15, exposure_comp = ?16
           WHERE file_path = ?17 AND is_deleted = 0"#,
        params![
            p.file_size, p.file_hash,
            p.width, p.height, p.orientation,
            p.modified_at,
            p.gps_lat, p.gps_lng,
            p.camera_make, p.camera_model, p.lens_model,
            p.focal_length, p.aperture, p.shutter_speed,
            p.iso, p.exposure_comp,
            file_path,
        ],
    )?;
    Ok(rows > 0)
}

/// 批量更新 EXIF 元数据（F-06: 供 scan.rs to_update 循环使用）
pub fn update_metadata_batch(conn: &Connection, photos: &[NewPhoto]) -> Result<usize> {
    if photos.is_empty() { return Ok(0); }
    let tx = conn.unchecked_transaction()?;
    let mut updated = 0usize;
    for p in photos {
        let rows = tx.execute(
            r#"UPDATE photos SET
                file_size = ?1, file_hash = ?2,
                width = ?3, height = ?4, orientation = ?5,
                modified_at = ?6,
                gps_lat = ?7, gps_lng = ?8,
                camera_make = ?9, camera_model = ?10, lens_model = ?11,
                focal_length = ?12, aperture = ?13, shutter_speed = ?14,
                iso = ?15, exposure_comp = ?16
               WHERE file_path = ?17 AND is_deleted = 0"#,
            params![
                p.file_size, p.file_hash,
                p.width, p.height, p.orientation,
                p.modified_at,
                p.gps_lat, p.gps_lng,
                p.camera_make, p.camera_model, p.lens_model,
                p.focal_length, p.aperture, p.shutter_speed,
                p.iso, p.exposure_comp,
                p.file_path,
            ],
        )?;
        updated += rows;
    }
    tx.commit()?;
    Ok(updated)
}

pub fn set_favorite(conn: &Connection, id: &str, fav: bool) -> Result<()> {
    let rows = conn.execute(
        "UPDATE photos SET is_favorite = ?1 WHERE id = ?2",
        params![fav as i32, id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Photo {id} not found")));
    }
    Ok(())
}

pub fn set_favorite_batch(conn: &Connection, ids: &[String], fav: bool) -> Result<()> {
    if ids.is_empty() { return Ok(()); }
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE photos SET is_favorite = ?1 WHERE id = ?2",
            params![fav as i32, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn soft_delete(conn: &Connection, ids: &[String]) -> Result<()> {
    if ids.is_empty() { return Ok(()); }
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE photos SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
             WHERE id = ?1 AND is_deleted = 0",
            params![id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn restore(conn: &Connection, ids: &[String]) -> Result<()> {
    if ids.is_empty() { return Ok(()); }
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE photos SET is_deleted = 0, deleted_at = NULL WHERE id = ?1",
            params![id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn purge(conn: &Connection, ids: &[String]) -> Result<()> {
    if ids.is_empty() { return Ok(()); }
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute("DELETE FROM photos WHERE id = ?1", params![id])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn update_thumbnails(
    conn: &Connection,
    id: &str,
    thumb_s: Option<&str>,
    thumb_m: Option<&str>,
    thumb_l: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE photos SET thumbnail_s = ?1, thumbnail_m = ?2, thumbnail_l = ?3 WHERE id = ?4",
        params![thumb_s, thumb_m, thumb_l, id],
    )?;
    Ok(())
}

pub fn purge_old_trash(conn: &Connection) -> Result<usize> {
    let rows = conn.execute(
        "DELETE FROM photos WHERE is_deleted = 1 \
         AND deleted_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')",
        [],
    )?;
    Ok(rows)
}

// ─────────────────────────────────────────────────────────
//  读操作
// ─────────────────────────────────────────────────────────

pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<Photo>> {
    let mut stmt = conn.prepare("SELECT * FROM photos WHERE id = ?1")?;
    match stmt.query_row(params![id], row_to_photo) {
        Ok(p)                                     => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                    => Err(e.into()),
    }
}

pub fn get_by_path(conn: &Connection, path: &str) -> Result<Option<Photo>> {
    let mut stmt = conn.prepare("SELECT * FROM photos WHERE file_path = ?1")?;
    match stmt.query_row(params![path], row_to_photo) {
        Ok(p)                                     => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e)                                    => Err(e.into()),
    }
}

pub fn list_folder_index(
    conn: &Connection,
    folder_path: &str,
) -> Result<Vec<(String, String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT file_path, modified_at, file_size FROM photos \
         WHERE folder_path = ?1 AND is_deleted = 0"
    )?;
    let rows = stmt.query_map(params![folder_path], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?
    .collect::<std::result::Result<_, _>>()?;
    Ok(rows)
}

pub fn mark_missing(conn: &Connection, file_path: &str) -> Result<()> {
    conn.execute(
        "UPDATE photos SET is_deleted = 1, deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
         WHERE file_path = ?1 AND is_deleted = 0",
        params![file_path],
    )?;
    Ok(())
}

// ─────────────────────────────────────────────────────────
//  游标分页查询（F-05：SELECT 改为精确投影）
// ─────────────────────────────────────────────────────────

pub fn query_paged(
    conn: &Connection,
    filter: &PhotoFilter,
    cursor: Option<&str>,
    limit: u32,
) -> Result<PhotoPage> {
    let sort_col = match filter.sort_by.as_deref() {
        Some("file_name")   => "file_name",
        Some("file_size")   => "file_size",
        Some("imported_at") => "imported_at",
        _                   => "created_at",
    };
    let order     = if filter.sort_asc { "ASC"  } else { "DESC" };
    let cmp_dir   = if filter.sort_asc { ">"    } else { "<"    };
    let cmp_eq_id = if filter.sort_asc { ">"    } else { "<"    };

    let mut conds: Vec<String>                        = Vec::new();
    let mut bind:  Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if filter.is_deleted {
        conds.push("p.is_deleted = 1".into());
    } else {
        conds.push("p.is_deleted = 0".into());
    }

    if filter.favorites_only {
        conds.push("p.is_favorite = 1".into());
    }

    if let Some(ref folder) = filter.folder_path {
        bind.push(Box::new(folder.clone()));
        conds.push(format!("p.folder_path = ?{}", bind.len()));
    }

    if let Some(ref fmt) = filter.format {
        bind.push(Box::new(fmt.clone()));
        conds.push(format!("p.format = ?{}", bind.len()));
    }

    if let Some(ref from) = filter.date_from {
        bind.push(Box::new(from.clone()));
        conds.push(format!("p.created_at >= ?{}", bind.len()));
    }

    if let Some(ref to) = filter.date_to {
        bind.push(Box::new(to.clone()));
        conds.push(format!("p.created_at <= ?{}", bind.len()));
    }

    if filter.has_gps == Some(true) {
        conds.push("p.gps_lat IS NOT NULL".into());
    }

    let join_clause = if let Some(ref album_id) = filter.album_id {
        bind.push(Box::new(album_id.clone()));
        format!(
            "INNER JOIN album_photos ap ON p.id = ap.photo_id AND ap.album_id = ?{}",
            bind.len()
        )
    } else {
        // PrivateAlbum 修复：
        // 当不是在查看某个特定相册（album_id = None）时，
        // 排除属于私密相册（albums.is_private = 1）的照片。
        // 这确保私密相册内的照片在「所有照片」「收藏」「文件夹」等常规视图中不可见。
        //
        // 实现：NOT EXISTS 子查询
        //   对每张照片，检查是否存在对应的 album_photos 记录，
        //   且该记录关联的相册 is_private = 1。
        //   使用 COALESCE(a.is_private, 0) 保证向下兼容（旧数据库无此列时默认 0）。
        //
        // 注意：回收站视图（is_deleted = true）不需要此过滤，
        //   但加上也无害（回收站中的私密相册照片同样不应在回收站泄漏）。
        conds.push(
            "NOT EXISTS (\
                SELECT 1 FROM album_photos ap_priv \
                INNER JOIN albums a_priv ON ap_priv.album_id = a_priv.id \
                WHERE ap_priv.photo_id = p.id \
                AND COALESCE(a_priv.is_private, 0) = 1\
            )".into()
        );
        String::new()
    };

    let where_base = format!("WHERE {}", conds.join(" AND "));

    // ── BugFix：在追加 cursor 参数之前，先记录 where/join 阶段的参数数量 ──
    //
    // 问题根因：原实现先将 cursor 的 2 个参数 push 进全局 bind 向量，
    // 再用完整 bind（含 cursor 参数）执行 count_sql。
    // 但 count_sql 的 SQL 文本中没有 cursor 的 ? 占位符，
    // 导致 SQLite 报：
    //   "Wrong number of parameters passed to query. Got 1, needed 0"
    // → AppError::Database → code:"DB_ERROR" → 前端 toast "数据库操作失败"
    //
    // 触发条件：滚动触底 → loadMore() → photos_list 带 cursor → 必现
    // 首页（cursor=None）不触发，所以导入后首次加载正常，滚动后异常。
    //
    // 修复：记录追加 cursor 参数前的 bind 长度 count_bind_len，
    // count_sql 执行时只传 bind[..count_bind_len]（不含 cursor）。
    let count_bind_len = bind.len();

    let cursor_clause = if let Some(c) = cursor {
        if let Some((val, cid)) = c.split_once("::") {
            bind.push(Box::new(val.to_string()));
            let val_idx = bind.len();
            bind.push(Box::new(cid.to_string()));
            let id_idx = bind.len();
            format!(
                "AND (p.{sort_col} {cmp_dir} ?{val_idx} \
                 OR (p.{sort_col} = ?{val_idx} AND p.id {cmp_eq_id} ?{id_idx}))"
            )
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // ── 总数查询：仅使用 where/join 阶段的参数（不含 cursor）──
    let count_sql = format!("SELECT COUNT(*) FROM photos p {join_clause} {where_base}");
    let total: i64 = {
        let mut stmt = conn.prepare(&count_sql)?;
        let mut v = 0i64;
        stmt.query_and_then(
            // 关键修复：只传前 count_bind_len 个参数，排除 cursor 追加的参数
            rusqlite::params_from_iter(bind[..count_bind_len].iter().map(|b| b.as_ref())),
            |row| row.get::<_, i64>(0),
        )?.for_each(|r| { if let Ok(n) = r { v = n; } });
        v
    };

    // ── F-05：精确列投影（PHOTO_THUMB_SELECT 包含 file_size + imported_at 供游标）──
    let data_sql = format!(
        "SELECT {PHOTO_THUMB_SELECT} FROM photos p \
         {join_clause} \
         {where_base} \
         {cursor_clause} \
         ORDER BY p.{sort_col} {order}, p.id {order} \
         LIMIT ?{}",
        bind.len() + 1
    );

    bind.push(Box::new(limit as i64 + 1));

    let mut stmt = conn.prepare(&data_sql)?;
    let rows = stmt.query_and_then(
        rusqlite::params_from_iter(bind.iter().map(|b| b.as_ref())),
        |row| -> Result<(PhotoThumb, String)> {
            let thumb = row_to_photo_thumb(row).map_err(AppError::from)?;
            // 读取额外游标字段（不进入 PhotoThumb 结构）
            let sort_val = match sort_col {
                "file_name"   => thumb.file_name.clone(),
                "file_size"   => row.get::<_, i64>("file_size")
                    .map_err(AppError::from)?.to_string(),
                "imported_at" => row.get::<_, String>("imported_at")
                    .map_err(AppError::from)?,
                _             => thumb.created_at.clone(),
            };
            Ok((thumb, sort_val))
        },
    )?
    .collect::<Result<Vec<_>>>()?;

    let mut items: Vec<PhotoThumb> = rows.iter().map(|(t, _)| t.clone()).collect();
    let sort_vals: Vec<String>     = rows.into_iter().map(|(_, s)| s).collect();

    let next_cursor = if items.len() > limit as usize {
        items.pop();
        let last_idx = items.len().saturating_sub(1);
        items.get(last_idx).map(|p| format!("{}::{}", sort_vals[last_idx], p.id))
    } else {
        None
    };

    Ok(PhotoPage { items, next_cursor, total })
}

// ─────────────────────────────────────────────────────────
//  更新参数（由 commands/photo.rs 迁移至此）
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoUpdateParams {
    pub is_favorite: Option<bool>,
    pub rating:      Option<i32>,
}

// 向后兼容别名
pub use row_to_photo as row_to_photo_public;
