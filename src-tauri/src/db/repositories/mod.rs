// src-tauri/src/db/repositories/mod.rs
pub mod album;
pub mod photo;
pub mod tag;
pub mod undo;

pub use album::{AlbumRepository, SqliteAlbumRepository};
pub use photo::{PhotoRepository, SqlitePhotoRepository};
pub use tag::{SqliteTagRepository, TagRepository};
pub use undo::{SqliteUndoRepository, UndoRepository};
