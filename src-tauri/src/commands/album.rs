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

use crate::db::album::{
    find_best_portrait, get_cover_photo_id, Album, AlbumSummary, UpdateAlbumParams,
};
use crate::db::photo::PhotoPage;
use crate::error::AppError;
use crate::state::{AppState, FailedAttempts};
use tauri::State;

/// bcrypt work factor — 10 在现代桌面 CPU 上约 100ms，安全性与响应速度的合理折中。
/// 不得低于 10，OWASP 建议桌面应用使用 10-12。
const BCRYPT_COST: u32 = 10;
/// SEC-C1: 开始指数退避的失败次数阈值（3 次后开始锁定）
const BACKOFF_THRESHOLD: u32 = 3;
/// SEC-C1: 最长锁定时间（5 分钟）
const MAX_LOCKOUT_SECS: u64 = 300;

// ─────────────────────────────────────────────────────────
//  查询
// ─────────────────────────────────────────────────────────

/// List non-private albums as summaries for the sidebar. Private albums are excluded
/// entirely to avoid leaking their existence to unauthenticated viewers.
#[tauri::command]
pub async fn albums_list(state: State<'_, AppState>) -> Result<Vec<AlbumSummary>, AppError> {
    // 侧边栏：排除私密相册，避免泄漏存在
    state.albums.list_summaries()
}

/// 列出所有相册含私密（管理/私密相册入口用）
#[tauri::command]
pub async fn albums_list_all(state: State<'_, AppState>) -> Result<Vec<AlbumSummary>, AppError> {
    let mut summaries = state.albums.list_all_summaries()?;
    // SEC-C2: 私密相册的封面缩略图在验证前不应暴露，避免通过封面推断内容
    for s in summaries.iter_mut() {
        if s.is_private {
            s.cover_thumbnail = None;
        }
    }
    Ok(summaries)
}

/// Fetch a single album's full record by ID. Returns `ALBUM_NOT_FOUND` if absent.
#[tauri::command]
pub async fn albums_get(id: String, state: State<'_, AppState>) -> Result<Album, AppError> {
    state
        .albums
        .get_by_id(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Album {id} not found")))
}

// ─────────────────────────────────────────────────────────
//  写操作
// ─────────────────────────────────────────────────────────

/// Create a public album. `name` must be 1–100 characters; `description` at most 500.
/// Returns `INVALID_PARAMS` on length violations.
#[tauri::command]
pub async fn albums_create(
    name: String,
    description: Option<String>,
    state: State<'_, AppState>,
) -> Result<Album, AppError> {
    // SEC-M3: 防止超长输入占用 DB 空间或导致 UI 渲染问题
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::InvalidArgument(
            "Album name must be 1–100 characters".into(), // LOC: album.create.name_length
        ));
    }
    if let Some(ref d) = description {
        if d.len() > 500 {
            return Err(AppError::InvalidArgument(
                "Description must be at most 500 characters".into(), // LOC: album.create.desc_length
            ));
        }
    }
    state.albums.create(&name, description.as_deref())
}

/// 创建私密相册（密码在 Rust 侧 bcrypt hash，前端只传明文）
#[tauri::command]
pub async fn album_create_private(
    name: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<Album, AppError> {
    // SEC-H2: 弃用仅6位数字PIN，改为至少8位字母数字混合
    if password.len() < 8 || !password.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::InvalidArgument(
            "密码至少需要8位字母或数字".into(), // LOC: album.password.requirement
        ));
    }
    // PERF-M3: bcrypt 是 CPU 密集型操作，在独立线程运行以避免阻塞 Tokio 事件循环
    let hash = tokio::task::spawn_blocking(move || bcrypt::hash(&password, BCRYPT_COST))
        .await
        .map_err(|e| AppError::Other(format!("Task join error: {e}")))?
        .map_err(|e| AppError::Other(format!("Password hash failed: {e}")))?;
    state.albums.create_private(&name, &hash)
}

