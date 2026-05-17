'use strict';
// sidecar/handlers/decode.js
//
// HEIC / RAW 原图解码（大图预览用）
//
// 调用时机：
//   PhotoPreview 组件在飞入动画完成后，异步加载原图。
//   thumbnail_get_path 已返回 medium 缩略图路径，decode 用于获取更高质量版本。
//
// 性能策略（两步渐进加载）：
//   Step 1: thumbnail 命令生成 L 尺寸（1600px）缩略图 → 前端立即显示
//   Step 2: decode 命令解码原图 → 前端无缝替换（opacity transition）
//
//   对 4K 照片：
//     Step 1 约 200ms（从磁盘读 L 缩略图）
//     Step 2 约 300-800ms（解码 HEIC/RAW，等比例缩放到屏幕尺寸）
//
// 请求格式：
//   {
//     cmd:          "decode",
//     input:        "/abs/path/IMG_0001.HEIC",
//     format:       "jpeg",          // 输出格式：jpeg | webp | png（默认 jpeg）
//     quality:      90,              // 输出质量（默认 90）
//     maxDimension: 3840,            // 最大边长 px（默认 3840 = 4K）
//     outputPath:   "/tmp/xxx.jpg"   // 若提供则写入文件，返回 { ok, path }
//                                    // 否则返回 base64 数据
//   }
//
// 响应格式（base64 模式）：
//   { ok: true, data: "<base64>", width: N, height: N, format: "jpeg" }
//
// 响应格式（文件模式）：
//   { ok: true, path: "/tmp/xxx.jpg", width: N, height: N }
//
// 注意：base64 模式传输大图会占用大量 IPC 内存，建议优先使用 outputPath 文件模式。

const sharp      = require('sharp');
const fs         = require('fs');
const path       = require('path');
const log        = require('../lib/logger');
const { decodeSem }  = require('../lib/concurrency');
const { checkInput } = require('../lib/validate');

const DEFAULT_MAX_DIM = 3840;  // 4K 上限（大多数显示器）
const ABSOLUTE_MAX    = 8192;  // 安全上限（超此值拒绝，防 OOM）

async function handle(req) {
  // ── 校验 ──────────────────────────────────────────────
  const inputErr = checkInput(req.input);
  if (inputErr) return inputErr;

  const {
    input,
    format       = 'jpeg',
    quality      = 90,
    maxDimension = DEFAULT_MAX_DIM,
    outputPath,
  } = req;

  // 安全上限校验
  const limit = Math.min(Number(maxDimension) || DEFAULT_MAX_DIM, ABSOLUTE_MAX);

  // 格式白名单
  const ALLOWED_FORMATS = new Set(['jpeg', 'webp', 'png']);
  if (!ALLOWED_FORMATS.has(format)) {
    return { ok: false, error: `Unsupported format: ${format}. Use jpeg|webp|png` };
  }

  return decodeSem.run(async () => {
    const t0 = Date.now();
    try {
      // ── 构建 Sharp pipeline ────────────────────────────
      const pipeline = sharp(input, {
        failOnError:     false,
        limitInputPixels:false,
        sequentialRead:  true,
      })
        .rotate()           // 自动 EXIF 方向校正
        .resize(limit, limit, {
          fit:                'inside',   // 等比例缩放，不裁切
          withoutEnlargement: true,       // 原图已小于 limit 时不放大
        });

      // 应用格式
      let formatted;
      switch (format) {
        case 'webp':
          formatted = pipeline.webp({ quality, effort: 2, smartSubsample: true });
          break;
        case 'png':
          formatted = pipeline.png({ compressionLevel: 6 });
          break;
        default: // jpeg
          formatted = pipeline.jpeg({
            quality,
            mozjpeg:        false,   // mozjpeg 更慢，生产环境不值得
            chromaSubsampling: '4:2:0',
          });
      }

      // ── 输出 ─────────────────────────────────────────
      let result;
      if (outputPath) {
        // 文件模式：写入磁盘，返回路径
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const out = await formatted.toFile(outputPath);
        result = {
          ok:     true,
          path:   outputPath,
          width:  out.width,
          height: out.height,
        };
      } else {
        // Base64 模式：返回内联数据（小图 / 无磁盘写权限时使用）
        const { data, info } = await formatted.toBuffer({ resolveWithObject: true });
        result = {
          ok:     true,
          data:   data.toString('base64'),
          width:  info.width,
          height: info.height,
          format: info.format,
        };
      }

      log.debug('Decode done', {
        file:    path.basename(input),
        w:       result.width,
        h:       result.height,
        elapsed: `${Date.now() - t0}ms`,
        mode:    outputPath ? 'file' : 'base64',
      });

      return result;

    } catch (e) {
      log.error('Decode failed', { file: path.basename(input), error: e.message });
      return { ok: false, error: `decode: ${e.message || String(e)}` };
    }
  });
}

module.exports = { handle };
