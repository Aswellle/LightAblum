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

/// Return a page of photos matching `filter`, ordered by `sort_by`/`sort_asc` from settings.
///
/// `cursor` is the opaque pagination token from the previous `PhotoPage.next_cursor`.
/// `limit` defaults to 100, capped at 500.
///
/// SEC-H3: if `filter.album_id` refers to a private album, `filter.session_token` must
/// contain a valid HMAC token issued by `album_verify_password`. Missing or expired tokens
/// return `TOKEN_REQUIRED`.
#[tauri::command]
pub async fn photos_list(
    filter: PhotoFilter,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<PhotoPage, AppError> {
    let limit = limit.unwrap_or(100).min(500);

    // SEC-H3: enforce token for private albums
    if let Some(ref album_id) = filter.album_id {
        let conn = state.conn()?;
        let is_private: bool = conn
            .query_row(
                "SELECT COALESCE(is_private, 0) FROM albums WHERE id = ?1",
                [album_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if is_private {
            let token_valid = filter
                .session_token
                .as_deref()
                .map(|t| crate::auth::session::verify_token(&state.hmac_secret, t, album_id))
                .unwrap_or(false);

            if !token_valid {
                return Err(AppError::Other("TOKEN_REQUIRED".into()));
            }
        }
    }

    state.photos.list(&filter, cursor.as_deref(), limit)
}

/// Fetch a single photo's full record by ID. Returns `PHOTO_NOT_FOUND` if absent.
#[tauri::command]
pub async fn photos_get(id: String, state: State<'_, AppState>) -> Result<Photo, AppError> {
    state
        .photos
        .get(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Photo {id} not found")))
}

/// Fetch up to 100 photos by ID in a single DB round-trip. Returns `INVALID_PARAMS` if
/// the batch exceeds 100 entries. Missing IDs are silently omitted from the result.
#[tauri::command]
pub async fn photos_get_batch(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Photo>, AppError> {
    if ids.len() > 100 {
        return Err(AppError::InvalidArgument(
            "Batch size exceeds limit of 100".into(),
        ));
    }
    state.photos.get_batch(&ids)
}

// ─────────────────────────────────────────────────────────
//  修改
// ─────────────────────────────────────────────────────────

/// Patch a photo's mutable metadata (`is_favorite`, `rating` 0-5).
/// Returns the updated `Photo` record. Does not support undo; use `photos_favorite` for
/// undoable favorite toggling.
#[tauri::command]
pub async fn photos_update(
    id: String,
    params: PhotoUpdateParams,
    state: State<'_, AppState>,
) -> Result<Photo, AppError> {
    if let Some(fav) = params.is_favorite {
        state.photos.set_favorite(&id, fav)?;
    }
    if let Some(rating) = params.rating {
        if rating > 5 {
            return Err(AppError::InvalidArgument("Rating must be 0-5".into()));
        }
        state.photos.set_rating(&id, rating)?;
    }
    state
        .photos
        .get(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Photo {id} not found")))
}

/// 切换单张照片的收藏状态
///
/// Phase-A：操作前先读取当前 is_favorite 值并写入 undo_log，
/// 支持 Ctrl+Z 恢复到操作前状态。
/// payload 格式：{ "id": "...", "old_value": <bool> }
#[tauri::command]
pub async fn photos_favorite(
    id: String,
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
            if let Err(e) = state.undo.record("favorite_set", &payload) {
                tracing::warn!("Undo record failed for favorite_set (operation proceeds): {e}");
            }
        }
    }

    state.photos.set_favorite(&id, value)
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
    ids: Vec<String>,
    value: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    if ids.len() > 1000 {
        return Err(AppError::InvalidArgument(
            "Exceeded limit of 1000 items".into(),
        ));
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
    if let Err(e) = state.undo.record("favorite_batch", &payload) {
        tracing::warn!("Undo record failed for favorite_batch (operation proceeds): {e}");
    }

    // 3. 批量更新（单事务）
    state.photos.set_favorite_batch(&ids, value)
}

/// 软删除：将照片移入回收站
///
/// Phase-A：record_undo 已在此命令中（原逻辑保持不变，添加注释确认）。
/// photos_delete 是 undo_log 最初支持的 action，此处无需修改，
/// 仅补充注释说明其已正确接入撤销系统。
#[tauri::command]
pub async fn photos_delete(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    if ids.len() > 1000 {
        return Err(AppError::InvalidArgument(
            "Exceeded limit of 1000 items".into(),
        ));
    }

    // 写 undo_log：记录被删除的 id 列表，供 undo_last 恢复用
    let payload = serde_json::json!({ "ids": ids }).to_string();
    if let Err(e) = state.undo.record("photo_delete", &payload) {
        tracing::warn!("Undo record failed for photo_delete (operation proceeds): {e}");
    }

    state.photos.soft_delete(&ids)
}

/// 从回收站恢复
#[tauri::command]
pub async fn photos_restore(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    state.photos.restore(&ids)
}

/// 永久删除（同时删除磁盘原文件 + 缩略图文件）
///
/// BUGFIX: 原实现只删除原文件，从未清理 {thumb_dir}/{hash[0:2]}/{hash}.{s,m,l}.webp，
/// 导致每次永久删除都在磁盘上留下孤儿缩略图，且 ThumbnailCache 只在总用量超过
/// 5GB 时才会驱逐——小于该阈值的孤儿文件永远不会被回收，是缩略图目录体积
/// 膨胀的主因之一。现在按 file_hash 推算三档缩略图路径并一并删除。
#[tauri::command]
pub async fn photos_purge(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    if ids.len() > 1000 {
        return Err(AppError::InvalidArgument(
            "Exceeded limit of 1000 items".into(),
        ));
    }
    // Collect file paths + hashes before touching the DB; if purge fails we haven't deleted anything.
    // BUGFIX: use get_batch (single IN(...) query) instead of a per-id get() loop — avoids up to
    // 1000 serialized pool checkouts on a max-5 connection pool.
    let purge_info: Vec<(String, String, String)> = state
        .photos
        .get_batch(&ids)?
        .into_iter()
        .map(|p| (p.id, p.file_path, p.file_hash))
        .collect();
    // DB deletion is atomic — abort here if it fails, leaving disk untouched
    state.photos.purge(&ids)?;
    // Best-effort file deletion now that the DB record is gone
    for (photo_id, file_path, file_hash) in &purge_info {
        let path = std::path::Path::new(file_path.as_str());
        if path.exists() {
            if let Err(e) = std::fs::remove_file(path) {
                tracing::warn!("Failed to delete file {}: {}", file_path, e);
            }
        }
        state.remove_thumbnails(photo_id, file_hash);
    }
    Ok(())
}

/// v2 新增：仅从程序数据库中清除（不删磁盘原文件，但清理缩略图缓存）
///
/// 用于回收站「从程序中清除」操作：
/// 照片文件保留在磁盘，但所有数据库记录、相册关联、缩略图文件全部删除。
/// 用户可以重新导入该文件夹以恢复记录（会重新生成缩略图）。
#[tauri::command]
pub async fn photos_purge_data(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    if ids.len() > 1000 {
        return Err(AppError::InvalidArgument(
            "Exceeded limit of 1000 items".into(),
        ));
    }
    // BUGFIX: 同 photos_purge，清除记录后也要删缩略图文件，否则同样留下孤儿文件。
    let purge_info: Vec<(String, String)> = state
        .photos
        .get_batch(&ids)?
        .into_iter()
        .map(|p| (p.id, p.file_hash))
        .collect();
    // purge() 只删除 DB 记录，不涉及原始文件系统
    state.photos.purge(&ids)?;
    for (photo_id, file_hash) in &purge_info {
        state.remove_thumbnails(photo_id, file_hash);
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────
//  搜索
// ─────────────────────────────────────────────────────────

/// Full-text and filter-based photo search. Supports FTS5 queries in `query.q` and
/// date/album/tag filters. Returns a paginated `PhotoPage` like `photos_list`.
#[tauri::command]
pub async fn search_photos(
    query: SearchQuery,
    state: State<'_, AppState>,
) -> Result<PhotoPage, AppError> {
    state.photos.search(&query)
}

/// Return autocomplete suggestions for the search bar. `limit` defaults to 10.
/// Suggestions include matching album names, tag names, and date prefixes.
#[tauri::command]
pub async fn search_suggestions(
    q: String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<SearchSuggestions, AppError> {
    state.photos.search_suggestions(&q, limit.unwrap_or(10))
}

/// Return aggregate library statistics: total photo count, favorites count,
/// per-month breakdown, and storage size. Used by the sidebar stats widget.
#[tauri::command]
pub async fn search_stats(state: State<'_, AppState>) -> Result<LibraryStats, AppError> {
    state.photos.search_stats()
}
