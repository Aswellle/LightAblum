// src-tauri/src/thumbnail/mod.rs
//
// 缩略图引擎公共接口
//
// 模块组成：
//   encoder.rs  — 图片解码 + WEBP 编码（image crate，处理常规格式）
//   sidecar.rs  — Sharp Node.js 进程通信（处理 HEIC / RAW）
//   pipeline.rs — 多线程生成调度器（优先级队列 + Tauri 事件推送）
//   cache.rs    — LRU 磁盘缓存管理（5GB 上限，hash 分片目录）

pub mod cache;
pub mod encoder;
pub mod pipeline;
pub mod sidecar;

use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────
//  ThumbSize
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThumbSize {
    S,  // 200×200  —— 网格密集视图
    M,  // 600×600  —— 标准网格 / 瀑布流 / 大图预览过渡帧
    L,  // 1600×1600 —— 大图预览（按需生成）
}

impl ThumbSize {
    /// 目标边长（正方形裁切）
    pub fn pixels(self) -> u32 {
        match self {
            ThumbSize::S => 200,
            ThumbSize::M => 600,
            ThumbSize::L => 1600,
        }
    }

    /// DB 字段对应的列名后缀
    pub fn db_column(self) -> &'static str {
        match self {
            ThumbSize::S => "thumbnail_s",
            ThumbSize::M => "thumbnail_m",
            ThumbSize::L => "thumbnail_l",
        }
    }

    /// 文件名后缀（{hash}.s.webp）
    pub fn file_suffix(self) -> &'static str {
        match self {
            ThumbSize::S => "s",
            ThumbSize::M => "m",
            ThumbSize::L => "l",
        }
    }
}

// ─────────────────────────────────────────────────────────
//  缩略图路径生成（确定性，基于 file_hash）
//
//  路径格式：{thumb_dir}/{hash[0:2]}/{hash}.{size}.webp
//  示例：    thumbnails/a3/a3f7c8d91e2b4a5f.s.webp
// ─────────────────────────────────────────────────────────

pub fn thumb_path(
    thumb_dir: &std::path::Path,
    file_hash: &str,
    size:      ThumbSize,
) -> std::path::PathBuf {
    let prefix = &file_hash[..2.min(file_hash.len())];
    thumb_dir
        .join(prefix)
        .join(format!("{}.{}.webp", file_hash, size.file_suffix()))
}

/// 确保缩略图目录存在（bucket 目录按 hash 前两位分片）
pub fn ensure_bucket_dir(
    thumb_dir: &std::path::Path,
    file_hash: &str,
) -> crate::error::Result<std::path::PathBuf> {
    let prefix = &file_hash[..2.min(file_hash.len())];
    let bucket = thumb_dir.join(prefix);
    std::fs::create_dir_all(&bucket)?;
    Ok(bucket)
}

// ─────────────────────────────────────────────────────────
//  SIDECAR_FORMATS — 需要 Sharp sidecar 处理的格式
// ─────────────────────────────────────────────────────────

/// 需要路由到 Sharp sidecar 的文件扩展名（小写）
pub const SIDECAR_FORMATS: &[&str] = &[
    "heic", "heif",               // iPhone / HEIF
    "cr2", "cr3",                 // Canon RAW
    "nef",                        // Nikon RAW
    "arw",                        // Sony RAW
    "dng",                        // Adobe DNG
    "orf",                        // Olympus RAW
    "rw2",                        // Panasonic RAW
    "raf",                        // Fujifilm RAW
    "avif",                       // AVIF（image crate 支持有限）
];

pub fn needs_sidecar(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SIDECAR_FORMATS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}
