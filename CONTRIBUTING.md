# Contributing to LightAlbum

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | https://nodejs.org |
| pnpm | ≥ 8 | `npm i -g pnpm` |
| Rust | ≥ 1.77 | https://rustup.rs |
| Windows | MSVC Build Tools | `winget install Microsoft.VisualStudio.2022.BuildTools` |
| macOS | Xcode CLT | `xcode-select --install` |

## Setup

```bash
# 1. Install frontend dependencies
pnpm install

# 2. Build Sharp sidecar (required for HEIC/RAW thumbnails)
cd sidecar && node scripts/bundle.js && cd ..

# 3. Start development (Tauri + Vite)
pnpm tauri dev
```

## Branch Naming

- `feat/short-description` — new feature
- `fix/short-description` — bug fix
- `refactor/short-description` — refactor without behavior change
- `docs/short-description` — documentation only

## Commit Format

```
type(scope): short description

# Types: feat | fix | refactor | test | docs | chore
# Scope: rust | frontend | ci | deps
# Example: fix(frontend): eliminate EventBus memory leak
```

## Before Submitting a PR

```bash
pnpm lint          # ESLint
pnpm typecheck     # TypeScript
pnpm test          # Vitest unit tests
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
# Security audits
pnpm audit --audit-level=high
cd src-tauri && cargo audit
```

## Sidecar Rebuild

If you modify anything in `sidecar/`, rebuild the binary before testing:
```bash
cd sidecar && node scripts/bundle.js
```

The binary outputs to `src-tauri/binaries/`.

## IPC Changes (Lockstep Required)

Adding or modifying a Tauri command requires **two changes in lockstep**:

1. Register in `src-tauri/src/lib.rs` → `tauri::generate_handler![your_command]`
2. Add the signature to `IpcCommands` in `src/types/commands.ts`

Skipping either half causes a runtime panic (Rust side) or TypeScript type error (frontend side).

## Architecture Decisions

Key decisions are documented in `docs/decisions/`:

| ADR | Topic |
|-----|-------|
| [ADR-001](docs/decisions/ADR-001-stale-time-infinity.md) | `staleTime: Infinity` — use `resetQueries` not `invalidateQueries` |
| [ADR-002](docs/decisions/ADR-002-dual-state-management.md) | Zustand + TanStack Query dual-state pattern |
| [ADR-003](docs/decisions/ADR-003-sharp-sidecar.md) | Sharp sidecar for HEIC/RAW thumbnail decoding |
| [ADR-004](docs/decisions/ADR-004-private-album-security.md) | Private album bcrypt + rate-limiting security model |

Read these before making architectural changes. For significant new decisions, add an ADR.

## Release Process

See [docs/RELEASE.md](docs/RELEASE.md) for versioning, code signing, and publishing instructions.
