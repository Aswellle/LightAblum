# LightAblum 全面代码审查与重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除全部已知 bug、完成 Rust Repository trait 架构解耦、前端 Hook 两层分离与类型安全清理、Locale 字符串集中化、开源社区文件补全、GitHub Actions CI/CD 接入。

**Architecture:** 三轨并行（Track A: Rust 后端 / Track B: 前端 React+TS / Track C: 横切面），Track A 和 B 只读 `src/types/ipc.ts` 不修改，三轨无共享文件冲突，可并发执行后合并。

**Tech Stack:** Tauri v2, Rust (rusqlite + r2d2 + rayon), React 19, TypeScript, Zustand v5, TanStack Query v5, Vitest, Playwright, GitHub Actions

---

## 文件变更总表

### Track A — 新建
- `src-tauri/src/db/repositories/mod.rs`
- `src-tauri/src/db/repositories/photo.rs`
- `src-tauri/src/db/repositories/album.rs`
- `src-tauri/src/db/repositories/tag.rs`
- `src-tauri/src/db/repositories/undo.rs`
- `tests/rust/photo_repository_test.rs`
- `tests/rust/filter_builder_test.rs`
- `tests/rust/pipeline_test.rs`
- `tests/rust/schema_migration_test.rs`

### Track A — 修改
- `src-tauri/src/db/mod.rs` — 导出 repositories 子模块
- `src-tauri/src/state.rs` — AppState 持有 Arc<dyn *Repository>
- `src-tauri/src/commands/photo.rs` — 改用 state.photos (Repository trait)
- `src-tauri/src/commands/album.rs` — 改用 state.albums
- `src-tauri/src/commands/tag.rs` — 改用 state.tags
- `src-tauri/src/commands/undo.rs` — 改用 state.undo_repo
- `src-tauri/src/thumbnail/sidecar.rs` — 动态解析 sidecar 路径
- `src-tauri/Cargo.toml` — 无新依赖（已有 tempfile 用于测试）

### Track B — 新建
- `src/hooks/usePhotoData.ts`
- `src/locales/zh-CN.ts`
- `src/locales/index.ts`
- `src/__tests__/stores/photoStore.test.ts`
- `src/__tests__/stores/selectionStore.test.ts`
- `src/__tests__/hooks/usePhotoData.test.ts`
- `src/__tests__/types/layout.test.ts`

### Track B — 修改
- `src/hooks/usePhotoQuery.ts` — 协调层，委托给 usePhotoData
- `src/services/eventBus.ts` — Promise.allSettled + album resetQueries
- `src/components/grid/BatchActionBar.tsx` — 消除 icon as any
- `src/services/tauriIpc.ts` — buildUserMessage 改用 locale
- `src/app/routes.tsx` — 导航标签改用 locale
- `package.json` — 新增 vitest + @testing-library/react + jsdom devDeps

### Track C — 新建
- `LICENSE`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/workflows/ci.yml`

### Track C — 修改
- `README.md` — 补充平台工具链、sidecar 构建、数据目录、调试指南

---

## TRACK A: Rust 后端

---

### Task A1: 创建 PhotoRepository trait 及 SQLite 实现

**Files:**
- Create: `src-tauri/src/db/repositories/mod.rs`
- Create: `src-tauri/src/db/repositories/photo.rs`

- [ ] **Step 1: 创建 repositories 目录和 mod.rs**

```rust
// src-tauri/src/db/repositories/mod.rs
pub mod photo;
pub mod album;
pub mod tag;
pub mod undo;

pub use photo::{PhotoRepository, SqlitePhotoRepository};
pub use album::{AlbumRepository, SqliteAlbumRepository};
pub use tag::{TagRepository, SqliteTagRepository};
pub use undo::{UndoRepository, SqliteUndoRepository};
```

- [ ] **Step 2: 编写 PhotoRepository trait**

创建 `src-tauri/src/db/repositories/photo.rs`：

```rust
// src-tauri/src/db/repositories/photo.rs
use crate::db::photo::{
    self as photo_db, NewPhoto, Photo, PhotoPage, PhotoThumb,
};
use crate::db::search::{self as search_db, LibraryStats, SearchQuery, SearchSuggestions};
use crate::error::Result;
use crate::query::filter::PhotoFilter;
use crate::state::DbPool;
use std::sync::Arc;

pub trait PhotoRepository: Send + Sync {
    fn list(&self, filter: &PhotoFilter, cursor: Option<&str>, limit: u32) -> Result<PhotoPage>;
    fn get(&self, id: &str) -> Result<Option<Photo>>;
    fn get_batch(&self, ids: &[String]) -> Result<Vec<Photo>>;
    fn update_thumbnails(&self, id: &str, s: Option<&str>, m: Option<&str>, l: Option<&str>) -> Result<()>;
    fn set_favorite(&self, id: &str, value: bool) -> Result<()>;
    fn set_favorite_batch(&self, ids: &[String], value: bool) -> Result<()>;
    fn soft_delete(&self, ids: &[String]) -> Result<()>;
    fn restore(&self, ids: &[String]) -> Result<()>;
    fn purge(&self, ids: &[String]) -> Result<()>;
    fn insert_batch(&self, photos: &[NewPhoto]) -> Result<usize>;
    fn update_metadata(&self, file_path: &str, photo: &NewPhoto) -> Result<bool>;
    fn update_metadata_batch(&self, photos: &[NewPhoto]) -> Result<usize>;
    fn get_by_path(&self, path: &str) -> Result<Option<Photo>>;
    fn mark_missing(&self, file_path: &str) -> Result<()>;
    fn list_folder_index(&self, folder_path: &str) -> Result<Vec<(String, String, i64)>>;
    fn purge_old_trash(&self) -> Result<usize>;
    fn search(&self, query: &SearchQuery) -> Result<PhotoPage>;
    fn search_suggestions(&self, q: &str, limit: u32) -> Result<SearchSuggestions>;
    fn search_stats(&self) -> Result<LibraryStats>;
}

pub struct SqlitePhotoRepository {
    pool: Arc<DbPool>,
}

impl SqlitePhotoRepository {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self { pool }
    }

    fn conn(&self) -> Result<crate::state::DbConn> {
        use crate::error::AppError;
        self.pool.get().map_err(|e| AppError::Other(format!("DB pool error: {e}")))
    }
}

impl PhotoRepository for SqlitePhotoRepository {
    fn list(&self, filter: &PhotoFilter, cursor: Option<&str>, limit: u32) -> Result<PhotoPage> {
        let conn = self.conn()?;
        photo_db::query_paged(&conn, filter, cursor, limit)
    }

    fn get(&self, id: &str) -> Result<Option<Photo>> {
        let conn = self.conn()?;
        photo_db::get_by_id(&conn, id)
    }

    fn get_batch(&self, ids: &[String]) -> Result<Vec<Photo>> {
        let conn = self.conn()?;
        let results = ids
            .iter()
            .filter_map(|id| photo_db::get_by_id(&conn, id).ok().flatten())
            .collect();
        Ok(results)
    }

    fn update_thumbnails(&self, id: &str, s: Option<&str>, m: Option<&str>, l: Option<&str>) -> Result<()> {
        let conn = self.conn()?;
        photo_db::update_thumbnails(&conn, id, s, m, l)
    }

    fn set_favorite(&self, id: &str, value: bool) -> Result<()> {
        let conn = self.conn()?;
        photo_db::set_favorite(&conn, id, value)
    }

    fn set_favorite_batch(&self, ids: &[String], value: bool) -> Result<()> {
        let conn = self.conn()?;
        photo_db::set_favorite_batch(&conn, ids, value)
    }

    fn soft_delete(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        photo_db::soft_delete(&conn, ids)
    }

    fn restore(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        photo_db::restore(&conn, ids)
    }

    fn purge(&self, ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        photo_db::purge(&conn, ids)
    }

    fn insert_batch(&self, photos: &[NewPhoto]) -> Result<usize> {
        let conn = self.conn()?;
        photo_db::insert_batch(&conn, photos)
    }

    fn update_metadata(&self, file_path: &str, photo: &NewPhoto) -> Result<bool> {
        let conn = self.conn()?;
        photo_db::update_metadata(&conn, file_path, photo)
    }

    fn update_metadata_batch(&self, photos: &[NewPhoto]) -> Result<usize> {
        let conn = self.conn()?;
        photo_db::update_metadata_batch(&conn, photos)
    }

    fn get_by_path(&self, path: &str) -> Result<Option<Photo>> {
        let conn = self.conn()?;
        photo_db::get_by_path(&conn, path)
    }

    fn mark_missing(&self, file_path: &str) -> Result<()> {
        let conn = self.conn()?;
        photo_db::mark_missing(&conn, file_path)
    }

    fn list_folder_index(&self, folder_path: &str) -> Result<Vec<(String, String, i64)>> {
        let conn = self.conn()?;
        photo_db::list_folder_index(&conn, folder_path)
    }

    fn purge_old_trash(&self) -> Result<usize> {
        let conn = self.conn()?;
        photo_db::purge_old_trash(&conn)
    }

    fn search(&self, query: &SearchQuery) -> Result<PhotoPage> {
        let conn = self.conn()?;
        search_db::search(&conn, query)
    }

    fn search_suggestions(&self, q: &str, limit: u32) -> Result<SearchSuggestions> {
        let conn = self.conn()?;
        search_db::suggestions(&conn, q, limit)
    }

