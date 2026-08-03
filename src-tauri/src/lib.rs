// src-tauri/src/lib.rs
//
// Tauri 应用入口（v2 — 新增回收站/私密相册命令）
//
// v2 新增命令注册：
//   photos_purge_data     — 从程序中清除（不删磁盘文件）
//   albums_list_all       — 含私密相册的全量列表
//   album_create_private  — 创建私密相册
//   album_set_private     — 设置/取消私密状态
//   album_verify_password — 验证私密相册密码
//
// Phase-B 新增命令注册（M-12 标签系统）：
// Phase-D 新增命令注册（M-11 批量操作）：
//   photos_favorite_batch — 批量收藏（单条原子 undo_log，支持 Ctrl+Z 回滚整批）
//   tags_list          — 列出所有标签
//   tags_create        — 创建标签
//   tags_delete        — 删除标签
//   photo_tags_get     — 获取照片标签
//   photo_tags_add     — 为照片添加标签
//   photo_tags_remove  — 从照片移除标签

pub mod auth;
pub mod commands;
pub mod db;
pub mod error;
pub mod metadata;
pub mod query;
pub mod scanner;
pub mod state;
pub mod thumbnail;

use state::AppState;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "light_album=info,warn".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new().expect("Failed to initialize AppState"))
        .invoke_handler(tauri::generate_handler![
            // ── 扫描 ──────────────────────────────────────
            commands::scan::import_scan,
            commands::scan::import_scan_status,
            commands::scan::folders_list,
            commands::scan::folders_remove,
            // ── 照片查询 ──────────────────────────────────
            commands::photo::photos_list,
            commands::photo::photos_get,
            commands::photo::photos_get_batch,
            // ── 照片修改 ──────────────────────────────────
            commands::photo::photos_update,
            commands::photo::photos_favorite,
            commands::photo::photos_favorite_batch, // Phase-D：批量收藏（原子 undo_log）
            commands::photo::photos_delete,
            commands::photo::photos_restore,
            commands::photo::photos_purge,
            commands::photo::photos_purge_data, // v2 新增：仅从程序清除，不删磁盘文件
            // ── 搜索 ──────────────────────────────────────
            commands::photo::search_photos,
            commands::photo::search_suggestions,
            commands::photo::search_stats,
            // ── 缩略图 ────────────────────────────────────
            commands::thumbnail::thumbnail_get_path,
            commands::thumbnail::thumbnail_request,
            // ── 相册 ──────────────────────────────────────
            commands::album::albums_list,
            commands::album::albums_list_all, // v2 新增：含私密相册
            commands::album::albums_get,
            commands::album::albums_create,
            commands::album::albums_update,
            commands::album::albums_delete,
            commands::album::album_photos_list,
            commands::album::album_photos_add,
            commands::album::album_photos_remove,
            commands::album::album_photos_reorder,
            commands::album::album_create_private,  // v2 新增
            commands::album::album_set_private,     // v2 新增
            commands::album::album_verify_password, // v2 新增；SEC-H3：返回 HMAC token
            commands::album::album_check_token,     // SEC-H3 新增：验证 token 是否有效
            // ── 标签（Phase-B M-12）──────────────────────
            commands::tag::tags_list,
            commands::tag::tags_create,
            commands::tag::tags_delete,
            commands::tag::photo_tags_get,
            commands::tag::photo_tags_add,
            commands::tag::photo_tags_remove,
            // ── 设置 ──────────────────────────────────────
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::settings::storage_get_info,
            commands::settings::storage_clear_thumbnails,
            commands::settings::storage_open_data_dir,
            // ── 撤销 ──────────────────────────────────────
            commands::undo::undo_last,
        ])
        .setup(|app| {
            let state_arc = app.state::<AppState>();

            state_arc.init_db().map_err(|e| {
                tracing::error!("DB init failed: {e}");
                e
            })?;

            state_arc.start_pipeline(app.handle().clone());
            state_arc.start_watcher(app.handle().clone());

            {
                let cache = std::sync::Arc::clone(&state_arc.cache);
                std::thread::spawn(move || {
                    let mut c = cache.lock().unwrap();
                    c.rebuild_usage();
                });
            }

            {
                let db = state_arc.db.clone();
                let pipeline: Option<std::sync::Arc<thumbnail::pipeline::ThumbnailPipeline>> =
                    state_arc.pipeline.lock().unwrap().clone();

                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    if let Some(ref p) = pipeline {
                        thumbnail::pipeline::enqueue_pending_all(p, &db);
                    }
                });
            }

            // BUGFIX: purge_old_trash existed in the DB layer but no caller ever invoked
            // it, so the advertised "30-day trash auto-purge" never actually ran — expired
            // photos (and their original + thumbnail files) accumulated on disk forever.
            // Run once shortly after startup, then every 24h for the life of the process.
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_secs(30));
                    let removed = app_handle.state::<AppState>().run_trash_purge();
                    // BUGFIX: purge mutates the library (rows + files), so the frontend
                    // must be told or TanStack Query (staleTime Infinity) + photoStore
                    // keep ghost entries for photos that no longer exist.
                    if !removed.is_empty() {
                        let _ = app_handle.emit(
                            "library:changed",
                            serde_json::json!({
                                "added": [],
                                "modified": [],
                                "removed": removed,
                            }),
                        );
                    }
                    std::thread::sleep(std::time::Duration::from_secs(24 * 60 * 60));
                });
            }

            tracing::info!("LightAlbum started. Data: {}", state_arc.data_dir.display());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running LightAlbum");
}
