// src-tauri/src/db/search.rs
//
// 搜索与统计查询
//
// 修复说明（骨架版 SQL 注入漏洞）：
//   骨架版通过字符串拼接构建 WHERE 条件，存在 SQL 注入风险。
//   本版本全部改用 rusqlite params! 绑定参数。
//
// Phase-C（搜索增强）：
//   1. search() 文本搜索改用 search_text 索引列（V5 迁移后可用），
//      将 file_name/camera_make/camera_model 三路 LIKE 合并为单列查询，
//      在 idx_photos_search_text 索引辅助下性能显著提升。
//   2. suggestions() 补全标签路径：返回结构扩展 tags 字段，
//      匹配 tags.name LIKE ?。
//   3. SearchSuggestions 结构体新增 tags: Vec<TagSuggestion> 字段，
//      与 IPC 层 types/ipc.ts 保持对齐。

use crate::error::Result;
use crate::db::photo::{PhotoThumb, PhotoPage, PHOTO_THUMB_SELECT, row_to_photo_thumb};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

// Phase-C：标签建议精简结构（避免循环依赖 db::tag）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagSuggestion {
    pub id:    String,
    pub name:  String,
    pub color: String,
}

// ─────────────────────────────────────────────────────────
//  搜索请求
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub text:        Option<String>,   // 文件名模糊搜索
    pub date_from:   Option<String>,   // ISO 8601
    pub date_to:     Option<String>,
    pub camera_make: Option<String>,
    pub camera_model:Option<String>,
    pub has_gps:     Option<bool>,
    pub format:      Option<String>,
    pub rating:      Option<i32>,      // 最低评分
    pub limit:       Option<u32>,
    pub cursor:      Option<String>,
    /// Phase-B（M-12）：按标签 ID 过滤，AND 语义（照片必须包含所有指定标签）
    pub tag_ids:     Option<Vec<String>>,
}

