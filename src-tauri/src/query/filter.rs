// src-tauri/src/query/filter.rs
//
// PhotoFilter — 照片查询组合筛选器
//
// 与前端 ipc.ts 中的 PhotoFilter 接口对应：
//   camelCase（前端）→ serde rename_all = "camelCase"（Rust）

use serde::{Deserialize, Serialize};

/// 照片列表筛选参数（来自前端 IPC invoke）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PhotoFilter {
    /// true = 仅显示收藏照片
    #[serde(default)]
    pub favorites_only: bool,

    /// 按文件夹路径过滤
    pub folder_path: Option<String>,

    /// 按相册 ID 过滤（JOIN album_photos）
    pub album_id: Option<String>,

    /// 按格式过滤（'jpeg', 'png', 'heic' 等）
    pub format: Option<String>,

    /// 拍摄时间范围（ISO 8601 字符串）
    pub date_from: Option<String>,
    pub date_to: Option<String>,

    /// true = 仅显示有 GPS 信息的照片
    pub has_gps: Option<bool>,

    /// true = 查询回收站（is_deleted = 1）；false/None = 正常照片
    #[serde(default)]
    pub is_deleted: bool,

    /// 排序字段："created_at" | "imported_at" | "file_name" | "file_size"
    pub sort_by: Option<String>,

    /// 排序方向：false = 倒序（新→旧，默认），true = 正序（旧→新）
    #[serde(default)]
    pub sort_asc: bool,

    /// SEC-H3: HMAC session token — required when album_id is a private album.
    /// Validated by photos_list before querying; missing/invalid token → TOKEN_REQUIRED error.
    pub session_token: Option<String>,
}
