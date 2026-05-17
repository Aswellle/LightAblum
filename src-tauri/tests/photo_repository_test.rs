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