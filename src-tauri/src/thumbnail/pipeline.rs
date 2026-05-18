// src-tauri/src/thumbnail/pipeline.rs
//
// 缩略图生成调度器
//
// 架构（对应架构文档 §4.1 Phase 3）：
//
//   前端 thumbnail_request IPC
//       ↓
//   PipelineTask（优先级 + photo_id + 路径）
//       ↓ crossbeam_channel::Sender
//   工作线程（rayon::ThreadPool）
//       ↓ encoder::generate_thumbnails_pair / sidecar::request_thumbnails
//   写入磁盘 → 更新 DB → 发送 thumb:ready 事件
//
// 优先级策略：
//   High   — 视口中心区域（用户当前在看）
//   Normal — overscan 区域（即将滚入）
//   Low    — 后台批量补全
//
// Round-6（F-13）：dispatcher busy-wait sleep(20ms) → select! + recv_blocking()
//
// 并发控制：
//   - rayon 线程数 = min(CPU核数, 4)，避免影响 UI 线程
//   - 同一 photo_id 入队去重（pending_set）
//   - 队列上限 10000 条，超出时丢弃 Low 优先级任务

use crate::db;
use crate::error::{AppError, Result};
use crate::thumbnail::{self, ThumbSize, cache::SharedCache, encoder, sidecar::SidecarHandle};
use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// ─────────────────────────────────────────────────────────
//  优先级 & 任务类型
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    High,   // 视口中心
    Normal, // overscan
    Low,    // 后台补全
}

#[derive(Debug, Clone)]
pub struct PipelineTask {
    pub photo_id:  String,
    pub file_path: String,
    pub file_hash: String,
    pub priority:  Priority,
    /// 是否需要生成 L 尺寸（大图预览请求时才需要）
    pub need_large: bool,
}

// ─────────────────────────────────────────────────────────
//  ThumbnailPipeline
// ─────────────────────────────────────────────────────────

const QUEUE_CAP: usize = 10_000;
const WEBP_QUALITY: u8 = 85;

pub struct ThumbnailPipeline {
    /// 高优先级通道（容量较小，快速响应）
    high_tx:   Sender<PipelineTask>,
    high_rx:   Receiver<PipelineTask>,
    /// 普通优先级通道
    normal_tx: Sender<PipelineTask>,
    normal_rx: Receiver<PipelineTask>,
    /// 低优先级通道（后台批量）
    low_tx:    Sender<PipelineTask>,
    low_rx:    Receiver<PipelineTask>,
    /// 去重集合（避免同一张图重复入队）
    pending:   Arc<Mutex<HashSet<String>>>,
}

