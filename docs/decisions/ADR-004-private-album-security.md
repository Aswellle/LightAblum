# ADR-004: Private album security model

**Status**: Accepted (revised 2026-06)  
**Date**: 2026-04-26  
**Revised**: 2026-06-19

## Context

Private albums need password protection without requiring a full user account system. The threat model is **casual unauthorized access** (e.g. someone picking up an unlocked computer) — not adversarial extraction of the SQLite file.

## Decision (initial — 2026-04-26)

- PIN: 6-digit numeric
- Storage: bcrypt hash in `albums.password_hash`
- Verification: synchronous bcrypt check in Tauri command handler

## Revision (2026-06-19)

The initial 6-digit numeric PIN (1,000,000 combinations) was insufficient. Revised to:

**PIN requirements**: minimum 8 characters, ASCII alphanumeric (`[A-Za-z0-9]`). This gives ≥62^8 ≈ 218 trillion combinations.

**bcrypt**: cost factor 12. Both `bcrypt::hash` and `bcrypt::verify` run in `tokio::task::spawn_blocking` to avoid blocking the async executor (~300ms each).

**Rate limiting**: after 3 failed attempts, exponential back-off: lockout = min(2^(attempts−3), 300) seconds. Maximum lockout: 5 minutes. State held in `AppState.failed_attempts: Arc<Mutex<HashMap<albumId, FailedAttempts>>>`.

**Cover image masking**: `albums_list_all` returns `cover_thumbnail: null` for locked private albums to prevent content leakage through thumbnail paths.

## Limitations (deferred)

**SEC-H3 (deferred sprint)**: The verification flow currently returns a boolean and the frontend relies on application-level state to track "unlocked" status. A short-lived HMAC session token (album-scoped, TTL ~1h) would prevent replay attacks and tie authorization to the backend rather than frontend trust. Scheduled for a separate security sprint.

## Consequences

- **Good**: bcrypt off the executor prevents async starvation under concurrent requests.
- **Good**: Rate limiting defeats brute-force against the running application.
- **Bad**: SQLite file exfiltration bypasses all of the above — bcrypt hashes are offline-crackable. This is out of scope for the current threat model.
- **Bad**: `failed_attempts` is in-memory; server restart resets the counter.
