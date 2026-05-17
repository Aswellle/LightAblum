// src-tauri/src/commands/photo.rs
//
// 照片相关 Tauri IPC 命令（v2 — 新增 photos_purge_data）
//
// v2 新增：
//   photos_purge_data — 仅从程序数据库中清除（不删磁盘原文件）
//   对应「回收站彻底清除」功能中的「仅清除记录」选项
//
// Phase-A（撤销完整性）：
//   photos_delete    — 软删除前调用 record_undo("photo_delete", ...)
//   photos_favorite  — 切换收藏前先读取旧值，再调用 record_undo("favorite_set", ...)
//
// Phase-D（批量操作完整化）：
//   photos_favorite_batch — 批量切换收藏状态
//     问题：BatchActionBar 原通过 Promise.all(ids.map(id => setFavorite(id, value)))
//           并发调用单次命令，会写 N 条 undo_log，但 undo_last 每次只弹出最后一条，
//           导致无法一次性撤销整批收藏操作。
//     修复：新增批量命令，先查询所有照片的旧值，原子写一条 "favorite_batch" undo_log，
//           再调用 set_favorite_batch 批量更新，保证一次 Ctrl+Z 可回滚整批操作。
//     payload 格式：{ "ids": [...], "old_values": { "id1": false, "id2": true, ... }, "new_value": true }

use crate::db::photo::{Photo, PhotoPage, PhotoUpdateParams};
use crate::db::search::{LibraryStats, SearchQuery, SearchSuggestions};
use crate::error::AppError;
use crate::query::filter::PhotoFilter;
use crate::state::AppState;
use tauri::State;

// ─────────────────────────────────────────────────────────
//  查询
// ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn photos_list(
    filter:  PhotoFilter,
    cursor:  Option<String>,
    limit:   Option<u32>,
    state:   State<'_, AppState>,
) -> Result<PhotoPage, AppError> {
    let limit = limit.unwrap_or(100).min(500);
    state.photos.list(&filter, cursor.as_deref(), limit).map_err(Into::into)
}

