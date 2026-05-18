// src-tauri/src/state.rs
//
// 应用全局状态
// Round-3：unsafe pipeline 指针已消除（pipeline: Mutex<Option<Arc<...>>>）
// Round-4（F-01）：Arc<Mutex<Connection>> → r2d2 连接池
// Round-5（F-03）：新增 watcher 字段 + start_watcher() 方法
//
// F-03 修复说明：
//   watcher.rs 实现了完整的 debounced 文件系统监听，但 AppState 从未
//   持有 watcher 字段，lib.rs setup 也从未调用 create_watcher()，
//   导致 watcher 模块完全是死代码：新增/删除照片后用户必须手动重扫。
//
//   修复：
//     1. 新增 pub watcher: Mutex<Option<FsWatcher>>
//     2. start_watcher(&self, app) 方法：
//        a. 从 DB 读取已有 watched_folders 并注册
//        b. 启动后台线程消费 mpsc::Receiver<Vec<FsChange>>
//        c. Created  → insert_batch + enqueue thumbnail (Low 优先级)
//        d. Modified → update_metadata + emit 事件
//        e. Removed  → mark_missing (软删)
//        f. 每批变化后 emit library:changed（携带路径数组，与前端类型对齐）
//     3. 暴露 register_watch / unregister_watch 供 scan.rs 命令动态更新

use crate::error::{AppError, Result};
use crate::db::{
    self,
    SqlitePhotoRepository, SqliteAlbumRepository,
    SqliteTagRepository, SqliteUndoRepository,
    PhotoRepository, AlbumRepository, TagRepository, UndoRepository,
};
use crate::scanner::watcher::{self as fs_watcher, FsWatcher};
use crate::thumbnail::{
    cache::{self, SharedCache},
    pipeline::{self, ThumbnailPipeline},
    sidecar::SidecarHandle,
};
use r2d2_sqlite::SqliteConnectionManager;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

// ─────────────────────────────────────────────────────────
//  公开类型别名
// ─────────────────────────────────────────────────────────

pub type DbPool = r2d2::Pool<SqliteConnectionManager>;
pub type DbConn = r2d2::PooledConnection<SqliteConnectionManager>;

// ─────────────────────────────────────────────────────────
//  per-connection PRAGMA 初始化器
// ─────────────────────────────────────────────────────────

#[derive(Debug)]
struct ConnCustomizer;

impl r2d2::CustomizeConnection<rusqlite::Connection, rusqlite::Error> for ConnCustomizer {
    fn on_acquire(&self, conn: &mut rusqlite::Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous  = NORMAL;
             PRAGMA mmap_size    = 268435456;
             PRAGMA cache_size   = -32000;
             PRAGMA temp_store   = MEMORY;
             PRAGMA busy_timeout = 5000;"
        )
    }
}

// ─────────────────────────────────────────────────────────
//  AppState
// ─────────────────────────────────────────────────────────

pub struct AppState {
    /// SQLite 连接池（Round-4 F-01）
    pub db: DbPool,

    /// 照片仓库
    pub photos: Arc<dyn PhotoRepository>,
    /// 相册仓库
    pub albums: Arc<dyn AlbumRepository>,
    /// 标签仓库
    pub tags:   Arc<dyn TagRepository>,
    /// Undo 仓库
    pub undo:   Arc<dyn UndoRepository>,

    /// 应用数据目录：%APPDATA%/LightAlbum/
    pub data_dir: PathBuf,

    /// 缩略图目录：%APPDATA%/LightAlbum/thumbnails/
    pub thumb_dir: PathBuf,

    /// 当前扫描状态
    pub scan_status: Arc<Mutex<ScanStatus>>,

    /// 缩略图生成调度器（Round-3 F-02：Mutex 内部可变性）
    pub pipeline: Mutex<Option<Arc<ThumbnailPipeline>>>,

    /// 磁盘缓存索引
    pub cache: SharedCache,

    /// Sharp sidecar 进程句柄
    pub sidecar: Arc<Mutex<SidecarHandle>>,

    /// 文件系统监听器（Round-5 F-03：原死代码，现接入）
    /// Mutex 保护，供 import_scan / folders_remove 命令动态注册/注销路径
    pub watcher: Mutex<Option<FsWatcher>>,
}

