# Changelog

All notable changes to LightAlbum are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### 2026-06-19 ~ 2026-06-20 — Security sprint & documentation pass

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
