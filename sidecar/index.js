'use strict';
// sidecar/index.js
//
// Sharp Worker — JSON Lines 协议调度器（生产版）
//
// ══════════════════════════════════════════════════════════
//  协议规范
// ══════════════════════════════════════════════════════════
//
//  传输层：stdin（Rust → Node）/ stdout（Node → Rust）
//  格式：  每行一个 JSON 对象，以 \n 结尾
//  顺序：  严格请求-响应（本进程单线程处理，async 不改变响应顺序）
//
//  请求字段（通用）：
//    cmd     string   命令名（必填）
//    reqId   string   请求 ID（可选，响应中原样返回，用于调试）
//
//  已注册命令：
//    thumbnail         生成 HEIC/RAW 缩略图（单张）
//    batch_thumbnail   批量生成缩略图
//    decode            解码 HEIC/RAW 原图（大图预览）
//    metadata          读取图片元数据
//    ping              健康检测
//    memory            内存使用查询
//    shutdown          优雅退出（测试用）
//
//  响应字段（通用）：
//    ok      boolean  是否成功
//    reqId   string   回传请求 ID（若请求中包含）
//    error   string   错误信息（ok=false 时）
//
// ══════════════════════════════════════════════════════════
//  生命周期
// ══════════════════════════════════════════════════════════
//
//  启动：Rust SidecarHandle.spawn() 按需启动
//  空闲：不自动退出（由 Rust 侧 IDLE_TIMEOUT 控制）
//  退出：stdin EOF（Rust 进程退出）或 shutdown 命令
//
// ══════════════════════════════════════════════════════════

const readline         = require('readline');
const os               = require('os');
const log              = require('./lib/logger');
const thumbnail        = require('./handlers/thumbnail');
const batchThumbnail   = require('./handlers/batch_thumbnail');
const decode           = require('./handlers/decode');
const metadata         = require('./handlers/metadata');

// ─────────────────────────────────────────────────────────
//  命令路由表
// ─────────────────────────────────────────────────────────

const HANDLERS = {
  thumbnail:       thumbnail.handle,
  batch_thumbnail: batchThumbnail.handle,
  decode:          decode.handle,
  metadata:        metadata.handle,

  // ── 内建命令 ──────────────────────────────────────────

  ping: async () => ({
    ok:       true,
    pid:      process.pid,
    version:  process.version,
    platform: process.platform,
    uptime:   Math.round(process.uptime()),
  }),

  memory: async () => {
    const mem = process.memoryUsage();
    return {
      ok:        true,
      heapUsed:  mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss:       mem.rss,
      external:  mem.external,
      // 格式化显示（MB）
      heapUsedMB:  Math.round(mem.heapUsed  / 1048576),
      heapTotalMB: Math.round(mem.heapTotal / 1048576),
      rssMB:       Math.round(mem.rss       / 1048576),
    };
  },

  shutdown: async () => {
    log.info('Shutdown command received, exiting');
    setImmediate(() => process.exit(0));
    return { ok: true, message: 'shutting down' };
  },
};

// ─────────────────────────────────────────────────────────
//  请求超时（防止 Sharp 处理某些损坏文件时永久挂起）
// ─────────────────────────────────────────────────────────

const TIMEOUT_MS = {
  thumbnail:       30_000,   // 30s（RAW 解码可能较慢）
  batch_thumbnail: 600_000,  // 10min（批量最多 200 张）
  decode:          60_000,   // 60s（高分辨率原图）
  metadata:        10_000,   // 10s
  ping:             1_000,
  memory:           1_000,
  shutdown:         1_000,
};

