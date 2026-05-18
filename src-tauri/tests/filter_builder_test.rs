//! 验证 PhotoFilter 各字段正确转译为 SQL 查询结果
use light_album_lib::db::photo::NewPhoto;
use light_album_lib::db::schema;
use light_album_lib::db::{PhotoRepository, SqlitePhotoRepository};
use light_album_lib::query::filter::PhotoFilter;
use r2d2_sqlite::SqliteConnectionManager;
use std::sync::Arc;
use tempfile::tempdir;

fn make_repo() -> (tempfile::TempDir, SqlitePhotoRepository) {
    let dir = tempdir().unwrap();
    let db = dir.path().join("test.db");
    let mgr = SqliteConnectionManager::file(&db);
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
        file_path: path.into(),
        file_name: "x.jpg".into(),
        file_size: 1,
        file_hash: uuid::Uuid::new_v4().to_string(),
        width: 1,
        height: 1,
        orientation: 1,
        format: format.into(),
        created_at: created_at.into(),
        modified_at: created_at.into(),
        folder_path: folder.into(),
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
fn test_filter_by_folder() {
    let (_dir, repo) = make_repo();
    repo.insert_batch(&[
        photo("/a/1.jpg", "/a", "jpeg", "2024-01-01T00:00:00Z"),
        photo("/b/2.jpg", "/b", "jpeg", "2024-01-01T00:00:00Z"),
    ])
    .unwrap();

    let filter = PhotoFilter {
        folder_path: Some("/a".into()),
        ..Default::default()
    };
    let page = repo.list(&filter, None, 10).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].folder_path, "/a");
}

#[test]
fn test_filter_by_format() {
    let (_dir, repo) = make_repo();
    repo.insert_batch(&[
        photo("/a/1.jpg", "/a", "jpeg", "2024-01-01T00:00:00Z"),
        photo("/a/2.png", "/a", "png", "2024-01-01T00:00:00Z"),
    ])
    .unwrap();

    let filter = PhotoFilter {
        format: Some("png".into()),
        ..Default::default()
    };
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
    ])
    .unwrap();

    let filter = PhotoFilter {
        date_from: Some("2024-01-01T00:00:00Z".into()),
        date_to: Some("2024-12-31T23:59:59Z".into()),
        ..Default::default()
    };
    let page = repo.list(&filter, None, 10).unwrap();
    assert_eq!(page.total, 1);
}
