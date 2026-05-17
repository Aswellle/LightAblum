// tests/rust/db_test.rs
//
// 数据库层单元测试（Phase-E）
//
// 测试覆盖范围：
//   1. insert_batch    — 批量插入 + OR IGNORE 去重
//   2. query_paged     — 游标分页查询
//   3. set_favorite    — 收藏切换
//   4. soft_delete     — 软删除 + is_deleted 过滤
//   5. restore         — 从回收站恢复
//   6. search()        — 全文搜索（文件名 + camera_make/model）
//   7. albums CRUD     — 创建/添加照片/列表/删除
//   8. tags CRUD       — 创建/添加照片标签/列表（Phase-B）
//
// 每个测试使用独立的内存数据库（":memory:"），保证完全隔离。
// run_migrations 使用 Phase-A 新签名（db_path 参数），内存 DB 传空路径。

use light_album_lib::db::{photo, album, schema};
use light_album_lib::query::filter::PhotoFilter;
use rusqlite::Connection;
use std::path::Path;

// ─────────────────────────────────────────────────────────
//  测试辅助函数
// ─────────────────────────────────────────────────────────

/// 创建内存 SQLite 连接并初始化 Schema
fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory DB");
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    // Phase-A 签名：传空路径（内存 DB 无磁盘路径，备份逻辑被跳过）
    schema::run_migrations(&conn, Path::new("")).expect("Migration failed");
    conn
}

/// 构建测试用 NewPhoto（最小必要字段）
fn make_photo(file_path: &str, file_name: &str, camera: &str) -> photo::NewPhoto {
    photo::NewPhoto {
        file_path:    file_path.to_string(),
        file_name:    file_name.to_string(),
        file_size:    1024 * 1024,  // 1MB
        file_hash:    format!("hash_{file_path}"),
        width:        3024,
        height:       4032,
        orientation:  1,
        format:       "jpeg".to_string(),
        created_at:   "2025-06-15T10:30:00Z".to_string(),
        modified_at:  "2025-06-15T10:30:00Z".to_string(),
        folder_path:  "D:/Photos".to_string(),
        gps_lat:      None,
        gps_lng:      None,
        camera_make:  Some("Canon".to_string()),
        camera_model: Some(camera.to_string()),
        lens_model:   None,
        focal_length: Some(50.0),
        aperture:     Some(1.8),
        shutter_speed:Some("1/250".to_string()),
        iso:          Some(400),
        exposure_comp:None,
    }
}

// ─────────────────────────────────────────────────────────
//  T-1: insert_batch
// ─────────────────────────────────────────────────────────

#[test]
fn test_insert_batch_basic() {
    let conn = setup_db();
    let photos = vec![
        make_photo("D:/Photos/img001.jpg", "img001.jpg", "EOS R5"),
        make_photo("D:/Photos/img002.jpg", "img002.jpg", "EOS R5"),
        make_photo("D:/Photos/img003.jpg", "img003.jpg", "iPhone 15 Pro"),
    ];

    let inserted = photo::insert_batch(&conn, &photos).expect("insert_batch failed");
    assert_eq!(inserted, 3, "Should insert 3 photos");
}

#[test]
fn test_insert_batch_dedup_by_path() {
    let conn = setup_db();
    let photos = vec![
        make_photo("D:/Photos/img001.jpg", "img001.jpg", "EOS R5"),
    ];

    let first  = photo::insert_batch(&conn, &photos).expect("first insert failed");
    let second = photo::insert_batch(&conn, &photos).expect("second insert failed");

    assert_eq!(first,  1, "First insert should add 1 photo");
    assert_eq!(second, 0, "Second insert should skip (INSERT OR IGNORE)");
}

#[test]
fn test_insert_batch_performance() {
    // 验证 1000 张照片批量插入时间 < 2 秒
    let conn = setup_db();
    let photos: Vec<photo::NewPhoto> = (0..1000)
        .map(|i| make_photo(
            &format!("D:/Photos/img{i:04}.jpg"),
            &format!("img{i:04}.jpg"),
            "EOS R5",
        ))
        .collect();

    let start = std::time::Instant::now();
    let inserted = photo::insert_batch(&conn, &photos).expect("batch insert failed");
    let elapsed = start.elapsed();

    assert_eq!(inserted, 1000);
    assert!(
        elapsed.as_secs() < 2,
        "1000 inserts should complete in < 2s, took {elapsed:?}"
    );
}

// ─────────────────────────────────────────────────────────
//  T-2: query_paged
// ─────────────────────────────────────────────────────────

#[test]
fn test_query_paged_basic() {
    let conn = setup_db();
    let photos: Vec<photo::NewPhoto> = (0..25)
        .map(|i| make_photo(
            &format!("D:/Photos/img{i:04}.jpg"),
            &format!("img{i:04}.jpg"),
            "EOS R5",
        ))
        .collect();
    photo::insert_batch(&conn, &photos).unwrap();

    let filter = PhotoFilter::default();
    let page1 = photo::query_paged(&conn, &filter, None, 10).expect("query_paged failed");

    assert_eq!(page1.items.len(), 10, "First page should have 10 items");
    assert_eq!(page1.total, 25, "Total should be 25");
    assert!(page1.next_cursor.is_some(), "Should have next cursor");
}

