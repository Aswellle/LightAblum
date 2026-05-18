// src-tauri/src/db/mod.rs
pub mod album;
pub mod photo;
pub mod repositories;
pub mod schema;
pub mod search;
pub mod tag; // Phase-B: M-12 标签系统
pub use repositories::{
    AlbumRepository, PhotoRepository, SqliteAlbumRepository, SqlitePhotoRepository,
    SqliteTagRepository, SqliteUndoRepository, TagRepository, UndoRepository,
};
