'use strict';
// sidecar/test/smoke.js
//
// Smoke Test — 验证 sidecar 所有命令的基本功能
//
// 运行方式：
//   node test/smoke.js [--verbose]
//
// 需要准备测试图片：
//   test/fixtures/sample.jpg   — 任意 JPEG（必需，由脚本自动生成）
//   test/fixtures/sample.heic  — 可选，测试 HEIC 路径（无则跳过）
//
// 测试项目：
//   1. ping              — 进程存活
//   2. memory            — 内存查询
//   3. thumbnail (jpeg)  — 生成 200+600px 缩略图
//   4. metadata          — 读取宽高方向
//   5. decode            — base64 模式解码
//   6. decode (file)     — 文件模式解码
//   7. batch_thumbnail   — 批量生成（3 张相同图片）
//   8. unknown cmd       — 应返回 ok:false
//   9. 不存在的文件       — 应返回 ok:false
//  10. shutdown          — 优雅退出

const { spawn } = require('child_process');
const readline  = require('readline');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');

const VERBOSE    = process.argv.includes('--verbose');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const TMP_DIR    = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-smoke-'));

// ─────────────────────────────────────────────────────────
//  测试工具
// ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`  ✅  ${name}`);
}

function fail(name, reason) {
  failed++;
  console.log(`  ❌  ${name}: ${reason}`);
}

function log(...args) {
  if (VERBOSE) console.log('  →', ...args);
}

// ─────────────────────────────────────────────────────────
//  生成测试 JPEG（不依赖外部文件）
//  使用 Sharp 生成一张 800×600 的渐变图
// ─────────────────────────────────────────────────────────

async function createFixtures() {
  const sharp = require('sharp');
  if (!fs.existsSync(FIXTURE_DIR)) fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  const sample = path.join(FIXTURE_DIR, 'sample.jpg');
  if (!fs.existsSync(sample)) {
    // 生成 800×600 纯色 JPEG
    await sharp({
      create: {
        width:      800,
        height:     600,
        channels:   3,
        background: { r: 100, g: 149, b: 237 },
      },
    })
      .jpeg({ quality: 85 })
      .toFile(sample);
    console.log('  📸  Created fixture: sample.jpg (800×600)');
  }
  return { sample };
}

// ─────────────────────────────────────────────────────────
//  Sidecar 进程包装（简单的 stdin/stdout IPC）
// ─────────────────────────────────────────────────────────

class SidecarClient {
  constructor(proc) {
    this._proc     = proc;
    this._pending  = [];   // [resolve, reject] 队列
    this._rl       = readline.createInterface({ input: proc.stdout, terminal: false });

    this._rl.on('line', (line) => {
      const [resolve] = this._pending.shift() || [];
      if (resolve) {
        try {
          resolve(JSON.parse(line.trim()));
        } catch (e) {
          resolve({ ok: false, error: `Invalid JSON: ${line}` });
        }
      }
    });

    this._proc.stderr.on('data', (d) => {
      if (VERBOSE) process.stdout.write(`  [stderr] ${d}`);
    });
  }

  send(req) {
    return new Promise((resolve, reject) => {
      this._pending.push([resolve, reject]);
      const line = JSON.stringify(req) + '\n';
      this._proc.stdin.write(line);
    });
  }

  close() {
    this._proc.stdin.end();
    return new Promise((resolve) => this._proc.on('close', resolve));
  }

  static spawn() {
    const entryPoint = path.join(__dirname, '../index.js');
    const proc = spawn(process.execPath, [entryPoint], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env:   { ...process.env, SIDECAR_LOG: VERBOSE ? 'debug' : 'error' },
    });
    return new SidecarClient(proc);
  }
}

