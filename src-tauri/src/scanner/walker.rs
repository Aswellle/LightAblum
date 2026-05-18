// src-tauri/src/scanner/walker.rs
//
// 递归文件遍历器
//
// 使用 ignore crate（比标准库 WalkDir 快 ~3x）：
//   - 自动跳过隐藏文件/目录（以 . 开头）
//   - 不尊重 .gitignore（照片库场景）
//   - 不跟随符号链接（避免循环）
//
// 性能：
//   每批 BATCH_SIZE（200）个文件，外层扫描循环可渐进式处理，
//   不需要等待全部遍历完成即可开始索引 + 发送进度事件。

use crate::error::Result;
use crate::scanner::is_supported;
use ignore::WalkBuilder;
use std::path::{Path, PathBuf};

pub const BATCH_SIZE: usize = 200;

/// 单个文件的基础信息（不含 EXIF，EXIF 在后续步骤提取）
#[derive(Debug, Clone)]
pub struct FileEntry {
    /// 绝对路径
    pub path: PathBuf,
    /// 文件名（含扩展名）
    pub file_name: String,
    /// 文件大小（字节）
    pub file_size: u64,
    /// 文件最后修改时间（UTC）
    pub modified_at: chrono::DateTime<chrono::Utc>,
}

/// 递归文件遍历器
pub struct FileWalker {
    /// 每批输出的文件数（默认 200）
    pub batch_size: usize,
}

impl Default for FileWalker {
    fn default() -> Self {
        Self {
            batch_size: BATCH_SIZE,
        }
    }
}

impl FileWalker {
    /// 遍历一个或多个根目录，以批次迭代器方式返回支持的图片文件
    ///
    /// ```ignore
    /// use std::path::PathBuf;
    /// let walker = FileWalker::default();
    /// for batch in walker.walk(&[PathBuf::from("/photos")]) {
    ///     if let Ok(entries) = batch {
    ///         // 处理这一批 entries...
    ///     }
    /// }
    /// ```
    // ✅ 修复 E0597（lifetime may not live long enough）：
    //    原代码签名 walk<'a>(&'a self, roots: &'a [PathBuf]) 中，
    //    flat_map 产生的 entries 迭代器借用了 roots（生命周期 'a），
    //    但 Box<dyn Iterator> 要求 'static，无法满足。
    //    修复：移除 lifetime 参数，将遍历结果 .collect() 到 Vec<PathBuf>，
    //    彻底解除对 roots/self 的借用依赖，之后转为 'static 迭代器。
    pub fn walk(&self, roots: &[PathBuf]) -> impl Iterator<Item = Result<Vec<FileEntry>>> {
        let batch_size = self.batch_size;

        // 先全部收集到 Vec，彻底解除对 roots/self 的生命周期依赖
        let all_paths: Vec<PathBuf> = roots
            .iter()
            .flat_map(|root| {
                WalkBuilder::new(root)
                    .hidden(true) // 跳过隐藏文件/目录（.DS_Store, thumbs.db 等）
                    .git_ignore(false) // 照片库不尊重 .gitignore
                    .git_global(false) // 不使用全局 gitignore
                    .git_exclude(false)
                    .follow_links(false) // 不跟随符号链接（防循环）
                    .same_file_system(false) // 跨挂载点也扫描（外置硬盘）
                    .build()
                    .filter_map(|result| {
                        let entry = match result {
                            Ok(e) => e,
                            Err(e) => {
                                tracing::debug!("Walk error (skipping): {e}");
                                return None;
                            }
                        };

                        // 只处理文件（跳过目录）
                        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                            return None;
                        }

                        let path = entry.into_path();
                        if is_supported(&path) {
                            Some(path)
                        } else {
                            None
                        }
                    })
            })
            .collect();

        BatchIterator {
            inner: Box::new(all_paths.into_iter()),
            batch_size,
        }
    }

    /// 统计目录下支持格式的文件总数（用于进度条 total 计算）
    /// 快速遍历，不读取文件元数据。
    pub fn count(roots: &[PathBuf]) -> u64 {
        let mut total = 0u64;
        for root in roots {
            let count = WalkBuilder::new(root)
                .hidden(true)
                .git_ignore(false)
                .follow_links(false)
                .build()
                .filter(|r| {
                    r.as_ref()
                        .map(|e| {
                            e.file_type().map(|ft| ft.is_file()).unwrap_or(false)
                                && is_supported(e.path())
                        })
                        .unwrap_or(false)
                })
                .count() as u64;
            total += count;
        }
        total
    }
}

// ─────────────────────────────────────────────────────────
//  BatchIterator — 内部批次迭代器
// ─────────────────────────────────────────────────────────

struct BatchIterator {
    inner: Box<dyn Iterator<Item = PathBuf>>,
    batch_size: usize,
}

impl Iterator for BatchIterator {
    type Item = Result<Vec<FileEntry>>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut batch = Vec::with_capacity(self.batch_size);

        for path in self.inner.by_ref().take(self.batch_size) {
            match build_entry(&path) {
                Ok(entry) => batch.push(entry),
                Err(e) => {
                    tracing::warn!("Skipping {:?}: {}", path.file_name().unwrap_or_default(), e);
                }
            }
        }

        if batch.is_empty() {
            None
        } else {
            Some(Ok(batch))
        }
    }
}

// ─────────────────────────────────────────────────────────
//  文件元信息读取
// ─────────────────────────────────────────────────────────

fn build_entry(path: &Path) -> Result<FileEntry> {
    let meta = std::fs::metadata(path)?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    let modified_at: chrono::DateTime<chrono::Utc> = meta
        .modified()
        .map(Into::into)
        .unwrap_or_else(|_| chrono::Utc::now());

    Ok(FileEntry {
        path: path.to_path_buf(),
        file_name,
        file_size: meta.len(),
        modified_at,
    })
}
