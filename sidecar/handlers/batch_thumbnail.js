'use strict';
// sidecar/handlers/batch_thumbnail.js
//
// 批量缩略图生成（扫描阶段 / 启动补全用）
//
// 设计动机：
//   扫描完成后可能有数千张 HEIC/RAW 文件需要生成缩略图。
//   若逐张通过 thumbnail 命令处理，每次 IPC 开销累加显著。
//   batch_thumbnail 命令允许一次请求处理最多 200 张图片，
//   内部顺序处理（受 thumbSem 保护），每完成一张回调进度。
//
// 注意：批量命令是「单请求单响应」模型。
//   完成后返回聚合结果，而非流式 per-file 响应。
//   进度通过 progress_id（可选）字段在响应中一并返回。
//
// 请求格式：
//   {
//     cmd:   "batch_thumbnail",
//     tasks: [
//       { input: "/path/a.heic", sizes: [200, 600], outputs: [...], quality: 85 },
//       { input: "/path/b.cr2",  sizes: [200, 600], outputs: [...], quality: 85 },
//       ...  (最多 200 条)
//     ]
//   }
//
// 响应格式：
//   {
//     ok:     true,
//     done:   195,
//     failed: 5,
//     errors: [{ index: 3, file: "bad.cr2", error: "..." }, ...]
//   }

const thumbnail          = require('./thumbnail');
const log                = require('../lib/logger');
const { checkBatchReq }  = require('../lib/validate');
const path               = require('path');

async function handle(req) {
  // ── 校验 ──────────────────────────────────────────────
  const err = checkBatchReq(req);
  if (err) return err;

  const { tasks } = req;
  const t0 = Date.now();

  let done   = 0;
  let failed = 0;
  const errors = [];

  // ── 顺序处理（由 thumbSem 内部控制并发）───────────────
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      const result = await thumbnail.handle(task);
      if (result.ok) {
        done++;
      } else {
        failed++;
        errors.push({
          index: i,
          file:  path.basename(task.input || ''),
          error: result.error,
        });
      }
    } catch (e) {
      failed++;
      errors.push({
        index: i,
        file:  path.basename(task.input || ''),
        error: e.message || String(e),
      });
    }
  }

  log.info('Batch done', {
    total:   tasks.length,
    done,
    failed,
    elapsed: `${Date.now() - t0}ms`,
  });

  return { ok: true, done, failed, errors };
}

module.exports = { handle };
