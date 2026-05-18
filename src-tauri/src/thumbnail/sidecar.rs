// src-tauri/src/thumbnail/sidecar.rs
//
// Sharp Node.js Sidecar 进程管理
//
// 架构（对应架构文档 §1.3）：
//
//   Rust                       Node.js (sharp-worker)
//   ┌──────────────┐  stdin    ┌─────────────────────┐
//   │ SidecarHandle│ ────────→ │ readline JSON Lines  │
//   │              │  stdout   │                      │
//   │              │ ←──────── │ sharp.resize().webp()│
//   └──────────────┘           └─────────────────────┘
//
// 生命周期：
//   - 首次请求 HEIC/RAW 时按需启动（lazy spawn）
//   - 空闲 IDLE_TIMEOUT_SECS（30s）后自动终止
//   - 进程崩溃时自动重启（下次请求时 re-spawn）
//
// 协议：
//   请求：{"cmd":"thumbnail","input":"/path","sizes":[200,600],"outputs":[...],"quality":85}\n
//   响应：{"ok":true}\n  或  {"ok":false,"error":"..."}\n

use crate::error::{AppError, Result};
use crate::thumbnail::ThumbSize;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Instant;

const IDLE_TIMEOUT_SECS: u64 = 30;

/// 动态解析 sidecar 二进制路径
///
/// 优先查找与可执行文件同目录的二进制，再 fallback 到 data_dir 同级。
fn sidecar_binary_path(data_dir: &Path) -> PathBuf {
    // 优先查找与可执行文件同目录的二进制
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let candidate = exe_dir.join(if cfg!(windows) {
                "sharp-worker.exe"
            } else {
                "sharp-worker"
            });
            if candidate.exists() {
                return candidate;
            }
        }
    }
    // fallback: data_dir 同级
    data_dir.join(if cfg!(windows) {
        "sharp-worker.exe"
    } else {
        "sharp-worker"
    })
}

// ─────────────────────────────────────────────────────────
//  JSON Lines 协议类型
// ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct SidecarRequest {
    cmd: String,
    input: String,
    sizes: Vec<u32>,
    outputs: Vec<String>,
    quality: u8,
}

#[derive(Debug, Serialize)]
struct MetadataRequest {
    cmd: String,
    input: String,
}

#[derive(Debug, Deserialize)]
pub struct SidecarResponse {
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MetadataResponse {
    pub ok: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub orientation: Option<i32>,
    pub format: Option<String>,
    pub error: Option<String>,
}

// ─────────────────────────────────────────────────────────
//  SidecarHandle
// ─────────────────────────────────────────────────────────

pub struct SidecarHandle {
    process: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    last_used: Instant,
    /// Tauri 资源目录（用于定位 sidecar 可执行文件）
    resource_dir: PathBuf,
}

impl SidecarHandle {
    pub fn new(resource_dir: PathBuf) -> Self {
        Self {
            process: None,
            stdin: None,
            stdout: None,
            last_used: Instant::now(),
            resource_dir,
        }
    }

    // ── 确保进程运行（懒加载 + 自动重启）──────────────
    fn ensure_running(&mut self) -> Result<()> {
        // 检查空闲超时：超时则终止
        if self.process.is_some() && self.last_used.elapsed().as_secs() > IDLE_TIMEOUT_SECS {
            tracing::info!("Sharp sidecar idle timeout — terminating");
            self.kill();
        }

        // 检查进程是否已退出（意外崩溃）
        if let Some(ref mut proc) = self.process {
            match proc.try_wait() {
                Ok(Some(status)) => {
                    tracing::warn!("Sharp sidecar exited unexpectedly: {status}");
                    self.process = None;
                    self.stdin = None;
                    self.stdout = None;
                }
                Ok(None) => {} // 进程正常运行中
                Err(e) => {
                    tracing::warn!("Failed to check sidecar status: {e}");
                }
            }
        }

        if self.process.is_none() {
            self.spawn()?;
        }

        self.last_used = Instant::now();
        Ok(())
    }

