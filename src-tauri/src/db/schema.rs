// src-tauri/src/db/schema.rs
//
// 数据库 Schema 迁移管理
// Round-6（F-14）：V2 ALTER TABLE 改为幂等执行
// Phase-B（V4）：新增 tags / photo_tags 表（M-12 标签系统）
// Phase-C（V5）：search_text 列 + 触发器 + 索引（搜索增强）
//
// 问题根因（F-14）：
//   SCHEMA_V2 包含裸 ALTER TABLE ADD COLUMN，SQLite 不支持 IF NOT EXISTS。
//   若 V2 迁移部分执行成功（如第一列添加后崩溃），再次启动时：
//     - user_version 仍为 1（事务未提交）→ 重新执行 V2
//     - orientation 列已存在 → "duplicate column name: orientation" → 崩溃
//     - 数据库进入无法恢复状态
//   column_exists() 辅助函数已定义且有实现，但被标记 #[allow(dead_code)]
//   且从未在迁移中调用——fix 即是把它用起来。
//
// 修复方案：
//   在 SCHEMA_V2 执行前，对每列单独检查 column_exists()，
//   仅在列不存在时才执行对应 ALTER TABLE。
//   每次 ALTER 都在独立 execute_batch 中，失败不影响其他列。
//   user_version 更新保持在所有列处理完毕后统一执行（事务语义）。
//
// V3 新增（私密相册）：
//   albums 表新增两列：
//     is_private    INTEGER NOT NULL DEFAULT 0
//     password_hash TEXT
//   使用相同的幂等迁移策略（column_exists 检查后按需 ALTER）。
//
// Phase-A（DB_API_Design §9.4：启动时数据库备份）：
//   run_migrations 新增 db_path 参数，在检测到需要执行迁移（version < LATEST）
//   时先备份当前数据库文件为 lightalbum.db.bak.{version}，再执行迁移。
//   - 首次创建（version == 0）：跳过备份（无文件可备份）
//   - 已有数据库需要升级：备份 → 迁移，确保迁移失败可手动恢复
//   - 已是最新版本：跳过备份（无需迁移，不产生备份文件）
//   备份失败不阻断迁移（仅 warn 日志），避免因磁盘写入权限问题导致应用无法启动。

use crate::error::Result;
use rusqlite::Connection;
use std::path::Path;

/// 当前最新 schema 版本号。迁移备份逻辑使用此常量判断是否需要备份，
/// 新增迁移版本时只需更新此处，无需修改 run_migrations 中的判断条件。
const LATEST_VERSION: i32 = 5;

/// 应用启动时调用，确保数据库 Schema 是最新状态
///
/// Phase-A：新增 `db_path` 参数，用于在迁移前创建备份文件。
/// 调用方（state.rs init_db）已知晓数据库路径，将其传入即可。
pub fn run_migrations(conn: &Connection, db_path: &Path) -> Result<()> {
    // 基础 PRAGMA（在任何操作前设置，r2d2 ConnCustomizer 已处理，此处幂等）
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch("PRAGMA synchronous = NORMAL;")?;
    conn.execute_batch("PRAGMA mmap_size = 268435456;")?;
    conn.execute_batch("PRAGMA cache_size = -32000;")?;
    conn.execute_batch("PRAGMA temp_store = MEMORY;")?;
    conn.execute_batch("PRAGMA busy_timeout = 5000;")?;

    let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    // Phase-A：当且仅当需要迁移时（version < LATEST_VERSION 且数据库文件已存在）执行备份
    // version == 0 + 文件不存在 = 全新数据库，无需备份
    // version > 0 + 需迁移     = 备份当前版本，防止迁移故障导致数据丢失
    if version > 0 && version < LATEST_VERSION {
        let bak_path = db_path.with_extension(format!("db.bak.{version}"));
        match std::fs::copy(db_path, &bak_path) {
            Ok(_) => tracing::info!(
                "DB backup created: {} (current version: {version})",
                bak_path.display()
            ),
            Err(e) => tracing::warn!("DB backup failed (non-fatal): {} — {e}", bak_path.display()),
        }
    }

    if version < 1 {
        tracing::info!("Applying DB migration v1: initial schema");
        conn.execute_batch(SCHEMA_V1)?;
        conn.execute_batch("PRAGMA user_version = 1;")?;
        tracing::info!("Migration v1 applied successfully");
    }

    if version < 2 {
        tracing::info!("Applying DB migration v2: orientation + lens_model + exposure_comp");
        apply_v2_idempotent(conn)?;
        conn.execute_batch("PRAGMA user_version = 2;")?;
        tracing::info!("Migration v2 applied successfully");
    }

    // V3：私密相册（is_private + password_hash）
    if version < 3 {
        tracing::info!("Applying DB migration v3: private album support");
        apply_v3_idempotent(conn)?;
        conn.execute_batch("PRAGMA user_version = 3;")?;
        tracing::info!("Migration v3 applied successfully");
    }

    // V4：标签系统（tags + photo_tags 表，M-12）
    // CREATE TABLE IF NOT EXISTS 确保幂等，无需逐列检查
    if version < 4 {
        tracing::info!("Applying DB migration v4: tags system");
        conn.execute_batch(SCHEMA_V4)?;
        conn.execute_batch("PRAGMA user_version = 4;")?;
        tracing::info!("Migration v4 applied successfully");
    }

    // V5：search_text 列 + 触发器 + 索引（Phase-C 搜索增强）
    // SQLite 不允许通过 ALTER TABLE 添加 GENERATED ALWAYS AS 列，
    // 改用普通 TEXT 列 + INSERT/UPDATE 触发器维护，效果等价。
    if version < 5 {
        tracing::info!("Applying DB migration v5: search_text column + index");
        apply_v5_search_text(conn)?;
        conn.execute_batch("PRAGMA user_version = 5;")?;
        tracing::info!("Migration v5 applied successfully");
    }

    tracing::info!("Database schema is up to date (version {})", {
        conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))?
    });

    Ok(())
}