// ─────────────────────────────────────────────────────────
//  测试用例
// ─────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🧪  Sharp Sidecar Smoke Test\n');

  // 依赖检查
  try {
    require('sharp');
  } catch (e) {
    console.error('❌  sharp not installed. Run: npm install');
    process.exit(1);
  }

  // 生成测试文件
  const { sample } = await createFixtures();

  const client = SidecarClient.spawn();

  // ── 1. ping ──────────────────────────────────────────
  {
    const r = await client.send({ cmd: 'ping', reqId: 'test-ping' });
    log('ping', r);
    if (r.ok && r.pid > 0 && r.reqId === 'test-ping') {
      pass('ping');
    } else {
      fail('ping', JSON.stringify(r));
    }
  }

  // ── 2. memory ────────────────────────────────────────
  {
    const r = await client.send({ cmd: 'memory' });
    log('memory', r);
    if (r.ok && typeof r.rssMB === 'number') {
      pass(`memory (${r.rssMB}MB RSS)`);
    } else {
      fail('memory', JSON.stringify(r));
    }
  }

  // ── 3. thumbnail ─────────────────────────────────────
  {
    const outS = path.join(TMP_DIR, 'smoke.s.webp');
    const outM = path.join(TMP_DIR, 'smoke.m.webp');
    const r = await client.send({
      cmd:     'thumbnail',
      input:   sample,
      sizes:   [200, 600],
      outputs: [outS, outM],
      quality: 80,
    });
    log('thumbnail', r);
    if (r.ok && fs.existsSync(outS) && fs.existsSync(outM)) {
      const sSize = fs.statSync(outS).size;
      const mSize = fs.statSync(outM).size;
      pass(`thumbnail (s=${sSize}B, m=${mSize}B)`);
    } else {
      fail('thumbnail', JSON.stringify(r));
    }
  }

  // ── 4. metadata ──────────────────────────────────────
  {
    const r = await client.send({ cmd: 'metadata', input: sample });
    log('metadata', r);
    if (r.ok && r.width === 800 && r.height === 600) {
      pass(`metadata (${r.width}×${r.height} ${r.format})`);
    } else {
      fail('metadata', JSON.stringify(r));
    }
  }

  // ── 5. metadata (full) ───────────────────────────────
  {
    const r = await client.send({ cmd: 'metadata', input: sample, full: true });
    log('metadata-full', r);
    if (r.ok && 'channels' in r) {
      pass('metadata full mode');
    } else {
      fail('metadata full', JSON.stringify(r));
    }
  }

  // ── 6. decode (base64) ───────────────────────────────
  {
    const r = await client.send({ cmd: 'decode', input: sample, format: 'jpeg', quality: 80 });
    log('decode base64', { ok: r.ok, width: r.width, dataLen: r.data?.length });
    if (r.ok && typeof r.data === 'string' && r.data.length > 100) {
      pass(`decode base64 (${Math.round(r.data.length * 3 / 4 / 1024)}KB)`);
    } else {
      fail('decode base64', JSON.stringify(r));
    }
  }

  // ── 7. decode (file mode) ────────────────────────────
  {
    const outFile = path.join(TMP_DIR, 'decoded.jpg');
    const r = await client.send({
      cmd:        'decode',
      input:      sample,
      outputPath: outFile,
      format:     'jpeg',
      quality:    85,
      maxDimension: 1600,
    });
    log('decode file', r);
    if (r.ok && fs.existsSync(outFile)) {
      pass(`decode file (${fs.statSync(outFile).size}B)`);
    } else {
      fail('decode file', JSON.stringify(r));
    }
  }

  // ── 8. batch_thumbnail ───────────────────────────────
  {
    const tasks = [0, 1, 2].map((i) => ({
      input:   sample,
      sizes:   [200],
      outputs: [path.join(TMP_DIR, `batch${i}.s.webp`)],
      quality: 75,
    }));
    const r = await client.send({ cmd: 'batch_thumbnail', tasks });
    log('batch_thumbnail', r);
    if (r.ok && r.done === 3 && r.failed === 0) {
      pass('batch_thumbnail (3 tasks)');
    } else {
      fail('batch_thumbnail', JSON.stringify(r));
    }
  }

  // ── 9. unknown command ───────────────────────────────
  {
    const r = await client.send({ cmd: 'nonexistent' });
    log('unknown cmd', r);
    if (!r.ok && r.error?.includes('Unknown command')) {
      pass('unknown command returns error');
    } else {
      fail('unknown command', JSON.stringify(r));
    }
  }

  // ── 10. missing file ─────────────────────────────────
  {
    const r = await client.send({
      cmd:     'thumbnail',
      input:   '/nonexistent/path/img.heic',
      sizes:   [200],
      outputs: [path.join(TMP_DIR, 'never.webp')],
    });
    log('missing file', r);
    if (!r.ok && r.error) {
      pass('missing file returns error');
    } else {
      fail('missing file', JSON.stringify(r));
    }
  }

  // ── 11. reqId round-trip ─────────────────────────────
  {
    const r = await client.send({ cmd: 'ping', reqId: 'abc-123' });
    if (r.ok && r.reqId === 'abc-123') {
      pass('reqId round-trip');
    } else {
      fail('reqId round-trip', JSON.stringify(r));
    }
  }

  // ── 12. shutdown ─────────────────────────────────────
  {
    const r = await client.send({ cmd: 'shutdown' });
    log('shutdown', r);
    if (r.ok) {
      pass('shutdown');
    } else {
      fail('shutdown', JSON.stringify(r));
    }
  }

  await client.close();

  // ── 清理临时文件 ──────────────────────────────────────
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  // ── 结果汇总 ──────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  if (failed === 0) {
    console.log('  ✅  All tests passed!\n');
    process.exit(0);
  } else {
    console.log('  ❌  Some tests failed.\n');
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Fatal error in smoke test:', e);
  process.exit(1);
});
