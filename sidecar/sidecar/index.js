'use strict';
/**
 * sidecar/index.js — Sharp Worker 主进程
 *
 * 协议规范（JSON Lines，每行一个 JSON 对象）：
 *
 *   Rust ──stdin──▶ Node
 *   {
 *     "cmd":     "thumbnail" | "decode" | "metadata" | "batch_thumbnail" | "ping" | "stats",
 *     "reqId":   "uuid-string",    // 可选：透传到响应，供 Rust 侧关联
 *     ...cmd 专属字段
 *   }
 *
 *   Node ──stdout──▶ Rust
 *   { "ok": true,  "reqId": "...", ...响应字段 }
 *   { "ok": false, "reqId": "...", "error": "错误描述" }
 *
 * 约束：
 *   - 请求与响应严格一一对应（无多路复用），Rust 侧串行发送
 *   - 每行不超过 10MB（单次请求文件路径，不传图片内容）
 *   - 进程空闲超过 IDLE_TIMEOUT_MS 后自动退出，Rust 侧下次请求时重新启动
 *
 * 性能指标：
 *   - JPEG/PNG → WEBP 200px：~8ms
 *   - HEIC → WEBP 200+600px：~60-120ms（依 libheif 版本）
 *   - RAW (nef/cr2) → WEBP：~200-400ms（依 libraw）
 */

const readline = require('readline');
const thumbnail      = require('./handlers/thumbnail');
const batchThumbnail = require('./handlers/batch_thumbnail');
const decode         = require('./handlers/decode');
const metadata       = require('./handlers/metadata');

// ─────────────────────────────────────────────────────────
//  空闲自动退出（30s 无请求）
//  Rust 侧 SidecarHandle 有相同超时，两者配合确保进程不常驻
// ─────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 30_000;
let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // 主动退出，避免成为僵尸进程
    process.stderr.write('[sidecar] idle timeout — exiting\n');
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
}

// ─────────────────────────────────────────────────────────
//  简单统计（供 stats 命令返回）
// ─────────────────────────────────────────────────────────

const stats = {
  requests:   0,
  errors:     0,
  totalMs:    0,
  startedAt:  Date.now(),
};

// ─────────────────────────────────────────────────────────
//  命令路由表
// ─────────────────────────────────────────────────────────

const HANDLERS = {
  thumbnail:       thumbnail.handle,
  batch_thumbnail: batchThumbnail.handle,
  decode:          decode.handle,
  metadata:        metadata.handle,
  ping:            handlePing,
  stats:           handleStats,
};

async function handlePing(req) {
  return {
    ok:      true,
    pid:     process.pid,
    version: process.version,
    uptime:  ((Date.now() - stats.startedAt) / 1000).toFixed(1),
  };
}

async function handleStats(_req) {
  return {
    ok:       true,
    requests: stats.requests,
    errors:   stats.errors,
    avgMs:    stats.requests > 0
      ? Math.round(stats.totalMs / stats.requests)
      : 0,
    uptimeSec:Math.round((Date.now() - stats.startedAt) / 1000),
    pid:      process.pid,
  };
}

// ─────────────────────────────────────────────────────────
//  JSON Lines 读取循环
// ─────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input:     process.stdin,
  terminal:  false,
  crlfDelay: Infinity,
});

// 处理队列（确保串行——上一个请求响应后才处理下一个）
let processing = false;
const queue = [];

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  resetIdleTimer();
  queue.push(trimmed);

  if (!processing) {
    processNext();
  }
});

async function processNext() {
  if (queue.length === 0) {
    processing = false;
    return;
  }

  processing = true;
  const raw = queue.shift();
  const t0  = Date.now();

  let request;
  try {
    request = JSON.parse(raw);
  } catch (e) {
    writeLine({ ok: false, reqId: null, error: `JSON parse error: ${e.message}` });
    stats.errors++;
    processNext();
    return;
  }

  const { cmd, reqId } = request;
  stats.requests++;

  let response;
  try {
    const handler = HANDLERS[cmd];
    if (!handler) {
      response = { ok: false, error: `Unknown command: "${cmd}"` };
      stats.errors++;
    } else {
      response = await handler(request);
      if (!response.ok) stats.errors++;
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    response  = { ok: false, error: msg };
    stats.errors++;
    // 打印调用栈到 stderr，方便调试（不影响 stdout 协议）
    process.stderr.write(`[sidecar] handler error (${cmd}): ${msg}\n`);
    if (err && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
  }

  const elapsed = Date.now() - t0;
  stats.totalMs += elapsed;

  // 透传 reqId
  if (reqId !== undefined) {
    response.reqId = reqId;
  }

  writeLine(response);
  processNext();
}

rl.on('close', () => {
  // stdin 关闭 = Rust 侧进程退出，正常退出
  if (idleTimer) clearTimeout(idleTimer);
  process.exit(0);
});

// ─────────────────────────────────────────────────────────
//  全局错误防护（防止未捕获的 Promise 崩溃进程）
// ─────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  const msg = reason && reason.message ? reason.message : String(reason);
  process.stderr.write(`[sidecar] unhandledRejection: ${msg}\n`);
  // 不退出进程，继续处理后续请求
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`[sidecar] uncaughtException: ${err.message}\n`);
  // 严重错误时退出，让 Rust 侧重新启动
  process.exit(1);
});

// ─────────────────────────────────────────────────────────
//  工具
// ─────────────────────────────────────────────────────────

function writeLine(obj) {
  // 确保单行：移除 value 中的换行（路径等不应含换行，防御性处理）
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// 启动空闲计时
resetIdleTimer();

process.stderr.write(
  `[sidecar] started — pid=${process.pid} node=${process.version}\n`
);
