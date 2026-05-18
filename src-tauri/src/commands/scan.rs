// src-tauri/src/commands/scan.rs
//
// 扫描相关 Tauri IPC 命令
//
// Round-4（F-01）：DbPool 替代 Arc<Mutex<Connection>>
// Round-5（F-03）：import_scan 动态注册 watcher；folders_remove 动态注销
// Bugfix-A（DB_ERROR Toast）：
//   所有 state.db.lock().unwrap() / db.lock().unwrap() 旧写法已移除。
//   state 端使用 state.conn()?，spawn_blocking 内部使用 db.get().unwrap()
//   (r2d2 连接池的正确取用方式)。
//
// Bugfix-B（扫描进度不显示）：
//   原来 progress emit 代码块被包裹在 `if !new_photos.is_empty()` 内部，
//   导致以下场景进度事件永远不发出：
//     - 批次内所有文件都已在 DB 中（to_add 为空，to_update 也为空）
//     - 批次内只有 to_update 没有 to_add
//   修复：将 progress 计算和 emit 移到 `if !new_photos.is_empty()` 外部，
//   无论批次是否有新增文件，每 300ms 发出一次进度事件。
//   同时增加 `current_file` 从 to_update/to_add 合并取值，
//   让进度条在"全部已索引仅更新"场景下也能正常推进。
//
// Bugfix-C（future not Send 编译错误）：
//   run_scan 为纯同步函数，通过 spawn_blocking 调用，避免 BatchIterator
//   (Box<dyn Iterator> 非 Send) 跨 .await 导致 E0277。
//
// Phase-A（library:changed 格式统一）：
//   原 run_scan 末尾 emit 使用数字格式（added: u64），与 state.rs watcher
//   发送的数组格式（added: string[]）不一致，导致前端 eventBus.ts 需要
//   `any` workaround。
//   修复：收集新增/更新/缺失文件的路径字符串，改为数组格式 emit，
//   与 watcher 路径保持一致，消除双格式分歧。
//   同时 folders_remove 的 library:changed 也统一为空数组格式。

use crate::db::photo as photo_db;
use crate::error::AppError;
use crate::metadata::{exif as exif_meta, hasher};
use crate::scanner::{differ, walker::FileWalker};
use crate::state::{AppState, DbPool, ScanStatus};
use crate::db::photo::NewPhoto;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub task_id:         String,
    pub folder:          String,
    pub phase:           ScanPhase,
    pub discovered:      u64,
    pub indexed:         u64,
    pub thumbnails_done: u64,
    pub errors:          u64,
    pub current_file:    Option<String>,
    pub speed_per_sec:   f64,
    pub eta_seconds:     Option<f64>,
    pub percent:         f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ScanPhase {
    Discovering,
    Indexing,
    GeneratingThumbnails,
    Completed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    pub path:         String,
    pub added_at:     String,
    pub last_scan_at: Option<String>,
    pub photo_count:  i64,
}

