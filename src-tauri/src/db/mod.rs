// src-tauri/src/db/mod.rs
pub mod album;
pub mod photo;
pub mod schema;
pub mod search;
pub mod tag;  // Phase-B: M-12 标签系统
pub mod repositories;
pub use repositories::{
    PhotoRepository, SqlitePhotoRepository,
    AlbumRepository, SqliteAlbumRepository,
    TagRepository, SqliteTagRepository,
    UndoRepository, SqliteUndoRepository,
};
