use crate::db::photo::PhotoPage;
use crate::error::Result;
use crate::query::filter::PhotoFilter;
use rusqlite::Connection;

pub fn query_paged(
    conn: &Connection,
    filter: &PhotoFilter,
    cursor: Option<&str>,
    limit: u32,
) -> Result<PhotoPage> {
    crate::db::photo::query_paged(conn, filter, cursor, limit)
}
