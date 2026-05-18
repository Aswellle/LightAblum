// src-tauri/src/scanner/differ.rs
//
// 增量扫描差异计算
//
// 职责：
//   将文件系统上的文件列表与数据库中已索引的记录进行比对，
//   输出需要新增、更新或标记为缺失的文件集合。
//
// 比对策略：
//   - 新增：file_path 在 DB 中不存在
//   - 更新：file_path 存在，但 modified_at 或 file_size 与 DB 不一致
//   - 缺失：DB 中记录的文件在磁盘上已不存在（find_missing 单独处理）
//
// 性能：
//   diff_batch 一次查询一批路径（最多 BATCH_SIZE 条），
//   使用 IN (...) 参数绑定，单次 RTT 完成比对。

use crate::error::Result;
use crate::scanner::walker::FileEntry;
use rusqlite::Connection;
use std::collections::HashMap;

/// 差异计算结果
#[derive(Debug, Default)]
pub struct DiffResult {
    /// 需要新增到 DB 的文件
    pub to_add: Vec<FileEntry>,
    /// 需要更新 DB 记录的文件（元数据变更）
    pub to_update: Vec<FileEntry>,
}

/// 将一批文件与 DB 中的记录进行比对
///
/// 通过单次 SQL IN 查询获取这批文件在 DB 中的状态，
/// 比较 modified_at（精确到秒）和 file_size 判断是否需要更新。
pub fn diff_batch(conn: &Connection, entries: &[FileEntry]) -> Result<DiffResult> {
    if entries.is_empty() {
        return Ok(DiffResult::default());
    }

    // 构建路径 → 文件系统信息的 Map（快速查找）
    let entries_map: HashMap<&str, &FileEntry> = entries
        .iter()
        .filter_map(|e| e.path.to_str().map(|s| (s, e)))
        .collect();

    if entries_map.is_empty() {
        return Ok(DiffResult::default());
    }

    // 从 DB 查询这批路径的已有记录
    // 使用 params_from_iter 动态绑定（安全，无注入风险）
    let paths: Vec<&str> = entries_map.keys().copied().collect();

    let placeholders = (1..=paths.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT file_path, file_size, modified_at \
         FROM photos \
         WHERE file_path IN ({placeholders})" // 注意：不加 is_deleted = 0，即使已软删除的文件也要检测到
                                              // 若文件重新出现（用户移回），应能重新激活
    );

    let mut stmt = conn.prepare(&sql)?;

    // (file_path → (db_size, db_modified))
    let mut existing: HashMap<String, (i64, String)> = HashMap::new();

    let rows = stmt.query_map(rusqlite::params_from_iter(paths.iter()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    for row in rows {
        let (path, size, modified) = row?;
        existing.insert(path, (size, modified));
    }

    // ── 差异判断 ──
    let mut result = DiffResult::default();

    for (path_str, entry) in &entries_map {
        let file_modified = entry.modified_at.format("%Y-%m-%dT%H:%M:%SZ").to_string();

        match existing.get(*path_str) {
            None => {
                // 新文件
                result.to_add.push((*entry).clone());
            }
            Some((db_size, db_modified)) => {
                // 文件存在，判断是否有变化
                let size_changed = *db_size != entry.file_size as i64;
                // 时间比较：截取到秒（DB 存储精度为秒）
                let time_changed = db_modified != &file_modified;

                if size_changed || time_changed {
                    result.to_update.push((*entry).clone());
                }
                // 否则：文件未变，跳过
            }
        }
    }

    Ok(result)
}

/// 检测某文件夹下 DB 中记录的文件，哪些已不存在于磁盘（缺失检测）
///
/// 返回缺失文件的 photo ID 列表（供 soft_delete 使用）。
/// 注意：此函数需要遍历 DB 记录并逐一检查磁盘，
/// 对于大型库（10万+）需要批次处理，避免一次锁定 DB 过长。
pub fn find_missing(conn: &Connection, folder_path: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path FROM photos \
         WHERE folder_path = ?1 AND is_deleted = 0",
    )?;

    let mut missing = Vec::new();

    let rows = stmt.query_map(rusqlite::params![folder_path], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows {
        let (id, file_path) = row?;
        if !std::path::Path::new(&file_path).exists() {
            tracing::debug!("File missing from disk: {file_path}");
            missing.push(id);
        }
    }

    Ok(missing)
}

/// 从 DB 中获取某文件夹的（路径 → mtime + size）索引，
/// 用于快速判断增量扫描时哪些文件已存在。
pub fn load_folder_index(
    conn: &Connection,
    folder_path: &str,
) -> Result<HashMap<String, (i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT file_path, file_size, modified_at FROM photos \
         WHERE folder_path = ?1 AND is_deleted = 0",
    )?;

    let mut index = HashMap::new();
    let rows = stmt.query_map(rusqlite::params![folder_path], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    for row in rows {
        let (path, size, modified) = row?;
        index.insert(path, (size, modified));
    }

    Ok(index)
}
