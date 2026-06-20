# LightAlbum

> 一款受 Apple Photos 启发、为本地照片而生的桌面相册管理应用

[![CI](https://github.com/Aswellle/LightAblum/actions/workflows/ci.yml/badge.svg)](https://github.com/Aswellle/LightAblum/actions/workflows/ci.yml)
[![Release](https://github.com/Aswellle/LightAblum/actions/workflows/release.yml/badge.svg)](https://github.com/Aswellle/LightAblum/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](#english) | [中文](#中文)

---

## 中文

### 这是什么

LightAlbum 是一款**完全本地运行**的跨平台桌面相片管理应用，使用 Tauri v2（Rust）+ React 19 构建。所有数据存储在本地，无需联网，无需账号，没有云端上传。

适合：摄影师管理 RAW 文件、家庭用户整理多年照片、任何希望真正拥有自己照片数据的人。

---

### 核心功能

#### 📥 导入与监控
- 递归扫描文件夹，支持**实时文件监控**（新增 / 修改 / 删除自动同步）
- 支持格式覆盖消费级与专业级：`JPEG` `PNG` `WebP` `AVIF` `TIFF` `BMP` `HEIC` `HEIF` `CR2` `CR3` `NEF` `ARW` `DNG` `ORF` `RW2` `RAF`

#### 🖼️ 浏览体验
- **虚拟化瀑布流网格**：保持原始宽高比，仅渲染可视区域，10 万张照片滚动不卡顿
- **四档网格密度**：紧凑 / 标准 / 宽松 / 超大，一键切换
- **全屏预览**：完整 EXIF 信息面板（相机型号、曝光参数、GPS）、胶片条导航、键盘快捷键

#### 🗂️ 整理与搜索
- **相册管理**：创建相册、拖拽排序、批量添加
- **彩色标签系统**：自定义颜色标签，标签面板一键筛选
- **全文搜索**：按文件名、相机型号、元数据内容搜索，支持 `#标签名` 快速过滤
- **智能视图**：全部照片 / 已收藏 / 最近导入，按时间线自动分组

#### 🔒 私密相册（安全加固）
- 密码保护相册，使用 **bcrypt** 哈希存储，不保存明文密码
- 解锁后颁发 **HMAC-SHA256 签名会话令牌**，有效期 1 小时
- 后端每次加载私密相册照片时均验证令牌，导航离开即自动清除
- 连续验证失败触发指数退避锁定（最长 5 分钟）

#### ✏️ 编辑与操作
- **批量操作**：框选 / Ctrl 多选 / 全选，批量收藏、移入相册、删除
- **撤销支持**（Ctrl+Z）：删除、收藏、相册添加均可撤销，批量操作一次撤销全还原
- **回收站**：30 天软删除机制，误删可恢复，过期自动清除

#### ⚡ 性能亮点
- **三级优先级缩略图队列**：当前预览优先、网格视图次之、后台批量最低
- **Sharp sidecar**：独立 Node.js 进程处理 HEIC/RAW 格式，主进程不阻塞
- **游标分页**：每批 100 张，无限滚动加载效率稳定
- **O(1) 状态更新**：照片收藏 / 标签变更通过索引直接定位，无需遍历全列表

#### 🎨 界面
- 深色（默认）/ 浅色 / 跟随系统 三种主题
- 右键上下文菜单、Toast 通知、确认对话框完整成套
- 动画过渡流畅，不影响操作响应速度

---

### 下载安装

前往 [Releases 页面](https://github.com/Aswellle/LightAblum/releases/latest) 下载对应平台安装包：

| 平台 | 文件 |
|------|------|
| Windows (x64) | `.msi` 安装包 或 `.exe` |
| macOS (Apple Silicon) | `.dmg`（aarch64） |
| macOS (Intel) | `.dmg`（x86_64） |
| Linux (x64) | `.deb` 或 `.AppImage` |

---

### 本地构建

```bash
# 环境要求：Node.js 20+、Rust 1.75+、pnpm

pnpm install
cd sidecar && node scripts/bundle.js && cd ..   # 构建 HEIC/RAW 处理器
pnpm tauri build
```

开发模式：

```bash
pnpm tauri dev
```

数据存储位置：

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\LightAlbum\` |
| macOS | `~/Library/Application Support/LightAlbum/` |
| Linux | `~/.local/share/LightAlbum/` |

---

## English

### What is this

LightAlbum is a **fully local**, cross-platform desktop photo management app built with Tauri v2 (Rust) + React 19. All data stays on your machine — no internet required, no account, no cloud.

---

### Highlights

#### 📥 Import & Watch
- Recursive folder scanning with **live file watching** — auto-syncs on add / modify / delete
- Broad format support: `JPEG` `PNG` `WebP` `AVIF` `TIFF` `BMP` `HEIC` `HEIF` `CR2` `CR3` `NEF` `ARW` `DNG` `ORF` `RW2` `RAF`

#### 🖼️ Browsing
- **Virtualized waterfall grid** — original aspect ratios preserved; only visible rows rendered; handles 100k+ photos without lag
- **4 density presets** — compact / standard / spacious / extra-large
- **Full-screen preview** — EXIF panel (camera, exposure, GPS), filmstrip navigation, keyboard shortcuts

#### 🗂️ Organization & Search
- Albums with drag-to-reorder and batch-add
- **Color-coded tag system** with filterable tag panel
- Full-text search across filenames, camera models, metadata; `#tag` shorthand for tag views
- Smart views: All Photos / Favorites / Recent Imports, grouped by month timeline

#### 🔒 Private Albums (Security Hardened)
- Password-protected albums with **bcrypt** hashing — no plaintext passwords stored
- Unlock issues a **HMAC-SHA256 signed session token** (1-hour TTL)
- Backend validates token on every photo list request; token cleared on navigation away
- Exponential back-off lockout on repeated failures (up to 5 minutes)

#### ✏️ Editing & Operations
- **Batch operations**: box-select, Ctrl-click, select-all → batch favorite / add to album / delete
- **Undo** (Ctrl+Z): delete, favorite, album-add all undoable; batch ops undo atomically in one step
- **Trash**: 30-day soft delete with restore; auto-purge after expiry

#### ⚡ Performance
- Three-priority thumbnail scheduler: preview-first, grid-second, background-last
- **Sharp sidecar** — isolated Node.js process for HEIC/RAW; main thread stays responsive
- Cursor-based pagination at 100 items/page for stable infinite scroll
- O(1) photo state updates via indexed store — no full-list scans on favorite or tag change

#### 🎨 UI
- Dark (default) / Light / System theme
- Context menus, toast notifications, confirm dialogs
- Smooth transitions without compromising interaction latency

---

### Download

Visit the [Releases page](https://github.com/Aswellle/LightAblum/releases/latest):

| Platform | File |
|----------|------|
| Windows (x64) | `.msi` installer or `.exe` |
| macOS (Apple Silicon) | `.dmg` (aarch64) |
| macOS (Intel) | `.dmg` (x86_64) |
| Linux (x64) | `.deb` or `.AppImage` |

---

### Build from Source

```bash
# Requirements: Node.js 20+, Rust 1.75+, pnpm

pnpm install
cd sidecar && node scripts/bundle.js && cd ..   # build HEIC/RAW processor
pnpm tauri build
```

Dev mode:

```bash
pnpm tauri dev
```

Data directory:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\LightAlbum\` |
| macOS | `~/Library/Application Support/LightAlbum/` |
| Linux | `~/.local/share/LightAlbum/` |

---

### License

MIT