    fn search_stats(&self) -> Result<LibraryStats> {
        let conn = self.conn()?;
        search_db::library_stats(&conn)
    }
}
```

- [ ] **Step 3: 验证编译**

```bash
cd src-tauri && cargo check 2>&1 | head -30
```

期望：无错误（警告可忽略）

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/repositories/
git commit -m "feat(rust): add PhotoRepository trait with SqlitePhotoRepository impl"
```

---

### Task A2: 创建 AlbumRepository 和 TagRepository trait

**Files:**
- Create: `src-tauri/src/db/repositories/album.rs`
- Create: `src-tauri/src/db/repositories/tag.rs`
- Create: `src-tauri/src/db/repositories/undo.rs`

- [ ] **Step 1: 创建 AlbumRepository**

创建 `src-tauri/src/db/repositories/album.rs`：

```rust
// src-tauri/src/db/repositories/album.rs
use crate::db::album::{self as album_db, Album, AlbumSummary, UpdateAlbumParams};
use crate::db::photo::PhotoPage;
use crate::error::Result;
use crate::state::DbPool;
use std::sync::Arc;

pub trait AlbumRepository: Send + Sync {
    fn list_summaries(&self) -> Result<Vec<AlbumSummary>>;
    fn list_all_summaries(&self) -> Result<Vec<AlbumSummary>>;
    fn get_by_id(&self, id: &str) -> Result<Option<Album>>;
    fn create(&self, name: &str, description: Option<&str>) -> Result<Album>;
    fn create_private(&self, name: &str, password_hash: &str) -> Result<Album>;
    fn update(&self, id: &str, params: &UpdateAlbumParams) -> Result<Album>;
    fn delete(&self, id: &str) -> Result<()>;
    fn set_private(&self, id: &str, is_private: bool, password_hash: Option<&str>) -> Result<Album>;
    fn get_password_hash(&self, id: &str) -> Result<Option<String>>;
    fn list_photos(&self, album_id: &str, cursor: Option<&str>, limit: u32) -> Result<PhotoPage>;
    fn add_photos(&self, album_id: &str, photo_ids: &[String]) -> Result<()>;
    fn remove_photos(&self, album_id: &str, photo_ids: &[String]) -> Result<()>;
    fn reorder_photos(&self, album_id: &str, ordered_ids: &[String]) -> Result<()>;
    fn update_cover_after_add(&self, album_id: &str) -> Result<()>;
}

pub struct SqliteAlbumRepository {
    pool: Arc<DbPool>,
}

impl SqliteAlbumRepository {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self { pool }
    }

    fn conn(&self) -> Result<crate::state::DbConn> {
        use crate::error::AppError;
        self.pool.get().map_err(|e| AppError::Other(format!("DB pool error: {e}")))
    }
}

impl AlbumRepository for SqliteAlbumRepository {
    fn list_summaries(&self) -> Result<Vec<AlbumSummary>> {
        let conn = self.conn()?;
        album_db::list_summaries(&conn)
    }
    fn list_all_summaries(&self) -> Result<Vec<AlbumSummary>> {
        let conn = self.conn()?;
        album_db::list_all_summaries(&conn)
    }
    fn get_by_id(&self, id: &str) -> Result<Option<Album>> {
        let conn = self.conn()?;
        album_db::get_by_id(&conn, id)
    }
    fn create(&self, name: &str, description: Option<&str>) -> Result<Album> {
        let conn = self.conn()?;
        album_db::create(&conn, name, description)
    }
    fn create_private(&self, name: &str, password_hash: &str) -> Result<Album> {
        let conn = self.conn()?;
        album_db::create_private(&conn, name, password_hash)
    }
    fn update(&self, id: &str, params: &UpdateAlbumParams) -> Result<Album> {
        let conn = self.conn()?;
        album_db::update(&conn, id, params)
    }
    fn delete(&self, id: &str) -> Result<()> {
        let conn = self.conn()?;
        album_db::delete(&conn, id)
    }
    fn set_private(&self, id: &str, is_private: bool, password_hash: Option<&str>) -> Result<Album> {
        let conn = self.conn()?;
        album_db::set_private(&conn, id, is_private, password_hash)
    }
    fn get_password_hash(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn()?;
        album_db::get_password_hash(&conn, id)
    }
    fn list_photos(&self, album_id: &str, cursor: Option<&str>, limit: u32) -> Result<PhotoPage> {
        let conn = self.conn()?;
        album_db::list_photos(&conn, album_id, cursor, limit)
    }
    fn add_photos(&self, album_id: &str, photo_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        album_db::add_photos(&conn, album_id, photo_ids)
    }
    fn remove_photos(&self, album_id: &str, photo_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        album_db::remove_photos(&conn, album_id, photo_ids)
    }
    fn reorder_photos(&self, album_id: &str, ordered_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        album_db::reorder_photos(&conn, album_id, ordered_ids)
    }
    fn update_cover_after_add(&self, album_id: &str) -> Result<()> {
        let conn = self.conn()?;
        album_db::update_cover_after_add(&conn, album_id)
    }
}
```

- [ ] **Step 2: 创建 TagRepository**

创建 `src-tauri/src/db/repositories/tag.rs`：

```rust
// src-tauri/src/db/repositories/tag.rs
use crate::db::tag::{self as tag_db, Tag};
use crate::error::Result;
use crate::state::DbPool;
use std::sync::Arc;

pub trait TagRepository: Send + Sync {
    fn list(&self) -> Result<Vec<Tag>>;
    fn create(&self, name: &str, color: &str) -> Result<Tag>;
    fn delete(&self, id: &str) -> Result<()>;
    fn get_for_photo(&self, photo_id: &str) -> Result<Vec<Tag>>;
    fn add_to_photo(&self, photo_id: &str, tag_ids: &[String]) -> Result<()>;
    fn remove_from_photo(&self, photo_id: &str, tag_ids: &[String]) -> Result<()>;
    fn list_photos_by_tag(&self, tag_id: &str, cursor: Option<&str>, limit: u32) -> Result<crate::db::photo::PhotoPage>;
}

pub struct SqliteTagRepository {
    pool: Arc<DbPool>,
}

impl SqliteTagRepository {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self { pool }
    }

    fn conn(&self) -> Result<crate::state::DbConn> {
        use crate::error::AppError;
        self.pool.get().map_err(|e| AppError::Other(format!("DB pool error: {e}")))
    }
}

impl TagRepository for SqliteTagRepository {
    fn list(&self) -> Result<Vec<Tag>> {
        let conn = self.conn()?;
        tag_db::list_tags(&conn)
    }
    fn create(&self, name: &str, color: &str) -> Result<Tag> {
        let conn = self.conn()?;
        tag_db::create_tag(&conn, name, color)
    }
    fn delete(&self, id: &str) -> Result<()> {
        let conn = self.conn()?;
        tag_db::delete_tag(&conn, id)
    }
    fn get_for_photo(&self, photo_id: &str) -> Result<Vec<Tag>> {
        let conn = self.conn()?;
        tag_db::get_photo_tags(&conn, photo_id)
    }
    fn add_to_photo(&self, photo_id: &str, tag_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        tag_db::add_tags_to_photo(&conn, photo_id, tag_ids)
    }
    fn remove_from_photo(&self, photo_id: &str, tag_ids: &[String]) -> Result<()> {
        let conn = self.conn()?;
        tag_db::remove_tags_from_photo(&conn, photo_id, tag_ids)
    }
    fn list_photos_by_tag(&self, tag_id: &str, cursor: Option<&str>, limit: u32) -> Result<crate::db::photo::PhotoPage> {
        let conn = self.conn()?;
        tag_db::list_photos_by_tag(&conn, tag_id, cursor, limit)
    }
}
```

- [ ] **Step 3: 创建 UndoRepository**

创建 `src-tauri/src/db/repositories/undo.rs`：

```rust
// src-tauri/src/db/repositories/undo.rs
use crate::error::Result;
use crate::state::DbPool;
use std::sync::Arc;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UndoEntry {
    pub id:         i64,
    pub action:     String,
    pub payload:    String,
    pub created_at: String,
}

pub trait UndoRepository: Send + Sync {
    fn record(&self, action: &str, payload: &str) -> Result<()>;
    fn pop_last(&self) -> Result<Option<UndoEntry>>;
}

pub struct SqliteUndoRepository {
    pool: Arc<DbPool>,
}

impl SqliteUndoRepository {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self { pool }
    }

    fn conn(&self) -> Result<crate::state::DbConn> {
        use crate::error::AppError;
        self.pool.get().map_err(|e| AppError::Other(format!("DB pool error: {e}")))
    }
}

impl UndoRepository for SqliteUndoRepository {
    fn record(&self, action: &str, payload: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO undo_log (action, payload) VALUES (?1, ?2)",
            rusqlite::params![action, payload],
        )?;
        Ok(())
    }

    fn pop_last(&self) -> Result<Option<UndoEntry>> {
        let conn = self.conn()?;
        let entry = conn.query_row(
            "SELECT id, action, payload, created_at FROM undo_log ORDER BY id DESC LIMIT 1",
            [],
            |row| Ok(UndoEntry {
                id:         row.get(0)?,
                action:     row.get(1)?,
                payload:    row.get(2)?,
                created_at: row.get(3)?,
            }),
        ).ok();

        if let Some(ref e) = entry {
            conn.execute("DELETE FROM undo_log WHERE id = ?1", rusqlite::params![e.id])?;
        }
        Ok(entry)
    }
}
```

