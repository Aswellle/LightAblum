// src-tauri/src/commands/tag.rs
//
// 标签相关 Tauri IPC 命令（Phase-B M-12）
//
// 命令清单（对应 DB_API_Design §6 标签接口）：
//   tags_list       — GET  /tags        列出所有标签
//   tags_create     — POST /tags        创建标签
//   tags_delete     — DELETE /tags/:id  删除标签
//   photo_tags_add  — POST /photos/:id/tags  为照片添加标签
//   photo_tags_remove — DELETE /photos/:id/tags/:tag_id  从照片移除标签
//   photo_tags_get  — GET /photos/:id/tags  获取照片的标签列表

use crate::db::tag::Tag;
use crate::error::AppError;
use crate::state::AppState;
use tauri::State;

// ─────────────────────────────────────────────────────────
//  标签 CRUD
// ─────────────────────────────────────────────────────────

/// 列出所有标签（按 sort_order ASC, usage_count DESC）
#[tauri::command]
pub async fn tags_list(state: State<'_, AppState>) -> Result<Vec<Tag>, AppError> {
    state.tags.list()
}

/// 创建标签
/// - name：标签名（大小写不敏感唯一）
/// - color：HEX 色值，如 "#007AFF"
/// 若同名标签已存在，返回 TAG_DUPLICATE 错误
#[tauri::command]
pub async fn tags_create(
    name: String,
    color: String,
    state: State<'_, AppState>,
) -> Result<Tag, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidArgument("标签名不能为空".into()));
    }
    if name.len() > 50 {
        return Err(AppError::InvalidArgument("标签名最长 50 个字符".into()));
    }
    state.tags.create(name.trim(), &color)
}

/// 删除标签（级联删除所有 photo_tags 关联）
#[tauri::command]
pub async fn tags_delete(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.tags.delete(&id)
}

// ─────────────────────────────────────────────────────────
//  照片-标签关联
// ─────────────────────────────────────────────────────────

/// 获取照片的所有标签
#[tauri::command]
pub async fn photo_tags_get(
    photo_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Tag>, AppError> {
    state.tags.get_for_photo(&photo_id)
}

/// 为照片添加标签（幂等，已存在的关联自动跳过）
#[tauri::command]
pub async fn photo_tags_add(
    photo_id: String,
    tag_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if tag_ids.is_empty() {
        return Ok(());
    }
    if tag_ids.len() > 50 {
        return Err(AppError::InvalidArgument("单次最多添加 50 个标签".into()));
    }
    state.tags.add_to_photo(&photo_id, &tag_ids)
}

/// 从照片移除标签
#[tauri::command]
pub async fn photo_tags_remove(
    photo_id: String,
    tag_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if tag_ids.is_empty() {
        return Ok(());
    }
    state.tags.remove_from_photo(&photo_id, &tag_ids)
}
