// src-tauri/src/db/repositories/album.rs
//
// AlbumRepository trait + SqliteAlbumRepository implementation
//
// Delegates every method to the free functions in `db::album`,
// holding only an Arc<DbPool> so it is cheaply cloneable and Send + Sync.

use crate::db::album::{Album, AlbumSummary, UpdateAlbumParams};
use crate::db::photo::PhotoPage;
use crate::error::{AppError, Result};
use crate::state::DbPool;
use std::sync::Arc;

// ─────────────────────────────────────────────────────────
//  Trait
// ─────────────────────────────────────────────────────────

pub trait AlbumRepository: Send + Sync {
    fn list_summaries(&self) -> Result<Vec<AlbumSummary>>;
    fn list_all_summaries(&self) -> Result<Vec<AlbumSummary>>;
    fn get_by_id(&self, id: &str) -> Result<Option<Album>>;
    fn create(&self, name: &str, description: Option<&str>) -> Result<Album>;
    fn create_private(&self, name: &str, password_hash: &str) -> Result<Album>;
    fn update(&self, id: &str, params: &UpdateAlbumParams) -> Result<Album>;
    fn delete(&self, id: &str) -> Result<()>;
    fn set_private(&self, id: &str, is_private: bool, password_hash: Option<&str>) -> Result<Album>;
    fn get_password_hash(&self, id: &str) -> Result<Option<String>>;
    fn list_photos(&self, album_id: &str, cursor: Option<&str>, limit: u32) -> Result<PhotoPage>;
    fn add_photos(&self, album_id: &str, photo_ids: &[String]) -> Result<()>;
    fn remove_photos(&self, album_id: &str, photo_ids: &[String]) -> Result<()>;
    fn reorder_photos(&self, album_id: &str, ordered_ids: &[String]) -> Result<()>;
}

// ─────────────────────────────────────────────────────────
//  SqliteAlbumRepository
// ─────────────────────────────────────────────────────────

pub struct SqliteAlbumRepository {
    pool: Arc<DbPool>,
}

impl SqliteAlbumRepository {
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
//  Trait implementation — delegates to db::album
// ─────────────────────────────────────────────────────────

impl AlbumRepository for SqliteAlbumRepository {
    fn list_summaries(&self) -> Result<Vec<AlbumSummary>> {
        let conn = self.conn()?;
        crate::db::album::list_summaries(&conn)
    }

    fn list_all_summaries(&self) -> Result<Vec<AlbumSummary>> {
        let conn = self.conn()?;
        crate::db::album::list_all_summaries(&conn)
    }

    fn get_by_id(&self, id: &str) -> Result<Option<Album>> {
        let conn = self.conn()?;
        crate::db::album::get_by_id(&conn, id)
    }

    fn create(&self, name: &str, description: Option<&str>) -> Result<Album> {
        let conn = self.conn()?;
        crate::db::album::create(&conn, name, description)
    }

    fn create_private(&self, name: &str, password_hash: &str) -> Result<Album> {
        let conn = self.conn()?;
        crate::db::album::create_private(&conn, name, password_hash)
    }

    fn update(&self, id: &str, params: &UpdateAlbumParams) -> Result<Album> {
        let conn = self.conn()?;
        crate::db::album::update(&conn, id, params)
    }

    fn delete(&self, id: &str) -> Result<()> {
        let conn = self.conn()?;
        crate::db::album::delete(&conn, id)
    }

    fn set_private(&self, id: &str, is_private: bool, password_hash: Option<&str>) -> Result<Album> {
        let conn = self.conn()?;
        crate::db::album::set_private(&conn, id, is_private, password_hash)
    }

    fn get_password_hash(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn()?;
        crate::db::album::get_password_hash(&conn, id)
    }

    fn list_photos(&self, album_id: &str, cursor: Option<&str>, limit: u32) -> Result<PhotoPage> {
        let conn = self.conn()?;
        crate::db::album::list_photos(&conn, album_id, cursor, limit)
    }

    fn add_photos(&self, album_id: &str, photo_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        crate::db::album::add_photos(&conn, album_id, photo_ids)
    }

    fn remove_photos(&self, album_id: &str, photo_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        crate::db::album::remove_photos(&conn, album_id, photo_ids)
    }

    fn reorder_photos(&self, album_id: &str, ordered_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        crate::db::album::reorder_photos(&conn, album_id, ordered_ids)
    }
}