- [ ] **Step 4: 验证编译**

```bash
cd src-tauri && cargo check 2>&1 | head -30
```

期望：无错误

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/repositories/
git commit -m "feat(rust): add AlbumRepository, TagRepository, UndoRepository traits"
```

---

### Task A3: 更新 db/mod.rs 并重构 AppState

**Files:**
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: 更新 db/mod.rs 导出 repositories**

读取当前 `src-tauri/src/db/mod.rs` 内容后，在文件顶部追加：

```rust
pub mod repositories;
pub use repositories::{
    PhotoRepository, SqlitePhotoRepository,
    AlbumRepository, SqliteAlbumRepository,
    TagRepository, SqliteTagRepository,
    UndoRepository, SqliteUndoRepository,
};
```

- [ ] **Step 2: 更新 AppState 持有 Repository Arc**

在 `src-tauri/src/state.rs` 的 `AppState` 结构体中新增 4 个字段，在 `AppState::new()` 中初始化。

在 `use` 声明区增加：
```rust
use crate::db::{
    SqlitePhotoRepository, SqliteAlbumRepository,
    SqliteTagRepository, SqliteUndoRepository,
    PhotoRepository, AlbumRepository, TagRepository, UndoRepository,
};
```

在 `AppState` 结构体追加字段（放在 `pub db: DbPool` 之后）：
```rust
pub photos: Arc<dyn PhotoRepository>,
pub albums: Arc<dyn AlbumRepository>,
pub tags:   Arc<dyn TagRepository>,
pub undo:   Arc<dyn UndoRepository>,
```

在 `AppState::new()` 中，创建 pool 之后追加：
```rust
let db_arc = Arc::new(pool.clone());
let photos: Arc<dyn PhotoRepository> = Arc::new(SqlitePhotoRepository::new(Arc::clone(&db_arc)));
let albums: Arc<dyn AlbumRepository> = Arc::new(SqliteAlbumRepository::new(Arc::clone(&db_arc)));
let tags:   Arc<dyn TagRepository>   = Arc::new(SqliteTagRepository::new(Arc::clone(&db_arc)));
let undo:   Arc<dyn UndoRepository>  = Arc::new(SqliteUndoRepository::new(Arc::clone(&db_arc)));
```

并在 `Ok(Self { ... })` 中加入：
```rust
photos,
albums,
tags,
undo,
```

- [ ] **Step 3: 验证编译**

```bash
cd src-tauri && cargo check 2>&1 | head -40
```

期望：无错误

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/mod.rs src-tauri/src/state.rs
git commit -m "feat(rust): wire Repository traits into AppState"
```

---

### Task A4: 重构 commands/photo.rs 使用 Repository

**Files:**
- Modify: `src-tauri/src/commands/photo.rs`

- [ ] **Step 1: 替换 `state.conn()` 调用为 `state.photos.*` 调用**

将文件开头的 use 声明由：
```rust
use crate::db::{photo, search};
use crate::commands::undo::record_undo;
```
改为：
```rust
use crate::db::photo::PhotoUpdateParams;
use crate::db::search::SearchQuery;
use crate::error::AppError;
```

删除 `PhotoUpdateParams` 重复定义（文件末尾的 struct，现在从 `db::photo` 导入）。

逐一更新每个命令函数，去掉 `state.conn()?` 和直接 DB 调用，改为通过 `state.photos`、`state.undo`：

`photos_list`:
```rust
#[tauri::command]
pub async fn photos_list(
    filter: PhotoFilter,
    cursor: Option<String>,
    limit:  Option<u32>,
    state:  State<'_, AppState>,
) -> Result<photo_db::PhotoPage, AppError> {
    let limit = limit.unwrap_or(100).min(1000);
    state.photos.list(&filter, cursor.as_deref(), limit).map_err(Into::into)
}
```

`photos_get`:
```rust
#[tauri::command]
pub async fn photos_get(id: String, state: State<'_, AppState>) -> Result<photo_db::Photo, AppError> {
    state.photos.get(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Photo {id} not found")))
}
```

`photos_get_batch`:
```rust
#[tauri::command]
pub async fn photos_get_batch(ids: Vec<String>, state: State<'_, AppState>) -> Result<Vec<photo_db::Photo>, AppError> {
    if ids.len() > 100 {
        return Err(AppError::InvalidArgument("Batch size exceeds limit of 100".into()));
    }
    state.photos.get_batch(&ids).map_err(Into::into)
}
```

`photos_favorite`:
```rust
#[tauri::command]
pub async fn photos_favorite(id: String, value: bool, state: State<'_, AppState>) -> Result<(), AppError> {
    if let Ok(Some(existing)) = state.photos.get(&id) {
        if existing.is_favorite != value {
            let payload = serde_json::json!({ "id": id, "old_value": existing.is_favorite }).to_string();
            let _ = state.undo.record("favorite_set", &payload);
        }
    }
    state.photos.set_favorite(&id, value).map_err(Into::into)
}
```

`photos_favorite_batch`:
```rust
#[tauri::command]
pub async fn photos_favorite_batch(ids: Vec<String>, value: bool, state: State<'_, AppState>) -> Result<(), AppError> {
    if ids.is_empty() { return Ok(()); }
    if ids.len() > 1000 {
        return Err(AppError::InvalidArgument("Exceeded limit of 1000 items".into()));
    }
    let mut old_values = serde_json::Map::new();
    for id in &ids {
        if let Ok(Some(p)) = state.photos.get(id) {
            old_values.insert(id.clone(), serde_json::Value::Bool(p.is_favorite));
        }
    }
    let payload = serde_json::json!({ "ids": ids, "old_values": old_values, "new_value": value }).to_string();
    let _ = state.undo.record("favorite_batch", &payload);
    state.photos.set_favorite_batch(&ids, value).map_err(Into::into)
}
```

`photos_delete`, `photos_restore`, `photos_purge`, `photos_purge_data` 同理替换为 `state.photos.*`，并使用 `state.undo.record()` 代替 `record_undo(&conn, ...)`.

`search_photos`, `search_suggestions`, `search_stats`:
```rust
#[tauri::command]
pub async fn search_photos(query: SearchQuery, state: State<'_, AppState>) -> Result<photo_db::PhotoPage, AppError> {
    state.photos.search(&query).map_err(Into::into)
}

#[tauri::command]
pub async fn search_suggestions(q: String, limit: Option<u32>, state: State<'_, AppState>) -> Result<crate::db::search::SearchSuggestions, AppError> {
    state.photos.search_suggestions(&q, limit.unwrap_or(10)).map_err(Into::into)
}

#[tauri::command]
pub async fn search_stats(state: State<'_, AppState>) -> Result<crate::db::search::LibraryStats, AppError> {
    state.photos.search_stats().map_err(Into::into)
}
```

- [ ] **Step 2: 验证编译**

```bash
cd src-tauri && cargo check 2>&1 | head -40
```