#[test]
fn test_query_paged_cursor() {
    let conn = setup_db();
    let photos: Vec<photo::NewPhoto> = (0..15)
        .map(|i| make_photo(
            &format!("D:/Photos/img{i:04}.jpg"),
            &format!("img{i:04}.jpg"),
            "EOS R5",
        ))
        .collect();
    photo::insert_batch(&conn, &photos).unwrap();

    let filter = PhotoFilter::default();
    let page1 = photo::query_paged(&conn, &filter, None, 10).unwrap();
    assert_eq!(page1.items.len(), 10);

    let cursor = page1.next_cursor.as_deref();
    let page2 = photo::query_paged(&conn, &filter, cursor, 10).unwrap();
    assert_eq!(page2.items.len(), 5, "Second page should have 5 items");
    assert!(page2.next_cursor.is_none(), "Last page should have no next cursor");

    // 两页 id 无重叠
    let ids1: std::collections::HashSet<_> = page1.items.iter().map(|p| &p.id).collect();
    let ids2: std::collections::HashSet<_> = page2.items.iter().map(|p| &p.id).collect();
    assert!(ids1.is_disjoint(&ids2), "Pages should not have overlapping IDs");
}

#[test]
fn test_query_paged_favorites_only() {
    let conn = setup_db();
    let photos = vec![
        make_photo("D:/Photos/fav.jpg",   "fav.jpg",   "EOS R5"),
        make_photo("D:/Photos/norm.jpg",  "norm.jpg",  "EOS R5"),
    ];
    photo::insert_batch(&conn, &photos).unwrap();

    // Get first photo id and mark as favorite
    let all = photo::query_paged(&conn, &PhotoFilter::default(), None, 10).unwrap();
    let fav_id = &all.items.iter().find(|p| p.file_name == "fav.jpg").unwrap().id.clone();
    photo::set_favorite(&conn, fav_id, true).unwrap();

    let fav_filter = PhotoFilter { favorites_only: true, ..Default::default() };
    let fav_page = photo::query_paged(&conn, &fav_filter, None, 10).unwrap();

    assert_eq!(fav_page.items.len(), 1, "Should return only favorite photos");
    assert_eq!(fav_page.items[0].file_name, "fav.jpg");
}

// ─────────────────────────────────────────────────────────
//  T-3: set_favorite
// ─────────────────────────────────────────────────────────

#[test]
fn test_set_favorite_toggle() {
    let conn = setup_db();
    photo::insert_batch(&conn, &[make_photo("D:/Photos/a.jpg", "a.jpg", "EOS R5")]).unwrap();
    let page = photo::query_paged(&conn, &PhotoFilter::default(), None, 10).unwrap();
    let id = &page.items[0].id.clone();

    assert!(!page.items[0].is_favorite, "Initially not favorite");

    photo::set_favorite(&conn, id, true).unwrap();
    let after_fav = photo::get_by_id(&conn, id).unwrap().unwrap();
    assert!(after_fav.is_favorite, "Should be favorite after set");

    photo::set_favorite(&conn, id, false).unwrap();
    let after_unfav = photo::get_by_id(&conn, id).unwrap().unwrap();
    assert!(!after_unfav.is_favorite, "Should not be favorite after unset");
}

// ─────────────────────────────────────────────────────────
//  T-4: soft_delete + restore
// ─────────────────────────────────────────────────────────

#[test]
fn test_soft_delete_and_restore() {
    let conn = setup_db();
    photo::insert_batch(&conn, &[make_photo("D:/Photos/del.jpg", "del.jpg", "EOS R5")]).unwrap();
    let page = photo::query_paged(&conn, &PhotoFilter::default(), None, 10).unwrap();
    let id = page.items[0].id.clone();

    // 软删除
    photo::soft_delete(&conn, &[id.clone()]).unwrap();

    let normal_page = photo::query_paged(&conn, &PhotoFilter::default(), None, 10).unwrap();
    assert_eq!(normal_page.total, 0, "Deleted photo should not appear in normal view");

    let trash_filter = PhotoFilter { is_deleted: true, ..Default::default() };
    let trash_page = photo::query_paged(&conn, &trash_filter, None, 10).unwrap();
    assert_eq!(trash_page.total, 1, "Deleted photo should appear in trash");

    // 恢复
    photo::restore(&conn, &[id.clone()]).unwrap();
    let restored_page = photo::query_paged(&conn, &PhotoFilter::default(), None, 10).unwrap();
    assert_eq!(restored_page.total, 1, "Restored photo should appear in normal view");
}

// ─────────────────────────────────────────────────────────
//  T-5: search
// ─────────────────────────────────────────────────────────