/// 设置或取消相册的私密状态
/// password: Some("123456") = 设置密码, None = 取消私密（清除密码）
#[tauri::command]
pub async fn album_set_private(
    id: String,
    is_private: bool,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<Album, AppError> {
    let password_hash = if is_private {
        match password {
            Some(pw) => {
                // SEC-H2: 8+ 位字母数字混合密码
                if pw.len() < 8 || !pw.chars().all(|c| c.is_ascii_alphanumeric()) {
                    return Err(AppError::InvalidArgument(
                        "密码至少需要8位字母或数字".into(), // LOC: album.password.requirement
                    ));
                }
                // PERF-M3: bcrypt 在独立线程运行
                let hash = tokio::task::spawn_blocking(move || bcrypt::hash(&pw, BCRYPT_COST))
                    .await
                    .map_err(|e| AppError::Other(format!("Task join error: {e}")))?
                    .map_err(|e| AppError::Other(format!("Hash failed: {e}")))?;
                Some(hash)
            }
            None => return Err(AppError::InvalidArgument("设置私密相册需要提供密码".into())),
        }
    } else {
        None // 取消私密时清除密码
    };
    state
        .albums
        .set_private(&id, is_private, password_hash.as_deref())
}

/// 验证私密相册密码，成功返回 HMAC 会话 token，失败返回 null。
///
/// SEC-C1: 内置暴力破解保护 — 连续失败 3 次后开始指数退避锁定（最长 5 分钟）
/// SEC-H3: 返回的 token 是 HMAC-SHA256 签名、相册绑定、有效期 1 小时的会话凭证。
///         前端必须将 token 附在后续 photos_list 调用的 session_token 字段中。
#[tauri::command]
pub async fn album_verify_password(
    id: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    // SEC-C1: 检查是否仍在锁定窗口内
    {
        let attempts = state.failed_attempts.lock().unwrap();
        if let Some(entry) = attempts.get(&id) {
            if let Some(until) = entry.locked_until {
                if std::time::Instant::now() < until {
                    return Err(AppError::Other("TOO_MANY_ATTEMPTS".into())); // LOC: album.verify.too_many_attempts
                }
            }
        }
    }

    match state.albums.get_password_hash(&id)? {
        None => Ok(None), // 相册不存在或无密码
        Some(hash) => {
            // PERF-M3: bcrypt::verify 是 CPU 密集型操作，在独立线程运行
            let ok = tokio::task::spawn_blocking(move || bcrypt::verify(&password, &hash))
                .await
                .map_err(|e| AppError::Other(format!("Task join error: {e}")))?
                .map_err(|e| AppError::Other(format!("Verify failed: {e}")))?;

            let mut attempts = state.failed_attempts.lock().unwrap();
            if ok {
                attempts.remove(&id); // 成功后清除失败记录
                                      // SEC-H3: issue a time-limited HMAC session token bound to this album
                let token = crate::auth::session::generate_token(&state.hmac_secret, &id);
                Ok(Some(token))
            } else {
                // 记录失败并按指数退避计算锁定时间
                let entry = attempts.entry(id).or_insert(FailedAttempts {
                    count: 0,
                    locked_until: None,
                });
                entry.count += 1;
                if entry.count >= BACKOFF_THRESHOLD {
                    let delay_secs =
                        (1u64 << (entry.count - BACKOFF_THRESHOLD)).min(MAX_LOCKOUT_SECS);
                    entry.locked_until = Some(
                        std::time::Instant::now() + std::time::Duration::from_secs(delay_secs),
                    );
                }
                Ok(None)
            }
        }
    }
}

/// Validate a previously issued HMAC session token for a private album.
///
/// Returns `true` if the token is valid, album-bound, and not yet expired.
/// Useful for the frontend to check whether a stored token can still be used
/// without prompting the user for the PIN again.
#[tauri::command]
pub async fn album_check_token(
    id: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    Ok(crate::auth::session::verify_token(
        &state.hmac_secret,
        &token,
        &id,
    ))
}

/// Patch album metadata. All fields are optional; only supplied fields are changed.
/// `cover_photo_id: Some(None)` clears the cover; `Some(Some(id))` sets a new one.
#[tauri::command]
pub async fn albums_update(
    id: String,
    name: Option<String>,
    description: Option<String>,
    cover_photo_id: Option<Option<String>>,
    sort_order: Option<i32>,
    state: State<'_, AppState>,
) -> Result<Album, AppError> {
    let params_in = UpdateAlbumParams {
        name,
        description,
        cover_photo_id,
        sort_order,
    };
    state.albums.update(&id, &params_in)
}

/// Delete an album and all its photo associations. The photos themselves are not deleted.
#[tauri::command]
pub async fn albums_delete(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.albums.delete(&id)
}

/// List photos belonging to an album, paginated by cursor. `limit` defaults to 100, max 500.
#[tauri::command]
pub async fn album_photos_list(
    album_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<PhotoPage, AppError> {
    let limit = limit.unwrap_or(100).min(500);
    state
        .albums
        .list_photos(&album_id, cursor.as_deref(), limit)
}

/// 向相册添加照片
///
/// Phase-A：添加成功后写入 undo_log，支持 Ctrl+Z 撤销添加操作。
/// payload 格式：{ "album_id": "...", "photo_ids": ["id1", ...] }
#[tauri::command]
pub async fn album_photos_add(
    album_id: String,
    photo_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if photo_ids.is_empty() {
        return Ok(());
    }
    state.albums.add_photos(&album_id, &photo_ids)?;

    // 自动设置相册封面（若相册尚无封面）：
    //   优先选用人像方向照片，次选用批次中第一张照片
    //   需要 a connection for the utility functions
    let conn = state.conn()?;
    if get_cover_photo_id(&conn, &album_id)?.is_none() {
        if let Some(cover_id) = find_best_portrait(&conn, &photo_ids)? {
            let params = UpdateAlbumParams {
                name: None,
                description: None,
                cover_photo_id: Some(Some(cover_id)),
                sort_order: None,
            };
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

/// Remove photos from an album without deleting the photos themselves.
#[tauri::command]
pub async fn album_photos_remove(
    album_id: String,
    photo_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.albums.remove_photos(&album_id, &photo_ids)
}

/// Persist a new display order for photos in an album. `ordered_photo_ids` must contain
/// every photo currently in the album; IDs not in the list are left at their current position.
#[tauri::command]
pub async fn album_photos_reorder(
    album_id: String,
    ordered_photo_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.albums.reorder_photos(&album_id, &ordered_photo_ids)
}
