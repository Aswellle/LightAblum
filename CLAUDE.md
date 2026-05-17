# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Full app dev (starts Vite + Rust backend together)
pnpm tauri dev

# Frontend only (no Tauri, for UI work)
pnpm dev

# Production build
pnpm tauri build

# Lint (ESLint)
pnpm lint

# TypeScript type check (no emit)
pnpm typecheck

# E2E tests (Playwright)
pnpm test:e2e

# E2E tests with interactive UI
pnpm test:e2e:ui

# Rust unit tests (run from src-tauri/)
cd src-tauri && cargo test

# Rust benchmarks (scan throughput)
cd src-tauri && cargo bench --bench scan_throughput

# Frontend unit tests (Vitest)
pnpm test

# Sidecar smoke test
cd sidecar && node test/smoke.js

# Build sidecar binary (outputs to src-tauri/binaries/)
cd sidecar && node scripts/bundle.js
```

## Architecture

LightAblum is a **Tauri v2 (Rust) + React 19 + TypeScript** desktop app for photo management. All persistent data lives in `%APPDATA%/LightAlbum/` — `library.db` (SQLite) and `thumbnails/`.

### IPC Contract

The frontend never calls Rust directly — all communication goes through `src/services/tauriIpc.ts`:
- `api.*` methods wrap `invoke()` calls with typed error handling
- **Adding a new IPC command requires two changes in lockstep:**
  1. Register the handler in `src-tauri/src/lib.rs` → `tauri::generate_handler![...]`
  2. Add the signature to `IpcCommands` in `src/types/ipc.ts`

### Event-Driven Updates

Rust pushes real-time events via `app.emit()`. The frontend subscribes in `src/services/eventBus.ts` via `useEventBus()` (mounted once at the app root in `src/app/App.tsx`). Events update Zustand stores and/or invalidate TanStack Query cache:

| Rust event | Frontend action |
|---|---|
| `scan:completed` | `queryClient.resetQueries(['photos'])` — use `resetQueries`, not `invalidateQueries`, to bypass `staleTime: Infinity` |
| `thumb:ready` | invalidate `['thumb', photoId, size]` + notify `thumbnailLoader` |
| `library:changed` | `resetQueries(['photos'])` |
| `photo:updated` | `photoStore.updatePhoto()` |
| `album:updated` | invalidate `['albums']` |

`library:changed` payload is always `{ added: string[], modified: string[], removed: string[] }` from both `scan.rs` and `state.rs` watcher paths.

### State Management

- **Zustand stores** (`src/stores/`): `photoStore`, `previewStore`, `selectionStore`, `uiStore`, `layoutStore`
- **TanStack Query** handles server-state caching. Query keys: `['photos']`, `['albums']`, `['thumb', photoId, size]`, `['folders']`, `['stats']`
- `photoStore` maintains both a flat `photos[]` and a `_groupMap` (indexed by `YYYY-MM`) for incremental group updates — `appendPhotos` is O(pageSize), not O(N_total)

### Photo Data Tiers

- **`PhotoThumb`** — 12-field projection used by the grid (avoids loading 30+ columns for thousands of rows)
- **`Photo`** — full record fetched only for the detail/preview view

### Thumbnail Pipeline (Rust)

`src-tauri/src/thumbnail/pipeline.rs`: Three-priority queue (High/Normal/Low) → rayon worker pool (min(CPUs/2, 4)) → generates S+M thumbnails, L on demand.

- HEIC/RAW formats are handled by the **Sharp sidecar** (`sidecar/`) — a Node.js binary bundled via `@yao-pkg/pkg`, placed in `src-tauri/binaries/`. Rust spawns it as a child process via `SidecarHandle`.
- Thumbnail paths are deterministic: `{thumb_dir}/{photoId}_{size}.webp`

### Database

SQLite via `rusqlite` + `r2d2` connection pool (max 5 connections). Per-connection PRAGMAs set WAL mode, foreign keys, and `busy_timeout = 5000ms` to handle concurrent access between the UI, scanner, and thumbnail threads. Schema migrations run at startup via `db::schema::run_migrations`.

### File Watching

`src-tauri/src/scanner/watcher.rs` uses `notify-debouncer-full` (500ms window). The watcher is started in `AppState::start_watcher()` and re-registers all `watched_folders` from the DB on launch. `import_scan` / `folders_remove` commands call `register_watch` / `unregister_watch` to update it dynamically.

### App Component Hierarchy

`src/app/App.tsx` mounts providers and global hooks exactly once:

```
<QueryClientProvider>
  <ConfirmDialogProvider>
    <AppContent>               ← useTheme() + useEventBus() live here
      <AppShell>               ← 3-column: sidebar / toolbar / content grid
      <AnimatePresence mode='wait'>
        <PhotoPreview />       ← conditional, large preview overlay
      <ContextMenu />          ← Portal to document.body
      <Toast />                ← Portal to document.body
```

`useTheme()` manages `.dark`/`.light` on `<html>` and watches `prefers-color-scheme`. `useEventBus()` subscribes to all Tauri events and fans out to stores/queryClient. Both must stay in `AppContent` (inside providers), not in `App`.

### Type-Safe Events

`src/types/events.ts` defines `TauriEventMap` — event name → payload type. Use `listenTyped<K>(event, handler)` from `src/services/eventBus.ts` to get inferred payload types without casting. Adding a new Rust event requires adding it to `TauriEventMap`.

### IPC Error Handling

Rust serializes errors as `{ code, message, detail }`. Frontend `src/services/tauriIpc.ts` exposes `parseIpcError()` and `isIpcError()`. Known codes: `DB_ERROR`, `IO_ERROR`, `THUMBNAIL_ERROR`, `EXIF_ERROR`, `SIDECAR_ERROR`, `PHOTO_NOT_FOUND`, `ALBUM_NOT_FOUND`, `SCAN_IN_PROGRESS`, `UNDO_EMPTY`, `INVALID_PARAMS`, `LIMIT_EXCEEDED`. Errors surface to users via `uiStore.toast()`.

### Database Migrations

Migrations in `src-tauri/src/db/schema.rs` are idempotent (use `column_exists()` checks before `ALTER TABLE`). Current versions: v1 initial schema → v2 EXIF fields → v3 private albums → v4 tag system → v5 full-text search. A `.bak.{version}` copy is written before any migration (non-fatal if backup fails). Never rely on column order — always use named columns.

### Design Tokens

`src/styles/tokens.css` defines all CSS variables consumed through Tailwind's `bg-la-*` / `text-la-*` utilities (`tailwind.config.ts`). Key tiers: `bg-app` → `bg-sidebar` → `bg-raised` → `bg-overlay`. Z-index ladder: `base(0)` → `dropdown(100)` → `overlay(300)` → `modal(400)` → `preview(500)` → `toast(600)` → `titlebar(800)`. Animation durations live in `--la-duration-*` variables — use these rather than hardcoded `ms` values.

### Build & Aliases

`@` maps to `src/` (configured in `vite.config.ts` and `tsconfig.json`). Dev server binds to `127.0.0.1:5173` (explicit IPv4 to avoid Windows IPv6 permission issues). ESLint uses v9 flat config (`eslint.config.js`). The sidecar binary must be built separately (`cd sidecar && node scripts/bundle.js`) before `pnpm tauri build` — it is not built automatically.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
