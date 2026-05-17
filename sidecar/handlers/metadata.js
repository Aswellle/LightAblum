'use strict';
// sidecar/handlers/metadata.js
//
// 图片元数据提取（快速 / 完整 两种模式）
//
// 调用场景：
//   - 扫描时（快速模式）：补充 Rust EXIF 解析失败的 HEIC/RAW 文件的宽高、方向
//   - 信息面板（完整模式）：获取 Sharp 额外暴露的元数据（icc profile / channels 等）
//
// 请求格式：
//   {
//     cmd:   "metadata",
//     input: "/abs/path/IMG_0001.HEIC",
//     full:  false   // true = 返回完整 EXIF，false（默认）= 只返回基础字段
//   }
//
// 响应（快速模式 full=false）：
//   {
//     ok:          true,
//     width:       4032,
//     height:      3024,
//     orientation: 6,           // EXIF orientation 1-8
//     format:      "heif",      // Sharp 识别到的格式
//     channels:    3,
//     hasAlpha:    false,
//     density:     72,          // DPI（RAW 文件通常为 null）
//     space:       "srgb"       // 色彩空间
//   }
//
// 响应（完整模式 full=true，额外字段）：
//   {
//     ...同上,
//     exif:        { ... },     // 原始 EXIF buffer（base64），可用 exifr 解析
//     icc:         "...",       // ICC 色彩配置文件（base64），null 表示 sRGB
//     compression: "av1",       // 压缩格式（HEIF 相关）
//     xmp:         null         // XMP 元数据（如有）
//   }

const sharp      = require('sharp');
const fs         = require('fs');
const log        = require('../lib/logger');
const { metaSem }    = require('../lib/concurrency');
const { checkInput } = require('../lib/validate');

async function handle(req) {
  // ── 校验 ──────────────────────────────────────────────
  const inputErr = checkInput(req.input);
  if (inputErr) return inputErr;

  const { input, full = false } = req;

  return metaSem.run(async () => {
    try {
      // Sharp.metadata() 仅读取文件头（几 KB），速度极快（< 10ms）
      const meta = await sharp(input, {
        failOnError: false,
      }).metadata();

      // ── 基础字段 ──────────────────────────────────────
      const base = {
        ok:          true,
        width:       meta.width       ?? 0,
        height:      meta.height      ?? 0,
        orientation: meta.orientation ?? 1,
        format:      meta.format      ?? 'unknown',
        channels:    meta.channels    ?? 3,
        hasAlpha:    meta.hasAlpha    ?? false,
        density:     meta.density     ?? null,
        space:       meta.space       ?? 'srgb',
      };

      // 对 HEIF 系列：实际显示宽高需结合 orientation 调整
      // Orientation 5/6/7/8 → 宽高互换
      if (meta.orientation && meta.orientation >= 5 && meta.orientation <= 8) {
        base.displayWidth  = base.height;
        base.displayHeight = base.width;
      } else {
        base.displayWidth  = base.width;
        base.displayHeight = base.height;
      }

      if (!full) return base;

      // ── 完整模式：追加 buffer 类型字段 ──────────────────
      const extra = {
        exif:        meta.exif  ? meta.exif.toString('base64')  : null,
        icc:         meta.icc   ? meta.icc.toString('base64')   : null,
        xmp:         meta.xmp   ? meta.xmp.toString('base64')   : null,
        compression: meta.compression ?? null,
        isProgressive:meta.isProgressive ?? false,
        paletteBitDepth: meta.paletteBitDepth ?? null,
        bitsPerSample:   meta.bitsPerSample   ?? null,
      };

      return { ...base, ...extra };

    } catch (e) {
      log.error('Metadata failed', { input, error: e.message });
      return { ok: false, error: `metadata: ${e.message || String(e)}` };
    }
  });
}

module.exports = { handle };
