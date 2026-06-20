// src-tauri/src/db/repositories/photo.rs
//
// PhotoRepository trait + SqlitePhotoRepository implementation
//
// The trait defines the full photo data-access contract.
// SqlitePhotoRepository delegates every method to the existing
// free functions in `db::photo` and `db::search`, holding only
// an Arc<DbPool> so it is cheaply cloneable and Send + Sync.

use crate::db::photo::{NewPhoto, Photo, PhotoPage};
use crate::db::search::{LibraryStats, SearchQuery, SearchSuggestions};
use crate::error::Result;
use crate::query::filter::PhotoFilter;
use crate::state::DbPool;
use std::sync::Arc;

// ─────────────────────────────────────────────────────────
//  Trait
// ─────────────────────────────────────────────────────────

pub trait PhotoRepository: Send + Sync {
    fn list(&self, filter: &PhotoFilter, cursor: Option<&str>, limit: u32) -> Result<PhotoPage>;
    fn get(&self, id: &str) -> Result<Option<Photo>>;
    fn get_batch(&self, ids: &[String]) -> Result<Vec<Photo>>;
    fn update_thumbnails(
        &self,
        id: &str,
        s: Option<&str>,
        m: Option<&str>,
        l: Option<&str>,
    ) -> Result<()>;
    fn set_favorite(&self, id: &str, value: bool) -> Result<()>;
    fn set_favorite_batch(&self, ids: &[String], value: bool) -> Result<()>;
    fn get_batch_favorites(&self, ids: &[String]) -> Result<std::collections::HashMap<String, bool>>;
    fn set_rating(&self, id: &str, rating: i32) -> Result<()>;
    fn soft_delete(&self, ids: &[String]) -> Result<()>;
    fn restore(&self, ids: &[String]) -> Result<()>;
    fn purge(&self, ids: &[String]) -> Result<()>;
    fn insert_batch(&self, photos: &[NewPhoto]) -> Result<usize>;
    fn update_metadata(&self, file_path: &str, photo: &NewPhoto) -> Result<bool>;
    fn update_metadata_batch(&self, photos: &[NewPhoto]) -> Result<usize>;
    fn get_by_path(&self, path: &str) -> Result<Option<Photo>>;
    fn mark_missing(&self, file_path: &str) -> Result<()>;
    fn list_folder_index(&self, folder_path: &str) -> Result<Vec<(String, String, i64)>>;
    fn purge_old_trash(&self) -> Result<usize>;
    fn search(&self, query: &SearchQuery) -> Result<PhotoPage>;
    fn search_suggestions(&self, q: &str, limit: u32) -> Result<SearchSuggestions>;
    fn search_stats(&self) -> Result<LibraryStats>;
}

// ─────────────────────────────────────────────────────────
//  SqlitePhotoRepository
// ─────────────────────────────────────────────────────────

pub struct SqlitePhotoRepository {
    pool: Arc<DbPool>,
}

impl SqlitePhotoRepository {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self { pool }
    }

    fn conn(&self) -> Result<crate::state::DbConn> {
        use crate::error::AppError;
        self.pool
            .get()
            .map_err(|e| AppError::Other(format!("DB pool error: {e}")))
    }
}

// ─────────────────────────────────────────────────────────
//  Trait implementation — delegates to db::photo / db::search
// ─────────────────────────────────────────────────────────

impl PhotoRepository for SqlitePhotoRepository {
    fn list(&self, filter: &PhotoFilter, cursor: Option<&str>, limit: u32) -> Result<PhotoPage> {
        let conn = self.conn()?;
        crate::db::photo::query_paged(&conn, filter, cursor, limit)
    }

    fn get(&self, id: &str) -> Result<Option<Photo>> {
        let conn = self.conn()?;
        crate::db::photo::get_by_id(&conn, id)
    }

