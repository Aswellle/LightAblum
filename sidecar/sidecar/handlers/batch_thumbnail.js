'use strict';
/**
 * handlers/batch_thumbnail.js — 批量缩略图生成
 *
 * 用于扫描完成后的批量补全（而非用户触发的实时请求）。
 * index.js 主循环是串行的，batch_thumbnail 内部可并行处理多张图片。
 *
 * 请求格式：
 *   {
 *     cmd:     "batch_thumbnail",
 *     reqId:   "optional-uuid",
 *     items: [
 *       {
 *         input:   "/abs/path/photo.heic",
 *         sizes:   [200, 600],
 *         outputs: ["/thumb/s.webp", "/thumb/m.webp"]
 *       },
 *       ...
 *     ],
 *     quality:      85,
 *     concurrency:  2,           // 并行处理数，默认 2（内存敏感）
 *     skipExisting: true
 *   }
 *
 * 响应格式：
 *   {
 *     ok:       true,
 *     total:    N,
 *     success:  N,
 *     failed:   N,
 *     skipped:  N,
 *     errors:   [{ input: "...", error: "..." }, ...]   // 最多 20 条
 *   }
 *
 * 设计说明：
 *   批处理不终止于单个失败——记录错误、继续处理剩余项目。
 *   调用方（Rust pipeline）根据 failed 数量决定是否重试。
 */

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

// 导入单张处理逻辑（复用核心算法）
const { handle: handleSingle } = require('./thumbnail');

async function handle(req) {
  const {
    items,
    quality      = 85,
    concurrency  = 2,
    skipExisting = true,
  } = req;

  // ── 参数验证 ──────────────────────────────────────────
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Missing or empty "items" array' };
  }
  if (items.length > 500) {
    return { ok: false, error: 'batch_thumbnail: max 500 items per request' };
  }

  const limit = Math.max(1, Math.min(concurrency, 4)); // 上限 4
  let success = 0;
  let failed  = 0;
  let skipped = 0;
  const errors = [];

  // ── 带并发限制的处理循环 ──────────────────────────────
  // 使用滑动窗口：同时处理 `limit` 张，完成一张再补充下一张
  let idx = 0;
  const active = new Set();

  function launchNext() {
    while (active.size < limit && idx < items.length) {
      const item = items[idx++];
      const p = processItem(item, quality, skipExisting).then((result) => {
        active.delete(p);
        if (result.skip) {
          skipped += result.skipped || 0;
          success += (result.generated || []).length > 0 ? 1 : 0;
        } else if (result.ok) {
          success++;
          skipped += (result.skipped || []).length;
        } else {
          failed++;
          if (errors.length < 20) {
            errors.push({ input: item.input, error: result.error });
          }
        }
        launchNext();
      });
      active.add(p);
    }
  }

  launchNext();

  // 等待所有 active 任务完成
  while (active.size > 0) {
    await Promise.race(active);
  }

  return {
    ok:      true,
    total:   items.length,
    success,
    failed,
    skipped,
    errors:  errors.length > 0 ? errors : undefined,
  };
}

async function processItem(item, quality, skipExisting) {
  try {
    const result = await handleSingle({
      cmd:          'thumbnail',
      input:        item.input,
      sizes:        item.sizes,
      outputs:      item.outputs,
      quality,
      skipExisting,
    });
    return result;
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { handle };
