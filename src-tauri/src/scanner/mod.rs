// src-tauri/src/scanner/mod.rs
pub mod differ;
pub mod walker;
pub mod watcher;

use std::path::Path;

/// MVP 支持的图片格式扩展名（小写）
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    // 常规格式
    "jpg", "jpeg",
    "png",
    "webp",
    "bmp",
    "tiff", "tif",
    // 移动端格式
    "heic", "heif",
    "avif",
    // RAW 格式（索引支持；缩略图生成需 Sharp sidecar）
    "cr2",  // Canon
    "cr3",  // Canon（新一代）
    "nef",  // Nikon
    "arw",  // Sony
    "dng",  // Adobe DNG（通用）
    "orf",  // Olympus
    "rw2",  // Panasonic
    "raf",  // Fujifilm
];

/// 判断文件路径是否为支持的图片格式
pub fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}