// ─────────────────────────────────────────────────────────
//  import_scan
// ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn import_scan(
    path:  String,
    app:   AppHandle,
    state: State<'_, AppState>,
) -> Result<ScanProgress, AppError> {
    let folder = PathBuf::from(&path);
    if !folder.exists() {
        return Err(AppError::InvalidArgument(format!("Folder not found: {path}")));
    }
    if !folder.is_dir() {
        return Err(AppError::InvalidArgument(format!("Not a directory: {path}")));
    }

    {
        let status = state.scan_status.lock().unwrap();
        if status.is_scanning {
            return Err(AppError::Other("SCAN_IN_PROGRESS".into()));
        }
    }

    {
        let conn = state.conn()?;
        conn.execute(
            "INSERT OR IGNORE INTO watched_folders (path) VALUES (?1)",
            rusqlite::params![path],
        )?;
    }

    // F-03：向 watcher 动态注册新文件夹
    state.register_watch(&folder);

    let task_id = Uuid::new_v4().to_string();

    {
        let mut status = state.scan_status.lock().unwrap();
        *status = ScanStatus {
            is_scanning: true,
            total: 0,
            done:  0,
            new_photos: 0,
            progress: None,
        };
    }

    let _ = app.emit("scan:started", serde_json::json!({
        "folder": path,
        "taskId": task_id,
    }));

    let initial_progress = ScanProgress {
        task_id:         task_id.clone(),
        folder:          path.clone(),
        phase:           ScanPhase::Discovering,
        discovered:      0,
        indexed:         0,
        thumbnails_done: 0,
        errors:          0,
        current_file:    None,
        speed_per_sec:   0.0,
        eta_seconds:     None,
        percent:         0.0,
    };

    let db          = state.db.clone();
    let scan_status = Arc::clone(&state.scan_status);
    let app_clone   = app.clone();
    let path_clone  = path.clone();
    let task_clone  = task_id.clone();

    // Bugfix-C：run_scan 是纯同步函数（BatchIterator 非 Send，不能跨 .await）
    // 通过 spawn_blocking 在独立线程池执行，不阻塞 tokio 工作线程
    tokio::task::spawn_blocking(move || {
        run_scan(db, scan_status, app_clone, path_clone, task_clone);
    });

    Ok(initial_progress)
}

// ─────────────────────────────────────────────────────────
//  run_scan — 同步扫描核心（在 spawn_blocking 线程中运行）
// ─────────────────────────────────────────────────────────

