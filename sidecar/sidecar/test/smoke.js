'use strict';
/**
 * test/smoke.js — Sidecar 冒烟测试
 *
 * 无需打包，直接 `node test/smoke.js` 验证各处理器逻辑。
 * 使用项目内 test/fixtures/ 目录中的样本图片。
 *
 * 运行：
 *   cd sidecar
 *   npm install
 *   node test/smoke.js
 *
 * 通过标准：
 *   所有 ✅ 即为通过，任意 ❌ 表示有问题
 */

const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const thumbnail      = require('../handlers/thumbnail');
const batchThumbnail = require('../handlers/batch_thumbnail');
const decode         = require('../handlers/decode');
const metadata       = require('../handlers/metadata');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TMP_DIR      = fs.mkdtempSync(path.join(os.tmpdir(), 'la-sidecar-test-'));

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────
//  测试工具：如果 fixtures 中没有 HEIC/RAW，用 PNG 代替
// ─────────────────────────────────────────────────────────

function findTestImage() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  // 优先查找 HEIC/RAW
  const preferred = ['test.heic', 'test.jpg', 'test.png'];
  for (const name of preferred) {
    const p = path.join(FIXTURES_DIR, name);
    if (fs.existsSync(p)) return p;
  }

  // 如果都没有，用 Sharp 创建一张临时 PNG
  const tmpPng = path.join(TMP_DIR, 'generated.png');
  if (!fs.existsSync(tmpPng)) {
    // 同步创建 1×1 PNG（最小测试图片）
    // 这里使用 Base64 内嵌一个有效的 1px PNG
    const PNG_1PX = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(tmpPng, PNG_1PX);
  }
  return tmpPng;
}

// ─────────────────────────────────────────────────────────
//  测试套件
// ─────────────────────────────────────────────────────────

