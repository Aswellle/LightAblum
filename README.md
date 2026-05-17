# LightAblum

一款基于 Tauri + React 构建的苹果风格本地相片管理应用，支持 macOS/Windows。

[![CI](https://github.com/YOUR_USERNAME/lightalbum/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/lightalbum/actions/workflows/ci.yml)

[English](#english) | [中文](#中文)

---

## English

### Overview

LightAblum is a native, high-performance photo management desktop application inspired by Apple Photos. It provides an elegant dark-mode-first UI with virtualized grid views, advanced photo organization, and seamless local file system integration.

### Features

- **Photo Import** — Recursive folder scanning with live file watching
- **Supported Formats** — JPEG, PNG, WebP, BMP, TIFF, HEIC, HEIF, AVIF, CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF
- **Virtualized Grid** — Waterfall layout preserving original aspect ratios with smooth scrolling
- **Photo Preview** — Full-screen viewer with EXIF metadata, filmstrip navigation, and gesture support
- **Albums** — Create, manage, and privately share album collections
- **Tags** — Color-coded tagging system with filterable tag panel
- **Batch Operations** — Multi-select with drag selection, batch favorite/delete with undo support
- **Full-text Search** — Search across file names, camera models, and metadata
- **Trash & Recovery** — 30-day soft delete with restore capability
- **Thumbnail Pipeline** — Three-tier priority queue with LRU cache and Sharp sidecar for HEIC/RAW processing
- **Theme** — Dark (default), Light, and System modes
- **Grid Density** — Four density presets (compact, standard, spacious, extra large)

### Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript |
| Build Tool | Vite 6 |
| Styling | Tailwind CSS v4 |
| State Management | Zustand v5 |
| Data Fetching | TanStack React Query v5 |
| Animation | Framer Motion v11 |
| Database | SQLite (rusqlite + r2d2) |
| Image Processing | image, webp, Sharp sidecar |
| EXIF Parsing | kamadak-exif |

### Project Structure

```
light_ablum/
├── src/                      # React frontend
│   ├── components/           # UI components (album, common, grid, layout, preview, settings, trash)
│   ├── hooks/                # Custom React hooks
│   ├── services/             # IPC wrapper, event bus, thumbnail loader
│   ├── stores/               # Zustand stores (photo, preview, selection, ui, layout)
│   ├── types/                # TypeScript type definitions
│   └── styles/               # Design tokens, animations, global CSS
├── src-tauri/                # Rust backend
│   └── src/
│       ├── commands/         # Tauri IPC command handlers
│       ├── db/               # Database layer (schema, queries, search)
│       ├── query/            # Query building (filter, pagination, sort)
│       ├── scanner/          # File system scanning and watching
│       ├── thumbnail/        # Thumbnail generation pipeline
│       └── metadata/         # EXIF parsing and file hashing
├── sidecar/                  # Node.js Sharp worker for HEIC/RAW thumbnails
└── tests/                    # Benchmarks and Playwright E2E tests
```

### Getting Started

#### Prerequisites

- Node.js 20+
- Rust 1.75+
- pnpm 8+

**Platform-specific build tools (required by Tauri):**
- **Windows:** [MSVC Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select "Desktop development with C++"
- **macOS:** Xcode Command Line Tools — run `xcode-select --install`
- **Linux:** `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev`

#### Install Dependencies

```bash
pnpm install
```

#### Build Sharp Sidecar (required for HEIC/RAW thumbnails)

```bash
cd sidecar && node scripts/bundle.js && cd ..
```

> Re-run this step if you update anything in `sidecar/`.

#### Development

```bash
pnpm tauri dev
```

#### Build

```bash
pnpm tauri build
```

---

## 中文

### 概述

LightAblum 是一款受 Apple Photos 启发的本地相片管理桌面应用，采用 Tauri + React 技术栈构建。它拥有优雅的深色模式界面、虚拟化网格视图、强大的相片组织功能，并能与本地文件系统无缝集成。

### 功能特性

- **相片导入** — 递归扫描文件夹，支持实时文件监控
- **支持格式** — JPEG, PNG, WebP, BMP, TIFF, HEIC, HEIF, AVIF, CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF
- **虚拟化网格** — 瀑布流布局保持原始宽高比，流畅滚动体验
- **相片预览** — 全屏查看器，支持 EXIF 元数据、胶片条导航和手势操作
- **相册管理** — 创建、管理相册，支持私密相册密码保护
- **标签系统** — 彩色标签，支持标签筛选面板
- **批量操作** — 多选、拖拽选择、批量收藏/删除（支持撤销）
- **全文搜索** — 按文件名、相机型号、元数据进行搜索
- **回收站** — 30 天软删除机制，支持恢复
- **缩略图管线** — 三级优先级队列 + LRU 缓存，Sharp sidecar 处理 HEIC/RAW
- **主题切换** — 深色（默认）、浅色、跟随系统
- **网格密度** — 四档密度调节（紧凑、标准、宽松、超大）

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri v2 (Rust) |
| 前端 | React 19 + TypeScript |
| 构建工具 | Vite 6 |
| 样式 | Tailwind CSS v4 |
| 状态管理 | Zustand v5 |
| 数据请求 | TanStack React Query v5 |
| 动画 | Framer Motion v11 |
| 数据库 | SQLite (rusqlite + r2d2) |
| 图片处理 | image, webp, Sharp sidecar |
| EXIF 解析 | kamadak-exif |

### 项目结构

```
light_ablum/
├── src/                      # React 前端
│   ├── components/           # UI 组件 (album, common, grid, layout, preview, settings, trash)
│   ├── hooks/                # 自定义 React Hooks
│   ├── services/             # IPC 封装、事件总线、缩略图加载器
│   ├── stores/               # Zustand 状态管理 (photo, preview, selection, ui, layout)
│   ├── types/                # TypeScript 类型定义
│   └── styles/               # 设计令牌、动画、全局样式
├── src-tauri/                # Rust 后端
│   └── src/
│       ├── commands/         # Tauri IPC 命令处理
│       ├── db/               # 数据库层 (schema, queries, search)
│       ├── query/            # 查询构建 (filter, pagination, sort)
│       ├── scanner/          # 文件系统扫描与监控
│       ├── thumbnail/        # 缩略图生成管线
│       └── metadata/         # EXIF 解析与文件哈希
├── sidecar/                  # Node.js Sharp worker，处理 HEIC/RAW 缩略图
└── tests/                    # 性能测试和 Playwright E2E 测试
```

### 快速开始

#### 环境要求

- Node.js 20+
- Rust 1.75+
- pnpm 8+

**平台构建工具（Tauri 必需）：**
- **Windows：** [MSVC Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，选择"使用 C++ 的桌面开发"
- **macOS：** Xcode Command Line Tools，运行 `xcode-select --install`
- **Linux：** `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev`

#### 安装依赖

```bash
pnpm install
```

#### 构建 Sharp Sidecar（HEIC/RAW 缩略图处理必需）

```bash
cd sidecar && node scripts/bundle.js && cd ..
```

> 修改 `sidecar/` 目录内容后需重新运行此命令。

#### 开发模式

```bash
pnpm tauri dev
```

#### 构建应用

```bash
pnpm tauri build
```

### Data Directory

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\LightAlbum\` |
| macOS | `~/Library/Application Support/LightAlbum/` |
| Linux | `~/.local/share/LightAlbum/` |

Contains: `library.db` (SQLite), `thumbnails/`, `settings.json`

### 数据目录

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\LightAlbum\` |
| macOS | `~/Library/Application Support/LightAlbum/` |
| Linux | `~/.local/share/LightAlbum/` |

包含：`library.db`（SQLite 数据库）、`thumbnails/`（缩略图缓存）、`settings.json`

---

### Architecture Highlights | 架构亮点

**性能优化**

- `PhotoThumb` 投影查询：网格视图仅加载 12 个字段，而非完整的 30+ 列
- 三级缩略图调度器：O(1) 优先级队列替代 O(N log N) 排序
- 增量月份分组：新照片追加而非全量重建
- LRU 缓存：O(1) 缩略图缓存，带跨进程同步
- 虚拟化渲染：仅渲染可视区域 + 600px 缓冲区
- 游标分页：每页 100 条，高效无限滚动

**事件驱动更新**

Rust 后端通过 Tauri 事件系统推送：`scan:started`, `scan:completed`, `thumb:ready`, `library:changed`, `photo:updated`, `album:updated`

前端事件总线分发至 Zustand stores + TanStack Query 缓存，确保 UI 实时同步。

---

### License | 许可证

MIT
