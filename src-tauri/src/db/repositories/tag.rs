// src-tauri/src/db/repositories/tag.rs
//
// TagRepository trait + SqliteTagRepository implementation
//
// Delegates every method to the free functions in `db::tag`,
// holding only an Arc<DbPool> so it is cheaply cloneable and Send + Sync.

use crate::db::tag::Tag;
use crate::error::{AppError, Result};
use crate::state::DbPool;
use std::sync::Arc;

// ─────────────────────────────────────────────────────────
//  Trait
// ─────────────────────────────────────────────────────────

pub trait TagRepository: Send + Sync {
    fn list(&self) -> Result<Vec<Tag>>;
    fn create(&self, name: &str, color: &str) -> Result<Tag>;
    fn delete(&self, id: &str) -> Result<()>;
    fn get_for_photo(&self, photo_id: &str) -> Result<Vec<Tag>>;
    fn add_to_photo(&self, photo_id: &str, tag_ids: &[String]) -> Result<()>;
    fn remove_from_photo(&self, photo_id: &str, tag_ids: &[String]) -> Result<()>;
}

// ─────────────────────────────────────────────────────────
//  SqliteTagRepository
// ─────────────────────────────────────────────────────────

pub struct SqliteTagRepository {
    pool: Arc<DbPool>,
}

impl SqliteTagRepository {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self { pool }
    }

    fn conn(&self) -> Result<crate::state::DbConn> {
        self.pool
            .get()
            .map_err(|e| AppError::Other(format!("DB pool error: {e}")))
    }
}

// ─────────────────────────────────────────────────────────
//  Trait implementation — delegates to db::tag
// ─────────────────────────────────────────────────────────

impl TagRepository for SqliteTagRepository {
    fn list(&self) -> Result<Vec<Tag>> {
        let conn = self.conn()?;
        crate::db::tag::list_tags(&conn)
    }

    fn create(&self, name: &str, color: &str) -> Result<Tag> {
        let conn = self.conn()?;
        crate::db::tag::create_tag(&conn, name, color)
    }

    fn delete(&self, id: &str) -> Result<()> {
        let conn = self.conn()?;
        crate::db::tag::delete_tag(&conn, id)
    }

    fn get_for_photo(&self, photo_id: &str) -> Result<Vec<Tag>> {
        let conn = self.conn()?;
        crate::db::tag::get_photo_tags(&conn, photo_id)
    }

    fn add_to_photo(&self, photo_id: &str, tag_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        crate::db::tag::add_photo_tags(&conn, photo_id, tag_ids)
    }

    fn remove_from_photo(&self, photo_id: &str, tag_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        crate::db::tag::remove_photo_tags(&conn, photo_id, tag_ids)
    }
}