    fn spawn(&mut self) -> Result<()> {
        let bin_path = sidecar_binary_path(&self.resource_dir);

        if !bin_path.exists() {
            return Err(AppError::Sidecar(format!(
                "Sharp sidecar binary not found: {}. \
                 Run `cd sidecar && npm run build` to generate it.",
                bin_path.display()
            )));
        }

        tracing::info!("Spawning Sharp sidecar: {}", bin_path.display());

        let mut child = Command::new(&bin_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null()) // 忽略 stderr（避免日志污染）
            .spawn()
            .map_err(|e| AppError::Sidecar(format!("Failed to spawn sidecar: {e}")))?;

        self.stdin = child.stdin.take();
        let raw_out = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Sidecar("No stdout from sidecar".into()))?;
        self.stdout = Some(BufReader::new(raw_out));
        self.process = Some(child);

        Ok(())
    }

    // ── 发送请求并读取响应 ──────────────────────────────
    fn send_recv(&mut self, json: &str) -> Result<String> {
        // 写入请求（以 \n 结尾）
        if let Some(ref mut stdin) = self.stdin {
            stdin
                .write_all(json.as_bytes())
                .map_err(|e| AppError::Sidecar(format!("Write to sidecar failed: {e}")))?;
            stdin
                .write_all(b"\n")
                .map_err(|e| AppError::Sidecar(format!("Write newline failed: {e}")))?;
            stdin
                .flush()
                .map_err(|e| AppError::Sidecar(format!("Flush to sidecar failed: {e}")))?;
        } else {
            return Err(AppError::Sidecar("Sidecar stdin not available".into()));
        }

        // 读取响应行
        let mut line = String::new();
        if let Some(ref mut stdout) = self.stdout {
            stdout
                .read_line(&mut line)
                .map_err(|e| AppError::Sidecar(format!("Read from sidecar failed: {e}")))?;
        } else {
            return Err(AppError::Sidecar("Sidecar stdout not available".into()));
        }

        Ok(line)
    }

    // ── 公开接口 ─────────────────────────────────────────

    /// 请求生成缩略图
    ///
    /// # 参数
    /// - `source`       源图片路径
    /// - `sizes`        需要生成的尺寸列表
    /// - `output_paths` 各尺寸对应的输出路径
    /// - `quality`      WEBP 质量 0-100
    pub fn request_thumbnails(
        &mut self,
        source: &Path,
        sizes: &[ThumbSize],
        output_paths: &[PathBuf],
        quality: u8,
    ) -> Result<SidecarResponse> {
        self.ensure_running()?;

        let req = SidecarRequest {
            cmd: "thumbnail".into(),
            input: source.to_string_lossy().into_owned(),
            sizes: sizes.iter().map(|s| s.pixels()).collect(),
            outputs: output_paths
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            quality,
        };

        let json = serde_json::to_string(&req)?;
        let resp_line = self.send_recv(&json)?;

        if resp_line.trim().is_empty() {
            return Err(AppError::Sidecar("Empty response from sidecar".into()));
        }

        serde_json::from_str(resp_line.trim())
            .map_err(|e| AppError::Sidecar(format!("Invalid JSON response: {e}")))
    }

    /// 请求读取图片元数据（宽高/方向/格式）
    pub fn request_metadata(&mut self, source: &Path) -> Result<MetadataResponse> {
        self.ensure_running()?;

        let req = MetadataRequest {
            cmd: "metadata".into(),
            input: source.to_string_lossy().into_owned(),
        };

        let json = serde_json::to_string(&req)?;
        let resp_line = self.send_recv(&json)?;

        if resp_line.trim().is_empty() {
            return Err(AppError::Sidecar("Empty metadata response".into()));
        }

        serde_json::from_str(resp_line.trim())
            .map_err(|e| AppError::Sidecar(format!("Invalid metadata JSON: {e}")))
    }

    pub fn kill(&mut self) {
        if let Some(ref mut proc) = self.process {
            let _ = proc.kill();
            let _ = proc.wait();
        }
        self.process = None;
        self.stdin = None;
        self.stdout = None;
        tracing::debug!("Sharp sidecar terminated");
    }
}

impl Drop for SidecarHandle {
    fn drop(&mut self) {
        self.kill();
    }
}
