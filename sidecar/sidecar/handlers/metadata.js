'use strict';
/**
 * handlers/metadata.js — 图片元数据读取（HEIC/RAW 补充）
 *
 * Rust 侧的 kamadak-exif 无法解析 HEIC 的部分 EXIF 块，
 * 此命令通过 Sharp（内部使用 libvips + libexif）补充读取。
 *
 * 典型使用场景：
 *   - 扫描器发现 HEIC 文件时，先用 Rust 读 EXIF，
 *     若 width/height 为 0（HEIC EXIF 尺寸位置特殊），
 *     再调用此命令获取真实像素尺寸
 *   - 读取 RAW 文件的 width/height（libraw 嵌入的 EXIF）
 *
 * 请求格式：
 *   {
 *     cmd:   "metadata",
 *     reqId: "optional-uuid",
 *     input: "/abs/path/photo.heic"
 *   }
 *
 * 响应格式：
 *   {
 *     ok:          true,
 *     width:       N,          // 原始像素宽度（已应用 orientation）
 *     height:      N,
 *     rawWidth:    N,          // 未旋转的原始宽度（EXIF 中存储的）
 *     rawHeight:   N,
 *     orientation: N,          // EXIF orientation 1-8
 *     format:      "heic",     // sharp 识别的格式名称
 *     hasAlpha:    false,
 *     channels:    3,          // RGB=3, RGBA=4, Grey=1
 *     density:     72,         // DPI（若有）
 *     space:       "srgb",     // 色彩空间（若有）
 *     icc:         false,      // 是否含 ICC 色彩描述文件
 *   }
 *   { ok: false, error: "..." }
 *
 * 注意：
 *   Sharp metadata() 仅读取文件头，不解码图片内容，速度 <5ms。
 *   width/height 是已应用 orientation 旋转后的"显示尺寸"。
 */

const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

async function handle(req) {
  const { input } = req;

  if (!input || typeof input !== 'string') {
    return { ok: false, error: 'Missing "input" field' };
  }
  if (!fs.existsSync(input)) {
    return { ok: false, error: `File not found: ${input}` };
  }

  try {
    // Sharp 的 metadata() 只读取文件头，不解码图片内容，速度极快
    const meta = await sharp(input, { failOnError: false }).metadata();

    // Sharp 报告的 width/height 是存储维度（对应 EXIF 原始轴）
    // 我们需要区分"存储尺寸"（rawWidth/rawHeight）
    // 和"显示尺寸"（orientation 旋转后）
    const rawWidth   = meta.width  || 0;
    const rawHeight  = meta.height || 0;
    const ori        = meta.orientation || 1;

    // Orientation 5-8 表示旋转了 90° 或 270°，宽高需互换得到显示尺寸
    const isRotated90or270 = ori >= 5 && ori <= 8;
    const displayWidth  = isRotated90or270 ? rawHeight : rawWidth;
    const displayHeight = isRotated90or270 ? rawWidth  : rawHeight;

    return {
      ok:          true,
      width:       displayWidth,
      height:      displayHeight,
      rawWidth,
      rawHeight,
      orientation: ori,
      format:      meta.format   || 'unknown',
      hasAlpha:    meta.hasAlpha || false,
      channels:    meta.channels || 3,
      density:     meta.density  || null,
      space:       meta.space    || null,
      icc:         Boolean(meta.icc),
    };

  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return {
      ok:    false,
      error: `Metadata error for "${path.basename(input)}": ${msg}`,
    };
  }
}

module.exports = { handle };
