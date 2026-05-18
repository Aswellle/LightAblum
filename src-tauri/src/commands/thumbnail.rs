// src-tauri/src/commands/thumbnail.rs
//
// 缩略图 Tauri IPC 命令
//
// 命令：
//   thumbnail_get_path  — 获取已生成缩略图的磁盘绝对路径
//   thumbnail_request   — 主动请求优先生成（滚入视口时调用）
//
// Bugfix（state API 迁移）：
//   Round-4 将 state.db 从 Arc<Mutex<Connection>> 迁移到 r2d2 DbPool，
//   但本文件仍使用 state.db.lock().unwrap() 旧写法，导致运行时 panic。
//   Round-3 将 state.pipeline 从裸 Option 改为 Mutex<Option<Arc<...>>>,
//   但本文件仍用 if let Some(ref pipeline) = state.pipeline 旧写法，
//   类型不匹配导致编译错误或逻辑异常。
//
//   修复：
//   - state.db.lock()   → state.conn()?（统一走连接池）
//   - state.pipeline    → { let lock = state.pipeline.lock().unwrap();
//                           let p = lock.clone(); drop(lock); p }
//     拿到 Option<Arc<ThumbnailPipeline>> 后在锁外使用，避免持锁 IO

use crate::error::AppError;
use crate::state::AppState;
use crate::thumbnail::pipeline::{PipelineTask, Priority};
use crate::thumbnail::{self, ThumbSize};
use tauri::State;

// ─────────────────────────────────────────────────────────
//  thumbnail_get_path
// ─────────────────────────────────────────────────────────

/// 获取缩略图磁盘路径（前端通过 convertFileSrc 转为可用 URL）
///
/// 若缩略图尚未生成，返回 null（前端显示骨架屏，等待 thumb:ready 事件）。
/// 不返回 Error，避免大量"未就绪"情况让前端 TanStack Query 重试。
///
/// Bugfix（DB pool 耗尽）：
///   原实现在一次调用内最多执行 3 次 state.conn()（每次都从 r2d2 pool 取连接），
///   当前端 thumbnailLoader 6 个并发槽同时调用时，加上 scan:completed 触发的
///   photos_list/search_stats/folders_list 并发查询，5 个连接的 pool 极易耗尽，
///   导致其他 IPC 命令超时并弹出"数据库操作失败"Toast。
///   修复：合并为单次 conn() 调用，在同一连接上完成所有 DB 读写后再释放。
#[tauri::command]
pub async fn thumbnail_get_path(
    photo_id: String,
    size: ThumbSize,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    // 单次 conn() 完成所有 DB 操作，避免多次取连接压垮 pool
    let (stored, file_hash, file_path) = {
        let conn = state.conn()?;
        let photo = crate::db::photo::get_by_id(&conn, &photo_id)?;
        match photo {
            None => return Ok(None),
            Some(p) => {
                let stored = match size {
                    ThumbSize::S => p.thumbnail_s,
                    ThumbSize::M => p.thumbnail_m,
                    ThumbSize::L => p.thumbnail_l,
                };
                (stored, p.file_hash, p.file_path)
            }
        }
    };

    // 1. DB 记录存在且文件在磁盘 → 直接返回（最快路径）
    if let Some(ref p) = stored {
        if std::path::Path::new(p).exists() {
            return Ok(stored);
        }
    }

    // 2. DB 记录不存在或文件已删除 → 从 hash 推算磁盘路径
    if !file_hash.is_empty() {
        let disk_path = thumbnail::thumb_path(&state.thumb_dir, &file_hash, size);
        if disk_path.exists() {
            // 补充 DB 记录（懒更新）— 复用同一次 conn()
            let path_str = disk_path.to_string_lossy().to_string();
            {
                let conn = state.conn()?;
                let (s, m, l) = match size {
                    ThumbSize::S => (Some(path_str.as_str()), None, None),
                    ThumbSize::M => (None, Some(path_str.as_str()), None),
                    ThumbSize::L => (None, None, Some(path_str.as_str())),
                };
                let _ = crate::db::photo::update_thumbnails(&conn, &photo_id, s, m, l);
            }
            return Ok(Some(path_str));
        }

        // 3. 缩略图确实不存在 → 加入高优先级队列触发生成
        if !file_path.is_empty() {
            let pipeline_opt = {
                let lock = state.pipeline.lock().unwrap();
                lock.clone()
            };
            if let Some(pipeline) = pipeline_opt {
                pipeline.enqueue(PipelineTask {
                    photo_id: photo_id.clone(),
                    file_path: file_path.clone(),
                    file_hash: file_hash.clone(),
                    priority: Priority::High,
                    need_large: matches!(size, ThumbSize::L),
                });
            }
        }
    }

    Ok(None)
}

// ─────────────────────────────────────────────────────────
//  thumbnail_request
// ─────────────────────────────────────────────────────────

/// 主动请求生成一批照片的缩略图
///
/// 前端在 usePreloadThumbnails 中调用，将即将滚入视口的照片批量入队。
/// `priority`："high" = 视口中心，"normal" = overscan（默认）
#[tauri::command]
pub async fn thumbnail_request(
    photo_ids: Vec<String>,
    size: ThumbSize,
    priority: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if photo_ids.len() > 500 {
        return Err(AppError::InvalidArgument(
            "thumbnail_request: too many photo IDs (max 500)".into(),
        ));
    }

    let prio = match priority.as_deref() {
        Some("high") => Priority::High,
        _ => Priority::Normal,
    };

    // Bugfix: pipeline 是 Mutex<Option<Arc<...>>>，先 lock 再 clone，锁外使用
    let pipeline_opt = {
        let lock = state.pipeline.lock().unwrap();
        lock.clone()
    };

    if let Some(pipeline) = pipeline_opt {
        let conn = state.conn()?; // Bugfix: conn() 替代 db.lock()
        for id in &photo_ids {
            if let Ok(Some(photo)) = crate::db::photo::get_by_id(&conn, id) {
                // 已有目标尺寸的缩略图则跳过
                let already_done = match size {
                    ThumbSize::S => photo
                        .thumbnail_s
                        .as_ref()
                        .map(|p| std::path::Path::new(p).exists())
                        .unwrap_or(false),
                    ThumbSize::M => photo
                        .thumbnail_m
                        .as_ref()
                        .map(|p| std::path::Path::new(p).exists())
                        .unwrap_or(false),
                    ThumbSize::L => photo
                        .thumbnail_l
                        .as_ref()
                        .map(|p| std::path::Path::new(p).exists())
                        .unwrap_or(false),
                };
                if already_done {
                    continue;
                }

                pipeline.enqueue(PipelineTask {
                    photo_id: id.clone(),
                    file_path: photo.file_path,
                    file_hash: photo.file_hash,
                    priority: prio,
                    need_large: matches!(size, ThumbSize::L),
                });
            }
        }
    }

    Ok(())
}