期望：无错误

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/photo.rs
git commit -m "refactor(rust): commands/photo.rs — delegate to PhotoRepository trait"
```

---

### Task A5: 重构 commands/album.rs 和 commands/tag.rs 及 commands/undo.rs

**Files:**
- Modify: `src-tauri/src/commands/album.rs`
- Modify: `src-tauri/src/commands/tag.rs`
- Modify: `src-tauri/src/commands/undo.rs`

- [ ] **Step 1: 更新 commands/album.rs**

将所有 `state.conn()?` + `album::*(&conn, ...)` 替换为 `state.albums.*(...)`。

例如 `albums_list`：
```rust
#[tauri::command]
pub async fn albums_list(state: State<'_, AppState>) -> Result<Vec<AlbumSummary>, AppError> {
    state.albums.list_summaries().map_err(Into::into)
}
```

`albums_get`:
```rust
#[tauri::command]
pub async fn albums_get(id: String, state: State<'_, AppState>) -> Result<Album, AppError> {
    state.albums.get_by_id(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Album {id} not found")))
}
```

`album_photos_add` 中的 undo 记录改为 `state.undo.record(...)`:
```rust
let payload = serde_json::json!({ "album_id": album_id, "photo_ids": photo_ids }).to_string();
let _ = state.undo.record("album_photos_add", &payload);
state.albums.add_photos(&album_id, &photo_ids).map_err(Into::into)
```

其余命令同理，均通过 `state.albums.*` 调用。

- [ ] **Step 2: 更新 commands/tag.rs**

将所有 DB 调用替换为 `state.tags.*`:
```rust
#[tauri::command]
pub async fn tags_list(state: State<'_, AppState>) -> Result<Vec<Tag>, AppError> {
    state.tags.list().map_err(Into::into)
}

#[tauri::command]
pub async fn tags_create(name: String, color: String, state: State<'_, AppState>) -> Result<Tag, AppError> {
    state.tags.create(&name, &color).map_err(Into::into)
}

#[tauri::command]
pub async fn tags_delete(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.tags.delete(&id).map_err(Into::into)
}

#[tauri::command]
pub async fn photo_tags_get(photo_id: String, state: State<'_, AppState>) -> Result<Vec<Tag>, AppError> {
    state.tags.get_for_photo(&photo_id).map_err(Into::into)
}

#[tauri::command]
pub async fn photo_tags_add(photo_id: String, tag_ids: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    state.tags.add_to_photo(&photo_id, &tag_ids).map_err(Into::into)
}

#[tauri::command]
pub async fn photo_tags_remove(photo_id: String, tag_ids: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    state.tags.remove_from_photo(&photo_id, &tag_ids).map_err(Into::into)
}
```

- [ ] **Step 3: 更新 commands/undo.rs**

将 `record_undo(&conn, ...)` 函数替换为通过 `state.undo.pop_last()` 实现，删除 `pub fn record_undo` 公共函数（命令层现在统一通过 `state.undo.record`）：

```rust
#[tauri::command]
pub async fn undo_last(state: State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    let entry = state.undo.pop_last()?
        .ok_or_else(|| AppError::Other("UNDO_EMPTY".into()))?;

    // 根据 action 执行反向操作
    let reversed = apply_undo(&state, &entry.action, &entry.payload).await?;
    Ok(serde_json::json!({
        "undoId":   entry.id,
        "action":   entry.action,
        "reversed": reversed,
        "detail":   entry.payload,
    }))
}

async fn apply_undo(state: &AppState, action: &str, payload: &str) -> Result<bool, AppError> {
    let v: serde_json::Value = serde_json::from_str(payload)
        .map_err(|e| AppError::Other(format!("undo parse error: {e}")))?;

    match action {
        "photo_delete" => {
            let ids: Vec<String> = serde_json::from_value(v["ids"].clone())
                .map_err(|e| AppError::Other(e.to_string()))?;
            state.photos.restore(&ids)?;
            Ok(true)
        }
        "favorite_set" => {
            let id: String = serde_json::from_value(v["id"].clone())
                .map_err(|e| AppError::Other(e.to_string()))?;
            let old: bool = v["old_value"].as_bool().unwrap_or(false);
            state.photos.set_favorite(&id, old)?;
            Ok(true)
        }
        "favorite_batch" => {
            let old_values = v["old_values"].as_object()
                .ok_or_else(|| AppError::Other("invalid undo payload".into()))?;
            for (id, val) in old_values {
                let fav = val.as_bool().unwrap_or(false);
                state.photos.set_favorite(id, fav)?;
            }
            Ok(true)
        }
        "album_photos_add" => {
            let album_id: String = serde_json::from_value(v["album_id"].clone())
                .map_err(|e| AppError::Other(e.to_string()))?;
            let photo_ids: Vec<String> = serde_json::from_value(v["photo_ids"].clone())
                .map_err(|e| AppError::Other(e.to_string()))?;
            state.albums.remove_photos(&album_id, &photo_ids)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}
```

- [ ] **Step 4: 验证全量编译**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```

期望：`Compiling light-album ...` 最终 `Finished`，无 error

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/
git commit -m "refactor(rust): commands/album|tag|undo.rs — delegate to Repository traits"
```

---

### Task A6: Rust Bug 修复

**Files:**
- Modify: `src-tauri/src/thumbnail/sidecar.rs`
- Modify: `src-tauri/src/state.rs` (bcrypt cost 注释)

- [ ] **Step 1: 修复 sidecar 路径硬编码**

读取 `src-tauri/src/thumbnail/sidecar.rs`，找到 sidecar 二进制路径解析处（通常是 `tauri::api::process::Command` 或直接字符串拼接），将路径解析改为基于当前可执行文件目录的动态方式：

找到类似：
```rust
let binary_name = "sharp-worker";
```

替换为：
```rust
fn sidecar_binary_path(data_dir: &std::path::Path) -> std::path::PathBuf {
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
    data_dir.join(if cfg!(windows) { "sharp-worker.exe" } else { "sharp-worker" })
}
```

并在 `SidecarHandle::new()` 中改用此函数。

- [ ] **Step 2: 显式注释 bcrypt cost**

在 `src-tauri/src/commands/album.rs` 中找到 `bcrypt::hash(&password, 10)` 这一行，将 `10` 替换为具名常量：

在文件顶部（use 区之后）加入：
```rust
/// bcrypt work factor — 10 在现代桌面 CPU 上约 100ms，安全性与响应速度的合理折中。
/// 不得低于 10，OWASP 建议桌面应用使用 10-12。
const BCRYPT_COST: u32 = 10;
```

将所有 `bcrypt::hash(&password, 10)` 改为 `bcrypt::hash(&password, BCRYPT_COST)`。

- [ ] **Step 3: 验证编译**

```bash
cd src-tauri && cargo check 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/thumbnail/sidecar.rs src-tauri/src/commands/album.rs
git commit -m "fix(rust): dynamic sidecar path resolution + explicit bcrypt cost constant"
```

---

### Task A7: Rust 单元测试

**Files:**
- Create: `tests/rust/photo_repository_test.rs`
- Create: `tests/rust/filter_builder_test.rs`
- Create: `tests/rust/pipeline_test.rs`
- Create: `tests/rust/schema_migration_test.rs`

- [ ] **Step 1: 创建 photo_repository_test.rs**

```rust
// tests/rust/photo_repository_test.rs
//! PhotoRepository 集成测试 — 使用 tempfile 隔离数据库
use light_album_lib::db::{schema, SqlitePhotoRepository, PhotoRepository};
use light_album_lib::db::photo::NewPhoto;
use light_album_lib::query::filter::PhotoFilter;
use r2d2_sqlite::SqliteConnectionManager;
use std::sync::Arc;
use tempfile::tempdir;

fn make_repo() -> (tempfile::TempDir, SqlitePhotoRepository) {
    let dir  = tempdir().unwrap();
    let db   = dir.path().join("test.db");
    let mgr  = SqliteConnectionManager::file(&db);
    let pool = r2d2::Pool::builder().max_size(2).build(mgr).unwrap();
    {
        let conn = pool.get().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").unwrap();
        schema::run_migrations(&conn, &db).unwrap();
    }
    let pool_arc = Arc::new(pool);
    let repo = SqlitePhotoRepository::new(Arc::clone(&pool_arc));
    (dir, repo)
}

fn sample_photo(file_path: &str) -> NewPhoto {
    NewPhoto {
        file_path:     file_path.into(),
        file_name:     "test.jpg".into(),
        file_size:     1024,
        file_hash:     uuid::Uuid::new_v4().to_string(),
        width:         100,
        height:        100,
        orientation:   1,
        format:        "jpeg".into(),
        created_at:    "2024-01-01T00:00:00Z".into(),
        modified_at:   "2024-01-01T00:00:00Z".into(),
        folder_path:   "/photos".into(),
        gps_lat:       None,
        gps_lng:       None,
        camera_make:   None,
        camera_model:  None,
        lens_model:    None,
        focal_length:  None,
        aperture:      None,
        shutter_speed: None,
        iso:           None,
        exposure_comp: None,
    }
}

#[test]
fn test_insert_and_list() {
    let (_dir, repo) = make_repo();
    let photos = vec![sample_photo("/photos/a.jpg"), sample_photo("/photos/b.jpg")];
    let inserted = repo.insert_batch(&photos).unwrap();
    assert_eq!(inserted, 2);

    let page = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.total, 2);
}

#[test]
fn test_list_limit_enforced() {
    let (_dir, repo) = make_repo();
    let photos: Vec<NewPhoto> = (0..5).map(|i| sample_photo(&format!("/photos/{i}.jpg"))).collect();
    repo.insert_batch(&photos).unwrap();

    let page = repo.list(&PhotoFilter::default(), None, 2).unwrap();
    assert_eq!(page.items.len(), 2);
    assert!(page.next_cursor.is_some());
}

#[test]
fn test_cursor_pagination() {
    let (_dir, repo) = make_repo();
    let photos: Vec<NewPhoto> = (0..5).map(|i| sample_photo(&format!("/photos/{i}.jpg"))).collect();
    repo.insert_batch(&photos).unwrap();

    let page1 = repo.list(&PhotoFilter::default(), None, 3).unwrap();
    assert_eq!(page1.items.len(), 3);
    let cursor = page1.next_cursor.unwrap();

    let page2 = repo.list(&PhotoFilter::default(), Some(&cursor), 3).unwrap();
    assert_eq!(page2.items.len(), 2);
    assert!(page2.next_cursor.is_none());
}

#[test]
fn test_favorites_filter() {
    let (_dir, repo) = make_repo();
    repo.insert_batch(&[sample_photo("/photos/a.jpg")]).unwrap();
    let page = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    let id   = page.items[0].id.clone();

    repo.set_favorite(&id, true).unwrap();
    let filter = PhotoFilter { favorites_only: true, ..Default::default() };
    let fav_page = repo.list(&filter, None, 10).unwrap();
    assert_eq!(fav_page.items.len(), 1);
    assert_eq!(fav_page.items[0].id, id);
}

#[test]
fn test_soft_delete_and_restore() {
    let (_dir, repo) = make_repo();
    repo.insert_batch(&[sample_photo("/photos/a.jpg")]).unwrap();
    let page = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    let id   = page.items[0].id.clone();

    repo.soft_delete(&[id.clone()]).unwrap();
    let after_delete = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    assert_eq!(after_delete.total, 0);

    repo.restore(&[id.clone()]).unwrap();
    let after_restore = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    assert_eq!(after_restore.total, 1);
}
```

- [ ] **Step 2: 创建 schema_migration_test.rs**

```rust
// tests/rust/schema_migration_test.rs
use light_album_lib::db::schema;
use r2d2_sqlite::SqliteConnectionManager;
use tempfile::tempdir;

#[test]
fn test_migration_idempotent() {
    let dir  = tempdir().unwrap();
    let db   = dir.path().join("test.db");
    let mgr  = SqliteConnectionManager::file(&db);
    let pool = r2d2::Pool::builder().max_size(1).build(mgr).unwrap();
    let conn = pool.get().unwrap();

    // 运行两次 migration，不应 panic 或返回错误
    schema::run_migrations(&conn, &db).expect("first migration failed");
    schema::run_migrations(&conn, &db).expect("second migration (idempotency) failed");
}

#[test]
fn test_tables_exist_after_migration() {
    let dir  = tempdir().unwrap();
    let db   = dir.path().join("test.db");
    let mgr  = SqliteConnectionManager::file(&db);
    let pool = r2d2::Pool::builder().max_size(1).build(mgr).unwrap();
    let conn = pool.get().unwrap();
    schema::run_migrations(&conn, &db).unwrap();

    let tables: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).unwrap();
        stmt.query_map([], |row| row.get(0)).unwrap()
            .filter_map(|r| r.ok()).collect()
    };

    for expected in &["photos", "albums", "album_photos", "tags", "photo_tags", "undo_log", "watched_folders"] {
        assert!(tables.contains(&expected.to_string()), "missing table: {expected}");
    }
}
```

- [ ] **Step 3: 创建 filter_builder_test.rs**

```rust
// tests/rust/filter_builder_test.rs
//! 验证 PhotoFilter 各字段正确转译为 SQL 查询结果
use light_album_lib::db::{SqlitePhotoRepository, PhotoRepository};
use light_album_lib::db::photo::NewPhoto;
use light_album_lib::db::schema;
use light_album_lib::query::filter::PhotoFilter;
use r2d2_sqlite::SqliteConnectionManager;
use std::sync::Arc;
use tempfile::tempdir;

