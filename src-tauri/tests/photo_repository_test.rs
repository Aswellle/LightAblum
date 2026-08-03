//! PhotoRepository 集成测试 — 使用 tempfile 隔离数据库
use light_album_lib::db::photo::NewPhoto;
use light_album_lib::db::{schema, PhotoRepository, SqlitePhotoRepository};
use light_album_lib::query::filter::PhotoFilter;
use r2d2_sqlite::SqliteConnectionManager;
use std::sync::Arc;
use tempfile::tempdir;

fn make_repo() -> (tempfile::TempDir, SqlitePhotoRepository, Arc<r2d2::Pool<SqliteConnectionManager>>) {
    let dir = tempdir().unwrap();
    let db = dir.path().join("test.db");
    let mgr = SqliteConnectionManager::file(&db);
    let pool = r2d2::Pool::builder().max_size(2).build(mgr).unwrap();
    {
        let conn = pool.get().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .unwrap();
        schema::run_migrations(&conn, &db).unwrap();
    }
    let pool_arc = Arc::new(pool);
    let repo = SqlitePhotoRepository::new(Arc::clone(&pool_arc));
    (dir, repo, pool_arc)
}

fn sample_photo(file_path: &str) -> NewPhoto {
    NewPhoto {
        file_path: file_path.into(),
        file_name: "test.jpg".into(),
        file_size: 1024,
        file_hash: uuid::Uuid::new_v4().to_string(),
        width: 100,
        height: 100,
        orientation: 1,
        format: "jpeg".into(),
        created_at: "2024-01-01T00:00:00Z".into(),
        modified_at: "2024-01-01T00:00:00Z".into(),
        folder_path: "/photos".into(),
        gps_lat: None,
        gps_lng: None,
        camera_make: None,
        camera_model: None,
        lens_model: None,
        focal_length: None,
        aperture: None,
        shutter_speed: None,
        iso: None,
        exposure_comp: None,
    }
}

#[test]
fn test_insert_and_list() {
    let (_dir, repo, _pool) = make_repo();
    let photos = vec![sample_photo("/photos/a.jpg"), sample_photo("/photos/b.jpg")];
    let inserted = repo.insert_batch(&photos).unwrap();
    assert_eq!(inserted, 2);

    let page = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.total, 2);
}

#[test]
fn test_list_limit_enforced() {
    let (_dir, repo, _pool) = make_repo();
    let photos: Vec<NewPhoto> = (0..5)
        .map(|i| sample_photo(&format!("/photos/{i}.jpg")))
        .collect();
    repo.insert_batch(&photos).unwrap();

    let page = repo.list(&PhotoFilter::default(), None, 2).unwrap();
    assert_eq!(page.items.len(), 2);
    assert!(page.next_cursor.is_some());
}

#[test]
fn test_cursor_pagination() {
    let (_dir, repo, _pool) = make_repo();
    let photos: Vec<NewPhoto> = (0..5)
        .map(|i| sample_photo(&format!("/photos/{i}.jpg")))
        .collect();
    repo.insert_batch(&photos).unwrap();

    let page1 = repo.list(&PhotoFilter::default(), None, 3).unwrap();
    assert_eq!(page1.items.len(), 3);
    let cursor = page1.next_cursor.unwrap();

    let page2 = repo
        .list(&PhotoFilter::default(), Some(&cursor), 3)
        .unwrap();
    assert_eq!(page2.items.len(), 2);
    assert!(page2.next_cursor.is_none());
}

#[test]
fn test_favorites_filter() {
    let (_dir, repo, _pool) = make_repo();
    repo.insert_batch(&[sample_photo("/photos/a.jpg")]).unwrap();
    let page = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    let id = page.items[0].id.clone();

    repo.set_favorite(&id, true).unwrap();
    let filter = PhotoFilter {
        favorites_only: true,
        ..Default::default()
    };
    let fav_page = repo.list(&filter, None, 10).unwrap();
    assert_eq!(fav_page.items.len(), 1);
    assert_eq!(fav_page.items[0].id, id);
}