fn run_scan(
    db:          DbPool,
    scan_status: Arc<std::sync::Mutex<ScanStatus>>,
    app:         AppHandle,
    path:        String,
    task_id:     String,
) {
    let start              = Instant::now();
    let folder             = PathBuf::from(&path);
    let walker             = FileWalker::default();
    let mut total_new:     u64 = 0;
    let mut total_updated: u64 = 0;
    let mut total_errors:  u64 = 0;
    let mut total_indexed: u64 = 0;
    let mut last_emit      = start;  // 初始化为 start，首批 force_emit 判断用

    // Phase-A：收集新增/更新文件路径，用于末尾 library:changed 数组格式 emit
    let mut added_paths:    Vec<String> = Vec::new();
    let mut modified_paths: Vec<String> = Vec::new();

    // 同步统计文件总数（无需 spawn_blocking + .await）
    let discovered_total = FileWalker::count(&[folder.clone()]);
    tracing::info!("[Scan] {path}: discovered {discovered_total} files");

    // walker.walk() 返回同步迭代器，整个循环无 .await，无 Send 问题
    for batch_result in walker.walk(&[folder.clone()]) {
        let entries = match batch_result {
            Ok(e)  => e,
            Err(e) => {
                tracing::error!("[Scan] Walk error: {e}");
                let _ = app.emit("scan:error", serde_json::json!({
                    "path": path, "error": e.to_string(),
                }));
                total_errors += 1;
                continue;
            }
        };

        let batch_len = entries.len() as u64;

        let diff = {
            let conn = match db.get() {
                Ok(c)  => c,
                Err(e) => {
                    tracing::error!("[Scan] DB pool during diff: {e}");
                    total_errors += batch_len;
                    continue;
                }
            };
            match differ::diff_batch(&conn, &entries) {
                Ok(d)  => d,
                Err(e) => {
                    tracing::error!("[Scan] Diff error: {e}");
                    total_errors += batch_len;
                    continue;
                }
            }
        };

        let to_add    = diff.to_add;
        let to_update = diff.to_update;

        // ── 新文件：并行提取 EXIF + 批量 INSERT ──
        let new_photos: Vec<NewPhoto> = to_add.par_iter().filter_map(|entry| {
            let file_path = entry.path.to_string_lossy().to_string();
            let mut exif  = exif_meta::extract(&entry.path).unwrap_or_default();
            exif_meta::enrich_dimensions(&mut exif, &entry.path);
            let hash = hasher::hash_file(&entry.path).unwrap_or_else(|_| {
                Uuid::new_v4().to_string()
            });
            let ext = entry.path.extension()
                .and_then(|e| e.to_str()).unwrap_or("unknown");
            let created_at = exif.created_at.unwrap_or_else(|| {
                entry.modified_at.format("%Y-%m-%dT%H:%M:%SZ").to_string()
            });
            Some(NewPhoto {
                file_path,
                file_name:    entry.file_name.clone(),
                file_size:    entry.file_size as i64,
                file_hash:    hash,
                width:        exif.width.unwrap_or(0) as i32,
                height:       exif.height.unwrap_or(0) as i32,
                orientation:  exif.orientation,
                format:       exif_meta::normalize_format(ext).to_string(),
                created_at,
                modified_at:  entry.modified_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
                folder_path:  path.clone(),
                gps_lat:      exif.gps_lat,
                gps_lng:      exif.gps_lng,
                camera_make:  exif.camera_make,
                camera_model: exif.camera_model,
                lens_model:   exif.lens_model,
                focal_length: exif.focal_length,
                aperture:     exif.aperture,
                shutter_speed:exif.shutter_speed,
                iso:          exif.iso,
                exposure_comp:exif.exposure_comp,
            })
        }).collect();

        if !new_photos.is_empty() {
            let inserted = match db.get() {
                Err(e) => {
                    tracing::error!("[Scan] DB pool during insert: {e}");
                    total_errors += new_photos.len() as u64;
                    0u64
                }
                Ok(conn) => match photo_db::insert_batch(&conn, &new_photos) {
                    Ok(n)  => n as u64,
                    Err(e) => {
                        tracing::error!("[Scan] Insert batch error: {e}");
                        total_errors += new_photos.len() as u64;
                        0
                    }
                }
            };
            total_new     += inserted;
            total_indexed += inserted;
            // Phase-A：收集新增路径
            for p in &new_photos {
                added_paths.push(p.file_path.clone());
            }
        }

        // ── 已有文件：并行更新 EXIF 元数据 ──
        // F-06：to_update 并行 EXIF 提取（rayon），单次 pool.get() 批量 UPDATE
        let updated_photos: Vec<NewPhoto> = to_update.par_iter().filter_map(|entry| {
            let mut exif = exif_meta::extract(&entry.path).unwrap_or_default();
            exif_meta::enrich_dimensions(&mut exif, &entry.path);
            let ext  = entry.path.extension().and_then(|e| e.to_str()).unwrap_or("unknown");
            let hash = hasher::hash_file(&entry.path).unwrap_or_default();
            Some(NewPhoto {
                file_path:    entry.path.to_string_lossy().to_string(),
                file_name:    entry.file_name.clone(),
                file_size:    entry.file_size as i64,
                file_hash:    hash,
                width:        exif.width.unwrap_or(0) as i32,
                height:       exif.height.unwrap_or(0) as i32,
                orientation:  exif.orientation,
                format:       exif_meta::normalize_format(ext).to_string(),
                created_at:   exif.created_at.unwrap_or_else(|| {
                    entry.modified_at.format("%Y-%m-%dT%H:%M:%SZ").to_string()
                }),
                modified_at:  entry.modified_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
                folder_path:  path.clone(),
                gps_lat:      exif.gps_lat,
                gps_lng:      exif.gps_lng,
                camera_make:  exif.camera_make,
                camera_model: exif.camera_model,
                lens_model:   exif.lens_model,
                focal_length: exif.focal_length,
                aperture:     exif.aperture,
                shutter_speed:exif.shutter_speed,
                iso:          exif.iso,
                exposure_comp:exif.exposure_comp,
            })
        }).collect();

        if !updated_photos.is_empty() {
            let conn = match db.get() {
                Ok(c)  => c,
                Err(e) => {
                    tracing::error!("[Scan] DB pool during update: {e}");
                    total_errors += updated_photos.len() as u64;
                    continue;
                }
            };
            match photo_db::update_metadata_batch(&conn, &updated_photos) {
                Ok(n) => {
                    total_updated += n as u64;
                    total_indexed += n as u64;
                    // Phase-A：收集更新路径
                    for p in &updated_photos {
                        modified_paths.push(p.file_path.clone());
                    }
                }
                Err(e) => tracing::error!("[Scan] update_metadata_batch error: {e}"),
            }
        }

        // ── 进度 emit（每批次至少一次，300ms 节流防高频刷新）──
        //
        // Bugfix-B v2：
        //   原实现仅在 `now.duration_since(last_emit) >= 300ms` 时才 emit，
        //   当所有文件都已索引时每批处理 < 10ms，整个扫描 < 300ms 完成，
        //   导致 0 个进度事件发出，前端进度条跳过中间态直接到"完成"。
        //
        //   新策略：每批次结束时，若距上次 emit 已超过 300ms 则正常发送；
        //   若不足 300ms 但 last_emit == start（首批）则强制发送一次，
        //   确保快速扫描（< 300ms）至少有一条进度事件到达前端。
        let now        = Instant::now();
        let elapsed    = start.elapsed().as_secs_f64().max(0.001);
        let speed      = total_indexed as f64 / elapsed;
        let since_last = now.duration_since(last_emit).as_millis();
        // 首批（last_emit == start）或距上次 >= 300ms 时发送
        let force_emit = since_last >= 300 || last_emit == start;

        // current_file 优先从新增批次取，其次从更新批次取，最后从 entries 取
        let current_file = new_photos.last()
            .map(|p| p.file_name.clone())
            .or_else(|| updated_photos.last().map(|p| p.file_name.clone()))
            .or_else(|| entries.last().map(|e| e.file_name.clone()));

        let remaining = discovered_total.saturating_sub(total_indexed);
        let eta       = if speed > 0.0 { Some(remaining as f64 / speed) } else { None };
        let percent   = if discovered_total > 0 {
            (total_indexed as f64 / discovered_total as f64 * 100.0).min(99.0)
        } else {
            50.0
        };

        if force_emit {
            last_emit = now;
            let progress = ScanProgress {
                task_id:         task_id.clone(),
                folder:          path.clone(),
                phase:           ScanPhase::Indexing,
                discovered:      discovered_total,
                indexed:         total_indexed,
                thumbnails_done: 0,
                errors:          total_errors,
                current_file,
                speed_per_sec:   (speed * 10.0).round() / 10.0,
                eta_seconds:     eta,
                percent,
            };
            {
                let mut status = scan_status.lock().unwrap();
                status.done       = total_indexed;
                status.new_photos = total_new;
            }
            let _ = app.emit("scan:progress", &progress);
        }
    }

    // ── 缺失文件检测 ──
    let missing_ids = match db.get() {
        Ok(conn) => differ::find_missing(&conn, &path).unwrap_or_default(),
        Err(e)   => { tracing::error!("[Scan] DB pool during missing detection: {e}"); vec![] }
    };
    // Phase-A：收集缺失文件的路径（从 DB 查询 file_path），用于数组格式 emit
    let removed_paths: Vec<String> = if !missing_ids.is_empty() {
        tracing::info!("[Scan] {path}: {} files missing from disk", missing_ids.len());
        match db.get() {
            Err(e) => { tracing::error!("[Scan] DB pool during soft-delete: {e}"); vec![] }
            Ok(conn) => {
                let mut paths: Vec<String> = Vec::with_capacity(missing_ids.len());
                for id in &missing_ids {
                    if let Ok(Some(p)) = photo_db::get_by_id(&conn, id) {
                        paths.push(p.file_path);
                    }
                }
                let _ = photo_db::soft_delete(&conn, &missing_ids);
                paths
            }
        }
    } else {
        Vec::new()
    };

    // ── 更新 watched_folders 统计 ──
    if let Ok(conn) = db.get() {
        let photo_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM photos WHERE folder_path = ?1 AND is_deleted = 0",
            rusqlite::params![path],
            |row| row.get(0),
        ).unwrap_or(0);
        let _ = conn.execute(
            "UPDATE watched_folders \
             SET last_scan_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), \
                 photo_count  = ?1 \
             WHERE path = ?2",
            rusqlite::params![photo_count, path],
        );
    }

    {
        let mut status = scan_status.lock().unwrap();
        status.is_scanning = false;
        status.done        = total_indexed;
        status.new_photos  = total_new;
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    tracing::info!(
        "[Scan] {path}: completed — new={total_new} updated={total_updated} \
         errors={total_errors} ({duration_ms}ms)"
    );

    let _ = app.emit("scan:completed", serde_json::json!({
        "folder":       path,
        "totalNew":     total_new,
        "totalUpdated": total_updated,
        "durationMs":   duration_ms,
    }));

    // Phase-A：library:changed 统一使用数组格式（与 watcher 保持一致）
    // 消除 eventBus.ts 中 `any` workaround 的必要性
    let _ = app.emit("library:changed", serde_json::json!({
        "added":    added_paths,
        "modified": modified_paths,
        "removed":  removed_paths,
    }));
}