fn make_repo() -> (tempfile::TempDir, SqlitePhotoRepository) {
    let dir  = tempdir().unwrap();
    let db   = dir.path().join("test.db");
    let mgr  = SqliteConnectionManager::file(&db);
    let pool = r2d2::Pool::builder().max_size(2).build(mgr).unwrap();
    {
        let conn = pool.get().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        schema::run_migrations(&conn, &db).unwrap();
    }
    let pool_arc = Arc::new(pool);
    (dir, SqlitePhotoRepository::new(pool_arc))
}

fn photo(path: &str, folder: &str, format: &str, created_at: &str) -> NewPhoto {
    NewPhoto {
        file_path: path.into(), file_name: "x.jpg".into(), file_size: 1,
        file_hash: uuid::Uuid::new_v4().to_string(),
        width: 1, height: 1, orientation: 1,
        format: format.into(),
        created_at: created_at.into(), modified_at: created_at.into(),
        folder_path: folder.into(),
        gps_lat: None, gps_lng: None, camera_make: None, camera_model: None,
        lens_model: None, focal_length: None, aperture: None,
        shutter_speed: None, iso: None, exposure_comp: None,
    }
}

#[test]
fn test_filter_by_folder() {
    let (_dir, repo) = make_repo();
    repo.insert_batch(&[
        photo("/a/1.jpg", "/a", "jpeg", "2024-01-01T00:00:00Z"),
        photo("/b/2.jpg", "/b", "jpeg", "2024-01-01T00:00:00Z"),
    ]).unwrap();

    let filter = PhotoFilter { folder_path: Some("/a".into()), ..Default::default() };
    let page = repo.list(&filter, None, 10).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].folder_path, "/a");
}

#[test]
fn test_filter_by_format() {
    let (_dir, repo) = make_repo();
    repo.insert_batch(&[
        photo("/a/1.jpg", "/a", "jpeg", "2024-01-01T00:00:00Z"),
        photo("/a/2.png", "/a", "png",  "2024-01-01T00:00:00Z"),
    ]).unwrap();

    let filter = PhotoFilter { format: Some("png".into()), ..Default::default() };
    let page = repo.list(&filter, None, 10).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].format, "png");
}

#[test]
fn test_filter_date_range() {
    let (_dir, repo) = make_repo();
    repo.insert_batch(&[
        photo("/a/1.jpg", "/a", "jpeg", "2023-06-01T00:00:00Z"),
        photo("/a/2.jpg", "/a", "jpeg", "2024-01-01T00:00:00Z"),
        photo("/a/3.jpg", "/a", "jpeg", "2025-01-01T00:00:00Z"),
    ]).unwrap();

    let filter = PhotoFilter {
        date_from: Some("2024-01-01T00:00:00Z".into()),
        date_to:   Some("2024-12-31T23:59:59Z".into()),
        ..Default::default()
    };
    let page = repo.list(&filter, None, 10).unwrap();
    assert_eq!(page.total, 1);
}
```

- [ ] **Step 4: 运行所有 Rust 测试**

```bash
cd src-tauri && cargo test -- --test-threads=4 2>&1 | tail -30
```

期望：`test result: ok. N passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add tests/rust/
git commit -m "test(rust): add photo_repository, filter_builder, schema_migration unit tests"
```

---

## TRACK B: 前端 React/TypeScript

---

### Task B1: 修复 EventBus 内存泄漏与相册缓存策略

**Files:**
- Modify: `src/services/eventBus.ts`

- [ ] **Step 1: 将 Promise.all 改为 Promise.allSettled**

找到文件中 cleanup return 函数（约第 238 行）：
```typescript
// 原代码
return () => {
  Promise.all(listeners).then((fns) => {
    fns.forEach((fn) => fn())
  })
  unlistenRef.current = []
}
```

替换为：
```typescript
return () => {
  Promise.allSettled(unlistenRef.current).then((results) => {
    results.forEach((result) => {
      if (result.status === 'fulfilled') result.value()
    })
  })
  unlistenRef.current = []
}
```

- [ ] **Step 2: 修复 album:updated 使用 resetQueries**

找到约第 225-233 行的 `album:updated` 处理器：
```typescript
// 原代码
queryClient.invalidateQueries({ queryKey: ['albums'] })
queryClient.invalidateQueries({
  queryKey: ['album', albumId],
  exact: true,
})
```

替换为：
```typescript
// staleTime:Infinity 下 invalidateQueries 不触发 refetch，改用 resetQueries
queryClient.resetQueries({ queryKey: ['albums'] })
queryClient.resetQueries({ queryKey: ['album', albumId] })
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
pnpm typecheck 2>&1 | head -20
```

期望：零错误

- [ ] **Step 4: Commit**

```bash
git add src/services/eventBus.ts
git commit -m "fix(frontend): EventBus memory leak (allSettled) + album cache reset strategy"
```

---

### Task B2: 消除全部 as any 类型转义

**Files:**
- Modify: `src/hooks/usePhotoQuery.ts`
- Modify: `src/components/grid/BatchActionBar.tsx`
- Modify: `src/services/eventBus.ts`

- [ ] **Step 1: 修复 usePhotoQuery.ts 的 ViewState 类型守卫**

找到约第 91-93 行：
```typescript
const isTagSearch = currentView.type === 'search' &&
  typeof (currentView as { type: string; query?: string }).query === 'string' &&
  ((currentView as { type: string; query?: string }).query ?? '').startsWith('#')
```

替换为（利用判别联合类型自动收窄）：
```typescript
const isTagSearch =
  currentView.type === 'search' &&
  'query' in currentView &&
  typeof currentView.query === 'string' &&
  currentView.query.startsWith('#')
```

- [ ] **Step 2: 修复 BatchActionBar.tsx 的 icon as any**

读取 BatchActionBar.tsx，找到 `icon as any` 所在的 action 定义处（约第 230-250 行）。

找到 action 对象数组中的 icon 字段定义，例如：
```typescript
{ key: 'favorite', icon: 'Heart', label: '收藏' }
```

在文件顶部 import Icon 处找到 Icon 组件接受的 name 类型，确认是 `LucideIcon` 名称字符串，然后将 action 数组加上 `as const` 或为 icon 字段显式标注类型，消除 `as any`：

```typescript
// 在 BatchActionBar.tsx 顶部加入
import type { LucideIcon } from 'lucide-react'
import {
  Heart, Trash2, FolderPlus, Star, Download,
  CheckSquare, XSquare,
} from 'lucide-react'

// 将 icon 字段从字符串改为直接引用 LucideIcon 组件
const BATCH_ACTIONS: Array<{
  key:   string
  icon:  React.ComponentType<{ size?: number; color?: string }>
  label: string
}> = [
  { key: 'favorite',   icon: Heart,       label: '收藏' },
  { key: 'delete',     icon: Trash2,      label: '删除' },
  { key: 'add-album',  icon: FolderPlus,  label: '加入相册' },
  // ... 其余 action
]
```

在渲染处替换：
```typescript
// 原：<Icon name={icon as any} size={13} color={baseColor} />
// 改为直接渲染组件
<action.icon size={13} color={baseColor} />
```

- [ ] **Step 3: 清理 eventBus.ts 的 rawPayload as any**

找到 `library:changed` 处理器约第 181-183 行：
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = rawPayload as any
```