// ─────────────────────────────────────────────────────────
//  统计信息
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total_photos:         i64,
    pub total_favorites:      i64,
    pub total_albums:         i64,
    pub total_size_bytes:     i64,
    pub format_distribution:  Vec<FormatCount>,
    pub camera_distribution:  Vec<CameraCount>,
    pub date_range:           DateRange,
    pub monthly_counts:       Vec<MonthCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatCount {
    pub format: String,
    pub count:  i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraCount {
    pub camera: String,
    pub count:  i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateRange {
    pub earliest: Option<String>,
    pub latest:   Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthCount {
    pub month: String,  // "YYYY-MM"
    pub count: i64,
}

// ─────────────────────────────────────────────────────────
//  搜索实现
// ─────────────────────────────────────────────────────────

/// 全文搜索（参数化查询，安全版本）
pub fn search(conn: &Connection, q: &SearchQuery) -> Result<PhotoPage> {
    let limit = q.limit.unwrap_or(200).min(1000);

    let mut conds: Vec<String> = vec!["p.is_deleted = 0".into()];
    let mut bind: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    // Phase-C：文本搜索改用 search_text 索引列（V5 迁移后填充）
    // 回退策略：若 search_text 为 NULL（V5 迁移前的历史数据），
    //   COALESCE(p.search_text, p.file_name) 确保不漏查旧记录。
    if let Some(ref text) = q.text {
        let pattern = format!("%{}%", text);
        bind.push(Box::new(pattern));
        conds.push(format!(
            "COALESCE(p.search_text, p.file_name) LIKE ?{} ESCAPE '\\'",
            bind.len()
        ));
    }

    if let Some(ref from) = q.date_from {
        bind.push(Box::new(from.clone()));
        conds.push(format!("p.created_at >= ?{}", bind.len()));
    }

    if let Some(ref to) = q.date_to {
        bind.push(Box::new(to.clone()));
        conds.push(format!("p.created_at <= ?{}", bind.len()));
    }

    if let Some(ref make) = q.camera_make {
        let pattern = format!("%{make}%");
        bind.push(Box::new(pattern));
        conds.push(format!("p.camera_make LIKE ?{}", bind.len()));
    }

    if let Some(ref model) = q.camera_model {
        let pattern = format!("%{model}%");
        bind.push(Box::new(pattern));
        conds.push(format!("p.camera_model LIKE ?{}", bind.len()));
    }

    if let Some(true) = q.has_gps {
        conds.push("p.gps_lat IS NOT NULL".into());
    }

    if let Some(ref fmt) = q.format {
        bind.push(Box::new(fmt.clone()));
        conds.push(format!("p.format = ?{}", bind.len()));
    }

    if let Some(min_rating) = q.rating {
        if min_rating > 0 {
            bind.push(Box::new(min_rating));
            conds.push(format!("p.rating >= ?{}", bind.len()));
        }
    }

    // Phase-B（M-12）：标签过滤（AND 语义：照片必须拥有全部指定标签）
    // 每个 tag_id 生成一个独立的 EXISTS 子查询，避免 JOIN 导致行重复
    if let Some(ref ids) = q.tag_ids {
        for tag_id in ids {
            bind.push(Box::new(tag_id.clone()));
            conds.push(format!(
                "EXISTS (SELECT 1 FROM photo_tags pt WHERE pt.photo_id = p.id AND pt.tag_id = ?{})",
                bind.len()
            ));
        }
    }

    let where_clause = format!("WHERE {}", conds.join(" AND "));

    // 总数
    let count_sql = format!("SELECT COUNT(*) FROM photos p {where_clause}");
    let total: i64 = {
        let mut stmt = conn.prepare(&count_sql)?;
        let mut val = 0i64;
        stmt.query_and_then(
            rusqlite::params_from_iter(bind.iter().map(|b| b.as_ref())),
            |row| row.get::<_, i64>(0),
        )?.for_each(|r| { if let Ok(v) = r { val = v; } });
        val
    };

    // 游标
    let cursor_clause = if let Some(ref c) = q.cursor {
        if let Some((val, cid)) = c.split_once("::") {
            bind.push(Box::new(val.to_string()));
            let vi = bind.len();
            bind.push(Box::new(cid.to_string()));
            let ci = bind.len();
            format!("AND (p.created_at < ?{vi} OR (p.created_at = ?{vi} AND p.id < ?{ci}))")
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    bind.push(Box::new(limit as i64 + 1));
    let data_sql = format!(
        "SELECT {PHOTO_THUMB_SELECT} FROM photos p {where_clause} {cursor_clause} \
         ORDER BY p.created_at DESC, p.id DESC \
         LIMIT ?{}",
        bind.len()
    );

    let mut stmt = conn.prepare(&data_sql)?;
    let mut items: Vec<PhotoThumb> = stmt
        .query_and_then(
            rusqlite::params_from_iter(bind.iter().map(|b| b.as_ref())),
            |row| row_to_photo_thumb(row).map_err(crate::error::AppError::from),
        )?
        .collect::<Result<_>>()?;

    let next_cursor = if items.len() > limit as usize {
        items.pop();
        items.last().map(|p| format!("{}::{}", p.created_at, p.id))
    } else {
        None
    };

    Ok(PhotoPage { items, next_cursor, total })
}

// ─────────────────────────────────────────────────────────
//  搜索建议（自动补全）
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSuggestions {
    pub file_names: Vec<String>,
    pub cameras:    Vec<String>,
    pub folders:    Vec<String>,
    /// Phase-C：标签名称建议（匹配 tags.name LIKE ?）
    pub tags:       Vec<TagSuggestion>,
}

pub fn suggestions(conn: &Connection, q: &str, limit: u32) -> Result<SearchSuggestions> {
    let pattern = format!("%{q}%");

    // 文件名建议
    let mut stmt = conn.prepare(
        "SELECT DISTINCT file_name FROM photos \
         WHERE file_name LIKE ?1 ESCAPE '\\' AND is_deleted = 0 \
         ORDER BY imported_at DESC LIMIT ?2"
    )?;
    let file_names: Vec<String> = stmt
        .query_map(params![pattern, limit], |row| row.get(0))?
        .collect::<std::result::Result<_, _>>()?;

    // 相机型号建议
    let mut stmt = conn.prepare(
        "SELECT DISTINCT camera_model FROM photos \
         WHERE camera_model LIKE ?1 ESCAPE '\\' AND is_deleted = 0 \
         ORDER BY camera_model LIMIT ?2"
    )?;
    let cameras: Vec<String> = stmt
        .query_map(params![pattern, limit], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .filter_map(|v: Option<String>| v)
        .collect();

    // 文件夹建议
    let mut stmt = conn.prepare(
        "SELECT DISTINCT folder_path FROM photos \
         WHERE folder_path LIKE ?1 ESCAPE '\\' AND is_deleted = 0 \
         ORDER BY folder_path LIMIT ?2"
    )?;
    let folders: Vec<String> = stmt
        .query_map(params![pattern, limit], |row| row.get(0))?
        .collect::<std::result::Result<_, _>>()?;

    // Phase-C：标签建议
    let mut stmt = conn.prepare(
        "SELECT id, name, color FROM tags \
         WHERE name LIKE ?1 ESCAPE '\\' \
         ORDER BY usage_count DESC, name ASC LIMIT ?2"
    )?;
    let tags: Vec<TagSuggestion> = stmt
        .query_map(params![pattern, limit], |row| {
            Ok(TagSuggestion {
                id:    row.get(0)?,
                name:  row.get(1)?,
                color: row.get(2)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;

    Ok(SearchSuggestions { file_names, cameras, folders, tags })
}

// ─────────────────────────────────────────────────────────
//  库统计（状态栏 / 信息面板）
// ─────────────────────────────────────────────────────────

pub fn library_stats(conn: &Connection) -> Result<LibraryStats> {
    // 基础计数
    let total_photos: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE is_deleted = 0",
        [], |row| row.get(0),
    )?;

    let total_favorites: i64 = conn.query_row(
        "SELECT COUNT(*) FROM photos WHERE is_deleted = 0 AND is_favorite = 1",
        [], |row| row.get(0),
    )?;

    let total_albums: i64 = conn.query_row(
        "SELECT COUNT(*) FROM albums",
        [], |row| row.get(0),
    )?;

    let total_size_bytes: i64 = conn.query_row(
        "SELECT COALESCE(SUM(file_size), 0) FROM photos WHERE is_deleted = 0",
        [], |row| row.get(0),
    )?;

    // 格式分布
    let mut stmt = conn.prepare(
        "SELECT format, COUNT(*) as cnt FROM photos \
         WHERE is_deleted = 0 GROUP BY format ORDER BY cnt DESC"
    )?;
    let format_distribution: Vec<FormatCount> = stmt
        .query_map([], |row| Ok(FormatCount {
            format: row.get(0)?,
            count:  row.get(1)?,
        }))?
        .collect::<std::result::Result<_, _>>()?;

    // 相机分布（Top 10）
    let mut stmt = conn.prepare(
        "SELECT COALESCE(camera_model, camera_make, '未知相机') as cam, \
                COUNT(*) as cnt \
         FROM photos WHERE is_deleted = 0 AND (camera_model IS NOT NULL OR camera_make IS NOT NULL) \
         GROUP BY cam ORDER BY cnt DESC LIMIT 10"
    )?;
    let camera_distribution: Vec<CameraCount> = stmt
        .query_map([], |row| Ok(CameraCount {
            camera: row.get(0)?,
            count:  row.get(1)?,
        }))?
        .collect::<std::result::Result<_, _>>()?;

    // 日期范围
    let date_range: DateRange = conn.query_row(
        "SELECT MIN(created_at), MAX(created_at) FROM photos WHERE is_deleted = 0",
        [],
        |row| Ok(DateRange {
            earliest: row.get(0)?,
            latest:   row.get(1)?,
        }),
    )?;

    // 近 12 个月计数
    let mut stmt = conn.prepare(
        "SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as cnt \
         FROM photos WHERE is_deleted = 0 \
           AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-12 months') \
         GROUP BY month ORDER BY month DESC"
    )?;
    let monthly_counts: Vec<MonthCount> = stmt
        .query_map([], |row| Ok(MonthCount {
            month: row.get(0)?,
            count: row.get(1)?,
        }))?
        .collect::<std::result::Result<_, _>>()?;

    Ok(LibraryStats {
        total_photos,
        total_favorites,
        total_albums,
        total_size_bytes,
        format_distribution,
        camera_distribution,
        date_range,
        monthly_counts,
    })
}
