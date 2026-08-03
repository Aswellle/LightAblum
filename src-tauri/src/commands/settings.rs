// src-tauri/src/commands/settings.rs
//
// 设置相关 Tauri IPC 命令（v2 — 新增存储管理命令）
//
// v2 新增（替代前端 @tauri-apps/plugin-fs，修复 Vite 编译报错）：
//   storage_get_info         → 读取数据目录信息 + 缩略图缓存统计
//   storage_clear_thumbnails → 清空缩略图目录下所有文件
//   storage_open_data_dir    → 用系统文件管理器打开数据目录

use crate::error::AppError;
use crate::state::{AppSettings, AppState};
use serde::Serialize;
use tauri::State;

// ─────────────────────────────────────────────────────────
//  settings_get（不变）
// ─────────────────────────────────────────────────────────

/// Return the current application settings loaded from disk (or defaults if no settings file exists).
#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, AppError> {
    Ok(state.load_settings())
}

// ─────────────────────────────────────────────────────────
//  settings_update（不变）
// ─────────────────────────────────────────────────────────

/// Patch application settings. Only recognized fields in the JSON object are applied;
/// unknown keys are silently ignored. Returns the full updated settings.
/// Validated ranges: `gridDensity` 1–4, `sidebarWidth` 160–320.
#[tauri::command]
pub async fn settings_update(
    settings: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<AppSettings, AppError> {
    let mut current = state.load_settings();

    if let Some(obj) = settings.as_object() {
        if let Some(v) = obj.get("theme").and_then(|v| v.as_str()) {
            current.theme = v.to_string();
        }
        if let Some(v) = obj.get("gridDensity").and_then(|v| v.as_u64()) {
            current.grid_density = (v as u32).clamp(1, 4);
        }
        if let Some(v) = obj.get("sortBy").and_then(|v| v.as_str()) {
            let valid = ["created_at", "imported_at", "file_name", "file_size"];
            if valid.contains(&v) {
                current.sort_by = v.to_string();
            }
        }
        if let Some(v) = obj.get("sortAsc").and_then(|v| v.as_bool()) {
            current.sort_asc = v;
        }
        if let Some(v) = obj.get("sidebarWidth").and_then(|v| v.as_u64()) {
            current.sidebar_width = (v as u32).clamp(160, 320);
        }
        if let Some(v) = obj.get("autoHidePreviewUi").and_then(|v| v.as_bool()) {
            current.auto_hide_preview_ui = v;
        }
        if let Some(v) = obj.get("previewOnDoubleClick").and_then(|v| v.as_bool()) {
            current.preview_on_double_click = v;
        }
    }

    state.save_settings(&current)?;
    Ok(current)
}

// ─────────────────────────────────────────────────────────
//  v2 新增：存储信息响应类型
// ─────────────────────────────────────────────────────────

/// 存储信息（serde camelCase → TypeScript StorageInfo 接口）
///
/// BUGFIX: 原字段为 thumb_cache_bytes / thumb_file_count，而前端
/// src/types/filters.ts 的 StorageInfo 契约声明的是 thumbnailSizeBytes /
/// thumbnailCount / dbSizeBytes / totalSizeBytes。字段名不一致导致前端
/// storageInfo.thumbnailCount.toLocaleString() 对 undefined 调用抛 TypeError，
/// React 无错误边界 → 整个界面白屏。这里按前端契约补齐所有字段。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub data_dir: String,
    pub thumb_dir: String,
    pub thumbnail_size_bytes: u64,
    pub thumbnail_count: u64,
    pub db_size_bytes: u64,
    pub total_size_bytes: u64,
}

// ─────────────────────────────────────────────────────────
//  storage_get_info
// ─────────────────────────────────────────────────────────

/// 获取存储信息：目录路径 + 缩略图缓存大小和文件数量
/// 替代前端 @tauri-apps/plugin-fs 的目录遍历操作
#[tauri::command]
pub async fn storage_get_info(state: State<'_, AppState>) -> Result<StorageInfo, AppError> {
    let data_dir = state.data_dir.clone();
    let thumb_dir = state.thumb_dir.clone();
    let db_path = data_dir.join("library.db");
    let thumb_dir_for_stat = thumb_dir.clone();

    let (thumbnail_size_bytes, thumbnail_count, db_size_bytes) =
        tokio::task::spawn_blocking(move || -> (u64, u64, u64) {
            let mut thumb_bytes: u64 = 0;
            let mut file_count: u64 = 0;
            if let Ok(entries) = std::fs::read_dir(&thumb_dir_for_stat) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            thumb_bytes += meta.len();
                            file_count += 1;
                        }
                    }
                }
            }
            let db_bytes = std::fs::metadata(&db_path)
                .map(|m| m.len())
                .unwrap_or(0);
            (thumb_bytes, file_count, db_bytes)
        })
        .await
        .unwrap_or((0, 0, 0));

    Ok(StorageInfo {
        data_dir: data_dir.to_string_lossy().to_string(),
        thumb_dir: thumb_dir.to_string_lossy().to_string(),
        thumbnail_size_bytes,
        thumbnail_count,
        db_size_bytes,
        total_size_bytes: thumbnail_size_bytes + db_size_bytes,
    })
}

// ─────────────────────────────────────────────────────────
//  storage_clear_thumbnails
// ─────────────────────────────────────────────────────────

/// 清空缩略图缓存，返回删除的文件数量
/// 替代前端 @tauri-apps/plugin-fs 的 readDir + remove 操作
#[tauri::command]
pub async fn storage_clear_thumbnails(state: State<'_, AppState>) -> Result<u64, AppError> {
    let thumb_dir = state.thumb_dir.clone();
    let cache = std::sync::Arc::clone(&state.cache);

    let deleted_count = tokio::task::spawn_blocking(move || -> u64 {
        let mut count = 0u64;
        if let Ok(entries) = std::fs::read_dir(&thumb_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && std::fs::remove_file(&path).is_ok() {
                    count += 1;
                }
            }
        }
        // 重建内存缓存索引（清零 used_bytes）
        if let Ok(mut c) = cache.lock() {
            c.rebuild_usage();
        }
        count
    })
    .await
    .unwrap_or(0);

    Ok(deleted_count)
}

// ─────────────────────────────────────────────────────────
//  storage_open_data_dir
// ─────────────────────────────────────────────────────────

/// 用系统文件管理器打开数据目录（Windows：资源管理器）
/// 使用已安装的 tauri-plugin-shell，替代前端直接调用 plugin-shell
#[tauri::command]
pub async fn storage_open_data_dir(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let data_dir_str = state.data_dir.to_string_lossy().to_string();

    #[allow(deprecated)]
    use tauri_plugin_shell::ShellExt;
    #[allow(deprecated)]
    app.shell()
        .open(&data_dir_str, None)
        .map_err(|e| AppError::Other(format!("Failed to open directory: {e}")))?;

    Ok(())
}
