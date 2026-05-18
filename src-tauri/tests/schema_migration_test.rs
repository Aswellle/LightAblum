use light_album_lib::db::schema;
use r2d2_sqlite::SqliteConnectionManager;
use tempfile::tempdir;

#[test]
fn test_migration_idempotent() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("test.db");
    let mgr = SqliteConnectionManager::file(&db);
    let pool = r2d2::Pool::builder().max_size(1).build(mgr).unwrap();
    let conn = pool.get().unwrap();

    // 运行两次 migration，不应 panic 或返回错误
    schema::run_migrations(&conn, &db).expect("first migration failed");
    schema::run_migrations(&conn, &db).expect("second migration (idempotency) failed");
}

#[test]
fn test_tables_exist_after_migration() {
    let dir = tempdir().unwrap();
    let db = dir.path().join("test.db");
    let mgr = SqliteConnectionManager::file(&db);
    let pool = r2d2::Pool::builder().max_size(1).build(mgr).unwrap();
    let conn = pool.get().unwrap();
    schema::run_migrations(&conn, &db).unwrap();

    let tables: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    };

    for expected in &[
        "photos",
        "albums",
        "album_photos",
        "tags",
        "photo_tags",
        "undo_log",
        "watched_folders",
    ] {
        assert!(
            tables.contains(&expected.to_string()),
            "missing table: {expected}"
        );
    }
}