// ─────────────────────────────────────────────────────────
//  F-14: V2 幂等迁移
// ─────────────────────────────────────────────────────────

/// 逐列检查并按需添加 V2 字段，保证任意执行次数结果一致
///
/// 为什么按列而非整体执行 SCHEMA_V2：
///   SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS，
///   整体执行在列已存在时会抛 "duplicate column name" 错误。
///   逐列检查 + 按需 ALTER 是目前最健壮的做法。
fn apply_v2_idempotent(conn: &Connection) -> Result<()> {
    /// 每个要添加的列的描述
    struct Col<'a> {
        name: &'a str,
        ddl: &'a str, // 完整 ALTER TABLE 语句
    }

    let cols = [
        Col {
            name: "orientation",
            ddl: "ALTER TABLE photos ADD COLUMN orientation INTEGER NOT NULL DEFAULT 1;",
        },
        Col {
            name: "lens_model",
            ddl: "ALTER TABLE photos ADD COLUMN lens_model TEXT;",
        },
        Col {
            name: "exposure_comp",
            ddl: "ALTER TABLE photos ADD COLUMN exposure_comp REAL;",
        },
    ];

    for col in &cols {
        if !column_exists(conn, "photos", col.name)? {
            tracing::debug!("Adding column photos.{}", col.name);
            conn.execute_batch(col.ddl)?;
        } else {
            tracing::debug!("Column photos.{} already exists, skipping", col.name);
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────
//  V3 幂等迁移：私密相册列
// ─────────────────────────────────────────────────────────

/// 逐列检查并按需添加 V3 字段（与 V2 策略完全一致）
fn apply_v3_idempotent(conn: &Connection) -> Result<()> {
    struct Col<'a> {
        name: &'a str,
        ddl: &'a str,
    }

    let cols = [
        Col {
            name: "is_private",
            ddl: "ALTER TABLE albums ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;",
        },
        Col {
            name: "password_hash",
            ddl: "ALTER TABLE albums ADD COLUMN password_hash TEXT;",
        },
    ];

    for col in &cols {
        if !column_exists(conn, "albums", col.name)? {
            tracing::debug!("Adding column albums.{}", col.name);
            conn.execute_batch(col.ddl)?;
        } else {
            tracing::debug!("Column albums.{} already exists, skipping", col.name);
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────
//  V1 Schema（不变）
// ─────────────────────────────────────────────────────────

const SCHEMA_V1: &str = r#"
-- ===== photos 主表 =====
CREATE TABLE IF NOT EXISTS photos (
    id              TEXT    PRIMARY KEY,
    file_path       TEXT    NOT NULL UNIQUE,
    file_name       TEXT    NOT NULL,
    file_size       INTEGER NOT NULL,
    file_hash       TEXT    NOT NULL,
    format          TEXT    NOT NULL,
    width           INTEGER NOT NULL DEFAULT 0,
    height          INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL,
    modified_at     TEXT    NOT NULL,
    imported_at     TEXT    NOT NULL
                    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    folder_path     TEXT    NOT NULL,
    gps_lat         REAL,
    gps_lng         REAL,
    camera_make     TEXT,
    camera_model    TEXT,
    focal_length    REAL,
    aperture        REAL,
    shutter_speed   TEXT,
    iso             INTEGER,
    is_favorite     INTEGER NOT NULL DEFAULT 0,
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    deleted_at      TEXT,
    rating          INTEGER NOT NULL DEFAULT 0,
    thumbnail_s     TEXT,
    thumbnail_m     TEXT,
    thumbnail_l     TEXT
);

-- ===== albums 相册表 =====
CREATE TABLE IF NOT EXISTS albums (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL,
    description     TEXT,
    cover_photo_id  TEXT    REFERENCES photos(id) ON DELETE SET NULL,
    created_at      TEXT    NOT NULL
                    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT    NOT NULL
                    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    photo_count     INTEGER NOT NULL DEFAULT 0
);

-- ===== album_photos 相册-照片关联表 =====
CREATE TABLE IF NOT EXISTS album_photos (
    album_id        TEXT    NOT NULL REFERENCES albums(id)  ON DELETE CASCADE,
    photo_id        TEXT    NOT NULL REFERENCES photos(id)  ON DELETE CASCADE,
    added_at        TEXT    NOT NULL
                    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (album_id, photo_id)
);

-- ===== watched_folders 监听文件夹表 =====
CREATE TABLE IF NOT EXISTS watched_folders (
    path            TEXT    PRIMARY KEY,
    added_at        TEXT    NOT NULL
                    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_scan_at    TEXT,
    photo_count     INTEGER NOT NULL DEFAULT 0
);

-- ===== undo_log 撤销历史表 =====
CREATE TABLE IF NOT EXISTS undo_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    action          TEXT    NOT NULL,
    payload         TEXT    NOT NULL,
    created_at      TEXT    NOT NULL
                    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ===== 核心索引 =====
CREATE INDEX IF NOT EXISTS idx_photos_created    ON photos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_imported   ON photos(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_file_name  ON photos(file_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_photos_file_size  ON photos(file_size DESC);
CREATE INDEX IF NOT EXISTS idx_photos_folder     ON photos(folder_path);
CREATE INDEX IF NOT EXISTS idx_photos_favorite   ON photos(is_favorite) WHERE is_favorite = 1;
CREATE INDEX IF NOT EXISTS idx_photos_not_deleted ON photos(is_deleted) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_photos_hash       ON photos(file_hash);
CREATE INDEX IF NOT EXISTS idx_photos_format     ON photos(format);
CREATE INDEX IF NOT EXISTS idx_album_photos_album ON album_photos(album_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_album_photos_photo ON album_photos(photo_id);
CREATE INDEX IF NOT EXISTS idx_undo_created      ON undo_log(created_at DESC);

-- ===== 触发器：维护 albums.photo_count =====
CREATE TRIGGER IF NOT EXISTS trg_album_photos_insert
AFTER INSERT ON album_photos
BEGIN
    UPDATE albums
    SET photo_count = photo_count + 1,
        updated_at  = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = NEW.album_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_album_photos_delete
AFTER DELETE ON album_photos
BEGIN
    UPDATE albums
    SET photo_count = MAX(0, photo_count - 1),
        updated_at  = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = OLD.album_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_photos_delete_cover
AFTER UPDATE OF is_deleted ON photos
WHEN NEW.is_deleted = 1
BEGIN
    UPDATE albums
    SET cover_photo_id = NULL
    WHERE cover_photo_id = NEW.id;
END;
"#;

// ─────────────────────────────────────────────────────────
//  V4 Schema：标签系统（M-12）
// ─────────────────────────────────────────────────────────

/// 全部使用 CREATE TABLE IF NOT EXISTS，天然幂等，无需逐列检查
const SCHEMA_V4: &str = r#"
-- ===== tags 标签主表 =====
CREATE TABLE IF NOT EXISTS tags (
    id          TEXT    PRIMARY KEY,           -- UUID v4
    name        TEXT    NOT NULL UNIQUE        -- 标签名（大小写不敏感唯一）
                COLLATE NOCASE,
    color       TEXT    NOT NULL               -- HEX 色值，如 '#007AFF'
                DEFAULT '#007AFF',
    created_at  TEXT    NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    sort_order  INTEGER NOT NULL DEFAULT 0,    -- 自定义排序
    usage_count INTEGER NOT NULL DEFAULT 0     -- 使用次数缓存（触发器维护）
);

-- ===== photo_tags 照片-标签关联表 =====
CREATE TABLE IF NOT EXISTS photo_tags (
    photo_id    TEXT    NOT NULL
                REFERENCES photos(id) ON DELETE CASCADE,
    tag_id      TEXT    NOT NULL
                REFERENCES tags(id)   ON DELETE CASCADE,
    tagged_at   TEXT    NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    source      TEXT    NOT NULL DEFAULT 'manual',  -- 'manual' | 'auto_ai' | 'auto_exif'
    PRIMARY KEY (photo_id, tag_id)
);

-- ===== 索引 =====
CREATE INDEX IF NOT EXISTS idx_photo_tags_photo ON photo_tags(photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_tags_tag   ON photo_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_tags_name        ON tags(name COLLATE NOCASE);

-- ===== 触发器：维护 tags.usage_count =====
CREATE TRIGGER IF NOT EXISTS trg_photo_tags_insert
AFTER INSERT ON photo_tags
BEGIN
    UPDATE tags SET usage_count = usage_count + 1 WHERE id = NEW.tag_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_photo_tags_delete
AFTER DELETE ON photo_tags
BEGIN
    UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id = OLD.tag_id;
END;
"#;

// ─────────────────────────────────────────────────────────
//  V5：search_text 列 + 触发器 + 索引（Phase-C 搜索增强）
// ─────────────────────────────────────────────────────────

/// 幂等地添加 search_text 列、填充存量数据、建触发器和索引
///
/// 设计说明：
///   DB_API_Design §3.1 要求 search_text 为 GENERATED ALWAYS AS 列，
///   但 SQLite 不支持对已有表 ALTER TABLE ADD COLUMN 添加 GENERATED 列。
///   替代方案：普通 TEXT 列 + INSERT/UPDATE 触发器，行为完全等价：
///     trg_search_text_insert  — 新增照片时自动填充
///     trg_search_text_update  — file_name/camera_make/camera_model 变化时更新
///   存量数据通过一次性 UPDATE 补填（仅在列首次被添加时执行）。
fn apply_v5_search_text(conn: &Connection) -> Result<()> {
    // 1. 按需添加列（幂等）
    if !column_exists(conn, "photos", "search_text")? {
        tracing::debug!("Adding column photos.search_text");
        conn.execute_batch("ALTER TABLE photos ADD COLUMN search_text TEXT;")?;

        // 2. 存量照片补填（仅在首次创建列时执行，之后触发器负责维护）
        conn.execute_batch(
            r#"
            UPDATE photos SET search_text =
                COALESCE(file_name, '') || ' ' ||
                COALESCE(camera_model, '') || ' ' ||
                COALESCE(camera_make, '');
        "#,
        )?;
        tracing::debug!("Backfilled search_text for existing photos");
    } else {
        tracing::debug!("Column photos.search_text already exists, skipping ADD COLUMN");
    }

    // 3. 索引（幂等 — IF NOT EXISTS）
    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_photos_search_text
            ON photos(search_text COLLATE NOCASE);
    "#,
    )?;

    // 4. INSERT 触发器（幂等）
    conn.execute_batch(
        r#"
        CREATE TRIGGER IF NOT EXISTS trg_search_text_insert
        AFTER INSERT ON photos
        BEGIN
            UPDATE photos SET search_text =
                COALESCE(NEW.file_name, '') || ' ' ||
                COALESCE(NEW.camera_model, '') || ' ' ||
                COALESCE(NEW.camera_make, '')
            WHERE id = NEW.id;
        END;
    "#,
    )?;

    // 5. UPDATE 触发器（仅在影响字段变更时触发，避免无谓写入）
    conn.execute_batch(
        r#"
        CREATE TRIGGER IF NOT EXISTS trg_search_text_update
        AFTER UPDATE OF file_name, camera_make, camera_model ON photos
        BEGIN
            UPDATE photos SET search_text =
                COALESCE(NEW.file_name, '') || ' ' ||
                COALESCE(NEW.camera_model, '') || ' ' ||
                COALESCE(NEW.camera_make, '')
            WHERE id = NEW.id;
        END;
    "#,
    )?;

    tracing::info!("V5 search_text migration complete");
    Ok(())
}

// ─────────────────────────────────────────────────────────
//  辅助：判断列是否已存在（F-14 核心工具，不再 dead_code）
// ─────────────────────────────────────────────────────────

pub fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        rusqlite::params![table, column],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}
