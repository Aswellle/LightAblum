#!/usr/bin/env node
'use strict';
// sidecar/scripts/bundle.js  (v2.0.3)
//
// 修复历史：
//   v2.0.0  原版
//   v2.0.1  修复路径含空格导致 cmd.exe 截断（使用 execSync + JSON.stringify 引号）
//   v2.0.2  修复 pkg 报 "Property 'bin' does not exist"
//            根因：pkg@5.x（旧版/全局版）要求 package.json 有 "bin" 字段，
//                  用 "." 打包时从 package.json 查找入口，找不到则报错。
//            修复：将入口从 "." 改为显式路径 "index.js"，
//                  pkg/所有版本均接受明确的入口文件，无需 "bin" 字段。
//            同时：通过 --options 传入 sharp asset 目录，
//                  确保 libvips 原生库被正确嵌入。
//   v2.0.3  修复 BIN_DIR 路径多跳一级（../../ → ../）
//            修复 sharp 原生库 Warning：pkg 无法内嵌 .node/.dll，
//            编译完成后自动将以下两个目录复制到 BIN_DIR 同级：
//              node_modules/sharp/build/Release  → binaries/sharp/build/Release
//              node_modules/sharp/vendor/lib     → binaries/sharp/vendor/lib
//
// 用法：
//   node scripts/bundle.js                   # 打包当前平台（自动检测）
//   node scripts/bundle.js --all             # 打包全部 4 个平台
//   node scripts/bundle.js --platform win    # 仅打包 Windows x64
//   node scripts/bundle.js --platform mac_x64
//   node scripts/bundle.js --platform mac_arm64
//   node scripts/bundle.js --platform linux
//
// 输出：../src-tauri/binaries/sharp-worker-{triple}[.exe]
//       ../src-tauri/binaries/sharp/build/Release/
//       ../src-tauri/binaries/sharp/vendor/lib/

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const ROOT_DIR = path.resolve(__dirname, '..');
// ✅ v2.0.3 修复：原来是 '../../src-tauri/binaries'，多跳了一层
const BIN_DIR  = path.resolve(ROOT_DIR, '../src-tauri/binaries');

// ── 平台目标配置 ──────────────────────────────────────────

const TARGETS = {
  win: {
    pkgTarget:   'node20-win-x64',
    tauriTriple: 'x86_64-pc-windows-msvc',
    ext:         '.exe',
  },
  mac_x64: {
    pkgTarget:   'node20-macos-x64',
    tauriTriple: 'x86_64-apple-darwin',
    ext:         '',
  },
  mac_arm64: {
    pkgTarget:   'node20-macos-arm64',
    tauriTriple: 'aarch64-apple-darwin',
    ext:         '',
  },
  linux: {
    pkgTarget:   'node20-linux-x64',
    tauriTriple: 'x86_64-unknown-linux-gnu',
    ext:         '',
  },
};

function detectCurrentPlatform() {
  const p   = process.platform;
  const cpu = os.arch();
  if (p === 'win32')  return 'win';
  if (p === 'darwin') return cpu === 'arm64' ? 'mac_arm64' : 'mac_x64';
  return 'linux';
}

// ── 路径引号工具 ──────────────────────────────────────────
// JSON.stringify 加双引号并转义内部特殊字符，
// 适用于 Windows cmd.exe 和 Unix shell。

function q(p) {
  return JSON.stringify(String(p));
}

// ── 递归复制目录工具 ──────────────────────────────────────
// v2.0.3 新增：用于编译后复制 sharp 原生库到 BIN_DIR

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── 环境检查 ──────────────────────────────────────────────

