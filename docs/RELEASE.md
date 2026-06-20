# Release Guide

## Versioning

LightAlbum follows [Semantic Versioning](https://semver.org/). Version is defined in:
- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `"version"`

Keep all three in sync before tagging a release.

## Release process

### 1. Prepare the release

```bash
# Update version in all three files (example: 0.2.0)
# package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json

# Update CHANGELOG.md — move [Unreleased] to the new version + date
# Format: ## [0.2.0] — YYYY-MM-DD

# Commit the version bump
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: release v0.2.0"
```

### 2. Tag and push

```bash
git tag v0.2.0
git push origin main --tags
```

Pushing the tag triggers the `release.yml` workflow, which:
- Builds platform binaries in parallel (Windows x64, macOS ARM64, macOS x64, Linux x64)
- Builds the sidecar binary for each platform
- Creates a draft GitHub Release with all installers attached

### 3. Finalize the release

1. Go to the GitHub Releases page.
2. Review the draft release and verify all platform binaries are attached.
3. Edit the release notes (copy from CHANGELOG.md).
4. Publish the release.

## Code signing

### Windows

Unsigned Windows builds trigger SmartScreen warnings. To sign:
1. Obtain an EV code-signing certificate from a CA (DigiCert, Sectigo, etc.).
2. Add the certificate as GitHub Actions secrets: `WINDOWS_CERTIFICATE` (Base64 PFX) + `WINDOWS_CERTIFICATE_PASSWORD`.
3. Add signing config to `tauri.conf.json` under `bundle.windows.certificateThumbprint` or use environment variables per the Tauri docs.

### macOS

Distributing outside the Mac App Store requires notarization:
1. Enroll in the Apple Developer Program.
2. Create an App ID, provisioning profile, and distribution certificate.
3. Add secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD`.
4. Configure the `tauri-action` in `release.yml` with the signing environment variables.

## Build artifacts

| Platform | Artifact |
|----------|----------|
| Windows  | `LightAlbum_x.y.z_x64-setup.exe` (NSIS installer) |
| macOS    | `LightAlbum_x.y.z_aarch64.dmg`, `LightAlbum_x.y.z_x64.dmg` |
| Linux    | `light-album_x.y.z_amd64.AppImage`, `light-album_x.y.z_amd64.deb` |

## Hotfix releases

For critical fixes (security vulnerabilities, data-loss bugs):
1. Branch from the release tag: `git checkout -b hotfix/0.1.1 v0.1.0`
2. Apply the minimum fix.
3. Update version + CHANGELOG, tag `v0.1.1`, push.
4. Merge the hotfix branch back to `main`.