由于 `LibraryChangedPayload` 已在 `ipc.ts` 中统一为 `string[]`，直接使用类型化的 payload：
```typescript
listenTyped('library:changed', (payload) => {
  const { added, modified, removed } = payload
  // payload 已经是 { added: string[], modified: string[], removed: string[] }
  const addedCount    = added.length
  const modifiedCount = modified.length
  const removedCount  = removed.length
  // ... 其余逻辑
})
```

删除整个 `as any` workaround 和其上方的 eslint-disable 注释。

- [ ] **Step 4: 全量类型检查**

```bash
pnpm typecheck 2>&1
```

期望：零错误，且 `grep -r "as any" src/` 返回空结果

```bash
grep -r "as any" src/ --include="*.ts" --include="*.tsx"
```

期望：无输出

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePhotoQuery.ts src/components/grid/BatchActionBar.tsx src/services/eventBus.ts
git commit -m "fix(frontend): eliminate all 'as any' type casts — type-safe discriminated unions"
```

---

### Task B3: Hook 两层分离 — 创建 usePhotoData

**Files:**
- Create: `src/hooks/usePhotoData.ts`
- Modify: `src/hooks/usePhotoQuery.ts`

- [ ] **Step 1: 创建 src/hooks/usePhotoData.ts**

```typescript
/**
 * @file src/hooks/usePhotoData.ts
 * @description 纯数据层 Hook — 只知道 PhotoFilter，不感知视图类型
 *
 * 职责：
 *   - 接收 PhotoFilter 参数
 *   - 管理 TanStack Query useInfiniteQuery
 *   - 将分页结果同步到 photoStore（始终用 setPhotos 全量同步，避免竞态）
 *   - 暴露 fetchMore / hasMore / isLoading
 *
 * 不做的事：
 *   - 不读取 viewState / layoutStore
 *   - 不重置 selectionStore
 *   - 不处理视图切换逻辑
 */

