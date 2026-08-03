# Changelog

All notable changes to LightAlbum are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### 2026-08-04 — Settings storage white screen & view-transition rendering fixes

#### Fixed

- **设置→存储 白屏** — Rust `storage_get_info` 返回的字段名（`thumbCacheBytes`/`thumbFileCount`）与前端 `StorageInfo` 契约（`thumbnailSizeBytes`/`thumbnailCount`）不一致，前端对 `undefined` 调用 `.toLocaleString()` 抛 TypeError，React 无错误边界 → 整树白屏。Rust 侧已按契约补齐 `thumbnailSizeBytes`/`thumbnailCount`/`dbSizeBytes`/`totalSizeBytes`；前端读取全部加 `?? 0` 兜底。
- **新增全局 ErrorBoundary** — 任何子组件渲染抛错不再白屏整棵应用，而是显示可恢复的降级界面（同类"字段缺失→崩溃"问题的系统性防护）。
- **启动闪屏** — `index.html` 硬编码 `class="dark"`，浅色/跟随系统用户在首帧会先闪一帧深色再被 `useTheme` 切换。改为首帧前内联脚本按 `prefers-color-scheme` 立即设主题；`MainContent` 首次挂载不再淡入。
- **切选项卡黑色停留动画 + 缩略图网格虚影** — `MainContent` 用 `mode="sync"` 让旧视图（含旧缩略图）与新视图在过渡期间重叠渲染，且新视图从透明淡入，露出黑色背景。改为 `mode="wait"`（旧视图完全卸载后才挂载新视图，消除虚影重叠）+ 视图容器实心 `bg-app` 背景（过渡间隙不再透出黑色）。

#### Security

#### Fixed

- **Dev/production data collision** — `AppState::new()` resolved the same `%APPDATA%\LightAlbum\` folder regardless of build mode, so `pnpm tauri dev` and the installed release shared one `library.db` and `thumbnails\` — locally-imported test photos showed up in the production app. Debug builds now use a sibling `LightAlbum-dev\` folder.
- **Orphaned thumbnail files on purge** — `photos_purge` / `photos_purge_data` deleted the DB row (and, for `photos_purge`, the original file) but never removed the generated `{hash}.{s,m,l}.webp` thumbnail files, leaving them on disk permanently. `ThumbnailCache`'s 5GB eviction threshold meant caches well under that size never got cleaned up at all. Both commands now delete the matching thumbnail files and evict the in-memory cache entry.
- **Trash auto-purge was dead code** — `purge_old_trash()` (the 30-day recycle-bin expiry) existed in the DB layer but was never called from anywhere in `lib.rs`, so items never actually expired. Wired up as a background task that runs shortly after startup and every 24h, and extended to also delete the expired items' original + thumbnail files (previously it only deleted DB rows).
- **Uninstaller left `%APPDATA%\LightAlbum\` behind** — the NSIS uninstaller only removed installed program files. Added a `NSIS_HOOK_POSTUNINSTALL` (`src-tauri/installer-hooks.nsh`) that prompts the user and, if they opt in, removes the app data folder (library.db + thumbnail cache; never the original photo files, which always live outside this folder).

### 2026-08-03 — Code-review hardening of the trash auto-purge & purge fixes

The initial fixes introduced two irreversible data-loss paths; both were caught in review and closed.

#### Fixed

- **Auto-purge deleted originals of watcher-marked photos (data loss)** — `mark_missing` (file watcher, triggered when a file disappears from disk — e.g. unplugged drive) set `is_deleted=1, deleted_at=now`, identical to user trash. The new 30-day purge would then permanently `remove_file` the original if it had reappeared on disk 30 days later. `mark_missing` now leaves `deleted_at` NULL, and `purge_old_trash` requires `deleted_at IS NOT NULL` — watcher-missing photos are never auto-purged (their files may just be temporarily offline).
- **Purge vs. restore race (data loss)** — `purge_old_trash` did a `SELECT` then an unguarded per-id `DELETE`; a photo restored between the two was still hard-deleted. Rewritten as a single atomic `DELETE ... RETURNING id, file_path, file_hash` with `is_deleted = 1` in the WHERE, closing the TOCTOU window (also removes the N+1 DELETE loop).
- **Shared-hash thumbnail deletion broke surviving photos** — thumbnails are keyed by `file_hash`, so byte-identical photos share the same `.webp` files; purging one deleted them all. `remove_thumbnails` now skips deletion when any other photo row (including trashed ones) still references the hash, and skips entirely for empty `file_hash` (which would otherwise collide on `{thumb_dir}/.s.webp`).
- **Queued thumbnail task regenerated orphan files after purge** — an in-flight `PipelineTask` could write thumbnails for a photo purged while queued, recreating the exact orphans the fix removed. `process_task` now checks the photo row is still active (exists and not trashed) before generating; DB failures do not skip (would lose legitimate thumbnails).
- **Auto-purge never told the frontend** — the background purge deleted rows/files but emitted no event, leaving ghost entries in TanStack Query (`staleTime: Infinity`) and the Zustand store. It now emits `library:changed` (`removed: [...]`) like every other library mutation.
- **Purge N+1 DB queries** — `photos_purge`/`photos_purge_data` prefetched via a per-id `get()` loop (up to 1000 serialized pool checkouts on a max-5 pool); replaced with a single `get_batch` IN(...) query. `remove_thumbnails` also takes the cache lock once instead of once per size.

#### Security

- **SEC-H3 — HMAC session token for private album authorization**
  - `album_verify_password` now returns a signed `base64url(payload).base64url(sig)` token on success instead of a plain boolean; `null` on failure
  - Token payload = `"{album_id}\n{expires_at_unix}"` signed with HMAC-SHA256; TTL = 3600 s
  - `AppState.hmac_secret` — 32-byte secret derived from two UUID v4 values (OS CSPRNG), regenerated on every app restart so tokens are automatically invalidated across sessions
  - `photos_list` now performs a backend authorization check: if `album_id` refers to a private album, a valid `session_token` is **required** in the filter; missing or expired tokens return `AppError::Other("TOKEN_REQUIRED")`
  - New `album_check_token` IPC command for proactive token validation from the frontend
  - Constant-time HMAC comparison (`constant_time_eq`) prevents timing-oracle attacks
  - New crate deps: `hmac 0.12`, `sha2 0.10`, `base64 0.22`
  - **Frontend wiring**: `AlbumContext` carries `sessionToken` + `onTokenExpired`; `PasswordLockScreen.onUnlock(token)` stores the token in `PrivateAlbumView`; `usePhotoQuery` injects `sessionToken` into `PhotoFilter`; `usePhotoData` detects `TOKEN_REQUIRED` errors and calls `onTokenExpired()` to re-lock the UI; navigating away from the album clears the token immediately

#### Fixed

- **PrivateAlbum PIN color consistency (v3)** — Replaced Framer Motion spring animation on filled `PinDot` cells with a plain `<div>` + CSS `transition` (`opacity`/`transform`); spring interpolation caused concurrently-mounted dots to be at different animation stages, making them appear different shades — CSS transition is deterministic and all filled cells now render identically
- **PrivateAlbum multi-album keydown isolation (v3)** — During an `AnimatePresence` transition between two private albums (~120 ms), both `PasswordLockScreen` instances were mounted simultaneously and both registered `window keydown` handlers, causing a single keystroke to trigger both `handleComplete` callbacks; fixed with a module-level `activeAlbumToken` string that the newest instance claims on mount, silencing stale listeners

#### Documentation

- **DOC-H1 — Rustdoc on all public Tauri commands** — Added `///` doc comments to every `#[tauri::command]` function in `commands/photo.rs`, `commands/album.rs`, `commands/settings.rs`, `commands/tag.rs`, and `commands/thumbnail.rs`; documents parameters, return types, error conditions, and key invariants (pagination cursors, private-album token requirement, bcrypt rate-limit behaviour, thumbnail priority queue)

