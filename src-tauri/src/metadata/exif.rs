// src-tauri/src/metadata/exif.rs
//
// EXIF 元数据提取
//
// 使用 kamadak-exif 库解析图片文件中的 EXIF 数据。
// 覆盖字段：拍摄时间、相机品牌/型号/镜头、曝光参数、GPS、图片尺寸、方向。
//
// 设计原则：
//   - 提取失败时返回 ExifData::default()，不报错（大量照片可能无 EXIF）
//   - 字符串值统一去掉首尾引号和空白（kamadak-exif 显示值有时带引号）
//   - GPS 坐标转换为十进制度数（WGS84）
//   - 拍摄时间优先使用 DateTimeOriginal，回退到 DateTime

use crate::error::Result;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

// ─────────────────────────────────────────────────────────
//  ExifData — 提取结果
// ─────────────────────────────────────────────────────────

/// 从图片文件提取的 EXIF 信息（完整版，与 DB photos 表字段对应）
#[derive(Debug, Default, Clone)]
pub struct ExifData {
    /// 拍摄时间（ISO 8601，如 "2025-03-14T10:30:00Z"）
    pub created_at:    Option<String>,

    /// EXIF Orientation（1-8，1=正常，6=顺时针90°，3=180°，8=逆时针90°）
    pub orientation:   i32,

    /// 像素宽度（由 EXIF 读取，部分格式需 image crate 补充）
    pub width:         Option<u32>,
    /// 像素高度
    pub height:        Option<u32>,

    /// 相机品牌（如 "Canon"）
    pub camera_make:   Option<String>,
    /// 相机型号（如 "EOS R5"）
    pub camera_model:  Option<String>,
    /// 镜头型号（如 "EF 24-70mm f/2.8L II USM"）
    pub lens_model:    Option<String>,

    /// 焦距 mm
    pub focal_length:  Option<f64>,
    /// 光圈值（f/2.8 → 2.8）
    pub aperture:      Option<f64>,
    /// 快门速度原始字符串（如 "1/250"、"30\""）
    pub shutter_speed: Option<String>,
    /// ISO 感光度
    pub iso:           Option<i32>,
    /// 曝光补偿 EV
    pub exposure_comp: Option<f64>,

    /// GPS 纬度（WGS84 十进制，南纬为负）
    pub gps_lat:       Option<f64>,
    /// GPS 经度（WGS84 十进制，西经为负）
    pub gps_lng:       Option<f64>,
}

// ─────────────────────────────────────────────────────────
//  主提取函数
// ─────────────────────────────────────────────────────────

