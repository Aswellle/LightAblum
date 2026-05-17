# Changelog

All notable changes to LightAlbum are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] — 2026-04-26

### Added
- Photo import with recursive folder scanning and live file watching
- Virtualized waterfall grid with 4 density presets
- Full-screen photo preview with EXIF metadata panel and filmstrip navigation
- Album management with private album support (bcrypt password protection)
- Color-coded tag system with tag filter panel
- Full-text search across filenames, camera models, and metadata
- Trash with 30-day soft delete and restore
- Three-tier thumbnail pipeline with LRU cache and Sharp sidecar for HEIC/RAW
- Dark / Light / System theme support
- Batch operations (multi-select, drag-select, batch favorite/delete with undo)
- Undo support (Ctrl+Z) for delete, favorite, album add operations

### Architecture
- Tauri v2 + React 19 + TypeScript + Rust backend
- SQLite with WAL mode and r2d2 connection pool
- Repository trait pattern for decoupled data access layer
- Zustand v5 stores + TanStack Query v5 for state and cache management