impl ThumbnailPipeline {
    pub fn new() -> Self {
        let (ht, hr) = bounded(500);
        let (nt, nr) = bounded(2_000);
        let (lt, lr) = bounded(QUEUE_CAP);
        Self {
            high_tx:   ht, high_rx:   hr,
            normal_tx: nt, normal_rx: nr,
            low_tx:    lt, low_rx:    lr,
            pending:   Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// 将任务加入优先级队列（去重）
    pub fn enqueue(&self, task: PipelineTask) -> bool {
        let mut pending = self.pending.lock().unwrap();
        if pending.contains(&task.photo_id) { return false; } // 已在队中
        pending.insert(task.photo_id.clone());
        drop(pending);

        let result = match task.priority {
            Priority::High   => self.high_tx.try_send(task),
            Priority::Normal => self.normal_tx.try_send(task),
            Priority::Low    => self.low_tx.try_send(task),
        };

        match result {
            Ok(()) => true,
            Err(TrySendError::Full(t)) => {
                // 队满丢弃 — 必须从 pending 集合中移除，否则该 photo_id 永远无法重新入队
                let mut p = self.pending.lock().unwrap();
                p.remove(&t.photo_id);
                tracing::debug!("Pipeline queue full, task dropped: {}", t.photo_id);
                false
            }
            Err(TrySendError::Disconnected(_)) => false,
        }
    }

    /// 批量入队（thumbnail_request IPC 调用）
    pub fn enqueue_batch(
        &self,
        photo_ids: &[String],
        priority:  Priority,
        db:        &crate::state::DbPool,
    ) {
        let conn = match db.get() {
            Ok(c)  => c,
            Err(e) => { tracing::error!("enqueue_batch: DB pool: {e}"); return; }
        };
        for id in photo_ids {
            if let Ok(Some(p)) = db::photo::get_by_id(&conn, id) {
                // 检查是否已有缩略图
                if p.thumbnail_s.is_some() && p.thumbnail_m.is_some() {
                    continue; // 已生成，跳过
                }
                self.enqueue(PipelineTask {
                    photo_id:   id.clone(),
                    file_path:  p.file_path,
                    file_hash:  p.file_hash,
                    priority,
                    need_large: false,
                });
            }
        }
    }

    /// 按优先级顺序取下一个任务（High → Normal → Low）
    fn recv_next(&self) -> Option<PipelineTask> {
        // 尝试三个通道，按优先级降序
        self.high_rx.try_recv()
            .or_else(|_| self.normal_rx.try_recv())
            .or_else(|_| self.low_rx.try_recv())
            .ok()
    }

    /// 任务完成后从 pending 集合中移除
    fn task_done(&self, photo_id: &str) {
        let mut p = self.pending.lock().unwrap();
        p.remove(photo_id);
    }

    /// F-13：阻塞等待任务，超时后返回 None
    ///
    /// 替代原来的 recv_next() + sleep(20ms) 忙等模式：
    ///   - 先按优先级 try_recv()（维持 High > Normal > Low 语义）
    ///   - 若三个通道均空，用 select! 真正阻塞线程，直到有任务到来或超时
    ///   - 线程在等待期间进入睡眠，不占 CPU（操作系统调度到真正有事件时才唤醒）
    ///
    /// timeout：建议 5s，足够覆盖"没有任何任务"的空闲窗口，
    /// 且保留定期唤醒能力（用于未来可能的健康检查、优雅退出等）。
    fn recv_blocking(&self, timeout: Duration) -> Option<PipelineTask> {
        // ① 优先非阻塞取高优先级（维持 High > Normal > Low 顺序）
        if let Ok(task) = self.high_rx.try_recv()   { return Some(task); }
        if let Ok(task) = self.normal_rx.try_recv() { return Some(task); }
        if let Ok(task) = self.low_rx.try_recv()    { return Some(task); }

        // ② 三通道均空 → select! 阻塞等待，直到任一通道有消息或超时
        //    注意：select! 不保证优先级（随机公平），但此时队列为空，
        //    优先级差异无意义；下次循环的 try_recv() 会恢复优先级语义
        crossbeam_channel::select! {
            recv(self.high_rx)   -> result => result.ok(),
            recv(self.normal_rx) -> result => result.ok(),
            recv(self.low_rx)    -> result => result.ok(),
            default(timeout)     => None,
        }
    }

    /// 队列中待处理任务总数（近似值）
    pub fn queue_len(&self) -> usize {
        self.high_rx.len() + self.normal_rx.len() + self.low_rx.len()
    }
}

// ─────────────────────────────────────────────────────────
//  Worker 启动（后台循环）
//
//  设计：单独 rayon 线程池，不占用 tokio 工作线程
// ─────────────────────────────────────────────────────────

/// 启动缩略图生成工作线程（应用启动时调用一次）
///
/// - `worker_count`：工作线程数（建议 min(cpu_count, 4)）
/// - 返回 `Arc<ThumbnailPipeline>`，调用方持有用于入队
pub fn start_workers(
    pipeline:   Arc<ThumbnailPipeline>,
    db:         crate::state::DbPool,
    thumb_dir:  PathBuf,
    cache:      SharedCache,
    sidecar:    Arc<Mutex<SidecarHandle>>,
    app:        AppHandle,
    worker_count: usize,
) {
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(worker_count)
        .thread_name(|i| format!("thumb-worker-{i}"))
        .build()
        .expect("Failed to build thumbnail thread pool");

    // 将 pool 移入后台 std::thread，pool 本身阻塞等待任务
    let pipeline_clone = Arc::clone(&pipeline);
    let db_clone = db.clone();
    let thumb_dir_c    = thumb_dir.clone();
    let cache_c        = Arc::clone(&cache);
    let sidecar_c      = Arc::clone(&sidecar);
    let app_c          = app.clone();

    std::thread::Builder::new()
        .name("thumb-dispatcher".into())
        .spawn(move || {
            tracing::info!("Thumbnail dispatcher started ({worker_count} workers)");

            loop {
                // F-13: recv_blocking() 替代 recv_next() + sleep(20ms) 忙等
                //   - 先 try_recv 三通道（保证 High > Normal > Low 优先级）
                //   - 均空时用 select! 真正阻塞，CPU 完全让出给其他线程
                //   - 5s 超时后循环继续（保留定期唤醒点）
                let task = match pipeline_clone.recv_blocking(Duration::from_secs(5)) {
                    Some(t) => t,
                    None    => continue,  // timeout，继续等待
                };

                let photo_id   = task.photo_id.clone();
                let db_t = db_clone.clone();
                let thumb_t    = thumb_dir_c.clone();
                let cache_t    = Arc::clone(&cache_c);
                let sidecar_t  = Arc::clone(&sidecar_c);
                let app_t      = app_c.clone();
                let pipeline_t = Arc::clone(&pipeline_clone);

                pool.spawn(move || {
                    if let Err(e) = process_task(&task, &db_t, &thumb_t, &cache_t, &sidecar_t, &app_t) {
                        tracing::warn!("Thumbnail task failed for {}: {e}", task.photo_id);
                    }
                    pipeline_t.task_done(&photo_id);
                });
            }
        })
        .expect("Failed to spawn thumb-dispatcher thread");
}

// ─────────────────────────────────────────────────────────
//  process_task — 单张图片缩略图生成
// ─────────────────────────────────────────────────────────

fn process_task(
    task:      &PipelineTask,
    db:        &crate::state::DbPool,
    thumb_dir: &PathBuf,
    cache:     &SharedCache,
    sidecar:   &Arc<Mutex<SidecarHandle>>,
    app:       &AppHandle,
) -> Result<()> {
    let source = std::path::Path::new(&task.file_path);

    // ── 构建输出路径 ──
    let _bucket   = thumbnail::ensure_bucket_dir(thumb_dir, &task.file_hash)?;
    let path_s    = thumbnail::thumb_path(thumb_dir, &task.file_hash, ThumbSize::S);
    let path_m    = thumbnail::thumb_path(thumb_dir, &task.file_hash, ThumbSize::M);
    let path_l    = thumbnail::thumb_path(thumb_dir, &task.file_hash, ThumbSize::L);

    // ── 检查缓存（已存在则更新 DB 后直接返回）──
    let s_exists = path_s.exists();
    let m_exists = path_m.exists();

    if s_exists && m_exists && !task.need_large {
        // 缩略图已在磁盘，只需确保 DB 记录同步
        update_db_thumbnails(db, &task.photo_id, &path_s, &path_m, None)?;
        return Ok(());
    }

    // ── 生成缩略图 ──
    let needs_sidecar = thumbnail::needs_sidecar(source);

    if needs_sidecar {
        // HEIC / RAW → Sharp sidecar
        let mut sizes   = vec![ThumbSize::S, ThumbSize::M];
        let mut outputs = vec![path_s.clone(), path_m.clone()];

        if task.need_large {
            sizes.push(ThumbSize::L);
            outputs.push(path_l.clone());
        }

        let mut sc = sidecar.lock().unwrap();
        let resp   = sc.request_thumbnails(source, &sizes, &outputs, WEBP_QUALITY)?;

        if !resp.ok {
            return Err(AppError::Sidecar(
                resp.error.unwrap_or_else(|| "Unknown sidecar error".into())
            ));
        }
    } else {
        // 常规格式 → image crate（一次解码，两次 resize）
        if !s_exists || !m_exists {
            let (bytes_s, bytes_m) = encoder::generate_thumbnails_pair(source, WEBP_QUALITY)?;
            std::fs::write(&path_s, bytes_s)?;
            std::fs::write(&path_m, bytes_m)?;
        }

        if task.need_large && !path_l.exists() {
            let bytes_l = encoder::generate_thumbnail(source, ThumbSize::L, WEBP_QUALITY)?;
            std::fs::write(&path_l, bytes_l)?;
        }
    }

    // ── 更新 DB ──
    // ✅ 修复 E0308（mismatched types Option<&PathBuf> vs Option<&Path>）：
    //    原代码 Some(&path_l) 类型为 Option<&PathBuf>，
    //    但 update_db_thumbnails 参数期望 Option<&std::path::Path>。
    //    修复：用 .as_path() 显式转换，并加类型标注消除歧义。
    let large_path: Option<&std::path::Path> = if task.need_large && path_l.exists() {
        Some(path_l.as_path())
    } else {
        None
    };
    update_db_thumbnails(db, &task.photo_id, &path_s, &path_m, large_path)?;

    // ── 更新缓存索引 ──
    {
        let mut c = cache.lock().unwrap();
        c.insert(&task.photo_id, ThumbSize::S.file_suffix(), path_s.clone());
        c.insert(&task.photo_id, ThumbSize::M.file_suffix(), path_m.clone());
    }

    // ── 发送 thumb:ready 事件 ──
    let _ = app.emit("thumb:ready", serde_json::json!({
        "photoId": task.photo_id,
        "size":    "s",
    }));
    let _ = app.emit("thumb:ready", serde_json::json!({
        "photoId": task.photo_id,
        "size":    "m",
    }));

    tracing::debug!("Thumbnail done: {}", task.photo_id);
    Ok(())
}

// ─────────────────────────────────────────────────────────
//  DB 更新
// ─────────────────────────────────────────────────────────

fn update_db_thumbnails(
    db:       &crate::state::DbPool,
    photo_id: &str,
    path_s:   &std::path::Path,
    path_m:   &std::path::Path,
    path_l:   Option<&std::path::Path>,
) -> Result<()> {
    let conn = db.get().map_err(|e| AppError::Other(format!("DB pool: {e}")))?;
    // ✅ 修复 E0515（cannot return value referencing temporary value）：
    //    原代码 path_l.map(|p| p.to_string_lossy().as_ref()).as_deref() 中，
    //    to_string_lossy() 返回 Cow<str>，.as_ref() 借用了该临时值，
    //    临时值在语句结束后被 drop，导致悬垂引用。
    //    修复：改用 .into_owned() 将 Cow 转为 String（拥有所有权），
    //    再 .as_deref() 得到 &str，生命周期由局部变量 path_l_str 控制，安全。
    let path_l_str: Option<String> = path_l.map(|p| p.to_string_lossy().into_owned());
    db::photo::update_thumbnails(
        &conn,
        photo_id,
        Some(path_s.to_string_lossy().as_ref()),
        Some(path_m.to_string_lossy().as_ref()),
        path_l_str.as_deref(),
    )?;
    Ok(())
}

// ─────────────────────────────────────────────────────────
//  批量补全扫描（扫描完成后触发）
// ─────────────────────────────────────────────────────────

/// 将所有未生成缩略图的照片加入 Low 优先级队列
pub fn enqueue_pending_all(
    pipeline:  &ThumbnailPipeline,
    db:        &crate::state::DbPool,
) {
    let conn = match db.get() {
        Ok(c)  => c,
        Err(e) => { tracing::error!("enqueue_pending_all: DB pool: {e}"); return; }
    };
    let mut stmt: rusqlite::Statement<'_> = match conn.prepare(
        "SELECT id, file_path, file_hash FROM photos \
         WHERE is_deleted = 0 \
           AND (thumbnail_s IS NULL OR thumbnail_m IS NULL) \
         ORDER BY imported_at DESC \
         LIMIT 5000"
    ) {
        Ok(s)  => s,
        Err(e) => { tracing::error!("Failed to prepare pending query: {e}"); return; }
    };

    let count = std::cell::Cell::new(0u64);

    let _ = stmt.query_map([], |row: &rusqlite::Row<'_>| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })
    .map(|rows: rusqlite::MappedRows<'_, _>| {
        for row in rows.flatten() {
            let (id, file_path, file_hash) = row;
            pipeline.enqueue(PipelineTask {
                photo_id:  id,
                file_path,
                file_hash,
                priority:  Priority::Low,
                need_large:false,
            });
            count.set(count.get() + 1);
        }
    });

    tracing::info!("Enqueued {} photos for thumbnail generation", count.get());
}