    fn get_batch(&self, ids: &[String]) -> Result<Vec<Photo>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let conn = self.conn()?;
        let placeholders: String = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, file_path, file_name, file_size, file_hash, width, height, orientation, \
             format, created_at, modified_at, imported_at, folder_path, \
             gps_lat, gps_lng, camera_make, camera_model, lens_model, \
             focal_length, aperture, shutter_speed, iso, exposure_comp, \
             is_favorite, is_deleted, deleted_at, rating, \
             thumbnail_s, thumbnail_m, thumbnail_l \
             FROM photos WHERE id IN ({})",
            placeholders
        );
        let params: Vec<&dyn rusqlite::ToSql> = ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let photos = stmt
            .query_map(params.as_slice(), crate::db::photo::row_to_photo)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(photos)
    }

    fn update_thumbnails(
        &self,
        id: &str,
        s: Option<&str>,
        m: Option<&str>,
        l: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn()?;
        crate::db::photo::update_thumbnails(&conn, id, s, m, l)
    }

    fn set_favorite(&self, id: &str, value: bool) -> Result<()> {
        let conn = self.conn()?;
        crate::db::photo::set_favorite(&conn, id, value)
    }

    fn set_favorite_batch(&self, ids: &[String], value: bool) -> Result<()> {
        let conn = self.conn()?;
        crate::db::photo::set_favorite_batch(&conn, ids, value)
    }

    fn get_batch_favorites(
        &self,
        ids: &[String],
    ) -> Result<std::collections::HashMap<String, bool>> {
        if ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        let conn = self.conn()?;
        let placeholders: String = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, is_favorite FROM photos WHERE id IN ({})",
            placeholders
        );
        let params: Vec<&dyn rusqlite::ToSql> = ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let map = stmt
            .query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>("id")?,
                    row.get::<_, i32>("is_favorite")? != 0,
                ))
            })?
            .collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()?;
        Ok(map)
    }

    fn set_rating(&self, id: &str, rating: i32) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE photos SET rating = ?1 WHERE id = ?2",
            rusqlite::params![rating, id],
        )?;
        Ok(())
    }

    fn soft_delete(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        crate::db::photo::soft_delete(&conn, ids)
    }

    fn restore(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        crate::db::photo::restore(&conn, ids)
    }

    fn purge(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        crate::db::photo::purge(&conn, ids)
    }

    fn insert_batch(&self, photos: &[NewPhoto]) -> Result<usize> {
        let conn = self.conn()?;
        crate::db::photo::insert_batch(&conn, photos)
    }

    fn update_metadata(&self, file_path: &str, photo: &NewPhoto) -> Result<bool> {
        let conn = self.conn()?;
        crate::db::photo::update_metadata(&conn, file_path, photo)
    }

    fn update_metadata_batch(&self, photos: &[NewPhoto]) -> Result<usize> {
        let conn = self.conn()?;
        crate::db::photo::update_metadata_batch(&conn, photos)
    }

    fn get_by_path(&self, path: &str) -> Result<Option<Photo>> {
        let conn = self.conn()?;
        crate::db::photo::get_by_path(&conn, path)
    }

    fn mark_missing(&self, file_path: &str) -> Result<()> {
        let conn = self.conn()?;
        crate::db::photo::mark_missing(&conn, file_path)
    }

    fn list_folder_index(&self, folder_path: &str) -> Result<Vec<(String, String, i64)>> {
        let conn = self.conn()?;
        crate::db::photo::list_folder_index(&conn, folder_path)
    }

    fn purge_old_trash(&self) -> Result<usize> {
        let conn = self.conn()?;
        crate::db::photo::purge_old_trash(&conn)
    }

    fn search(&self, query: &SearchQuery) -> Result<PhotoPage> {
        let conn = self.conn()?;
        crate::db::search::search(&conn, query)
    }

    fn search_suggestions(&self, q: &str, limit: u32) -> Result<SearchSuggestions> {
        let conn = self.conn()?;
        crate::db::search::suggestions(&conn, q, limit)
    }

    fn search_stats(&self) -> Result<LibraryStats> {
        let conn = self.conn()?;
        crate::db::search::library_stats(&conn)
    }
}