---

### 2026-05-18 ~ 2026-05-19 — Comprehensive bug-fix batch

#### Security

- Private album PIN upgraded from 6-digit numeric to 8+ alphanumeric; bcrypt hash/verify moved off the async executor with `spawn_blocking`
- `AppState.db` field changed to `pub(crate)` to prevent direct SQL access bypassing the repository layer
- Added exponential back-off (≥3 failed attempts → lockout up to 5 min) on private album verification
- DEV-mode IPC log now redacts `password` field for `album_create_private`, `album_set_private`, `album_verify_password`
- **PrivateAlbum PIN input (v2)** — Replaced hidden `<input>` focus hack with `window.addEventListener('keydown')` to fix PIN digits being silently dropped when the hidden input lost focus; overlay click no longer dismisses the creation wizard mid-flow

#### Performance

- N+1 `get_batch` SQL replaced with single `IN (…)` query
- `usePhotoData` no longer re-flatMaps all pages on each scroll; uses `appendPhotos` for page 2+ (O(N²) → O(pageSize))
- `updatePhoto` in `photoStore` is now O(1) via `_photoIndex` map instead of O(N) `.map()` scan
- `thumb:batch_done` event now uses `resetQueries` to bypass `staleTime: Infinity`

#### Correctness

- `photos_purge` now collects file paths before DB delete (no dangling paths on rollback failure)
- `photos_update` uses repository `set_rating()` instead of raw SQL
- `AppError` gains explicit `ScanInProgress` and `UndoEmpty` variants; error codes align with frontend `IpcError` types
- `photoGroupKey` uses UTC methods to avoid timezone-induced month boundary shifts
- Undo recording errors now emit `tracing::warn` instead of silently discarding with `let _ =`
- `useEventBus` unlisten cleanup is now synchronous (was an async `Promise.allSettled` race)
- `albums_list_all` masks `cover_thumbnail` for private albums
- `AlbumUpdateParams` type unifies two-argument album update calls to a single typed object

#### React

- `usePhotoData` merges two separate `useEffect`s into one to prevent split-frame state
- Store updates in `usePhotoData` wrapped in `startTransition` for concurrency safety
- `PreviewToolbar` `favMutation` moved to true optimistic pattern (`onMutate` + `onError` rollback)
- `invalidateQueries(['photos'])` replaced with `resetQueries` at all favorite/batch-favorite call sites

#### CI

- Rust tests now use `--test-threads=$(nproc)` instead of hardcoded `4`
- Added `cargo audit` security scan to Rust job
- Added `pnpm audit --audit-level=high` to frontend job
- Added sidecar smoke test to frontend CI job
- Added E2E test job with `xvfb-run`
- `windows-compat` job upgraded with Clippy, frontend lint, and typecheck steps
- Added `release.yml` workflow triggered on version tags
- Added Dependabot config for npm, Cargo, and GitHub Actions

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