/// 从文件路径提取 EXIF 数据
///
/// 失败时（无 EXIF、格式不支持等）返回 `ExifData::default()`，
/// 调用方无需处理错误——仅记录警告日志即可。
pub fn extract(path: &Path) -> Result<ExifData> {
    let file       = File::open(path)?;
    let mut reader = BufReader::new(file);

    let exif_reader = exif::Reader::new();
    let exif = match exif_reader.read_from_container(&mut reader) {
        Ok(e)  => e,
        Err(e) => {
            tracing::debug!("No EXIF in {:?}: {}", path.file_name().unwrap_or_default(), e);
            return Ok(ExifData::default());
        }
    };

    let mut data = ExifData { orientation: 1, ..Default::default() };

    // ── 拍摄时间 ──────────────────────────────────────────
    let dt_field = exif
        .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .or_else(|| exif.get_field(exif::Tag::DateTime, exif::In::PRIMARY));

    if let Some(f) = dt_field {
        let raw = clean_str(&f.display_value().to_string());
        data.created_at = Some(normalize_exif_datetime(&raw));
    }

    // ── 方向 ──────────────────────────────────────────────
    if let Some(f) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
        if let exif::Value::Short(ref v) = f.value {
            data.orientation = v.first().copied().unwrap_or(1) as i32;
        }
    }

    // ── 图片尺寸 ──────────────────────────────────────────
    if let Some(f) = exif.get_field(exif::Tag::PixelXDimension, exif::In::PRIMARY) {
        data.width = parse_u32(&f.value);
    }
    if let Some(f) = exif.get_field(exif::Tag::PixelYDimension, exif::In::PRIMARY) {
        data.height = parse_u32(&f.value);
    }

    // ── 相机信息 ──────────────────────────────────────────
    if let Some(f) = exif.get_field(exif::Tag::Make, exif::In::PRIMARY) {
        let v = clean_str(&f.display_value().to_string());
        if !v.is_empty() { data.camera_make = Some(v); }
    }
    if let Some(f) = exif.get_field(exif::Tag::Model, exif::In::PRIMARY) {
        let v = clean_str(&f.display_value().to_string());
        if !v.is_empty() { data.camera_model = Some(v); }
    }
    if let Some(f) = exif.get_field(exif::Tag::LensModel, exif::In::PRIMARY) {
        let v = clean_str(&f.display_value().to_string());
        if !v.is_empty() { data.lens_model = Some(v); }
    }

    // ── 曝光参数 ──────────────────────────────────────────
    if let Some(f) = exif.get_field(exif::Tag::FocalLength, exif::In::PRIMARY) {
        data.focal_length = rational_to_f64(&f.value);
    }
    if let Some(f) = exif.get_field(exif::Tag::FNumber, exif::In::PRIMARY) {
        data.aperture = rational_to_f64(&f.value);
    }
    if let Some(f) = exif.get_field(exif::Tag::ExposureTime, exif::In::PRIMARY) {
        // ✅ 将 field 引用传入，这样可以用 field.display_value() 作为最终兜底
        data.shutter_speed = Some(format_shutter_speed(f));
    }
    if let Some(f) = exif.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY) {
        if let exif::Value::Short(ref v) = f.value {
            data.iso = v.first().map(|&n| n as i32);
        }
    }
    if let Some(f) = exif.get_field(exif::Tag::ExposureBiasValue, exif::In::PRIMARY) {
        if let exif::Value::SRational(ref v) = f.value {
            if let Some(r) = v.first() {
                let ev = r.num as f64 / r.denom as f64;
                data.exposure_comp = Some((ev * 10.0).round() / 10.0);
            }
        }
    }

    // ── GPS ───────────────────────────────────────────────
    data.gps_lat = extract_gps_coord(
        &exif,
        exif::Tag::GPSLatitude,
        exif::Tag::GPSLatitudeRef,
        'S',
    );
    data.gps_lng = extract_gps_coord(
        &exif,
        exif::Tag::GPSLongitude,
        exif::Tag::GPSLongitudeRef,
        'W',
    );

    Ok(data)
}

// ─────────────────────────────────────────────────────────
//  格式化工具
// ─────────────────────────────────────────────────────────

fn clean_str(s: &str) -> String {
    s.trim().trim_matches('"').trim().to_string()
}

fn normalize_exif_datetime(s: &str) -> String {
    let s = s.trim_matches('"').trim();
    if s.len() >= 19
        && s.chars().nth(4) == Some(':')
        && s.chars().nth(7) == Some(':')
    {
        let date = &s[0..10].replace(':', "-");
        let time = &s[11..19];
        return format!("{date}T{time}Z");
    }
    s.to_string()
}

fn rational_to_f64(value: &exif::Value) -> Option<f64> {
    match value {
        exif::Value::Rational(ref v)  => v.first().map(|r| r.num as f64 / r.denom as f64),
        exif::Value::SRational(ref v) => v.first().map(|r| r.num as f64 / r.denom as f64),
        exif::Value::Float(ref v)     => v.first().copied().map(|f| f as f64),
        exif::Value::Double(ref v)    => v.first().copied(),
        _ => None,
    }
}

fn parse_u32(value: &exif::Value) -> Option<u32> {
    match value {
        exif::Value::Long(ref v)  => v.first().copied(),
        exif::Value::Short(ref v) => v.first().map(|&n| n as u32),
        _ => None,
    }
}