impl AppState {
    pub fn new() -> Result<Self> {
        let data_dir = dirs_next::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("LightAlbum");

        let thumb_dir = data_dir.join("thumbnails");
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(&thumb_dir)?;

        let db_path = data_dir.join("library.db");
        tracing::info!("Database: {}", db_path.display());

        let manager = SqliteConnectionManager::file(&db_path);
        let pool = r2d2::Pool::builder()
            .max_size(5)
            .connection_timeout(std::time::Duration::from_secs(10))
            .connection_customizer(Box::new(ConnCustomizer))
            .build(manager)
            .map_err(|e| AppError::Other(format!("Failed to create DB pool: {e}")))?;

        let db_arc = Arc::new(pool.clone());
        let photos: Arc<dyn PhotoRepository> = Arc::new(SqlitePhotoRepository::new(Arc::clone(&db_arc)));
        let albums: Arc<dyn AlbumRepository> = Arc::new(SqliteAlbumRepository::new(Arc::clone(&db_arc)));
        let tags:   Arc<dyn TagRepository>   = Arc::new(SqliteTagRepository::new(Arc::clone(&db_arc)));
        let undo:   Arc<dyn UndoRepository>  = Arc::new(SqliteUndoRepository::new(Arc::clone(&db_arc)));

        let cache   = cache::new_shared(thumb_dir.clone(), cache::DEFAULT_MAX_BYTES);
        let sidecar = Arc::new(Mutex::new(SidecarHandle::new(data_dir.clone())));

        Ok(Self {
            db: pool,
            photos,
            albums,
            tags,
            undo,
            data_dir,
            thumb_dir,
            scan_status: Arc::new(Mutex::new(ScanStatus::default())),
            pipeline:    Mutex::new(None),
            cache,
            sidecar,
            watcher:     Mutex::new(None),
        })
    }

    pub fn conn(&self) -> Result<DbConn> {
        self.db.get().map_err(|e| AppError::Other(format!("DB pool error: {e}")))
    }

    pub fn init_db(&self) -> Result<()> {
        let conn = self.conn()?;
        db::schema::run_migrations(&conn, &self.data_dir.join("library.db"))?;
        Ok(())
    }

    /// 启动缩略图工作线程池（Round-3 F-02：&self 签名）
    pub fn start_pipeline(&self, app: tauri::AppHandle) {
        let worker_count = (num_cpus() / 2).clamp(1, 4);
        let pipeline     = Arc::new(ThumbnailPipeline::new());
        let p_clone      = Arc::clone(&pipeline);

        pipeline::start_workers(
            p_clone,
            self.db.clone(),
            self.thumb_dir.clone(),
            Arc::clone(&self.cache),
            Arc::clone(&self.sidecar),
            app,
            worker_count,
        );

        *self.pipeline.lock().unwrap() = Some(pipeline);
        tracing::info!("Thumbnail pipeline started ({worker_count} workers)");
    }

    pub fn enqueue_pending(&self) {
        let lock = self.pipeline.lock().unwrap();
        if let Some(ref p) = *lock {
            pipeline::enqueue_pending_all(p, &self.db);
        }
    }

    // ─────────────────────────────────────────────────────
    //  F-03：文件系统监听器启动
    // ─────────────────────────────────────────────────────

