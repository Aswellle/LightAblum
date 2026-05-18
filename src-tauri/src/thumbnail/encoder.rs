// src-tauri/src/thumbnail/encoder.rs
//
// 常规格式缩略图生成（image crate）
//
// 支持格式（~85% 的照片）：
//   JPEG / PNG / WebP / BMP / TIFF / GIF
//
// 生成流程：
//   S/M（网格用）：resize_cover()  — 正方形居中裁切，输出统一正方形
//   L  （预览用）：resize_contain() — 等比缩放不裁剪，保留原始宽高比
//
// 修复说明（大图预览显示不完整）：
//   原实现对 S/M/L 三种尺寸均使用 resize_cover()（正方形居中裁切）。
//   这对网格视图（S/M）是正确的——统一的正方形格子需要正方形缩略图。
//   但对大图预览（L）是错误的：
//     - 1080×2400 的手机截图 → L 缩略图变成 1600×1600（上下裁掉了 800px）
//     - PreviewImage 读取 naturalWidth=1600, naturalHeight=1600
//     - 按 1:1 比例显示，原本的 2.2:1 高宽比完全丢失
//     - 用户看到的是"只有一半"的截图
//   修复：L 尺寸改用 resize_contain()——将图片等比例缩放至 1600×1600 的框内，
//   不裁剪，输出尺寸为原始宽高比（如 900×1600 或 1600×720）。
//   PreviewImage 据此正确显示完整图片。
//
// Bugfix（"Invalid PNG signature"）：
//   原来使用 image::open(source)，该函数依靠文件扩展名判断格式。
//   改用 ImageReader::open(source)?.with_guessed_format()?.decode()
//   通过读取文件头魔数字节识别真实格式，不依赖扩展名。

use crate::error::Result;
use crate::thumbnail::ThumbSize;
use image::{imageops::FilterType, DynamicImage, ImageReader};
use std::path::Path;

/// native image crate 支持的格式扩展名
pub const NATIVE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "tiff", "tif", "gif"];

pub fn is_native_format(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| NATIVE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// 打开图片并按实际内容格式解码（不依赖扩展名）
fn open_image(source: &Path) -> Result<DynamicImage> {
    let reader = ImageReader::open(source)
        .map_err(|e| crate::error::AppError::Image(image::ImageError::IoError(e)))?
        .with_guessed_format()
        .map_err(|e| crate::error::AppError::Image(image::ImageError::IoError(e)))?;

    reader.decode().map_err(crate::error::AppError::Image)
}

/// 生成单个尺寸的缩略图，返回 WEBP 字节
///
/// S/M 尺寸：resize_cover（正方形裁切，网格视图统一外观）
/// L 尺寸  ：resize_contain（等比缩放不裁剪，保留原始宽高比供大图预览）
pub fn generate_thumbnail(source: &Path, size: ThumbSize, quality: u8) -> Result<Vec<u8>> {
    let img = open_image(source)?;
    let resized = match size {
        ThumbSize::L => resize_contain(&img, size.pixels()), // 修复：L 用 contain
        _ => resize_cover(&img, size.pixels()),              // S/M 保持 cover（正方形）
    };
    encode_webp(&resized, quality)
}

/// 将两种尺寸一次解码、两次 resize，避免重复 IO
/// S + M 均为网格用途，保持 resize_cover（正方形裁切）
pub fn generate_thumbnails_pair(source: &Path, quality: u8) -> Result<(Vec<u8>, Vec<u8>)> {
    let img = open_image(source)?;

    // S/M 均用 cover（正方形），网格视图需要统一尺寸
    let medium = resize_cover(&img, ThumbSize::M.pixels());
    let small = resize_cover(&medium, ThumbSize::S.pixels());

    let bytes_m = encode_webp(&medium, quality)?;
    let bytes_s = encode_webp(&small, quality)?;

    Ok((bytes_s, bytes_m))
}

// ─────────────────────────────────────────────────────────
//  内部工具
// ─────────────────────────────────────────────────────────

/// 正方形居中裁切缩放（Cover fit）— S/M 网格缩略图
///
/// 算法：
///   1. 将短边缩放到 target，长边等比例放大
///   2. 将长边居中裁切到 target
///
/// 输出始终为 target × target，图片内容最大化填充。
fn resize_cover(img: &DynamicImage, target: u32) -> DynamicImage {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return img.clone();
    }

    // 短边对齐 target
    let (nw, nh) = if w <= h {
        (target, (h as u64 * target as u64 / w as u64) as u32)
    } else {
        ((w as u64 * target as u64 / h as u64) as u32, target)
    };

    // 防止溢出
    let nw = nw.min(target * 4);
    let nh = nh.min(target * 4);

    let scaled = img.resize(nw, nh, FilterType::Lanczos3);

    // 居中裁切到正方形
    let x = (scaled.width().saturating_sub(target)) / 2;
    let y = (scaled.height().saturating_sub(target)) / 2;
    scaled.crop_imm(x, y, target, target)
}

/// 等比缩放不裁剪（Contain fit）— L 大图预览缩略图
///
/// 算法：
///   将图片缩放至恰好能放入 target × target 的框内，
///   长边等于 target，短边按原始比例缩小。
///   输出尺寸为非正方形（如 900×1600 或 1600×720），保留原始宽高比。
///
/// 相比 resize_cover：
///   不裁剪任何像素，PreviewImage 读取正确的 naturalWidth/naturalHeight，
///   按原始宽高比显示完整图片。
fn resize_contain(img: &DynamicImage, target: u32) -> DynamicImage {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return img.clone();
    }

    // 长边对齐 target，短边等比缩小
    let (nw, nh) = if w >= h {
        (target, (h as u64 * target as u64 / w as u64).max(1) as u32)
    } else {
        ((w as u64 * target as u64 / h as u64).max(1) as u32, target)
    };

    img.resize(nw, nh, FilterType::Lanczos3)
}

/// WEBP 编码（使用 webp crate）
fn encode_webp(img: &DynamicImage, quality: u8) -> Result<Vec<u8>> {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let encoder = webp::Encoder::from_rgba(&rgba, w, h);
    let encoded = encoder.encode(quality as f32);
    Ok(encoded.to_vec())
}