/// 将快门速度格式化为可读字符串
/// ✅ 修复 E0061：
///    原来参数是 &exif::Value，fallback 调用 exif::Value::display_as(value) 需要
///    第二个 Tag 参数，但此函数没有 tag 上下文。
///    修复：改为接收完整 &exif::Field，先手动处理 Rational 分支（覆盖 99% 情况），
///    fallback 直接用 field.display_value()（Field 已持有 tag，可安全调用）。
fn format_shutter_speed(field: &exif::Field) -> String {
    if let exif::Value::Rational(ref v) = field.value {
        if let Some(r) = v.first() {
            if r.num == 0 { return "0".to_string(); }
            if r.denom == 1 {
                return format!("{}\"", r.num);
            }
            if r.num == 1 {
                return format!("1/{}", r.denom);
            }
            let gcd = gcd(r.num, r.denom);
            let n   = r.num   / gcd;
            let d   = r.denom / gcd;
            if n == 1 {
                return format!("1/{d}");
            }
            return format!("{n}/{d}");
        }
    }
    // 非 Rational 类型（极罕见）：用 field.display_value() 兜底，无需 tag 参数外传
    clean_str(&field.display_value().to_string())
}

fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 { let t = b; b = a % b; a = t; }
    a
}

fn extract_gps_coord(
    exif:      &exif::Exif,
    coord_tag: exif::Tag,
    ref_tag:   exif::Tag,
    neg_char:  char,
) -> Option<f64> {
    let field     = exif.get_field(coord_tag, exif::In::PRIMARY)?;
    let ref_field = exif.get_field(ref_tag,   exif::In::PRIMARY)?;
    let decimal   = dms_to_decimal(&field.value)?;
    let ref_str   = ref_field.display_value().to_string();
    let sign      = if ref_str.contains(neg_char) { -1.0_f64 } else { 1.0_f64 };
    Some((decimal * sign * 1_000_000.0).round() / 1_000_000.0)
}

fn dms_to_decimal(value: &exif::Value) -> Option<f64> {
    if let exif::Value::Rational(ref v) = value {
        if v.len() >= 3 {
            let d = v[0].num as f64 / v[0].denom as f64;
            let m = v[1].num as f64 / v[1].denom as f64 / 60.0;
            let s = v[2].num as f64 / v[2].denom as f64 / 3600.0;
            return Some(d + m + s);
        }
    }
    None
}

// ─────────────────────────────────────────────────────────
//  图片尺寸补充
// ─────────────────────────────────────────────────────────

pub fn read_dimensions(path: &Path) -> Option<(u32, u32)> {
    match image::image_dimensions(path) {
        Ok((w, h)) => Some((w, h)),
        Err(_)     => None,
    }
}

pub fn enrich_dimensions(data: &mut ExifData, path: &Path) {
    if let Some((w, h)) = read_dimensions(path) {
        data.width  = Some(w);
        data.height = Some(h);
    }
}

// ─────────────────────────────────────────────────────────
//  文件时间戳工具
// ─────────────────────────────────────────────────────────

pub fn file_modified_at(path: &Path) -> String {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
        })
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string())
}

pub fn file_created_at(path: &Path) -> String {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.created().or_else(|_| m.modified()).ok())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
        })
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string())
}

// ─────────────────────────────────────────────────────────
//  扩展名 → 格式标准化
// ─────────────────────────────────────────────────────────

pub fn normalize_format(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "jpg" | "jpeg"  => "jpeg",
        "tif" | "tiff"  => "tiff",
        "heif"          => "heic",
        "png"           => "png",
        "webp"          => "webp",
        "bmp"           => "bmp",
        "cr2"           => "cr2",
        "cr3"           => "cr3",
        "nef"           => "nef",
        "arw"           => "arw",
        "dng"           => "dng",
        "orf"           => "orf",
        "rw2"           => "rw2",
        "raf"           => "raf",
        _               => "unknown",
    }
}