#[tauri::command]
pub async fn photos_get(
    id:    String,
    state: State<'_, AppState>,
) -> Result<Photo, AppError> {
    state.photos.get(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Photo {id} not found")))
}

#[tauri::command]
pub async fn photos_get_batch(
    ids:   Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Photo>, AppError> {
    if ids.len() > 100 {
        return Err(AppError::InvalidArgument("Batch size exceeds limit of 100".into()));
    }
    state.photos.get_batch(&ids).map_err(Into::into)
}

// ─────────────────────────────────────────────────────────
//  修改
// ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn photos_update(
    id:     String,
    params: PhotoUpdateParams,
    state:  State<'_, AppState>,
) -> Result<Photo, AppError> {
    let conn = state.conn()?;
    if let Some(fav) = params.is_favorite {
        state.photos.set_favorite(&id, fav)?;
    }
    if let Some(rating) = params.rating {
        if rating > 5 {
            return Err(AppError::InvalidArgument("Rating must be 0-5".into()));
        }
        conn.execute(
            "UPDATE photos SET rating = ?1 WHERE id = ?2",
            rusqlite::params![rating, id],
        )?;
    }
    state.photos.get(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Photo {id} not found")))
}

/// 切换单张照片的收藏状态
///
/// Phase-A：操作前先读取当前 is_favorite 值并写入 undo_log，
/// 支持 Ctrl+Z 恢复到操作前状态。
/// payload 格式：{ "id": "...", "old_value": <bool> }
#[tauri::command]
pub async fn photos_favorite(
    id:    String,
    value: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // Phase-A：读取操作前的旧值，记录到 undo_log
    if let Ok(Some(existing)) = state.photos.get(&id) {
        let old_value = existing.is_favorite;
        // 仅当值确实发生变化时才写 undo_log，避免无意义记录
        if old_value != value {
            let payload = serde_json::json!({
                "id":        id,
                "old_value": old_value,
            })
            .to_string();
            let _ = state.undo.record("favorite_set", &payload);
        }
    }

    state.photos.set_favorite(&id, value).map_err(Into::into)
}

/// 批量切换收藏状态（Phase-D M-11）
///
/// 相对于对每张照片分别调用 photos_favorite 的问题：
///   - N 张照片写 N 条 undo_log，Ctrl+Z 每次只能撤销一条
///   - 并发调用导致 undo_log 顺序不确定
///
/// 本命令：
///   1. 一次性查询所有照片的当前 is_favorite 值（保存旧值）
///   2. 原子写入一条 "favorite_batch" undo_log，包含所有旧值映射
///   3. 调用 set_favorite_batch 批量更新（单事务）
///
/// payload 格式：
///   { "ids": ["id1","id2",...], "old_values": {"id1": false, "id2": true, ...}, "new_value": true }
#[tauri::command]
pub async fn photos_favorite_batch(
    ids:   Vec<String>,
    value: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if ids.is_empty() { return Ok(()); }
    if ids.len() > 1000 {
        return Err(AppError::InvalidArgument("Exceeded limit of 1000 items".into()));
    }

    // 1. 查询所有照片当前收藏状态，构建旧值映射
    let mut old_values = serde_json::Map::new();
    for id in &ids {
        if let Ok(Some(p)) = state.photos.get(id) {
            old_values.insert(id.clone(), serde_json::Value::Bool(p.is_favorite));
        }
    }

    // 2. 写入一条 favorite_batch undo_log（原子覆盖整批操作）
    let payload = serde_json::json!({
        "ids":        ids,
        "old_values": old_values,
        "new_value":  value,
    })
    .to_string();
    let _ = state.undo.record("favorite_batch", &payload);

    // 3. 批量更新（单事务）
    state.photos.set_favorite_batch(&ids, value).map_err(Into::into)
}

/// 软删除：将照片移入回收站
///
/// Phase-A：record_undo 已在此命令中（原逻辑保持不变，添加注释确认）。
/// photos_delete 是 undo_log 最初支持的 action，此处无需修改，
/// 仅补充注释说明其已正确接入撤销系统。
#[tauri::command]
pub async fn photos_delete(
    ids:   Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if ids.is_empty() { return Ok(()); }
    if ids.len() > 1000 {
        return Err(AppError::InvalidArgument("Exceeded limit of 1000 items".into()));
    }

    // 写 undo_log：记录被删除的 id 列表，供 undo_last 恢复用
    let payload = serde_json::json!({ "ids": ids }).to_string();
    let _ = state.undo.record("photo_delete", &payload);

    state.photos.soft_delete(&ids).map_err(Into::into)
}

/// 从回收站恢复
#[tauri::command]
pub async fn photos_restore(
    ids:   Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if ids.is_empty() { return Ok(()); }
    state.photos.restore(&ids).map_err(Into::into)
}

/// 永久删除（同时删除磁盘原文件）
#[tauri::command]
pub async fn photos_purge(
    ids:   Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if ids.is_empty() { return Ok(()); }
    if ids.len() > 1000 {
        return Err(AppError::InvalidArgument("Exceeded limit of 1000 items".into()));
    }
    for id in &ids {
        if let Ok(Some(p)) = state.photos.get(id) {
            let path = std::path::Path::new(&p.file_path);
            if path.exists() {
                if let Err(e) = std::fs::remove_file(path) {
                    tracing::warn!("Failed to delete file {}: {}", p.file_path, e);
                }
            }
        }
    }
    state.photos.purge(&ids).map_err(Into::into)
}

/// v2 新增：仅从程序数据库中清除（不删磁盘原文件）
///
/// 用于回收站「从程序中清除」操作：
/// 照片文件保留在磁盘，但所有数据库记录、相册关联、缩略图引用全部删除。
/// 用户可以重新导入该文件夹以恢复记录。
#[tauri::command]
pub async fn photos_purge_data(
    ids:   Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if ids.is_empty() { return Ok(()); }
    if ids.len() > 1000 {
        return Err(AppError::InvalidArgument("Exceeded limit of 1000 items".into()));
    }
    // purge() 只删除 DB 记录，不涉及文件系统
    state.photos.purge(&ids).map_err(Into::into)
}

// ─────────────────────────────────────────────────────────
//  搜索
// ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn search_photos(
    query: SearchQuery,
    state: State<'_, AppState>,
) -> Result<PhotoPage, AppError> {
    state.photos.search(&query).map_err(Into::into)
}

#[tauri::command]
pub async fn search_suggestions(
    q:     String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<SearchSuggestions, AppError> {
    state.photos.search_suggestions(&q, limit.unwrap_or(10)).map_err(Into::into)
}

#[tauri::command]
pub async fn search_stats(
    state: State<'_, AppState>,
) -> Result<LibraryStats, AppError> {
    state.photos.search_stats().map_err(Into::into)
}