function checkPrereqs() {
  // 检查 sharp
  const sharpPath = path.join(ROOT_DIR, 'node_modules', 'sharp');
  if (!fs.existsSync(sharpPath)) {
    console.error('\n❌  sharp not found.');
    console.error(`    请先在此目录执行 npm install：`);
    console.error(`    ${ROOT_DIR}\n`);
    process.exit(1);
  }

  // 查找 pkg 可执行文件
  // 优先顺序：本地 @yao-pkg/pkg > 本地 pkg > 全局 pkg
  const candidates = [
    // 本地安装（npm install 后在 node_modules/.bin）
    path.join(ROOT_DIR, 'node_modules', '.bin', 'pkg.cmd'),   // Windows .cmd
    path.join(ROOT_DIR, 'node_modules', '.bin', 'pkg'),       // Unix / Windows .exe
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      console.log(`    pkg:       ${c}`);
      return c;
    }
  }

  // 回退到全局 pkg（用户全局安装了 pkg@5.x）
  console.warn('    ⚠  Local pkg not found, trying global pkg...');
  console.warn('       Tip: run "npm install" in sidecar/ to use local @yao-pkg/pkg');
  return process.platform === 'win32' ? 'pkg.cmd' : 'pkg';
}

// ── 打包单个平台 ──────────────────────────────────────────

function buildTarget(platformKey, pkgBin) {
  const cfg     = TARGETS[platformKey];
  const binName = `sharp-worker-${cfg.tauriTriple}${cfg.ext}`;
  const outPath = path.join(BIN_DIR, binName);

  // index.js 的绝对路径
  const entryFile = path.join(ROOT_DIR, 'index.js');

  if (!fs.existsSync(entryFile)) {
    console.error(`\n❌  Entry file not found: ${entryFile}`);
    console.error(`    请确认在正确的 sidecar/ 目录下执行此脚本`);
    return false;
  }

  console.log(`\n📦  Building: ${binName}`);
  console.log(`    Target:  ${cfg.pkgTarget}`);
  console.log(`    Entry:   ${entryFile}`);
  console.log(`    Output:  ${outPath}`);

  // ── 构建 pkg 命令 ────────────────────────────────────────
  //
  // 关键修复（v2.0.2）：
  //   ❌ 原版：pkg "." ...
  //      pkg 用 "." 时读取 package.json 的 "bin" 字段确定入口。
  //      若无 "bin" 字段，pkg@5.x 报 "Property 'bin' does not exist"。
  //
  //   ✅ 修复：pkg "index.js" ...
  //      显式指定入口文件，pkg 直接使用该文件，
  //      完全不读取 package.json 的 "bin" 字段。
  //      兼容 pkg@5.x 旧版和 @yao-pkg/pkg@5.x 新版。
  //
  // sharp 原生模块处理（v2.0.3 补充说明）：
  //   sharp 的 .node 原生文件和 libvips .dll 无法被 pkg 内嵌，
  //   pkg 会输出 Warning 并跳过这些文件。
  //   解决方案：编译后由本脚本手动将这两个目录复制到 BIN_DIR，
  //   Tauri 打包时会将 binaries/ 整目录一并纳入应用包。
  // ─────────────────────────────────────────────────────────

  const cmd = [
    q(pkgBin),
    q(entryFile),               // ← 修复：显式入口文件，非 "."
    '--target', cfg.pkgTarget,
    '--output', q(outPath),
    '--public-packages', '"*"',  // 所有依赖包设为 public（sharp 需要）
    '--public',                  // 允许访问打包外的文件（libvips dll）
  ].join(' ');

  console.log(`    cmd:     ${cmd}`);
  console.log('');

  try {
    execSync(cmd, {
      cwd:   ROOT_DIR,
      stdio: 'inherit',
    });
  } catch (e) {
    console.error(`\n❌  Build failed for ${platformKey} (exit code: ${e.status ?? 'unknown'})`);
    return false;
  }

  if (!fs.existsSync(outPath)) {
    console.error(`\n❌  Output not found after build: ${outPath}`);
    return false;
  }

  const sizeMB = (fs.statSync(outPath).size / 1048576).toFixed(1);
  console.log(`\n✅  ${binName} (${sizeMB} MB)`);

  // ── v2.0.3：复制 sharp 原生库 ────────────────────────────
  //
  // pkg 无法将以下两个目录内嵌进 .exe，运行时必须从外部加载：
  //   node_modules/sharp/build/Release  — 含 sharp.node（原生绑定）
  //   node_modules/sharp/vendor/lib     — 含 libvips-*.dll（Windows）
  //                                       或 libvips.so（Linux）
  //                                       或 libvips.dylib（macOS）
  //
  // 复制目标：BIN_DIR/sharp/build/Release
  //           BIN_DIR/sharp/vendor/lib
  //
  // Tauri 的 externalBin 机制会把 binaries/ 整目录打入安装包，
  // 因此只要这两个子目录在 BIN_DIR 下，运行时路径就能对齐。
  // ─────────────────────────────────────────────────────────

  const sharpLibs = [
    {
      src:  path.join(ROOT_DIR, 'node_modules', 'sharp', 'build', 'Release'),
      dest: path.join(BIN_DIR,  'sharp', 'build', 'Release'),
      label: 'sharp/build/Release',
    },
    {
      src:  path.join(ROOT_DIR, 'node_modules', 'sharp', 'vendor', 'lib'),
      dest: path.join(BIN_DIR,  'sharp', 'vendor', 'lib'),
      label: 'sharp/vendor/lib',
    },
  ];

  for (const lib of sharpLibs) {
    if (fs.existsSync(lib.src)) {
      copyDirSync(lib.src, lib.dest);
      const fileCount = countFiles(lib.dest);
      console.log(`    📁 Copied: ${lib.label} (${fileCount} files)`);
    } else {
      console.warn(`    ⚠  Source not found, skipped: ${lib.src}`);
    }
  }

  return true;
}

