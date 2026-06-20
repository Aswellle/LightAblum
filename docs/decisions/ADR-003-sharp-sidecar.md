# ADR-003: Sharp sidecar for HEIC/RAW decoding

**Status**: Accepted  
**Date**: 2026-04-26

## Context

Rust's image decoding ecosystem (as of 2025) lacks production-quality support for HEIC (Apple's default photo format since iOS 11) and most RAW camera formats. `image-rs` can handle JPEG/PNG/WebP but not HEIC or CR2/NEF/ARW.

libheif and dcraw-based Rust bindings exist but have large C dependency chains, complex build requirements on Windows, and limited crate maintenance.

## Decision

Decode HEIC and RAW formats using a **Sharp sidecar** — a Node.js binary compiled with `@yao-pkg/pkg` that exposes a stdio JSON-RPC interface. Sharp uses libvips which has battle-tested, actively maintained HEIC and RAW support.

The sidecar binary is:
- Pre-built per-platform and committed to `src-tauri/binaries/`
- Spawned lazily by `SidecarHandle` on first HEIC/RAW request
- Kept alive as a long-running process; stdin/stdout protocol with newline-delimited JSON

**Build the sidecar** (required before `pnpm tauri build`):
```bash
cd sidecar && node scripts/bundle.js
```

## Consequences

- **Good**: Full HEIC and RAW support without complex native Rust FFI.
- **Good**: Sharp is widely maintained; libvips gets HEIC/codec updates regularly.
- **Bad**: Binary must be manually rebuilt when sidecar source changes — CI now verifies this.
- **Bad**: Adds ~15MB to the distributable per platform.
- **Watch out**: The sidecar binary is platform-specific. The `src-tauri/tauri.conf.json` `externalBin` field controls which binary Tauri bundles. Don't commit cross-platform binaries to the wrong path.