// ─────────────────────────────────────────────────────────
//  import_scan_status / folders_list / folders_remove
// ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn import_scan_status(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
    let status = state.scan_status.lock().unwrap();
    Ok(serde_json::json!({
        "isScanning": status.is_scanning,
        "progress":   null,
    }))
}

#[tauri::command]
pub async fn folders_list(
    state: State<'_, AppState>,
) -> Result<Vec<WatchedFolder>, AppError> {
    let conn = state.conn()?;
    let mut stmt = conn.prepare(
        "SELECT path, added_at, last_scan_at, photo_count \
         FROM watched_folders \
         ORDER BY added_at ASC"
    )?;
    let folders = stmt.query_map([], |row| {
        Ok(WatchedFolder {
            path:         row.get(0)?,
            added_at:     row.get(1)?,
            last_scan_at: row.get(2)?,
            photo_count:  row.get(3)?,
        })
    })?
    .collect::<std::result::Result<_, _>>()?;
    Ok(folders)
}

// Fix: folders_remove 改为扁平参数，与 import_scan 等其他命令保持一致。
// 原实现使用 params: RemoveFolderParams 结构体参数，Tauri 2 要求
// 前端调用时传 { params: { path, deletePhotos } }，但前端实际传的是
// { path, deletePhotos }（扁平），导致 "missing required key params" 错误。
// 改为直接接收 path: String 和 delete_photos: Option<bool>，
// 前端无需任何修改（已经按此格式传参）。
#[tauri::command]
pub async fn folders_remove(
    path:          String,
    delete_photos: Option<bool>,
    app:           AppHandle,
    state:         State<'_, AppState>,
) -> Result<(), AppError> {
    // F-03：先注销 watcher
    let folder_path = PathBuf::from(&path);
    state.unregister_watch(&folder_path);

    let conn = state.conn()?;
    conn.execute(
        "DELETE FROM watched_folders WHERE path = ?1",
        rusqlite::params![path],
    )?;

    if delete_photos == Some(true) {
        let affected = conn.execute(
            "UPDATE photos SET is_deleted = 1, \
                deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
             WHERE folder_path = ?1 AND is_deleted = 0",
            rusqlite::params![path],
        )?;
        tracing::info!("[Folders] Soft-deleted {affected} photos from {path}");
    }

    // Phase-A：空数组格式（与 watcher 保持一致）
    let _ = app.emit("library:changed", serde_json::json!({
        "added":    serde_json::Value::Array(vec![]),
        "modified": serde_json::Value::Array(vec![]),
        "removed":  serde_json::Value::Array(vec![]),
    }));

    Ok(())
}