// ── 文件计数工具（用于日志显示）─────────────────────────────

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

// ── 主逻辑 ────────────────────────────────────────────────

function main() {
  const args     = process.argv.slice(2);
  const buildAll = args.includes('--all');
  const platIdx  = args.indexOf('--platform');
  const platVal  = platIdx !== -1 ? args[platIdx + 1] : null;

  let requestedPlatforms;
  if (buildAll) {
    requestedPlatforms = Object.keys(TARGETS);
  } else if (platVal) {
    if (!TARGETS[platVal]) {
      console.error(`\n❌  Unknown platform: "${platVal}"`);
      console.error(`    Valid: ${Object.keys(TARGETS).join(', ')}\n`);
      process.exit(1);
    }
    requestedPlatforms = [platVal];
  } else {
    requestedPlatforms = [detectCurrentPlatform()];
  }

  console.log('\n🔧  LightAlbum Sharp Sidecar Builder (v2.0.3)');
  console.log(`    Platforms: ${requestedPlatforms.join(', ')}`);
  console.log(`    Node:      ${process.version}`);
  console.log(`    Root dir:  ${ROOT_DIR}`);
  console.log(`    Out dir:   ${BIN_DIR}`);

  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    console.log(`    Created:   ${BIN_DIR}`);
  }

  const pkgBin = checkPrereqs();

  let ok = 0;
  let ng = 0;
  for (const p of requestedPlatforms) {
    if (buildTarget(p, pkgBin)) {
      ok++;
    } else {
      ng++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Built: ${ok}   Failed: ${ng}`);
  if (ng > 0) {
    console.log('  ❌  Some builds failed.\n');
    process.exit(1);
  } else {
    console.log(`  ✅  Done. Binaries in:\n     ${BIN_DIR}\n`);
    console.log('  📂  Expected directory layout:');
    console.log(`       ${BIN_DIR}`);
    console.log('       ├── sharp-worker-{triple}[.exe]');
    console.log('       └── sharp/');
    console.log('           ├── build/Release/   ← sharp.node');
    console.log('           └── vendor/lib/      ← libvips .dll/.so/.dylib\n');
  }
}

main();
