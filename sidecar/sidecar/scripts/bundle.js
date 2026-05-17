#!/usr/bin/env node
'use strict';
/**
 * scripts/bundle.js — 将 sidecar 打包为独立可执行文件
 *
 * 使用 pkg v5（`npx pkg`）将 Node.js 脚本打包为单文件可执行程序，
 * 包含 Node.js runtime + sharp native binaries + 所有依赖。
 *
 * 运行方式：
 *   cd sidecar/
 *   npm install
 *   node scripts/bundle.js
 *       (默认：只打包当前主机平台)
 *   node scripts/bundle.js --all
 *       (打包全部四个平台)
 *   node scripts/bundle.js --target node20-win-x64
 *       (指定单个平台)
 *
 * Tauri 2.0 sidecar 命名规范：
 *   {name}-{rust-target-triple}[.exe]
 *   其中 name = tauri.conf.json 中 externalBin 数组里的文件名前缀
 *
 * 输出文件（→ src-tauri/binaries/）：
 *   sharp-worker-x86_64-pc-windows-msvc.exe  （Windows x64）
 *   sharp-worker-x86_64-apple-darwin          （macOS x64）
 *   sharp-worker-aarch64-apple-darwin         （macOS ARM64）
 *   sharp-worker-x86_64-unknown-linux-gnu     （Linux x64）
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const ROOT_DIR = path.resolve(__dirname, '..');           // sidecar/
const OUT_DIR  = path.resolve(__dirname, '../../../src-tauri/binaries');

// Tauri triple → pkg target 映射
const TARGETS = {
  'x86_64-pc-windows-msvc':   { pkg: 'node20-win-x64',     ext: '.exe' },
  'x86_64-apple-darwin':      { pkg: 'node20-macos-x64',   ext: ''     },
  'aarch64-apple-darwin':     { pkg: 'node20-macos-arm64', ext: ''     },
  'x86_64-unknown-linux-gnu': { pkg: 'node20-linux-x64',   ext: ''     },
};

// 当前主机平台对应的默认 triple
function hostTriple() {
  const p = os.platform();
  const a = os.arch();
  if (p === 'win32' && a === 'x64')   return 'x86_64-pc-windows-msvc';
  if (p === 'darwin' && a === 'x64')  return 'x86_64-apple-darwin';
  if (p === 'darwin' && a === 'arm64')return 'aarch64-apple-darwin';
  if (p === 'linux'  && a === 'x64')  return 'x86_64-unknown-linux-gnu';
  return 'x86_64-pc-windows-msvc'; // fallback
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--all')) {
    return Object.keys(TARGETS);
  }
  const tIdx = args.indexOf('--target');
  if (tIdx !== -1 && args[tIdx + 1]) {
    return [args[tIdx + 1]];
  }
  return [hostTriple()];
}

function checkPrereqs() {
  // 检查 Node 版本
  const major = parseInt(process.version.slice(1), 10);
  if (major < 18) {
    console.error(`❌  Node.js 18+ required (current: ${process.version})`);
    process.exit(1);
  }

  // 检查 sharp 已安装
  const sharpPkg = path.join(ROOT_DIR, 'node_modules', 'sharp', 'package.json');
  if (!fs.existsSync(sharpPkg)) {
    console.error('❌  sharp not installed. Run: npm install');
    process.exit(1);
  }

  // 检查 pkg 可用
  const res = spawnSync('npx', ['pkg', '--version'], { cwd: ROOT_DIR, encoding: 'utf8' });
  if (res.status !== 0) {
    console.error('❌  pkg not found. Run: npm install');
    process.exit(1);
  }

  console.log(`   sharp:   ${require(sharpPkg).version}`);
  console.log(`   pkg:     ${(res.stdout || '').trim()}`);
}

function buildTarget(triple) {
  const info = TARGETS[triple];
  if (!info) {
    console.error(`❌  Unknown target triple: ${triple}`);
    console.error(`   Valid targets: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }

  const outputName = `sharp-worker-${triple}${info.ext}`;
  const outputPath = path.join(OUT_DIR, outputName);

  console.log(`\n📦  Building: ${outputName}`);
  console.log(`    pkg target: ${info.pkg}`);
  console.log(`    output:     ${outputPath}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    execSync(
      `npx pkg . --target ${info.pkg} --output "${outputPath}"`,
      {
        cwd:   ROOT_DIR,
        stdio: 'inherit',
        env:   {
          ...process.env,
          // sharp 跨平台构建时需要指定 platform/arch
          npm_config_platform: info.pkg.split('-')[1],
          npm_config_arch:     info.pkg.split('-')[2],
        },
      }
    );

    const size = fs.statSync(outputPath).size;
    console.log(`    ✅  Done (${(size / 1_048_576).toFixed(1)} MB)`);
    return true;
  } catch (err) {
    console.error(`    ❌  Build failed: ${err.message || err}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────
//  主流程
// ─────────────────────────────────────────────────────────

console.log('🔧  LightAlbum Sharp Sidecar Build\n');
console.log(`   Node.js:  ${process.version}`);
console.log(`   Root dir: ${ROOT_DIR}`);
console.log(`   Out dir:  ${OUT_DIR}\n`);

checkPrereqs();

const triples = parseArgs();
console.log(`\n   Targets: ${triples.join(', ')}`);

let anyFailed = false;
for (const triple of triples) {
  if (!buildTarget(triple)) {
    anyFailed = true;
  }
}

console.log('\n' + '─'.repeat(50));
if (anyFailed) {
  console.error('❌  One or more builds failed');
  process.exit(1);
} else {
  console.log(`✅  All ${triples.length} target(s) built successfully`);
  console.log(`   Binaries: ${OUT_DIR}`);
}