function withTimeout(promise, ms, cmd) {
  if (!ms) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Command "${cmd}" timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ─────────────────────────────────────────────────────────
//  内存压力保护
//  超过阈值时拒绝新的 thumbnail/decode 请求，避免 OOM 崩溃
// ─────────────────────────────────────────────────────────

const MEMORY_LIMIT_MB = 512;  // 单进程内存上限（可通过环境变量覆盖）
const memLimitMB = parseInt(process.env.SIDECAR_MEM_MB || String(MEMORY_LIMIT_MB), 10);

function isMemoryOk() {
  const used = process.memoryUsage().rss / 1048576;
  return used < memLimitMB;
}

// ─────────────────────────────────────────────────────────
//  请求计数（用于 log 相关性追踪）
// ─────────────────────────────────────────────────────────

let reqCount = 0;

// ─────────────────────────────────────────────────────────
//  stdin JSON Lines 读取
// ─────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input:     process.stdin,
  terminal:  false,
  crlfDelay: Infinity,
});

log.info('Sharp worker started', {
  pid:      process.pid,
  node:     process.version,
  platform: process.platform,
  cpus:     os.cpus().length,
});

// 按顺序处理请求（readline 本身是顺序的，每次 line 事件都等上一个 async 完成）
// 这确保了 stdout 的响应顺序与 stdin 的请求顺序完全一致
let processing = Promise.resolve();

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  // 链式执行：确保响应顺序
  processing = processing.then(() => handleLine(trimmed));
});

rl.on('close', () => {
  log.info('stdin closed, exiting');
  process.exit(0);
});

async function handleLine(trimmed) {
  const n = ++reqCount;

  // ── 解析 JSON ─────────────────────────────────────────
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (e) {
    writeLine({ ok: false, error: `JSON parse error: ${e.message}` });
    return;
  }

  const { cmd, reqId } = req;
  const t0 = Date.now();

  log.debug(`[${n}] → ${cmd}`, reqId ? { reqId } : undefined);

  // ── 命令路由 ──────────────────────────────────────────
  const handler = HANDLERS[cmd];
  if (!handler) {
    writeLine(respond({ ok: false, error: `Unknown command: ${cmd}` }, reqId));
    return;
  }

  // ── 内存压力检查（仅对重量级命令）────────────────────
  if ((cmd === 'thumbnail' || cmd === 'decode' || cmd === 'batch_thumbnail')
      && !isMemoryOk()) {
    const rssMB = Math.round(process.memoryUsage().rss / 1048576);
    log.warn(`Memory pressure: ${rssMB}MB, rejecting ${cmd}`);
    writeLine(respond({
      ok:    false,
      error: `MEMORY_PRESSURE: ${rssMB}MB used (limit ${memLimitMB}MB), retry later`,
    }, reqId));
    return;
  }

  // ── 执行命令（含超时保护）────────────────────────────
  let response;
  try {
    const timeoutMs = TIMEOUT_MS[cmd] || 30_000;
    response = await withTimeout(handler(req), timeoutMs, cmd);
  } catch (e) {
    log.error(`[${n}] ✗ ${cmd}`, { error: e.message, elapsed: `${Date.now() - t0}ms` });
    response = { ok: false, error: e.message || String(e) };
  }

  const elapsed = Date.now() - t0;
  log.debug(`[${n}] ← ${cmd} ${response.ok ? '✓' : '✗'}`, { elapsed: `${elapsed}ms` });

  writeLine(respond(response, reqId));
}

// ─────────────────────────────────────────────────────────
//  输出工具
// ─────────────────────────────────────────────────────────

function respond(obj, reqId) {
  if (reqId !== undefined) return { ...obj, reqId };
  return obj;
}

function writeLine(obj) {
  // 确保单行（JSON.stringify 不产生换行）
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ─────────────────────────────────────────────────────────
//  未处理异常：记录但不退出（保持进程存活）
// ─────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
  // 不 process.exit()：让 Rust 侧通过 IDLE_TIMEOUT 决定是否重启
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
  // 无法安全继续，让 Rust 侧重启
  process.exit(1);
});

// SIGTERM：优雅退出（pkg 打包后 Rust kill() 发送此信号）
process.on('SIGTERM', () => {
  log.info('Received SIGTERM, exiting');
  process.exit(0);
});
