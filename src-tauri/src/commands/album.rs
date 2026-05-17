// src-tauri/src/commands/album.rs
//
// 相册相关 Tauri IPC 命令（v2 — 私密相册）
//
// v2 新增命令：
//   album_create_private(name, password)       — 创建私密相册（前端传明文密码，后端 bcrypt）
//   album_set_private(id, is_private, password) — 设置/取消相册私密状态
//   album_verify_password(id, password)         — 验证私密相册密码（通过则返回 true）
//   albums_list_all()                           — 返回含私密相册的完整列表（管理用）
//
// Phase-A（撤销完整性）：
//   album_photos_add — 添加照片到相册后写入 undo_log("album_photos_add", ...)
//   支持 Ctrl+Z 从相册移除刚添加的照片
//   payload 格式：{ "album_id": "...", "photo_ids": ["id1", ...] }

use crate::db::album::{Album, AlbumSummary, UpdateAlbumParams, get_cover_photo_id, find_best_portrait};
use crate::db::photo::PhotoPage;
use crate::error::AppError;
use crate::state::AppState;
use tauri::State;

/// bcrypt work factor — 10 在现代桌面 CPU 上约 100ms，安全性与响应速度的合理折中。
/// 不得低于 10，OWASP 建议桌面应用使用 10-12。
const BCRYPT_COST: u32 = 10;

// ─────────────────────────────────────────────────────────
//  查询
// ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn albums_list(
    state: State<'_, AppState>,
) -> Result<Vec<AlbumSummary>, AppError> {
    // 侧边栏：排除私密相册，避免泄漏存在
    Ok(state.albums.list_summaries()?)
}

/// 列出所有相册含私密（管理/私密相册入口用）
#[tauri::command]
pub async fn albums_list_all(
    state: State<'_, AppState>,
) -> Result<Vec<AlbumSummary>, AppError> {
    Ok(state.albums.list_all_summaries()?)
}

#[tauri::command]
pub async fn albums_get(
    id:    String,
    state: State<'_, AppState>,
) -> Result<Album, AppError> {
    state.albums.get_by_id(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Album {id} not found")))
}

// ─────────────────────────────────────────────────────────
//  写操作
// ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn albums_create(
    name:        String,
    description: Option<String>,
    state:       State<'_, AppState>,
) -> Result<Album, AppError> {
    Ok(state.albums.create(&name, description.as_deref())?)
}

/// 创建私密相册（密码在 Rust 侧 bcrypt hash，前端只传明文）
#[tauri::command]
pub async fn album_create_private(
    name:     String,
    password: String,
    state:    State<'_, AppState>,
) -> Result<Album, AppError> {
    if password.len() != 6 || !password.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::InvalidArgument("密码必须为6位数字".into()));
    }
    // bcrypt hash（cost=10，安全且在桌面上速度可接受）
    let hash = bcrypt::hash(&password, BCRYPT_COST)
        .map_err(|e| AppError::Other(format!("Password hash failed: {e}")))?;
    Ok(state.albums.create_private(&name, &hash)?)
}

/// 设置或取消相册的私密状态
/// password: Some("123456") = 设置密码, None = 取消私密（清除密码）
#[tauri::command]
pub async fn album_set_private(
    id:         String,
    is_private: bool,
    password:   Option<String>,
    state:      State<'_, AppState>,
) -> Result<Album, AppError> {
    let password_hash = if is_private {
        match password {
            Some(ref pw) => {
                if pw.len() != 6 || !pw.chars().all(|c| c.is_ascii_digit()) {
                    return Err(AppError::InvalidArgument("密码必须为6位数字".into()));
                }
                let hash = bcrypt::hash(pw, BCRYPT_COST)
                    .map_err(|e| AppError::Other(format!("Hash failed: {e}")))?;
                Some(hash)
            }
            None => return Err(AppError::InvalidArgument("设置私密相册需要提供密码".into())),
        }
    } else {
        None  // 取消私密时清除密码
    };
    Ok(state.albums.set_private(&id, is_private, password_hash.as_deref())?)
}

/// 验证私密相册密码
/// 返回 true = 密码正确，false = 密码错误
#[tauri::command]
pub async fn album_verify_password(
    id:       String,
    password: String,
    state:    State<'_, AppState>,
) -> Result<bool, AppError> {
    match state.albums.get_password_hash(&id)? {
        None       => Ok(false),  // 相册不存在或无密码
        Some(hash) => {
            let ok = bcrypt::verify(&password, &hash)
                .map_err(|e| AppError::Other(format!("Verify failed: {e}")))?;
            Ok(ok)
        }
    }
}

#[tauri::command]
pub async fn albums_update(
    id:             String,
    name:           Option<String>,
    description:    Option<String>,
    cover_photo_id: Option<Option<String>>,
    sort_order:     Option<i32>,
    state:          State<'_, AppState>,
) -> Result<Album, AppError> {
    let params_in = UpdateAlbumParams {
        name,
        description,
        cover_photo_id,
        sort_order,
    };
    Ok(state.albums.update(&id, &params_in)?)
}

#[tauri::command]
pub async fn albums_delete(
    id:    String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    Ok(state.albums.delete(&id)?)
}

#[tauri::command]
pub async fn album_photos_list(
    album_id: String,
    cursor:   Option<String>,
    limit:    Option<u32>,
    state:    State<'_, AppState>,
) -> Result<PhotoPage, AppError> {
    let limit = limit.unwrap_or(100).min(500);
    Ok(state.albums.list_photos(&album_id, cursor.as_deref(), limit)?)
}

/// 向相册添加照片
///
/// Phase-A：添加成功后写入 undo_log，支持 Ctrl+Z 撤销添加操作。
/// payload 格式：{ "album_id": "...", "photo_ids": ["id1", ...] }
#[tauri::command]
pub async fn album_photos_add(
    album_id:  String,
    photo_ids: Vec<String>,
    state:     State<'_, AppState>,
) -> Result<(), AppError> {
    if photo_ids.is_empty() { return Ok(()); }
    state.albums.add_photos(&album_id, &photo_ids)?;

    // 自动设置相册封面（若相册尚无封面）：
    //   优先选用人像方向照片，次选用批次中第一张照片
    //   需要 a connection for the utility functions
    let conn = state.conn()?;
    if get_cover_photo_id(&conn, &album_id)?.is_none() {
        if let Some(cover_id) = find_best_portrait(&conn, &photo_ids)? {
            let params = UpdateAlbumParams { name: None, description: None, cover_photo_id: Some(Some(cover_id)), sort_order: None };
            state.albums.update(&album_id, &params)?;
        }
    }

    // Phase-A：写 undo_log（添加成功后再记录，避免操作失败仍写入 log）
    let payload = serde_json::json!({
        "album_id":  album_id,
        "photo_ids": photo_ids,
    })
    .to_string();
    let _ = state.undo.record("album_photos_add", &payload);

    Ok(())
}

#[tauri::command]
pub async fn album_photos_remove(
    album_id:  String,
    photo_ids: Vec<String>,
    state:     State<'_, AppState>,
) -> Result<(), AppError> {
    Ok(state.albums.remove_photos(&album_id, &photo_ids)?)
}

#[tauri::command]
pub async fn album_photos_reorder(
    album_id:         String,
    ordered_photo_ids: Vec<String>,
    state:            State<'_, AppState>,
) -> Result<(), AppError> {
    Ok(state.albums.reorder_photos(&album_id, &ordered_photo_ids)?)
}