#[test]
fn test_soft_delete_and_restore() {
    let (_dir, repo, _pool) = make_repo();
    repo.insert_batch(&[sample_photo("/photos/a.jpg")]).unwrap();
    let page = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    let id = page.items[0].id.clone();

    repo.soft_delete(&[id.clone()]).unwrap();
    let after_delete = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    assert_eq!(after_delete.total, 0);

    repo.restore(&[id.clone()]).unwrap();
    let after_restore = repo.list(&PhotoFilter::default(), None, 10).unwrap();
    assert_eq!(after_restore.total, 1);
}

/// BUGFIX regression test: purge_old_trash previously deleted expired rows and
/// returned only a row count, giving callers no way to clean up the matching
/// original/thumbnail files on disk — and it was never actually wired up to run
/// anywhere, so trash never auto-expired at all. This confirms it now: (a) only
/// deletes rows past the 30-day cutoff, (b) leaves recently-deleted rows alone,
/// and (c) returns enough info (id, file_path, file_hash) for disk cleanup.
#[test]
fn test_purge_old_trash_only_removes_expired() {
    use light_album_lib::db::photo as photo_db;

    let (_dir, repo, pool) = make_repo();
    repo.insert_batch(&[sample_photo("/photos/old.jpg"), sample_photo("/photos/recent.jpg")])
        .unwrap();

    let conn = pool.get().unwrap();
    let old_id = photo_db::get_by_path(&conn, "/photos/old.jpg").unwrap().unwrap().id;
    let recent_id = photo_db::get_by_path(&conn, "/photos/recent.jpg").unwrap().unwrap().id;
    drop(conn);

    repo.soft_delete(&[old_id.clone(), recent_id.clone()]).unwrap();

    // Backdate one of the two deleted_at timestamps past the 30-day cutoff directly via SQL,
    // since soft_delete() always stamps "now" and there's no repository method for backdating.
    {
        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE photos SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-31 days') WHERE id = ?1",
            rusqlite::params![old_id],
        )
        .unwrap();
    }

    let expired = repo.purge_old_trash().unwrap();
    assert_eq!(expired.len(), 1);
    assert_eq!(expired[0].0, old_id);

    // Expired row is gone; recently-deleted row survives (still soft-deleted, not purged).
    let conn = pool.get().unwrap();
    assert!(photo_db::get_by_id(&conn, &old_id).unwrap().is_none());
    assert!(photo_db::get_by_id(&conn, &recent_id).unwrap().is_some());
}

/// Regression test for the data-loss fix: photos the file watcher marked missing
/// (mark_missing → is_deleted=1, deleted_at=NULL) are NOT user trash and must never
/// be auto-purged — their original files may just be temporarily offline (unplugged
/// drive / network share), and a purge that deletes originals once they return would
/// destroy data irrecoverably.
#[test]
fn test_purge_old_trash_skips_watcher_missing() {
    use light_album_lib::db::photo as photo_db;

    let (_dir, repo, pool) = make_repo();
    repo.insert_batch(&[sample_photo("/photos/missing.jpg")]).unwrap();

    let conn = pool.get().unwrap();
    let id = photo_db::get_by_path(&conn, "/photos/missing.jpg").unwrap().unwrap().id;
    drop(conn);

    // Simulate the watcher marking the file as missing: is_deleted=1, deleted_at stays NULL.
    {
        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE photos SET is_deleted = 1, deleted_at = NULL WHERE id = ?1",
            rusqlite::params![id],
        )
        .unwrap();
    }

    // Even though the row is soft-deleted, it must NOT be auto-purged (deleted_at NULL).
    let expired = repo.purge_old_trash().unwrap();
    assert!(expired.is_empty(), "watcher-missing rows must not be auto-purged");

    let conn = pool.get().unwrap();
    assert!(photo_db::get_by_id(&conn, &id).unwrap().is_some());
}
