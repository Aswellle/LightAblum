// src-tauri/src/thumbnail/cache.rs
//
// 缩略图磁盘缓存管理
// Round-6（F-12）：O(N) VecDeque+retain → O(1) lru::LruCache
//
// 问题根因：
//   get() 调用 self.order.retain(|s| s != &k) 将访问项移到队首。
//   retain() 是 O(N)，遍历整个 VecDeque 比较每个 key。
//   thumbnail_get_path 是热路径（每个可见 GridItem 都调用），
//   100K 缓存条目时每次访问约 100K 次字符串比较。
//
// 修复方案：
//   用 lru::LruCache<String, CacheEntry> 替代 VecDeque<String> + HashMap。
//   lru crate 内部用双向链表 + HashMap 实现 O(1) get/put/pop_lru。
//   字节驱逐逻辑保持不变（pop_lru() 逐出最旧条目直到低于阈值）。
//
// API 不变：SharedCache / ThumbnailCache / new_shared / 所有方法签名均保持，
// 其他模块无需改动。

use lru::LruCache;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

// ─────────────────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────────────────

pub const DEFAULT_MAX_BYTES: u64 = 5 * 1024 * 1024 * 1024; // 5GB
pub const MAX_INDEX_ENTRIES: usize = 100_000;

// ─────────────────────────────────────────────────────────
//  CacheEntry（不变）
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct CacheEntry {
    path: PathBuf,
    size_bytes: u64,
}

// ─────────────────────────────────────────────────────────
//  ThumbnailCache
// ─────────────────────────────────────────────────────────

pub struct ThumbnailCache {
    /// F-12: 用 lru::LruCache 替代 VecDeque<String> + HashMap<String, CacheEntry>
    /// get() / put() / pop_lru() 均为 O(1) 均摊
    lru: LruCache<String, CacheEntry>,
    /// 已使用磁盘字节数
    used_bytes: u64,
    /// 最大磁盘字节数
    max_bytes: u64,
    /// 缩略图根目录（用于删除文件）
    thumb_dir: PathBuf,
}

impl ThumbnailCache {
    pub fn new(thumb_dir: PathBuf, max_bytes: u64) -> Self {
        let cap = NonZeroUsize::new(MAX_INDEX_ENTRIES).expect("MAX_INDEX_ENTRIES must be > 0");
        Self {
            lru: LruCache::new(cap),
            used_bytes: 0,
            max_bytes,
            thumb_dir,
        }
    }

    fn key(photo_id: &str, size_suffix: &str) -> String {
        format!("{photo_id}:{size_suffix}")
    }

    // ── 查询（F-12 核心：get 从 O(N) → O(1)）──────────────

    /// 查询缓存中是否有该缩略图，并将其标记为最近使用
    /// F-12: lru.get() 内部 O(1)，不再调用 O(N) retain()
    pub fn get(&mut self, photo_id: &str, size_suffix: &str) -> Option<&Path> {
        let k = Self::key(photo_id, size_suffix);

        // lru.get() 自动将 k 移到 MRU 位置（O(1)）
        // 需要先取出 path 检查文件是否存在
        let path_exists = self.lru.get(&k).map(|e| e.path.clone()).map(|p| p.exists());

        match path_exists {
            Some(true) => self.lru.get(&k).map(|e| e.path.as_path()),
            Some(false) => {
                // 文件被外部删除，清理缓存条目
                self.remove_entry(&k);
                None
            }
            None => None,
        }
    }

    /// 直接按路径检查（不更新 LRU 顺序，用于 pipeline 判断是否需要重新生成）
    pub fn exists(&self, photo_id: &str, size_suffix: &str) -> bool {
        let k = Self::key(photo_id, size_suffix);
        // peek() 不改变 LRU 顺序
        self.lru.peek(&k).map(|e| e.path.exists()).unwrap_or(false)
    }

    // ── 写入（O(1)）──────────────────────────────────────

    /// 记录新生成的缩略图（path 已写入磁盘）
    pub fn insert(&mut self, photo_id: &str, size_suffix: &str, path: PathBuf) {
        let k = Self::key(photo_id, size_suffix);

        // 若已有旧条目，先移除以正确计算 used_bytes
        if let Some(old) = self.lru.peek(&k) {
            self.used_bytes = self.used_bytes.saturating_sub(old.size_bytes);
        }

        let size_bytes = path.metadata().map(|m| m.len()).unwrap_or(0);
        self.used_bytes += size_bytes;
        self.lru.put(k, CacheEntry { path, size_bytes });

        // 字节超限：逐出 LRU 条目直到低于阈值
        self.evict_if_needed();
    }

    // ── 驱逐（LRU，O(1) per eviction）──────────────────

    fn evict_if_needed(&mut self) {
        let target = (self.max_bytes as f64 * 0.90) as u64;
        while self.used_bytes > self.max_bytes {
            match self.lru.pop_lru() {
                Some((_, entry)) => {
                    self.used_bytes = self.used_bytes.saturating_sub(entry.size_bytes);
                    let _ = std::fs::remove_file(&entry.path);
                    if self.used_bytes <= target {
                        break;
                    }
                }
                None => break,
            }
        }
    }

    fn remove_entry(&mut self, key: &str) {
        if let Some(entry) = self.lru.pop(key) {
            self.used_bytes = self.used_bytes.saturating_sub(entry.size_bytes);
            let _ = std::fs::remove_file(&entry.path);
        }
    }

    // ── 统计 ──────────────────────────────────────────────

    pub fn used_bytes(&self) -> u64 {
        self.used_bytes
    }
    pub fn max_bytes(&self) -> u64 {
        self.max_bytes
    }
    pub fn entry_count(&self) -> usize {
        self.lru.len()
    }

    pub fn usage_percent(&self) -> f64 {
        if self.max_bytes == 0 {
            return 0.0;
        }
        (self.used_bytes as f64 / self.max_bytes as f64 * 100.0).min(100.0)
    }

    // ── 启动时重建索引（不变）────────────────────────────

    pub fn rebuild_usage(&mut self) {
        let mut total = 0u64;
        if let Ok(read) = std::fs::read_dir(&self.thumb_dir) {
            for bucket in read.flatten() {
                let bucket_path = bucket.path();
                if !bucket_path.is_dir() {
                    continue;
                }
                if let Ok(files) = std::fs::read_dir(&bucket_path) {
                    for file in files.flatten() {
                        total += file.metadata().map(|m| m.len()).unwrap_or(0);
                    }
                }
            }
        }
        self.used_bytes = total;
        tracing::info!(
            "ThumbnailCache: {} entries, {:.1} MB / {:.1} MB ({:.1}%)",
            self.entry_count(),
            total as f64 / 1_048_576.0,
            self.max_bytes as f64 / 1_048_576.0,
            self.usage_percent(),
        );
    }
}

// ─────────────────────────────────────────────────────────
//  类型别名（不变）
// ─────────────────────────────────────────────────────────

pub type SharedCache = Arc<Mutex<ThumbnailCache>>;

pub fn new_shared(thumb_dir: PathBuf, max_bytes: u64) -> SharedCache {
    Arc::new(Mutex::new(ThumbnailCache::new(thumb_dir, max_bytes)))
}
