// tests/benches/scan_throughput.rs
//
// 扫描吞吐量基准测试（Phase-E）
//
// 验证目标（PRD §9.1）：
//   - 缩略图生成速率 ≥ 200 张/秒（Small + Medium，8核 CPU）
//   - 完整索引（含 EXIF 解析）≥ 500 张/秒
//   - 数据库大小：10 万张照片 ≤ 50MB
//
// 本基准测试覆盖：
//   bench_insert_1k    — 1000 张照片批量插入吞吐量（模拟扫描写 DB 路径）
//   bench_query_paged  — 分页查询性能（10 万条记录下 < 100ms）
//
// 运行命令：
//   cargo bench --bench scan_throughput

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use light_album_lib::db::{photo, schema};
use light_album_lib::query::filter::PhotoFilter;
use rusqlite::Connection;
use std::path::Path;

// ─────────────────────────────────────────────────────────
//  辅助函数
// ─────────────────────────────────────────────────────────

fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory DB failed");
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .unwrap();
    schema::run_migrations(&conn, Path::new("")).expect("migration failed");
    conn
}

fn make_photo_batch(start: usize, count: usize) -> Vec<photo::NewPhoto> {
    (start..start + count)
        .map(|i| photo::NewPhoto {
            file_path: format!("D:/Photos/{i:06}.jpg"),
            file_name: format!("{i:06}.jpg"),
            file_size: (1024 * 1024 + i as i64 * 100) % (20 * 1024 * 1024), // 1–20MB 变化
            file_hash: format!("deadbeef{i:016x}"),
            width: 3024,
            height: 4032,
            orientation: 1,
            format: "jpeg".to_string(),
            created_at: format!("2024-{:02}-{:02}T10:30:00Z", (i % 12) + 1, (i % 28) + 1),
            modified_at: "2024-06-15T10:30:00Z".to_string(),
            folder_path: "D:/Photos".to_string(),
            gps_lat: if i % 3 == 0 { Some(35.681236) } else { None },
            gps_lng: if i % 3 == 0 { Some(139.767125) } else { None },
            camera_make: Some("Canon".to_string()),
            camera_model: Some(format!("EOS R{}", i % 5 + 1)),
            lens_model: Some("RF 50mm F1.8".to_string()),
            focal_length: Some(50.0),
            aperture: Some(1.8),
            shutter_speed: Some("1/250".to_string()),
            iso: Some(400),
            exposure_comp: Some(0.0),
        })
        .collect()
}

// ─────────────────────────────────────────────────────────
//  Bench 1：1000 张照片批量插入
// ─────────────────────────────────────────────────────────

/// 验证：DB 写入吞吐量支撑 ≥500 张/秒的索引目标
fn bench_insert_1k(c: &mut Criterion) {
    let mut group = c.benchmark_group("db_insert");
    group.sample_size(10); // 数据库操作 sample_size 降低至 10 次

    for batch_size in [100usize, 500, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::new("insert_batch", batch_size),
            batch_size,
            |b, &size| {
                b.iter_with_setup(
                    || {
                        let conn = setup_db();
                        let photos = make_photo_batch(0, size);
                        (conn, photos)
                    },
                    |(conn, photos)| {
                        photo::insert_batch(&conn, black_box(&photos)).expect("insert_batch failed")
                    },
                )
            },
        );
    }

    group.finish();
}

// ─────────────────────────────────────────────────────────
//  Bench 2：分页查询（10000 条记录）
// ─────────────────────────────────────────────────────────

/// 验证：搜索响应时间 ≤ 100ms（PRD §9.1）
fn bench_query_paged(c: &mut Criterion) {
    // 准备：预填充 10000 张照片
    let conn = setup_db();
    let batch = make_photo_batch(0, 10_000);
    photo::insert_batch(&conn, &batch).expect("setup insert failed");

    let mut group = c.benchmark_group("db_query");
    group.sample_size(50);

    group.bench_function("query_first_page_100", |b| {
        let filter = PhotoFilter::default();
        b.iter(|| {
            photo::query_paged(&conn, black_box(&filter), None, 100).expect("query_paged failed")
        })
    });

    group.bench_function("query_with_favorites_filter", |b| {
        let filter = PhotoFilter {
            favorites_only: true,
            ..Default::default()
        };
        b.iter(|| {
            photo::query_paged(&conn, black_box(&filter), None, 100).expect("query_paged failed")
        })
    });

    group.finish();
}

// ─────────────────────────────────────────────────────────
//  Bench 3：全文搜索
// ─────────────────────────────────────────────────────────

/// 验证：search() ≤ 100ms on 10000 records
fn bench_search(c: &mut Criterion) {
    use light_album_lib::db::search::{search, SearchQuery};

    let conn = setup_db();
    let batch = make_photo_batch(0, 10_000);
    photo::insert_batch(&conn, &batch).expect("setup insert failed");

    let mut group = c.benchmark_group("db_search");
    group.sample_size(50);

    group.bench_function("search_filename_partial", |b| {
        let q = SearchQuery {
            text: Some("0001".to_string()),
            ..Default::default()
        };
        b.iter(|| search(&conn, black_box(&q)).expect("search failed"))
    });

    group.bench_function("search_empty", |b| {
        let q = SearchQuery::default();
        b.iter(|| search(&conn, black_box(&q)).expect("search failed"))
    });

    group.finish();
}

// ─────────────────────────────────────────────────────────
//  注册基准测试
// ─────────────────────────────────────────────────────────

criterion_group!(benches, bench_insert_1k, bench_query_paged, bench_search);
criterion_main!(benches);