import { useEffect, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/services/tauriIpc'
import { usePhotoStore } from '@/stores/photoStore'
import type { PhotoFilter } from '@/types/ipc'

const PAGE_SIZE = 100

export interface UsePhotoDataResult {
  isLoading:      boolean
  isFetchingMore: boolean
  hasMore:        boolean
  totalCount:     number
  loadMore:       () => void
  error:          Error | null
}

export function usePhotoData(filter: PhotoFilter): UsePhotoDataResult {
  const setPhotos   = usePhotoStore((s) => s.setPhotos)
  const setFetching = usePhotoStore((s) => s.setIsFetchingMore)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery({
    queryKey: ['photos', filter] as const,
    // queryFn 从 queryKey 读取 filter，避免闭包捕获过渡态
    queryFn: ({ pageParam, queryKey }) => {
      const qFilter = queryKey[1] as PhotoFilter
      return api.photos.list(qFilter, pageParam as string | undefined, PAGE_SIZE)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: Infinity,
    gcTime:    10 * 60 * 1000,
  })

  // 同步到 photoStore — 始终用 setPhotos 全量同步（F-17 竞态修复保留）
  useEffect(() => {
    if (!data) return
    const allPhotos = data.pages.flatMap((p) => p.items)
    const total     = data.pages[0]?.total ?? 0
    setPhotos(allPhotos, total)
  }, [data, setPhotos])

  // isFetchingMore 状态同步
  useEffect(() => {
    setFetching(isFetchingNextPage)
  }, [isFetchingNextPage, setFetching])

  const loadMore = useMemo(
    () => () => { if (hasNextPage && !isFetchingNextPage) fetchNextPage() },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  return {
    isLoading,
    isFetchingMore: isFetchingNextPage,
    hasMore:        hasNextPage ?? false,
    totalCount:     data?.pages[0]?.total ?? 0,
    loadMore,
    error:          error as Error | null,
  }
}
```

- [ ] **Step 2: 重构 src/hooks/usePhotoQuery.ts 为协调层**

将文件替换为：

```typescript
/**
 * @file src/hooks/usePhotoQuery.ts
 * @description 协调层 Hook — 视图感知、状态协调，委托数据获取给 usePhotoData
 *
 * 职责：
 *   - 从 layoutStore 读取 viewState
 *   - 调用 viewStateToFilter() 构建 PhotoFilter
 *   - 视图切换时清空 photoStore 和 selectionStore
 *   - 将协调后的 filter 传给 usePhotoData
 *
 * 不做的事：
 *   - 不直接调用 api.*
 *   - 不管理 TanStack Query 状态
 *   - 不写入 photoStore（由 usePhotoData 负责）
 */

import { useEffect, useMemo, useRef } from 'react'
import { useUiStore, selectCurrentView } from '@/stores/uiStore'
import { useLayoutStore, selectSortBy, selectSortAsc } from '@/stores/layoutStore'
import { usePhotoStore } from '@/stores/photoStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { viewStateToFilter } from '@/types/layout'
import { usePhotoData, type UsePhotoDataResult } from './usePhotoData'
import type { PhotoFilter } from '@/types/ipc'

export type { UsePhotoDataResult as UsePhotoQueryResult }

export function usePhotoQuery(): UsePhotoDataResult {
  const currentView    = useUiStore(selectCurrentView)
  const sortBy         = useLayoutStore(selectSortBy)
  const sortAsc        = useLayoutStore(selectSortAsc)
  const setPhotos      = usePhotoStore((s) => s.setPhotos)
  const resetSelection = useSelectionStore((s) => s.reset)

  // 判断是否为 tag 搜索视图（由 useTagPhotoQuery 负责写入 photoStore）
  const isTagSearch =
    currentView.type === 'search' &&
    'query' in currentView &&
    typeof currentView.query === 'string' &&
    currentView.query.startsWith('#')

  // 构建 filter：视图特定字段（base）优先级高于 layoutStore 默认排序
  const filter = useMemo((): PhotoFilter => {
    if (isTagSearch) return { isDeleted: false }
    const base = viewStateToFilter(currentView)
    return { sortBy, sortAsc, ...base }
  }, [currentView, sortBy, sortAsc, isTagSearch])

  // 视图切换时清空状态（防止旧数据残留）
  const prevFilterRef = useRef<string>('')
  useEffect(() => {
    if (isTagSearch) return
    const curr = JSON.stringify(filter)
    if (prevFilterRef.current !== curr) {
      prevFilterRef.current = curr
      setPhotos([], 0)
      resetSelection()
    }
  }, [isTagSearch, filter, setPhotos, resetSelection])

  return usePhotoData(filter)
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
pnpm typecheck 2>&1 | head -20
```

期望：零错误

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePhotoData.ts src/hooks/usePhotoQuery.ts
git commit -m "refactor(frontend): split usePhotoQuery into data layer (usePhotoData) + coordination layer"
```

---

### Task B4: 创建 Locale 文件并替换硬编码字符串

**Files:**
- Create: `src/locales/zh-CN.ts`
- Create: `src/locales/index.ts`
- Modify: `src/services/tauriIpc.ts`
- Modify: `src/app/routes.tsx`

- [ ] **Step 1: 创建 src/locales/zh-CN.ts**

```typescript
// src/locales/zh-CN.ts
// 所有中文字符串的单一来源（按模块分组）
// 修改字符串时只改此文件，调用方通过 t() 或 locale.* 引用，不受影响

export const zhCN = {
  nav: {
    allPhotos:      '所有照片',
    favorites:      '收藏',
    recentImports:  '最近导入',
    trash:          '回收站',
    settings:       '设置',
  },

  errors: {
    SCAN_IN_PROGRESS:       '正在扫描中，请稍候',
    UNDO_EMPTY:             '没有可撤销的操作',
    PHOTO_NOT_FOUND:        '找不到该照片，可能已被移动或删除',
    ALBUM_NOT_FOUND:        '找不到该相册',
    FOLDER_NOT_FOUND:       '文件夹不存在',
    NOT_FOUND:              '找不到该资源',
    INVALID_PARAMS:         '参数无效',
    LIMIT_EXCEEDED:         '操作数量超出限制（最多 1000 项）',
    FOLDER_ALREADY_WATCHED: '该文件夹已在监听列表中',
    FOLDER_NESTED:          '文件夹不能包含已有监听文件夹',
    DB_ERROR:               '数据库操作失败',
    IO_ERROR:               '文件读写失败',
    THUMBNAIL_ERROR:        '缩略图生成失败',
    SIDECAR_ERROR:          '图片处理服务异常，请重试',
    EXIF_ERROR:             'EXIF 元数据解析失败',
    SERDE_ERROR:            '数据序列化失败',
    UNKNOWN:                '操作失败，请重试',
  },

  toast: {
    scanComplete: (newCount: number, updatedCount: number, sec: string) =>
      `扫描完成：新增 ${newCount} 张，更新 ${updatedCount} 张（用时 ${sec}s）`,
    deleteSuccess:  (count: number) => `已删除 ${count} 张照片`,
    restoreSuccess: (count: number) => `已恢复 ${count} 张照片`,
  },

  album: {
    create:          '新建相册',
    delete:          '删除相册',
    private:         '私密相册',
    enterPassword:   '请输入密码',
    wrongPassword:   '密码错误',
    noPhotos:        '相册为空',
  },

  preview: {
    exifInfo:   'EXIF 信息',
    close:      '关闭',
    noExif:     '暂无 EXIF 信息',
  },

  settings: {
    title:       '设置',
    theme:       '主题',
    gridDensity: '网格密度',
    appearance:  '外观',
    general:     '通用',
    storage:     '存储',
    performance: '性能',
    about:       '关于',
    import:      '导入',
  },

  grid: {
    empty:       '没有找到照片',
    loadMore:    '加载更多',
    selectAll:   '全选',
    deselectAll: '取消全选',
  },

  common: {
    confirm:  '确定',
    cancel:   '取消',
    delete:   '删除',
    restore:  '恢复',
    close:    '关闭',
    save:     '保存',
  },
} as const
```

- [ ] **Step 2: 创建 src/locales/index.ts**

```typescript
// src/locales/index.ts
// 预留 i18n 扩展接口：当前直接返回中文字符串。
// 未来接入 react-i18next 时，只改此文件，调用方签名不变。

import { zhCN } from './zh-CN'

type Locale = typeof zhCN

// 辅助类型：将嵌套对象键路径展平为点分字符串
type NestedKeyOf<T, Prefix extends string = ''> = {
  [K in keyof T]: T[K] extends (...args: unknown[]) => unknown
    ? never
    : T[K] extends object
    ? NestedKeyOf<T[K], `${Prefix}${Prefix extends '' ? '' : '.'}${string & K}`>
    : `${Prefix}${Prefix extends '' ? '' : '.'}${string & K}`
}[keyof T]

function getNestedValue(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return key
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : key
}

// 模式一：静态字符串 — t('nav.allPhotos') → '所有照片'
// 未来替换实现时调用方不变
export function t(key: string): string {
  return getNestedValue(zhCN as unknown as Record<string, unknown>, key)
}

// 模式二：参数化字符串 — locale.toast.scanComplete(3, 0, '1.2')
// 直接访问 zhCN 对象上的函数
export const locale = zhCN
```

- [ ] **Step 3: 更新 tauriIpc.ts 使用 locale**

在 `src/services/tauriIpc.ts` 中：

在 import 区顶部加入：
```typescript
import { locale } from '@/locales'
```

将 `buildUserMessage` 函数替换为：
```typescript
function buildUserMessage(err: import('@/types/ipc').IpcError): string {
  const key = err.code as keyof typeof locale.errors
  return (locale.errors[key] as string | undefined) ?? err.message ?? locale.errors.UNKNOWN
}
```

- [ ] **Step 4: 更新 routes.tsx 导航标签**

在 `src/app/routes.tsx` 中，找到硬编码的导航标签字符串（'所有照片'、'收藏'、'最近导入'、'回收站'）：

在文件顶部加入：
```typescript
import { locale } from '@/locales'
```

将每处硬编码字符串替换：
```typescript
// 原：label: '所有照片'
// 改：
label: locale.nav.allPhotos,

// 原：label: '收藏'
label: locale.nav.favorites,

// 原：label: '最近导入'
label: locale.nav.recentImports,

// 原：label: '回收站'
label: locale.nav.trash,
```

- [ ] **Step 5: 验证编译**

```bash
pnpm typecheck 2>&1 | head -20
```

期望：零错误

- [ ] **Step 6: Commit**

```bash
git add src/locales/ src/services/tauriIpc.ts src/app/routes.tsx
git commit -m "feat(frontend): centralize all Chinese strings in src/locales/zh-CN.ts with i18n-ready interface"
```

---

### Task B5: 安装 Vitest 并编写前端单元测试

**Files:**
- Modify: `package.json`
- Create: `vite.config.ts` (or modify existing)
- Create: `src/__tests__/stores/photoStore.test.ts`
- Create: `src/__tests__/stores/selectionStore.test.ts`
- Create: `src/__tests__/types/layout.test.ts`

- [ ] **Step 1: 安装 Vitest 依赖**

```bash
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: 配置 Vitest**

检查是否已有 `vite.config.ts`（若无则创建），在 `defineConfig` 中加入 `test` 字段：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
})
```

创建 `src/__tests__/setup.ts`：
```typescript
// src/__tests__/setup.ts
import '@testing-library/jest-dom'
// Mock Tauri IPC — 测试环境中无 Tauri 运行时
vi.mock('@/services/tauriIpc', () => ({
  api: {
    photos: {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null, total: 0 }),
    },
  },
  ipc: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
```

在 `package.json` scripts 中加入：
```json
"test": "vitest run",
"test:ui": "vitest --ui"
```

- [ ] **Step 3: 编写 photoStore.test.ts**

```typescript
// src/__tests__/stores/photoStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { usePhotoStore } from '@/stores/photoStore'
import type { PhotoThumb } from '@/types/photo'

function makePhoto(id: string, createdAt: string): PhotoThumb {
  return {
    id, createdAt, fileName: `${id}.jpg`,
    width: 100, height: 100, orientation: 1,
    isFavorite: false, isDeleted: false,
    thumbnailS: null, thumbnailM: null,
    format: 'jpeg', folderPath: '/photos',
  }
}

describe('photoStore', () => {
  beforeEach(() => {
    usePhotoStore.getState().reset()
  })

  it('setPhotos builds correct groups', () => {
    const photos = [
      makePhoto('a', '2024-03-15T00:00:00Z'),
      makePhoto('b', '2024-03-20T00:00:00Z'),
      makePhoto('c', '2024-02-10T00:00:00Z'),
    ]
    usePhotoStore.getState().setPhotos(photos, 3)

    const { groups, total } = usePhotoStore.getState()
    expect(total).toBe(3)
    expect(groups).toHaveLength(2)
    // 最新月份在前
    expect(groups[0].key).toBe('2024-03')
    expect(groups[0].photos).toHaveLength(2)
    expect(groups[1].key).toBe('2024-02')
  })

  it('appendPhotos is O(pageSize) — existing month group updated without full resort', () => {
    const initial = [makePhoto('a', '2024-03-01T00:00:00Z')]
    usePhotoStore.getState().setPhotos(initial, 1)

    const newPhotos = [makePhoto('b', '2024-03-15T00:00:00Z')]
    usePhotoStore.getState().appendPhotos(newPhotos)

    const { groups } = usePhotoStore.getState()
    expect(groups).toHaveLength(1)
    expect(groups[0].photos).toHaveLength(2)
  })

  it('appendPhotos adds new month group when needed', () => {
    usePhotoStore.getState().setPhotos([makePhoto('a', '2024-03-01T00:00:00Z')], 1)
    usePhotoStore.getState().appendPhotos([makePhoto('b', '2024-02-01T00:00:00Z')])

    const { groups } = usePhotoStore.getState()
    expect(groups).toHaveLength(2)
    expect(groups[0].key).toBe('2024-03') // 倒序：新在前
    expect(groups[1].key).toBe('2024-02')
  })

  it('removePhotos removes photo and updates total', () => {
    usePhotoStore.getState().setPhotos([
      makePhoto('a', '2024-03-01T00:00:00Z'),
      makePhoto('b', '2024-03-02T00:00:00Z'),
    ], 2)

    usePhotoStore.getState().removePhotos(['a'])

    const { photos, total, groups } = usePhotoStore.getState()
    expect(photos).toHaveLength(1)
    expect(total).toBe(1)
    expect(groups[0].photos).toHaveLength(1)
    expect(groups[0].photos[0].id).toBe('b')
  })

  it('updatePhoto patches specific photo without changing groups', () => {
    usePhotoStore.getState().setPhotos([makePhoto('a', '2024-03-01T00:00:00Z')], 1)
    usePhotoStore.getState().updatePhoto('a', { isFavorite: true })

    const photo = usePhotoStore.getState().photos[0]
    expect(photo.isFavorite).toBe(true)
  })
})
```

- [ ] **Step 4: 编写 layout.test.ts**

```typescript
// src/__tests__/types/layout.test.ts
import { describe, it, expect } from 'vitest'
import { viewStateToFilter } from '@/types/layout'

describe('viewStateToFilter', () => {
  it('all_photos returns isDeleted false', () => {
    const f = viewStateToFilter({ type: 'all_photos' })
    expect(f.isDeleted).toBe(false)
    expect(f.favoritesOnly).toBeUndefined()
  })

  it('favorites returns favoritesOnly true', () => {
    const f = viewStateToFilter({ type: 'favorites' })
    expect(f.favoritesOnly).toBe(true)
    expect(f.isDeleted).toBe(false)
  })

  it('recently_imported returns sortBy imported_at', () => {
    const f = viewStateToFilter({ type: 'recently_imported' })
    expect(f.sortBy).toBe('imported_at')
    expect(f.isDeleted).toBe(false)
  })

  it('album returns albumId', () => {
    const f = viewStateToFilter({ type: 'album', albumId: 'abc-123' })
    expect(f.albumId).toBe('abc-123')
  })

  it('folder returns folderPath', () => {
    const f = viewStateToFilter({ type: 'folder', folderPath: '/photos/vacation' })
    expect(f.folderPath).toBe('/photos/vacation')
  })

  it('trash returns isDeleted true', () => {
    const f = viewStateToFilter({ type: 'trash' })
    expect(f.isDeleted).toBe(true)
  })

  it('search returns isDeleted false (search handled separately)', () => {
    const f = viewStateToFilter({ type: 'search', query: 'cat' })
    expect(f.isDeleted).toBe(false)
  })
})
```

- [ ] **Step 5: 运行测试**

```bash
pnpm test 2>&1 | tail -20
```

期望：`Tests N passed (0 failed)`

- [ ] **Step 6: Commit**

```bash
git add package.json vite.config.ts src/__tests__/ src/locales/
git commit -m "test(frontend): add Vitest + photoStore, layout.test.ts unit tests"
```

---

## TRACK C: 横切面

---

### Task C1: 添加 LICENSE 和社区文件

**Files:**
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 1: 创建 LICENSE**

```
MIT License

Copyright (c) 2026 LightAlbum Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: 创建 CONTRIBUTING.md**

```markdown
# Contributing to LightAlbum

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | https://nodejs.org |
| pnpm | ≥ 8 | `npm i -g pnpm` |
| Rust | ≥ 1.77 | https://rustup.rs |
| Windows | MSVC Build Tools | `winget install Microsoft.VisualStudio.2022.BuildTools` |
| macOS | Xcode CLT | `xcode-select --install` |

## Setup

​```bash
# 1. Install frontend dependencies
pnpm install

# 2. Build Sharp sidecar (required for HEIC/RAW thumbnails)
cd sidecar && node scripts/bundle.js && cd ..

# 3. Start development (Tauri + Vite)
pnpm tauri dev
```

## Branch Naming

- `feat/short-description` — new feature
- `fix/short-description` — bug fix
- `refactor/short-description` — refactor without behavior change
- `docs/short-description` — documentation only

## Commit Format

```
type(scope): short description

# Types: feat | fix | refactor | test | docs | chore
# Scope: rust | frontend | ci | deps
# Example: fix(frontend): eliminate EventBus memory leak
```

## Before Submitting a PR

```bash
pnpm lint          # ESLint
pnpm typecheck     # TypeScript
pnpm test          # Vitest unit tests
cd src-tauri && cargo fmt --check && cargo clippy && cargo test
```

## Sidecar Rebuild

If you modify anything in `sidecar/`, rebuild the binary before testing:
```bash
cd sidecar && node scripts/bundle.js
```

The binary outputs to `src-tauri/binaries/`.
```

- [ ] **Step 3: 创建 CODE_OF_CONDUCT.md**

​```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We pledge to make participation in this project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity, level of experience, nationality, race, religion, or sexual identity.

## Our Standards

**Acceptable behavior:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Accepting constructive criticism gracefully
- Focusing on what is best for the community

**Unacceptable behavior:**
- Harassment, insults, or derogatory comments
- Publishing others' private information without permission
- Any conduct that would be considered inappropriate in a professional setting

## Enforcement

Instances of unacceptable behavior may be reported by opening a GitHub issue or contacting the maintainers via SECURITY.md. All complaints will be reviewed and investigated.

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org), version 1.4.
```

- [ ] **Step 4: 创建 SECURITY.md**

```markdown
# Security Policy

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Please disclose vulnerabilities privately by emailing the maintainers. We will:
- Acknowledge receipt within 48 hours
- Provide an estimated fix timeline within 7 days
- Credit you in the release notes (unless you prefer anonymity)

## Scope

- SQL injection via IPC commands
- Path traversal in file scanner
- Arbitrary code execution via sidecar process
- Private album password bypass

## Out of Scope

- Issues in dependencies (report upstream)
- Denial of service on local machine
```

- [ ] **Step 5: 创建 CHANGELOG.md**

```markdown
# Changelog

All notable changes to LightAlbum are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] — 2026-04-26

### Added
- Photo import with recursive folder scanning and live file watching
- Virtualized waterfall grid with 4 density presets
- Full-screen photo preview with EXIF metadata panel and filmstrip navigation
- Album management with private album support (bcrypt password protection)
- Color-coded tag system with tag filter panel
- Full-text search across filenames, camera models, and metadata
- Trash with 30-day soft delete and restore
- Three-tier thumbnail pipeline with LRU cache and Sharp sidecar for HEIC/RAW
- Dark / Light / System theme support
- Batch operations (multi-select, drag-select, batch favorite/delete with undo)
- Undo support (Ctrl+Z) for delete, favorite, album add operations

### Architecture
- Tauri v2 + React 19 + TypeScript + Rust backend
- SQLite with WAL mode and r2d2 connection pool
- Repository trait pattern for decoupled data access layer
- Zustand v5 stores + TanStack Query v5 for state and cache management
```

- [ ] **Step 6: 创建 .github/PULL_REQUEST_TEMPLATE.md**

```markdown
## Summary

<!-- What does this PR do? 1-3 sentences. -->

## Changes

- 
- 

## Test Plan

- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes  
- [ ] `pnpm test` passes (unit tests)
- [ ] `cargo test` passes (Rust tests)
- [ ] Manually tested: <!-- describe what you clicked/tested -->

## Screenshots (if UI change)

<!-- Before / After -->

## Checklist

- [ ] No `as any` introduced
- [ ] No hardcoded Chinese strings (use `locale.*` or `t()`)
- [ ] No direct SQL in `commands/*.rs` (use Repository trait)
```

- [ ] **Step 7: Commit**

```bash
git add LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs: add LICENSE (MIT), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, PR template"
```

---

### Task C2: 创建 GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 创建 CI workflow**

创建 `.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  frontend:
    name: Frontend (lint + typecheck + test)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Type check
        run: pnpm typecheck

      - name: Unit tests
        run: pnpm test

  rust:
    name: Rust (fmt + clippy + test)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install system deps (Ubuntu)
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev \
            libappindicator3-dev librsvg2-dev patchelf

      - name: Check formatting
        run: cargo fmt --check
        working-directory: src-tauri

      - name: Clippy
        run: cargo clippy -- -D warnings
        working-directory: src-tauri

      - name: Tests
        run: cargo test -- --test-threads=4
        working-directory: src-tauri

  windows-compat:
    name: Windows compatibility check
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - uses: pnpm/action-setup@v4
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install frontend deps
        run: pnpm install --frozen-lockfile

      - name: Rust check
        run: cargo check
        working-directory: src-tauri
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (frontend lint/test + rust fmt/clippy/test + windows compat)"
```

---

### Task C3: 补全 README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在 README 的 Prerequisites 章节补充平台工具链**

找到中英文两处 `Prerequisites` / `环境要求` 章节，在已有 Node.js / Rust / pnpm 要求之后追加：

英文版：
```markdown
**Platform-specific build tools (required by Tauri):**
- **Windows:** [MSVC Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select "Desktop development with C++"
- **macOS:** Xcode Command Line Tools — run `xcode-select --install`
- **Linux:** `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev`
```

中文版：
```markdown
**平台构建工具（Tauri 必需）：**
- **Windows：** [MSVC Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，选择"使用 C++ 的桌面开发"
- **macOS：** Xcode Command Line Tools，运行 `xcode-select --install`
- **Linux：** `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev`
```

- [ ] **Step 2: 在 Install Dependencies 后添加 Sidecar 构建步骤**

英文版（在 `pnpm install` 之后插入）：
```markdown
#### Build Sharp Sidecar (required for HEIC/RAW thumbnails)

​```bash
cd sidecar && node scripts/bundle.js && cd ..
```

> Re-run this step if you update anything in `sidecar/`.
```

中文版：
​```markdown
#### 构建 Sharp Sidecar（HEIC/RAW 缩略图处理必需）

​```bash
cd sidecar && node scripts/bundle.js && cd ..
```

> 修改 `sidecar/` 目录内容后需重新运行此命令。
```

- [ ] **Step 3: 添加数据目录位置说明**

在 Architecture / 架构亮点章节前插入：

英文版：
​```markdown
### Data Directory

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\LightAlbum\` |
| macOS | `~/Library/Application Support/LightAlbum/` |
| Linux | `~/.local/share/LightAlbum/` |

Contains: `library.db` (SQLite), `thumbnails/`, `settings.json`
```

中文版：
```markdown
### 数据目录

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\LightAlbum\` |
| macOS | `~/Library/Application Support/LightAlbum/` |
| Linux | `~/.local/share/LightAlbum/` |

包含：`library.db`（SQLite 数据库）、`thumbnails/`（缩略图缓存）、`settings.json`
```

- [ ] **Step 4: 添加 CI badge**

在 README 标题行下方（`[English] | [中文]` 之前）插入：
```markdown
[![CI](https://github.com/YOUR_USERNAME/lightalbum/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/lightalbum/actions/workflows/ci.yml)
```

（注意：`YOUR_USERNAME` 需在发布时替换为真实 GitHub 用户名/组织名）

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README — add platform toolchain, sidecar build step, data directory, CI badge"
```

---

## 验收检查

- [ ] **Track A 验收**
  ```bash
  cd src-tauri && cargo test -- --test-threads=4
  # 期望：test result: ok. N passed; 0 failed
  cd src-tauri && cargo clippy -- -D warnings
  # 期望：无 warning
  grep -r "state\.conn()" src-tauri/src/commands/
  # 期望：无输出（命令层不再直接获取连接）
  ```

- [ ] **Track B 验收**
  ```bash
  pnpm typecheck
  # 期望：零错误
  pnpm test
  # 期望：all tests passed
  grep -r "as any" src/ --include="*.ts" --include="*.tsx"
  # 期望：无输出
  ```

- [ ] **Track C 验收**
  ```bash
  ls LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md
  # 期望：全部存在
  ls .github/workflows/ci.yml
  # 期望：存在
  ```

- [ ] **整体验收**
  ```bash
  pnpm tauri build
  # 期望：Finished release 无 error
  ```
