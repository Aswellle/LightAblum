// src-tauri/src/commands/undo.rs
use crate::error::AppError;
use crate::state::AppState;
use tauri::State;

/// Pop the most recent undo entry and replay it in reverse.
///
/// Supported actions: `photo_delete`, `favorite_set`, `favorite_batch`, `album_photos_add`.
/// Returns `{ undoId, action, reversed, detail }` on success.
/// Returns `UNDO_EMPTY` if the undo log is empty.
#[tauri::command]
pub async fn undo_last(state: State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    let entry = state.undo.pop_last()?.ok_or_else(|| AppError::UndoEmpty)?;

    let reversed = apply_undo(&state, &entry.action, &entry.payload).await?;
    Ok(serde_json::json!({
        "undoId":   entry.id,
        "action":   entry.action,
        "reversed": reversed,
        "detail":   entry.payload,
    }))
}

async fn apply_undo(state: &AppState, action: &str, payload: &str) -> Result<bool, AppError> {
    let v: serde_json::Value = serde_json::from_str(payload)
        .map_err(|e| AppError::Other(format!("undo parse error: {e}")))?;

    match action {
        "photo_delete" => {
            let ids: Vec<String> = serde_json::from_value(v["ids"].clone())
                .map_err(|e| AppError::Other(e.to_string()))?;
            state.photos.restore(&ids)?;
            Ok(true)
        }
        "favorite_set" => {
            let id: String = serde_json::from_value(v["id"].clone())
                .map_err(|e| AppError::Other(e.to_string()))?;
            let old: bool = v["old_value"]
                .as_bool()
                .ok_or_else(|| AppError::Other("undo payload missing 'old_value'".into()))?;
            state.photos.set_favorite(&id, old)?;
            Ok(true)
        }
        "favorite_batch" => {
            let old_values = v["old_values"]
                .as_object()
                .ok_or_else(|| AppError::Other("invalid undo payload".into()))?;
            // 按目标值分组，用 set_favorite_batch 批量更新（最多 2 次事务，而非 N 次）
            let mut ids_true: Vec<String> = Vec::new();
            let mut ids_false: Vec<String> = Vec::new();
            for (id, val) in old_values {
                match val.as_bool() {
                    Some(true) => ids_true.push(id.clone()),
                    Some(false) => ids_false.push(id.clone()),
                    None => {
                        return Err(AppError::Other(format!(
                            "invalid bool in favorite_batch undo for id={id}"
                        )))
                    }
                }
            }
            if !ids_true.is_empty() {
                state.photos.set_favorite_batch(&ids_true, true)?;
            }
            if !ids_false.is_empty() {
                state.photos.set_favorite_batch(&ids_false, false)?;
            }
            Ok(true)
        }
        "album_photos_add" => {
            let album_id: String = serde_json::from_value(v["album_id"].clone())
                .map_err(|e| AppError::Other(e.to_string()))?;
            let photo_ids: Vec<String> = serde_json::from_value(v["photo_ids"].clone())
                .map_err(|e| AppError::Other(e.to_string()))?;
            state.albums.remove_photos(&album_id, &photo_ids)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}
