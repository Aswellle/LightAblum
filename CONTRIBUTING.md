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
cd src-tauri && cargo fmt --check && cargo clippy && cargo test
```

## Sidecar Rebuild

If you modify anything in `sidecar/`, rebuild the binary before testing:
```bash
cd sidecar && node scripts/bundle.js
```

The binary outputs to `src-tauri/binaries/`.
