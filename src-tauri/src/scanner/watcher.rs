// src-tauri/src/scanner/watcher.rs
//
// 文件系统实时监听（后台常驻）
//
// 架构（对应架构文档 §4.1 Phase 5）：
//   AppState 中保存 FsWatcher 实例（Option<FsWatcher>）
//   应用启动时为所有 watched_folders 注册监听
//   文件变化 → debounce 500ms → FsChange 事件
//   → 前端 'library:changed' Tauri 事件
//
// 注意事项：
//   - Debouncer 必须保持存活（drop 即停止监听），AppState 持有其所有权
//   - Windows ReadDirectoryChangesW 在 notify v6 中已自动使用
//   - 对 HEIC/RAW 等大文件，写入完成事件可能延迟，debounce 时间适当延长

use crate::error::Result;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, FileIdMap,
};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

/// Debounced 文件系统监听器类型
pub type FsWatcher = Debouncer<RecommendedWatcher, FileIdMap>;

/// 文件变化事件（已 debounce）
#[derive(Debug, Clone)]
pub enum FsChange {
    Created(PathBuf),
    Modified(PathBuf),
    Removed(PathBuf),
}

/// 创建 debounced 文件监听器
///
/// `debounce_ms`：事件合并窗口（毫秒），建议 500ms
/// 返回 (watcher, receiver)，watcher 必须保持存活
pub fn create_watcher(
    debounce_ms: u64,
) -> Result<(FsWatcher, mpsc::Receiver<Vec<FsChange>>)> {
    let (tx, rx) = mpsc::channel::<Vec<FsChange>>();

    let debouncer = new_debouncer(
        Duration::from_millis(debounce_ms),
        None,
        move |result: DebounceEventResult| match result {
            Ok(events) => {
                let changes: Vec<FsChange> = events
                    .into_iter()
                    .filter_map(|e| {
                        // ✅ 修复 E0507（cannot move out of dereference）：
                        //    e 是从迭代器中取出的值，e.paths 是 Vec<PathBuf>。
                        //    into_iter() 需要拿走所有权，但在某些 notify 版本中
                        //    e 是引用类型，无法直接 move。
                        //    修复：先 clone paths，再 into_iter()，安全获取第一个路径。
                        let path = e.paths.clone().into_iter().next()?;

                        // 过滤掉非图片文件（临时文件、系统文件等）
                        if !crate::scanner::is_supported(&path) {
                            return None;
                        }

                        match e.kind {
                            notify::EventKind::Create(_) => Some(FsChange::Created(path)),
                            notify::EventKind::Modify(notify::event::ModifyKind::Data(_)) => {
                                Some(FsChange::Modified(path))
                            }
                            notify::EventKind::Remove(_) => Some(FsChange::Removed(path)),
                            _ => None,
                        }
                    })
                    .collect();

                if !changes.is_empty() {
                    let _ = tx.send(changes);
                }
            }
            Err(errors) => {
                for e in errors {
                    tracing::error!("Filesystem watch error: {e:?}");
                }
            }
        },
    )
    .map_err(|e| crate::error::AppError::Other(format!("Failed to create watcher: {e}")))?;

    Ok((debouncer, rx))
}

/// 开始监听一个文件夹（递归）
pub fn watch_folder(watcher: &mut FsWatcher, path: &PathBuf) -> Result<()> {
    watcher
        .watcher()
        .watch(path, RecursiveMode::Recursive)
        .map_err(|e| crate::error::AppError::Other(format!("Watch failed for {path:?}: {e}")))?;
    tracing::info!("Started watching: {:?}", path);
    Ok(())
}

/// 停止监听一个文件夹
pub fn unwatch_folder(watcher: &mut FsWatcher, path: &PathBuf) -> Result<()> {
    watcher
        .watcher()
        .unwatch(path)
        .map_err(|e| crate::error::AppError::Other(format!("Unwatch failed for {path:?}: {e}")))?;
    tracing::info!("Stopped watching: {:?}", path);
    Ok(())
}
