'use strict';
/**
 * handlers/thumbnail.js — 单张图片缩略图生成
 *
 * 职责：
 *   将单张 HEIC / RAW / 其他图片生成一组 WEBP 缩略图（多尺寸）。
 *   核心优化：一次读取原图并解码（toBuffer），多次 resize，减少 IO 和解码开销。
 *
 * 请求格式：
 *   {
 *     cmd:     "thumbnail",
 *     reqId:   "optional-uuid",
 *     input:   "/abs/path/IMG_0001.HEIC",
 *     sizes:   [200, 600],            // 正方形边长，px
 *     outputs: ["/thumb/s.webp", "/thumb/m.webp"],
 *     quality: 85,                    // WEBP quality 0-100，默认 85
 *     skipExisting: true              // 默认 true，文件已存在则跳过
 *   }
 *
 * 响应格式：
 *   { ok: true,  generated: ["/thumb/s.webp", "/thumb/m.webp"], skipped: [] }
 *   { ok: false, error: "..." }
 *
 * Sharp 优势（相对 image crate）：
 *   - .rotate() 自动读取 EXIF Orientation，旋转后再 resize（image crate 不总是自动处理）
 *   - 原生支持 HEIC（libheif）、RAW（libvips + dcraw）
 *   - 流式解码：不将整张原图载入 JS 堆（通过 native 模块直接读取）
 */

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

// 并发限制：避免同时处理多张大 RAW 导致内存溢出
// index.js 已串行化请求，此处限制主要用于 batch_thumbnail 内部并行
const MAX_CONCURRENT_INTERNAL = 2;
let _concurrentCount = 0;

async function handle(req) {
  const {
    input,
    sizes,
    outputs,
    quality      = 85,
    skipExisting = true,
  } = req;

  // ── 参数验证 ──────────────────────────────────────────
  if (!input || typeof input !== 'string') {
    return { ok: false, error: 'Missing or invalid "input" field' };
  }
  if (!Array.isArray(sizes) || sizes.length === 0) {
    return { ok: false, error: 'Missing or empty "sizes" array' };
  }
  if (!Array.isArray(outputs) || outputs.length !== sizes.length) {
    return { ok: false, error: '"outputs" must match "sizes" in length' };
  }
  if (typeof quality !== 'number' || quality < 0 || quality > 100) {
    return { ok: false, error: '"quality" must be 0-100' };
  }

  // ── 文件存在检查 ──────────────────────────────────────
  if (!fs.existsSync(input)) {
    return { ok: false, error: `Source file not found: ${input}` };
  }

  // ── 确定哪些尺寸需要生成 ──────────────────────────────
  const tasks = [];  // { size, outPath }
  const skipped = [];

  for (let i = 0; i < sizes.length; i++) {
    const outPath = outputs[i];
    if (skipExisting && fs.existsSync(outPath)) {
      skipped.push(outPath);
      continue;
    }
    // 确保输出目录存在
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    tasks.push({ size: sizes[i], outPath });
  }

  if (tasks.length === 0) {
    return { ok: true, generated: [], skipped };
  }

  // ── 一次解码原图，多次 resize ─────────────────────────
  // 排序：从大到小（先生成大尺寸，再从中间尺寸缩到小尺寸效果更好）
  tasks.sort((a, b) => b.size - a.size);

  const generated = [];

  try {
    // Step 1：解码原图并应用 EXIF 方向（一次操作）
    // 使用 toBuffer({resolveWithObject: true}) 获取元信息
    const {
      data:    imgBuffer,
      info:    imgInfo,
    } = await sharp(input, {
      failOnError:      false,
      limitInputPixels: false,   // 支持超大全景图
    })
      .rotate()                  // ← 关键：自动 EXIF 旋转
      .toBuffer({ resolveWithObject: true });

    // Step 2：从已解码的 Buffer 生成各尺寸（不再读取文件）
    await Promise.all(
      tasks.map(async ({ size, outPath }) => {
        await sharp(imgBuffer, {
          raw: {
            width:    imgInfo.width,
            height:   imgInfo.height,
            channels: imgInfo.channels,
          },
        })
          .resize(size, size, {
            fit:                'cover',
            position:           'centre',
            withoutEnlargement: false,
            kernel:             sharp.kernel.lanczos3,
          })
          .webp({
            quality,
            effort: 4,        // 速度/质量平衡（0=最快，6=最慢）
            lossless: false,
          })
          .toFile(outPath);

        generated.push(outPath);
      })
    );

    return { ok: true, generated, skipped };

  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    // 附加文件信息便于排查
    return {
      ok:    false,
      error: `Sharp thumbnail error for "${path.basename(input)}": ${msg}`,
    };
  }
}

module.exports = { handle };
