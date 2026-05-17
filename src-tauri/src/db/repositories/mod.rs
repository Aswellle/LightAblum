// src-tauri/src/db/repositories/mod.rs
pub mod photo;
pub mod album;
pub mod tag;
pub mod undo;

pub use photo::{PhotoRepository, SqlitePhotoRepository};
pub use album::{AlbumRepository, SqliteAlbumRepository};
pub use tag::{TagRepository, SqliteTagRepository};
pub use undo::{UndoRepository, SqliteUndoRepository};
