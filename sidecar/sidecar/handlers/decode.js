'use strict';
/**
 * handlers/decode.js — HEIC/RAW 解码为标准格式（大图预览用）
 *
 * 在大图预览时，前端需要显示完整分辨率的照片。
 * image crate 无法处理 HEIC/RAW，此命令通过 Sharp 解码并以 base64 返回。
 *
 * 请求格式：
 *   {
 *     cmd:          "decode",
 *     reqId:        "optional-uuid",
 *     input:        "/abs/path/photo.heic",
 *     format:       "jpeg",        // 输出格式："jpeg" | "png" | "webp"，默认 "jpeg"
 *     quality:      90,            // 输出质量，默认 90
 *     maxDimension: 4096           // 最大边长（等比缩放），默认 4096，防止内存爆炸
 *   }
 *
 * 响应格式：
 *   {
 *     ok:     true,
 *     data:   "<base64 string>",   // 编码后的图片数据
 *     width:  N,                   // 输出图片宽度（经过 maxDimension 缩放后）
 *     height: N,                   // 输出图片高度
 *     format: "jpeg",
 *     originalWidth:  N,           // 原始宽度（旋转校正后）
 *     originalHeight: N,
 *   }
 *   { ok: false, error: "..." }
 *
 * 性能说明：
 *   - HEIC 4000×3000 → JPEG 4096max：~150ms（M1 Mac），~300ms（i7 Win）
 *   - 返回的 base64 字符串约 3-8MB（取决于照片内容和质量）
 *   - 前端 services/tauriIpc.ts 中使用此命令的 read_original 路径
 */

const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

// 解码最大边长上限（防止超大全景图塞满内存）
const HARD_MAX_DIMENSION = 8192;
// 默认最大边长（4K 分辨率）
const DEFAULT_MAX_DIMENSION = 4096;

async function handle(req) {
  const {
    input,
    format       = 'jpeg',
    quality      = 90,
    maxDimension = DEFAULT_MAX_DIMENSION,
  } = req;

  // ── 参数验证 ──────────────────────────────────────────
  if (!input || typeof input !== 'string') {
    return { ok: false, error: 'Missing "input" field' };
  }
  if (!['jpeg', 'png', 'webp'].includes(format)) {
    return { ok: false, error: `Unsupported output format: "${format}"` };
  }

  if (!fs.existsSync(input)) {
    return { ok: false, error: `File not found: ${input}` };
  }

  const limitDim = Math.min(
    Math.max(1, Number(maxDimension) || DEFAULT_MAX_DIMENSION),
    HARD_MAX_DIMENSION
  );

  try {
    // Step 1：读取元信息，获取原始宽高（旋转校正后）
    const rawMeta = await sharp(input, { failOnError: false })
      .rotate()
      .metadata();

    const originalWidth  = rawMeta.width  || 0;
    const originalHeight = rawMeta.height || 0;

    // Step 2：解码、旋转、等比缩放、编码
    const pipeline = sharp(input, {
      failOnError:      false,
      limitInputPixels: false,
    })
      .rotate()                   // EXIF 方向校正
      .resize(limitDim, limitDim, {
        fit:                'inside', // 等比缩放，不裁切，不超过 limitDim
        withoutEnlargement: true,     // 原图小于 limit 时保持原尺寸
        kernel:             sharp.kernel.lanczos3,
      });

    let outputBuffer;
    switch (format) {
      case 'jpeg':
        outputBuffer = await pipeline
          .jpeg({ quality, progressive: true, mozjpeg: false })
          .toBuffer({ resolveWithObject: true });
        break;
      case 'png':
        outputBuffer = await pipeline
          .png({ compressionLevel: 7 })
          .toBuffer({ resolveWithObject: true });
        break;
      case 'webp':
        outputBuffer = await pipeline
          .webp({ quality, effort: 2 }) // effort 2 = 快速，预览不需要最优压缩
          .toBuffer({ resolveWithObject: true });
        break;
    }

    const { data, info } = outputBuffer;

    return {
      ok:             true,
      data:           data.toString('base64'),
      width:          info.width,
      height:         info.height,
      format:         info.format,
      originalWidth,
      originalHeight,
      sizeBytes:      data.length,
    };

  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return {
      ok:    false,
      error: `Decode error for "${path.basename(input)}": ${msg}`,
    };
  }
}

module.exports = { handle };
