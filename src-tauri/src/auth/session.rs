// src-tauri/src/auth/session.rs
//
// SEC-H3: HMAC-SHA256 session token for private album authorization.
//
// Token format: base64url_nopad(payload) + "." + base64url_nopad(hmac_sig)
//   payload   = "{album_id}\n{expires_at_unix_secs}"
//   hmac_sig  = HMAC-SHA256(hmac_secret, payload.as_bytes())
//
// The token is album-scoped (bound to a specific album_id) and time-limited (1h TTL).
// The HMAC secret is generated at app startup (AppState.hmac_secret); tokens are
// invalidated automatically when the app restarts.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Token time-to-live: 1 hour (matches ADR-004 specification).
const TOKEN_TTL_SECS: u64 = 3600;

/// Generate a time-limited, album-scoped HMAC session token.
///
/// The returned opaque string should be stored by the frontend and passed back
/// as `PhotoFilter.session_token` on every `photos_list` call for private albums.
pub fn generate_token(secret: &[u8], album_id: &str) -> String {
    let expires_at = unix_now() + TOKEN_TTL_SECS;
    let payload = format!("{}\n{}", album_id, expires_at);
    let sig = compute_hmac(secret, payload.as_bytes());
    format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(payload.as_bytes()),
        URL_SAFE_NO_PAD.encode(&sig),
    )
}

/// Verify a token: checks HMAC integrity, album_id binding, and expiry.
///
/// Uses constant-time comparison for the HMAC check to prevent timing side-channels.
/// Returns `true` only when all three checks pass.
pub fn verify_token(secret: &[u8], token: &str, expected_album_id: &str) -> bool {
    let (payload_b64, sig_b64) = match token.split_once('.') {
        Some(p) => p,
        None => return false,
    };

    let payload_bytes = match URL_SAFE_NO_PAD.decode(payload_b64) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let sig_bytes = match URL_SAFE_NO_PAD.decode(sig_b64) {
        Ok(b) => b,
        Err(_) => return false,
    };

    // HMAC verification — must happen before payload parsing to prevent oracle attacks.
    let expected_sig = compute_hmac(secret, &payload_bytes);
    if !constant_time_eq(&sig_bytes, &expected_sig) {
        return false;
    }

    // Parse verified payload: "{album_id}\n{expires_at}"
    let payload_str = match std::str::from_utf8(&payload_bytes) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let (album_id, expires_str) = match payload_str.split_once('\n') {
        Some(p) => p,
        None => return false,
    };
    let expires_at: u64 = match expires_str.parse() {
        Ok(v) => v,
        Err(_) => return false,
    };

    album_id == expected_album_id && unix_now() < expires_at
}

fn compute_hmac(secret: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(secret)
        .expect("HMAC accepts keys of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// Constant-time byte-slice equality to prevent timing side-channels.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
