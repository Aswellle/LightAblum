'use strict';
// sidecar/lib/validate.js
//
// 请求参数校验
// 统一在此处理，handlers 无需重复校验

const fs = require('fs');

/**
 * 校验输入文件路径
 * @param {string} input
 * @returns {{ ok: false, error: string } | null}  null 表示通过
 */
function checkInput(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'Missing or invalid "input" field' };
  }
  if (!fs.existsSync(input)) {
    return { ok: false, error: `Source file not found: ${input}` };
  }
  return null;
}

/**
 * 校验 thumbnail 命令参数
 */
function checkThumbnailReq(req) {
  const { input, sizes, outputs, quality } = req;

  const inputErr = checkInput(input);
  if (inputErr) return inputErr;

  if (!Array.isArray(sizes) || sizes.length === 0) {
    return { ok: false, error: '"sizes" must be a non-empty array of numbers' };
  }
  if (!Array.isArray(outputs) || outputs.length !== sizes.length) {
    return { ok: false, error: '"outputs" must be an array with same length as "sizes"' };
  }
  for (const s of sizes) {
    if (typeof s !== 'number' || s <= 0 || s > 4096) {
      return { ok: false, error: `Invalid size value: ${s} (must be 1-4096)` };
    }
  }
  if (quality !== undefined && (typeof quality !== 'number' || quality < 1 || quality > 100)) {
    return { ok: false, error: `Invalid quality: ${quality} (must be 1-100)` };
  }
  return null;
}

/**
 * 校验 batch_thumbnail 命令参数
 */
function checkBatchReq(req) {
  const { tasks } = req;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { ok: false, error: '"tasks" must be a non-empty array' };
  }
  if (tasks.length > 200) {
    return { ok: false, error: 'Batch size exceeds limit of 200' };
  }
  for (let i = 0; i < tasks.length; i++) {
    const err = checkThumbnailReq(tasks[i]);
    if (err) return { ok: false, error: `tasks[${i}]: ${err.error}` };
  }
  return null;
}

module.exports = { checkInput, checkThumbnailReq, checkBatchReq };