#[test]
fn test_search_by_filename() {
    use light_album_lib::db::search::{search, SearchQuery};

    let conn = setup_db();
    photo::insert_batch(&conn, &[
        make_photo("D:/Photos/vacation_beach.jpg", "vacation_beach.jpg", "EOS R5"),
        make_photo("D:/Photos/family_portrait.jpg", "family_portrait.jpg", "EOS R5"),
    ]).unwrap();

    let q = SearchQuery { text: Some("vacation".to_string()), ..Default::default() };
    let result = search(&conn, &q).unwrap();

    assert_eq!(result.items.len(), 1, "Search 'vacation' should return 1 result");
    assert!(result.items[0].file_name.contains("vacation"));
}

#[test]
fn test_search_empty_query_returns_all() {
    use light_album_lib::db::search::{search, SearchQuery};

    let conn = setup_db();
    let photos: Vec<_> = (0..5)
        .map(|i| make_photo(&format!("D:/Photos/img{i}.jpg"), &format!("img{i}.jpg"), "EOS R5"))
        .collect();
    photo::insert_batch(&conn, &photos).unwrap();

    let q = SearchQuery::default();
    let result = search(&conn, &q).unwrap();
    assert_eq!(result.total, 5, "Empty search should return all photos");
}

// ─────────────────────────────────────────────────────────
//  T-6: albums CRUD
// ─────────────────────────────────────────────────────────

#[test]
fn test_album_create_add_photos_list() {
    let conn = setup_db();

    // 插入测试照片
    photo::insert_batch(&conn, &[
        make_photo("D:/Photos/p1.jpg", "p1.jpg", "EOS R5"),
        make_photo("D:/Photos/p2.jpg", "p2.jpg", "EOS R5"),
    ]).unwrap();
    let page = photo::query_paged(&conn, &PhotoFilter::default(), None, 10).unwrap();
    let photo_ids: Vec<String> = page.items.iter().map(|p| p.id.clone()).collect();

    // 创建相册
    let alb = album::create(&conn, "2025 旅行", None).unwrap();
    assert!(!alb.id.is_empty());
    assert_eq!(alb.name, "2025 旅行");
    assert_eq!(alb.photo_count, 0);

    // 添加照片
    album::add_photos(&conn, &alb.id, &photo_ids).unwrap();

    // 验证 photo_count 触发器
    let updated = album::get_by_id(&conn, &alb.id).unwrap().unwrap();
    assert_eq!(updated.photo_count, 2, "Trigger should update photo_count");

    // 列出相册内照片
    let alb_photos = album::list_photos(&conn, &alb.id, None, 10).unwrap();
    assert_eq!(alb_photos.items.len(), 2);

    // 删除相册（不影响照片）
    album::delete(&conn, &alb.id).unwrap();
    let normal_page = photo::query_paged(&conn, &PhotoFilter::default(), None, 10).unwrap();
    assert_eq!(normal_page.total, 2, "Photos should remain after album deletion");
}

// ─────────────────────────────────────────────────────────
//  T-7: tags CRUD（Phase-B，表在 V4 迁移中创建）
// ─────────────────────────────────────────────────────────

#[test]
fn test_tags_create_and_list() {
    use light_album_lib::db::tag;

    let conn = setup_db();

    let t1 = tag::create_tag(&conn, "旅行", "#007AFF").unwrap();
    let t2 = tag::create_tag(&conn, "人像", "#FF3B30").unwrap();

    assert!(!t1.id.is_empty());
    assert_eq!(t1.name, "旅行");
    assert_eq!(t1.color, "#007AFF");

    let tags = tag::list_tags(&conn).unwrap();
    assert_eq!(tags.len(), 2, "Should list 2 tags");
}

#[test]
fn test_tags_add_to_photo_usage_count() {
    use light_album_lib::db::tag;

    let conn = setup_db();
    photo::insert_batch(&conn, &[make_photo("D:/Photos/x.jpg", "x.jpg", "EOS R5")]).unwrap();
    let page = photo::query_paged(&conn, &PhotoFilter::default(), None, 10).unwrap();
    let photo_id = &page.items[0].id.clone();

    let tag = tag::create_tag(&conn, "测试标签", "#34C759").unwrap();
    assert_eq!(tag.usage_count, 0);

    // 添加标签
    tag::add_photo_tags(&conn, photo_id, &[tag.id.clone()]).unwrap();

    let updated_tags = tag::list_tags(&conn).unwrap();
    let updated = updated_tags.iter().find(|t| t.id == tag.id).unwrap();
    assert_eq!(updated.usage_count, 1, "Trigger should increment usage_count");

    // 移除标签
    tag::remove_photo_tags(&conn, photo_id, &[tag.id.clone()]).unwrap();
    let after_remove = tag::list_tags(&conn).unwrap();
    let after = after_remove.iter().find(|t| t.id == tag.id).unwrap();
    assert_eq!(after.usage_count, 0, "Trigger should decrement usage_count");
}

#[test]
fn test_tags_duplicate_name_rejected() {
    use light_album_lib::db::tag;

    let conn = setup_db();
    tag::create_tag(&conn, "唯一标签", "#007AFF").unwrap();

    // 大小写不同（NOCASE 约束）
    let result = tag::create_tag(&conn, "唯一标签", "#FF3B30");
    assert!(result.is_err(), "Duplicate tag name should fail");
}
