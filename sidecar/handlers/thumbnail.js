'use strict';
// sidecar/handlers/thumbnail.js
//
// HEIC / RAW 缩略图生成
//
// ─── Bug Fix（VipsImage: memory area too small）───────────
//
// 根本原因：
//   原代码使用 `.toBuffer({ resolveWithObject: true })` 解码原图。
//   Sharp 的 toBuffer() 默认保持编码格式（JPEG→JPEG Buffer）。
//   因此 data 实际上是 3119 字节的 JPEG 压缩数据，
//   而非 800×600×3 = 1,440,000 字节的原始像素数据。
//
//   随后将此 JPEG buffer 传入
//     sharp(data, { raw: { width:800, height:600, channels:3 } })
//   Sharp 期待 1,440,000 字节的 raw 像素，却只收到 3119 字节，
//   因此报错：
//     "VipsImage: memory area too small —
//      should be 1440000 bytes, you passed 3118"
//
// 修复方案：
//   在 toBuffer() 之前插入 .raw() 调用，强制输出未压缩的原始像素。
//
//   修复前（❌）：
//     .rotate()
//     .toBuffer({ resolveWithObject: true })
//
//   修复后（✅）：
//     .rotate()
//     .raw()                          ← 关键：强制输出 raw 像素
//     .toBuffer({ resolveWithObject: true })
//
//   此时 info.format 变为 'raw'，data.length = width×height×channels，
//   与 sharp(data, { raw: {...} }) 的期望完全一致。
//
// ──────────────────────────────────────────────────────────
//
// 请求格式：
//   {
//     cmd:     "thumbnail",
//     input:   "/abs/path/IMG_0001.HEIC",
//     sizes:   [200, 600],
//     outputs: ["/thumb/a3/a3bc...s.webp", "/thumb/a3/a3bc...m.webp"],
//     quality: 85
//   }
//
// 响应格式：
//   { ok: true,  widths: [200, 600], heights: [200, 600] }
//   { ok: false, error: "..." }

const sharp    = require('sharp');
const path     = require('path');
const fs       = require('fs');
const log      = require('../lib/logger');
const { thumbSem } = require('../lib/concurrency');
const { checkThumbnailReq } = require('../lib/validate');

// WEBP encode effort 级别（0=最快，6=最慢/最小）
// 4 = 速度与压缩率的合理平衡
const WEBP_EFFORT = 4;

async function handle(req) {
  // ── 参数校验 ──────────────────────────────────────────
  const err = checkThumbnailReq(req);
  if (err) return err;

  const { input, sizes, outputs, quality = 85 } = req;
  const t0 = Date.now();

  return thumbSem.run(async () => {
    try {
      // ── Step 1: 一次解码 + 自动 EXIF 旋转 ─────────────
      //
      // ✅ 修复点：链式调用中加入 .raw()
      //   .raw() 告知 Sharp 将解码结果输出为未压缩的原始像素（RGBA/RGB）
      //   而非保持原始编码格式（JPEG/HEIC/etc）
      //   这样 data.length 才等于 width × height × channels，
      //   后续 sharp(data, { raw: {...} }) 才能正确工作。
      //
      const { data, info } = await sharp(input, {
        failOnError:     false,
        limitInputPixels: false,
        sequentialRead:  true,
      })
        .rotate()
        .raw()                              // ← 修复核心：强制输出 raw 像素 Buffer
        .toBuffer({ resolveWithObject: true });

      log.debug('Decoded', {
        file:   path.basename(input),
        w:      info.width,
        h:      info.height,
        fmt:    info.format,  // 现在会是 'raw'
        bytes:  data.length,  // 现在等于 w×h×channels
        ms:     Date.now() - t0,
      });

      // ── Step 2: 并行多尺寸 resize ───────────────────────
      const results = await Promise.all(
        sizes.map(async (size, i) => {
          const outPath = outputs[i];

          // 确保输出目录存在
          const dir = path.dirname(outPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          // 若目标文件已存在则跳过
          if (fs.existsSync(outPath)) {
            const meta = await sharp(outPath).metadata();
            return { width: meta.width || size, height: meta.height || size };
          }

          // 从内存 raw Buffer 创建 sharp 实例（避免重复解码）
          // info.channels 在 .raw() 之后可能变为 4（含 alpha），
          // 需使用实际值而非硬编码 3。
          const { width, height } = await sharp(data, {
            raw: {
              width:    info.width,
              height:   info.height,
              channels: info.channels,   // 使用解码后的实际 channels 值
            },
          })
            .resize(size, size, {
              fit:                'cover',
              position:           'centre',
              withoutEnlargement: false,
            })
            .webp({
              quality,
              effort:         WEBP_EFFORT,
              smartSubsample: true,
            })
            .toFile(outPath)
            .then(out => ({ width: out.width, height: out.height }));

          return { width, height };
        })
      );

      const elapsed = Date.now() - t0;
      log.debug('Thumbnails done', {
        file:    path.basename(input),
        sizes,
        elapsed: `${elapsed}ms`,
      });

      return {
        ok:      true,
        widths:  results.map(r => r.width),
        heights: results.map(r => r.height),
      };

    } catch (e) {
      log.error('Thumbnail failed', { file: path.basename(input), error: e.message });
      return { ok: false, error: `thumbnail: ${e.message || String(e)}` };
    }
  });
}

module.exports = { handle };
