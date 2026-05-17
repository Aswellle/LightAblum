'use strict';
// sidecar/lib/logger.js
//
// 结构化日志（全部写入 stderr，绝不污染 stdout 协议通道）
//
// 规则：stdout 只写 JSON Lines 响应，stderr 只写调试日志。
// Rust 侧 SidecarHandle 将 stderr 重定向到 null，
// 开发时可通过 SIDECAR_LOG=debug 环境变量开启详细日志。

const LEVEL_MAP = { error: 0, warn: 1, info: 2, debug: 3 };
const ENV_LEVEL = process.env.SIDECAR_LOG || 'info';
const MAX_LEVEL = LEVEL_MAP[ENV_LEVEL] ?? LEVEL_MAP.info;

function write(level, msg, extra) {
  if ((LEVEL_MAP[level] ?? 99) > MAX_LEVEL) return;
  const ts   = new Date().toISOString();
  const line = extra
    ? `[${ts}] [${level.toUpperCase()}] ${msg} ${JSON.stringify(extra)}`
    : `[${ts}] [${level.toUpperCase()}] ${msg}`;
  process.stderr.write(line + '\n');
}

module.exports = {
  error: (msg, extra) => write('error', msg, extra),
  warn:  (msg, extra) => write('warn',  msg, extra),
  info:  (msg, extra) => write('info',  msg, extra),
  debug: (msg, extra) => write('debug', msg, extra),
};
