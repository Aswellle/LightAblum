// src-tauri/src/metadata/hasher.rs
//
// 文件指纹计算（xxHash64）
//
// 用途：
//   1. 跨路径去重检测（相同内容、不同路径的照片）
//   2. 增量扫描时快速判断文件内容是否变化（配合 mtime + file_size）
//
// 选择 xxHash64 的原因：
//   - 极快（比 MD5 快 10x+），适合批量处理大量图片文件
//   - 碰撞概率可接受（去重用，非密码学场景）
//   - xxhash-rust 是纯 Rust 实现，无外部依赖

use crate::error::Result;
use std::io::Read;
use std::path::Path;
use xxhash_rust::xxh64::Xxh64;

/// 分块读取文件并计算 xxHash64 指纹
///
/// 使用 64 KB 分块读取，避免将大型 RAW 文件（可能超过 50MB）全部载入内存。
/// 返回 16 位小写十六进制字符串（如 "a3f7c8d91e2b4a5f"）。
pub fn hash_file(path: &Path) -> Result<String> {
    let mut file   = std::fs::File::open(path)?;
    let mut hasher = Xxh64::new(0);
    let mut buf    = [0u8; 65536]; // 64 KB

    loop {
        let n = file.read(&mut buf)?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }

    Ok(format!("{:016x}", hasher.digest()))
}

/// 计算内存中字节切片的 xxHash64（测试和小数据用）
pub fn hash_bytes(data: &[u8]) -> String {
    let mut hasher = Xxh64::new(0);
    hasher.update(data);
    format!("{:016x}", hasher.digest())
}

/// 从 hash 值提取前两位（用于缩略图目录分片）
/// 示例：hash = "a3f7c8..." → "a3"
pub fn hash_prefix(hash: &str) -> &str {
    &hash[..2.min(hash.len())]
}