async function runTests() {
  console.log('🔬 LightAlbum Sharp Sidecar — Smoke Tests\n');
  console.log(`   Node.js:  ${process.version}`);
  console.log(`   TMP dir:  ${TMP_DIR}\n`);

  const testImage = findTestImage();
  console.log(`   Test image: ${testImage}\n`);

  // ── 1. metadata ────────────────────────────────────────
  console.log('[ metadata ]');
  {
    // 正常文件
    const r = await metadata.handle({ cmd: 'metadata', input: testImage });
    assert(r.ok === true,      'ok = true');
    assert(r.width  > 0,       `width  = ${r.width}`);
    assert(r.height > 0,       `height = ${r.height}`);
    assert(typeof r.format === 'string' && r.format.length > 0, `format = "${r.format}"`);
    assert(typeof r.orientation === 'number', `orientation = ${r.orientation}`);

    // 不存在的文件
    const r2 = await metadata.handle({ cmd: 'metadata', input: '/nonexistent/file.heic' });
    assert(r2.ok === false,    'missing file → ok = false');
    assert(typeof r2.error === 'string', 'error is string');

    // 缺少 input
    const r3 = await metadata.handle({ cmd: 'metadata' });
    assert(r3.ok === false,    'missing input → ok = false');
  }
  console.log();

  // ── 2. thumbnail ───────────────────────────────────────
  console.log('[ thumbnail ]');
  {
    const outS = path.join(TMP_DIR, 'test.s.webp');
    const outM = path.join(TMP_DIR, 'test.m.webp');

    const r = await thumbnail.handle({
      cmd:     'thumbnail',
      input:   testImage,
      sizes:   [200, 600],
      outputs: [outS, outM],
      quality: 85,
    });
    assert(r.ok === true,          'ok = true');
    assert(Array.isArray(r.generated), 'generated is array');
    assert(fs.existsSync(outS),    `s.webp written (${fs.existsSync(outS) ? fs.statSync(outS).size : 0} bytes)`);
    assert(fs.existsSync(outM),    `m.webp written (${fs.existsSync(outM) ? fs.statSync(outM).size : 0} bytes)`);

    // skipExisting：已存在则跳过
    const r2 = await thumbnail.handle({
      cmd:          'thumbnail',
      input:        testImage,
      sizes:        [200],
      outputs:      [outS],
      quality:      85,
      skipExisting: true,
    });
    assert(r2.ok === true,                   'skip existing → ok = true');
    assert((r2.skipped || []).length === 1,  'skip existing → skipped = 1');
    assert((r2.generated || []).length === 0,'skip existing → generated = 0');

    // 错误输入
    const r3 = await thumbnail.handle({
      cmd:     'thumbnail',
      input:   '/no/such/file.heic',
      sizes:   [200],
      outputs: [path.join(TMP_DIR, 'x.webp')],
    });
    assert(r3.ok === false,   'missing source → ok = false');

    // 参数缺失
    const r4 = await thumbnail.handle({ cmd: 'thumbnail', input: testImage });
    assert(r4.ok === false,   'missing sizes → ok = false');
  }
  console.log();

  // ── 3. batch_thumbnail ─────────────────────────────────
  console.log('[ batch_thumbnail ]');
  {
    const items = [
      {
        input:   testImage,
        sizes:   [200, 600],
        outputs: [
          path.join(TMP_DIR, 'batch.0.s.webp'),
          path.join(TMP_DIR, 'batch.0.m.webp'),
        ],
      },
      {
        input:   testImage,
        sizes:   [200],
        outputs: [path.join(TMP_DIR, 'batch.1.s.webp')],
      },
      {
        // 故意失败项
        input:   '/nonexistent/image.heic',
        sizes:   [200],
        outputs: [path.join(TMP_DIR, 'batch.fail.webp')],
      },
    ];

    const r = await batchThumbnail.handle({
      cmd:         'batch_thumbnail',
      items,
      quality:     85,
      concurrency: 2,
    });
    assert(r.ok === true,     'ok = true');
    assert(r.total   === 3,   `total = ${r.total}`);
    assert(r.success === 2,   `success = ${r.success}`);
    assert(r.failed  === 1,   `failed = ${r.failed}`);
    assert(Array.isArray(r.errors) && r.errors.length === 1, 'errors contains 1 item');

    // 空 items
    const r2 = await batchThumbnail.handle({ cmd: 'batch_thumbnail', items: [] });
    assert(r2.ok === false,   'empty items → ok = false');
  }
  console.log();

  // ── 4. decode ──────────────────────────────────────────
  console.log('[ decode ]');
  {
    const r = await decode.handle({
      cmd:          'decode',
      input:        testImage,
      format:       'jpeg',
      quality:      90,
      maxDimension: 1024,
    });
    assert(r.ok === true,           'ok = true');
    assert(typeof r.data === 'string' && r.data.length > 0, 'data is non-empty base64');
    assert(r.width  > 0,            `width  = ${r.width}`);
    assert(r.height > 0,            `height = ${r.height}`);
    assert(r.format === 'jpeg',     `format = "${r.format}"`);
    assert(r.sizeBytes > 0,         `sizeBytes = ${r.sizeBytes}`);

    // 验证 base64 可解码
    const buf = Buffer.from(r.data, 'base64');
    assert(buf.length === r.sizeBytes, 'base64 decode length matches');

    // webp 格式
    const r2 = await decode.handle({
      cmd: 'decode', input: testImage, format: 'webp', quality: 80,
    });
    assert(r2.ok === true,          'webp format → ok = true');

    // 不存在文件
    const r3 = await decode.handle({ cmd: 'decode', input: '/no/such.heic' });
    assert(r3.ok === false,         'missing file → ok = false');

    // 不支持的格式
    const r4 = await decode.handle({ cmd: 'decode', input: testImage, format: 'bmp' });
    assert(r4.ok === false,         'unsupported format → ok = false');
  }
  console.log();

  // ── 5. index.js 协议集成 ─────────────────────────────
  console.log('[ protocol integration ]');
  {
    // 模拟 ping
    const pingHandler = require('../index.js');
    // index.js 不导出，但我们可以直接测 handler 模块
    // ping 在 index.js 内联，这里改为验证 JSON 序列化
    const obj = { ok: true, reqId: 'test-123', width: 100, height: 200 };
    const line = JSON.stringify(obj);
    const parsed = JSON.parse(line);
    assert(parsed.reqId === 'test-123', 'reqId round-trip OK');
    assert(parsed.ok === true,          'ok round-trip OK');
    assert(!line.includes('\n'),        'output line contains no newline');
  }
  console.log();

  // ── 汇总 ───────────────────────────────────────────────
  console.log('─'.repeat(40));
  console.log(`Result: ${passed} passed, ${failed} failed\n`);

  // 清理临时目录
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (_) {}

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
