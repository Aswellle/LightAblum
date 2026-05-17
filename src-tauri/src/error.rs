// src-tauri/src/error.rs
//
// Round-2 修复（F-11）：结构化错误序列化
//
// 问题根因：
//   原 Serialize impl 调用 serializer.serialize_str(self.to_string())，
//   将 AppError 序列化为纯字符串（如 "Database error: UNIQUE constraint failed"）。
//   Tauri 把该字符串作为 IPC reject payload 传到前端，前端 parseIpcError 无法
//   从纯字符串中解析出 code 字段，最终全部落到 { code: 'UNKNOWN' } 分支，
//   致使 buildUserMessage 中所有精确匹配（PHOTO_NOT_FOUND / SCAN_IN_PROGRESS
//   / UNDO_EMPTY 等）永远不可达。
//
// 修复方案：
//   将 Serialize impl 改为输出 JSON 对象 { "code": "...", "message": "...", "detail": "..." }，
//   与前端 IpcError 接口完全对齐，使 parseIpcError 的第一条路径（isIpcError(raw)）
//   直接命中，跳过所有降级逻辑。
//
// code 映射规则：
//   Database     → DB_ERROR
//   Io           → IO_ERROR
//   Image        → THUMBNAIL_ERROR
//   Exif         → EXIF_ERROR
//   Sidecar      → SIDECAR_ERROR
//   Serde        → SERDE_ERROR
//   NotFound     → PHOTO_NOT_FOUND | ALBUM_NOT_FOUND | FOLDER_NOT_FOUND | NOT_FOUND
//                  （根据 message 文本内容推断实体类型）
//   InvalidArg   → LIMIT_EXCEEDED | INVALID_PARAMS
//                  （根据 message 文本内容推断）
//   Other        → message 字符串本身即为 code
//                  （命令层已将业务码如 SCAN_IN_PROGRESS / UNDO_EMPTY 放入 Other）

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Image processing error: {0}")]
    Image(#[from] image::ImageError),

    #[error("EXIF parsing error: {0}")]
    Exif(String),

    #[error("Sidecar process error: {0}")]
    Sidecar(String),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid argument: {0}")]
    InvalidArgument(String),

    #[error("{0}")]
    Other(String),
}

// ─────────────────────────────────────────────────────────
//  Serialize — 输出结构化 JSON（与前端 IpcError 接口对齐）
// ─────────────────────────────────────────────────────────
//
// 注意：这里必须显式写 std::result::Result<S::Ok, S::Error>，
// 否则文件末尾的 `pub type Result<T>` 别名会遮蔽双参数形式，
// 导致编译器把它解析为单泛型 Result<S::Ok> 并报 E0107。

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        use serde::ser::SerializeMap;

        // ── 从各 variant 派生 (code, message, detail) ──
        // detail: 内部技术信息（仅开发模式下展示给用户，正式 Toast 使用 code 映射）
        let (code, message, detail): (&str, String, Option<String>) = match self {
            AppError::Database(e) => (
                "DB_ERROR",
                "Database error".into(),
                Some(e.to_string()),
            ),
            AppError::Io(e) => (
                "IO_ERROR",
                "IO error".into(),
                Some(e.to_string()),
            ),
            AppError::Image(e) => (
                "THUMBNAIL_ERROR",
                "Image processing error".into(),
                Some(e.to_string()),
            ),
            AppError::Exif(msg) => (
                "EXIF_ERROR",
                msg.clone(),
                None,
            ),
            AppError::Sidecar(msg) => (
                "SIDECAR_ERROR",
                msg.clone(),
                None,
            ),
            AppError::Serde(e) => (
                "SERDE_ERROR",
                "Serialization error".into(),
                Some(e.to_string()),
            ),
            AppError::NotFound(msg) => {
                // 从消息文本推断实体类型，生成精确 code
                // 命令层样例：
                //   "Photo {id} not found"  → PHOTO_NOT_FOUND
                //   "Album {id} not found"  → ALBUM_NOT_FOUND
                //   "Folder not found: ..." → FOLDER_NOT_FOUND
                let lower = msg.to_ascii_lowercase();
                let code = if lower.contains("photo") {
                    "PHOTO_NOT_FOUND"
                } else if lower.contains("album") {
                    "ALBUM_NOT_FOUND"
                } else if lower.contains("folder") {
                    "FOLDER_NOT_FOUND"
                } else {
                    "NOT_FOUND"
                };
                (code, msg.clone(), None)
            }
            AppError::InvalidArgument(msg) => {
                // 命令层样例：
                //   "Exceeded limit of 1000 items" → LIMIT_EXCEEDED
                //   其余参数校验                    → INVALID_PARAMS
                let lower = msg.to_ascii_lowercase();
                let code = if lower.contains("limit") || lower.contains("exceeded") {
                    "LIMIT_EXCEEDED"
                } else {
                    "INVALID_PARAMS"
                };
                (code, msg.clone(), None)
            }
            AppError::Other(msg) => {
                // 命令层已将业务码字符串放入 Other：
                //   AppError::Other("SCAN_IN_PROGRESS".into())
                //   AppError::Other("UNDO_EMPTY".into())
                // 直接透传，code 与 message 相同；
                // 前端 buildUserMessage 会将 code 映射为本地化文案。
                (msg.as_str(), msg.clone(), None)
            }
        };

        // ── 序列化为 JSON 对象 ──
        // 字段数：detail 存在时为 3，否则为 2
        let field_count = if detail.is_some() { 3 } else { 2 };
        let mut map = serializer.serialize_map(Some(field_count))?;
        map.serialize_entry("code", code)?;
        map.serialize_entry("message", &message)?;
        if let Some(ref d) = detail {
            map.serialize_entry("detail", d)?;
        }
        map.end()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