    /// 启动文件系统监听器，为所有已注册文件夹开始实时监听
    ///
    /// 调用时机：lib.rs setup，在 start_pipeline 之后。
    /// 注意：watcher（Debouncer）必须保持存活，存入 self.watcher。
    pub fn start_watcher(&self, app: tauri::AppHandle) {
        // 1. 读取已有 watched_folders（启动时恢复监听）
        let folders: Vec<String> = self.conn()
            .and_then(|conn: DbConn| {
                let mut stmt = conn.prepare("SELECT path FROM watched_folders")?;
                let paths = stmt.query_map([], |row: &rusqlite::Row<'_>| row.get::<_, String>(0))?
                    .filter_map(|r: rusqlite::Result<String>| r.ok())
                    .collect();
                Ok(paths)
            })
            .unwrap_or_default();

        // 2. 创建 debounced watcher（500ms 合并窗口）
        let (mut watcher, rx) = match fs_watcher::create_watcher(500) {
            Ok(pair) => pair,
            Err(e) => {
                tracing::error!("Failed to create filesystem watcher: {e}");
                return;
            }
        };

        // 3. 为每个已有文件夹注册监听
        for folder in &folders {
            let path = PathBuf::from(folder);
            if path.exists() {
                if let Err(e) = fs_watcher::watch_folder(&mut watcher, &path) {
                    tracing::warn!("Failed to watch folder {folder}: {e}");
                }
            }
        }

        // 4. 保存 watcher（必须在 spawn 前，确保其存活时间覆盖整个 app 生命周期）
        *self.watcher.lock().unwrap() = Some(watcher);

        // 5. 克隆后台线程所需的句柄
        let db           = self.db.clone();
        let pipeline_opt = self.pipeline.lock().unwrap().clone();

        // 6. 后台线程：消费 FsChange 事件 → 更新 DB → 入队缩略图 → 通知前端
        std::thread::spawn(move || {
            handle_watch_events(rx, db, pipeline_opt, app);
        });

        tracing::info!("Filesystem watcher started for {} folder(s)", folders.len());
    }

    /// 动态注册新文件夹（import_scan 成功后调用）
    pub fn register_watch(&self, path: &PathBuf) {
        let mut lock = self.watcher.lock().unwrap();
        if let Some(ref mut watcher) = *lock {
            if let Err(e) = fs_watcher::watch_folder(watcher, path) {
                tracing::warn!("Failed to register watcher for {:?}: {e}", path);
            } else {
                tracing::info!("Watcher registered: {:?}", path);
            }
        }
    }

    /// 动态注销文件夹（folders_remove 调用）
    pub fn unregister_watch(&self, path: &PathBuf) {
        let mut lock = self.watcher.lock().unwrap();
        if let Some(ref mut watcher) = *lock {
            if let Err(e) = fs_watcher::unwatch_folder(watcher, path) {
                tracing::warn!("Failed to unregister watcher for {:?}: {e}", path);
            } else {
                tracing::info!("Watcher unregistered: {:?}", path);
            }
        }
    }

    pub fn load_settings(&self) -> AppSettings {
        let path = self.data_dir.join("settings.json");
        if path.exists() {
            if let Ok(raw) = std::fs::read_to_string(&path) {
                if let Ok(s) = serde_json::from_str(&raw) {
                    return s;
                }
            }
            tracing::warn!("Failed to parse settings.json, using defaults");
        }
        AppSettings::default()
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<()> {
        let path = self.data_dir.join("settings.json");
        let raw  = serde_json::to_string_pretty(settings)?;
        std::fs::write(&path, raw)?;
        Ok(())
    }
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
}

// ─────────────────────────────────────────────────────────
//  F-03：watcher 事件处理循环
// ─────────────────────────────────────────────────────────

/// 后台线程：阻塞等待 FsChange 事件，处理后通知前端
///
/// 事件处理策略：
///   Created  → EXIF 提取 → insert_batch → enqueue thumbnail (Low)
///   Modified → update_metadata（仅元数据，不重生成缩略图）
///   Removed  → mark_missing（软删）
///
/// 每批次处理完毕统一发送一次 library:changed，避免事件风暴。
/// payload 携带路径数组（与前端 LibraryChangedPayload 类型对齐）。
fn handle_watch_events(
    rx:       std::sync::mpsc::Receiver<Vec<crate::scanner::watcher::FsChange>>,
    db:       DbPool,
    pipeline: Option<Arc<ThumbnailPipeline>>,
    app:      tauri::AppHandle,
) {
    use crate::db::photo as photo_db;
    use crate::metadata::{exif as exif_meta, hasher};
    use crate::scanner::watcher::FsChange;
    use crate::thumbnail::pipeline::{Priority, PipelineTask};
    use tauri::Emitter;

    for changes in &rx {
        let mut added_paths:    Vec<String> = Vec::new();
        let mut modified_paths: Vec<String> = Vec::new();
        let mut removed_paths:  Vec<String> = Vec::new();

        for change in changes {
            match change {
                // ── 新文件：插入 DB + 入队缩略图 ──
                FsChange::Created(path) => {
                    let file_path = path.to_string_lossy().to_string();

                    // 通过 DB 查找该文件所属的 watched_folder
                    let folder_path = match find_folder_for_path(&db, &path) {
                        Some(fp) => fp,
                        None => {
                            tracing::debug!("Watcher: no folder found for {file_path}, skipping");
                            continue;
                        }
                    };

                    // 文件元数据
                    let file_size = std::fs::metadata(&path)
                        .map(|m| m.len() as i64)
                        .unwrap_or(0);
                    let modified_at = std::fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .map(|t| {
                            let dt: chrono::DateTime<chrono::Utc> = t.into();
                            dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
                        })
                        .unwrap_or_else(|_| {
                            chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
                        });

                    // EXIF 提取（同步，此处已在独立线程中）
                    let mut exif = exif_meta::extract(&path).unwrap_or_default();
                    exif_meta::enrich_dimensions(&mut exif, &path);

                    let hash = hasher::hash_file(&path).unwrap_or_else(|_| {
                        uuid::Uuid::new_v4().to_string()
                    });
                    let ext = path.extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("unknown");
                    let created_at = exif.created_at.unwrap_or_else(|| modified_at.clone());
                    let file_name  = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();

                    let new_photo = photo_db::NewPhoto {
                        file_path:    file_path.clone(),
                        file_name,
                        file_size,
                        file_hash:    hash.clone(),
                        width:        exif.width.unwrap_or(0) as i32,
                        height:       exif.height.unwrap_or(0) as i32,
                        orientation:  exif.orientation,
                        format:       exif_meta::normalize_format(ext).to_string(),
                        created_at,
                        modified_at,
                        folder_path,
                        gps_lat:      exif.gps_lat,
                        gps_lng:      exif.gps_lng,
                        camera_make:  exif.camera_make,
                        camera_model: exif.camera_model,
                        lens_model:   exif.lens_model,
                        focal_length: exif.focal_length,
                        aperture:     exif.aperture,
                        shutter_speed:exif.shutter_speed,
                        iso:          exif.iso,
                        exposure_comp:exif.exposure_comp,
                    };

                    let conn = match db.get() {
                        Ok(c)  => c,
                        Err(e) => {
                            tracing::error!("Watcher: DB pool error (Created): {e}");
                            continue;
                        }
                    };
                    match photo_db::insert_batch(&conn, &[new_photo]) {
                        Ok(n) if n > 0 => {
                            added_paths.push(file_path.clone());
                            tracing::info!("Watcher: new photo indexed — {file_path}");

                            // 查询刚插入的 photo_id，入队缩略图生成
                            if let Some(ref p) = pipeline {
                                if let Ok(Some(photo)) = photo_db::get_by_path(&conn, &file_path) {
                                    p.enqueue(PipelineTask {
                                        photo_id:  photo.id,
                                        file_path: file_path.clone(),
                                        file_hash: hash,
                                        priority:  Priority::Low,
                                        need_large: false,
                                    });
                                }
                            }
                        }
                        Ok(_) => {
                            // INSERT OR IGNORE 跳过（文件已索引）
                            tracing::debug!("Watcher: file already indexed — {file_path}");
                        }
                        Err(e) => {
                            tracing::error!("Watcher: insert failed for {file_path}: {e}");
                        }
                    }
                }

                // ── 文件修改：更新元数据 ──
                FsChange::Modified(path) => {
                    let file_path = path.to_string_lossy().to_string();
                    let conn = match db.get() {
                        Ok(c)  => c,
                        Err(e) => {
                            tracing::error!("Watcher: DB pool error (Modified): {e}");
                            continue;
                        }
                    };

                    // 只处理已索引的文件
                    if let Ok(Some(photo)) = photo_db::get_by_path(&conn, &file_path) {
                        let file_size = std::fs::metadata(&path)
                            .map(|m| m.len() as i64)
                            .unwrap_or(photo.file_size);
                        let modified_at = std::fs::metadata(&path)
                            .and_then(|m| m.modified())
                            .map(|t| {
                                let dt: chrono::DateTime<chrono::Utc> = t.into();
                                dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
                            })
                            .unwrap_or(photo.modified_at.clone());

                        // 仅当 mtime 或 size 有变化时才重新提取 EXIF
                        if modified_at != photo.modified_at || file_size != photo.file_size {
                            let mut exif = exif_meta::extract(&path).unwrap_or_default();
                            exif_meta::enrich_dimensions(&mut exif, &path);
                            let hash = hasher::hash_file(&path).unwrap_or(photo.file_hash.clone());
                            let ext  = path.extension().and_then(|e| e.to_str()).unwrap_or("unknown");

                            let updated = photo_db::NewPhoto {
                                file_path:    file_path.clone(),
                                file_name:    photo.file_name.clone(),
                                file_size,
                                file_hash:    hash,
                                width:        exif.width.unwrap_or(photo.width as u32) as i32,
                                height:       exif.height.unwrap_or(photo.height as u32) as i32,
                                orientation:  exif.orientation,
                                format:       exif_meta::normalize_format(ext).to_string(),
                                created_at:   exif.created_at.unwrap_or(photo.created_at),
                                modified_at,
                                folder_path:  photo.folder_path,
                                gps_lat:      exif.gps_lat.or(photo.gps_lat),
                                gps_lng:      exif.gps_lng.or(photo.gps_lng),
                                camera_make:  exif.camera_make.or(photo.camera_make),
                                camera_model: exif.camera_model.or(photo.camera_model),
                                lens_model:   exif.lens_model.or(photo.lens_model),
                                focal_length: exif.focal_length.or(photo.focal_length),
                                aperture:     exif.aperture.or(photo.aperture),
                                shutter_speed:exif.shutter_speed.or(photo.shutter_speed),
                                iso:          exif.iso.or(photo.iso),
                                exposure_comp:exif.exposure_comp.or(photo.exposure_comp),
                            };

                            if photo_db::update_metadata(&conn, &file_path, &updated)
                                .unwrap_or(false)
                            {
                                modified_paths.push(file_path.clone());
                                tracing::info!("Watcher: metadata updated — {file_path}");
                            }
                        }
                    }
                }

                // ── 文件删除：软删 ──
                FsChange::Removed(path) => {
                    let file_path = path.to_string_lossy().to_string();
                    let conn = match db.get() {
                        Ok(c)  => c,
                        Err(e) => {
                            tracing::error!("Watcher: DB pool error (Removed): {e}");
                            continue;
                        }
                    };
                    if let Ok(()) = photo_db::mark_missing(&conn, &file_path) {
                        removed_paths.push(file_path.clone());
                        tracing::info!("Watcher: file removed — {file_path}");
                    }
                }
            }
        }

        // ── 批次结束：一次性通知前端刷新（避免多次 invalidate）──
        if !added_paths.is_empty()
            || !modified_paths.is_empty()
            || !removed_paths.is_empty()
        {
            let _ = app.emit(
                "library:changed",
                serde_json::json!({
                    "added":    added_paths,
                    "modified": modified_paths,
                    "removed":  removed_paths,
                }),
            );
        }
    }

    tracing::info!("Filesystem watcher event loop exited");
}

// ─────────────────────────────────────────────────────────
//  工具：查找文件所属 watched_folder
// ─────────────────────────────────────────────────────────

/// 从 DB watched_folders 中找到匹配文件路径的最长前缀文件夹
///
/// 例：watched_folders = ["/photos", "/photos/vacation"]
///     path = "/photos/vacation/img.jpg" → "/photos/vacation"（最长匹配）
fn find_folder_for_path(db: &DbPool, path: &PathBuf) -> Option<String> {
    let file_path = path.to_string_lossy().to_string();
    // 统一路径分隔符（Windows 兼容）
    let file_path_norm = file_path.replace('\\', "/");

    let conn = db.get().ok()?;
    let mut stmt = conn.prepare("SELECT path FROM watched_folders").ok()?;
    let folders: Vec<String> = stmt
        .query_map([], |row: &rusqlite::Row<'_>| row.get::<_, String>(0))
        .ok()?
        .filter_map(|r: rusqlite::Result<String>| r.ok())
        .collect();

    // 找最长匹配前缀（处理嵌套监听文件夹场景）
    folders
        .into_iter()
        .filter(|folder: &String| {
            let folder_norm = folder.replace('\\', "/");
            file_path_norm.starts_with(&folder_norm)
        })
        .max_by_key(|folder: &String| folder.len())
}

// ─────────────────────────────────────────────────────────
//  ScanStatus / AppSettings（不变）
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub is_scanning: bool,
    pub total:       u64,
    pub done:        u64,
    pub new_photos:  u64,
    pub progress:    Option<serde_json::Value>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme:                   String,
    pub grid_density:            u32,
    pub sort_by:                 String,
    pub sort_asc:                bool,
    pub watched_folders:         Vec<String>,
    pub sidebar_width:           u32,
    pub auto_hide_preview_ui:    bool,
    pub preview_on_double_click: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme:                   "system".into(),
            grid_density:            2,
            sort_by:                 "created_at".into(),
            sort_asc:                false,
            watched_folders:         vec![],
            sidebar_width:           220,
            auto_hide_preview_ui:    true,
            preview_on_double_click: false,
        }
    }
}
