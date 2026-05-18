// src-tauri/src/db/tag.rs
//
// 标签数据层（Phase-B M-12）
//
// 提供 tags / photo_tags 表的完整 CRUD 操作：
//   list_tags        — 列出所有标签，按 sort_order ASC, usage_count DESC 排序
//   create_tag       — 创建标签（name 大小写不敏感唯一约束）
//   delete_tag       — 删除标签（级联删除 photo_tags）
//   add_photo_tags   — 为照片添加标签（INSERT OR IGNORE，幂等）
//   remove_photo_tags — 从照片移除标签
//   get_photo_tags   — 获取照片的所有标签

use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─────────────────────────────────────────────────────────
//  数据结构
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: String,
    pub sort_order: i32,
    pub usage_count: i32,
}

// ─────────────────────────────────────────────────────────
//  标签查询
// ─────────────────────────────────────────────────────────

/// 列出所有标签
/// 排序规则：sort_order ASC，sort_order 相同时 usage_count DESC（热门靠前）
pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, created_at, sort_order, usage_count \
         FROM tags \
         ORDER BY sort_order ASC, usage_count DESC, name ASC",
    )?;
    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
                sort_order: row.get(4)?,
                usage_count: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(tags)
}

/// 获取照片的所有标签（按 sort_order ASC, name ASC）
pub fn get_photo_tags(conn: &Connection, photo_id: &str) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, t.created_at, t.sort_order, t.usage_count \
         FROM tags t \
         INNER JOIN photo_tags pt ON pt.tag_id = t.id \
         WHERE pt.photo_id = ?1 \
         ORDER BY t.sort_order ASC, t.name ASC",
    )?;
    let tags = stmt
        .query_map(params![photo_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
                sort_order: row.get(4)?,
                usage_count: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(tags)
}

// ─────────────────────────────────────────────────────────
//  标签写操作
// ─────────────────────────────────────────────────────────

/// 创建标签
/// 若同名标签已存在（NOCASE 唯一约束），返回 AppError::Other("TAG_DUPLICATE")
pub fn create_tag(conn: &Connection, name: &str, color: &str) -> Result<Tag> {
    let id = Uuid::new_v4().to_string();

    let result = conn.execute(
        "INSERT INTO tags (id, name, color) VALUES (?1, ?2, ?3)",
        params![id, name, color],
    );

    match result {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(ref e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            return Err(AppError::Other("TAG_DUPLICATE".into()));
        }
        Err(e) => return Err(AppError::Database(e)),
    }

    let tag = conn.query_row(
        "SELECT id, name, color, created_at, sort_order, usage_count FROM tags WHERE id = ?1",
        params![id],
        |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
                sort_order: row.get(4)?,
                usage_count: row.get(5)?,
            })
        },
    )?;
    Ok(tag)
}

/// 删除标签（级联删除 photo_tags，触发器同步减 usage_count）
pub fn delete_tag(conn: &Connection, id: &str) -> Result<()> {
    let rows = conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Tag {id} not found")));
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────
//  照片-标签关联写操作
// ─────────────────────────────────────────────────────────

/// 为照片添加标签（幂等，INSERT OR IGNORE 跳过已存在的关联）
/// 触发器自动递增 tags.usage_count
pub fn add_photo_tags(conn: &Connection, photo_id: &str, tag_ids: &[String]) -> Result<()> {
    if tag_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for tag_id in tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?1, ?2)",
            params![photo_id, tag_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// 从照片移除标签
/// 触发器自动递减 tags.usage_count
pub fn remove_photo_tags(conn: &Connection, photo_id: &str, tag_ids: &[String]) -> Result<()> {
    if tag_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for tag_id in tag_ids {
        tx.execute(
            "DELETE FROM photo_tags WHERE photo_id = ?1 AND tag_id = ?2",
            params![photo_id, tag_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}
