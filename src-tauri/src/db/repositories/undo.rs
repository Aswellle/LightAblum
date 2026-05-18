// src-tauri/src/db/repositories/undo.rs
//
// UndoRepository trait + SqliteUndoRepository implementation
//
// Provides minimal undo-log persistence: record an action, pop the
// most recent entry.  Keeps the last 50 rows (same cap as the
// commands/undo.rs record_undo helper).

use crate::error::{AppError, Result};
use crate::state::DbPool;
use std::sync::Arc;

// ─────────────────────────────────────────────────────────
//  Data type
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UndoEntry {
    pub id: i64,
    pub action: String,
    pub payload: String,
    pub created_at: String,
}

// ─────────────────────────────────────────────────────────
//  Trait
// ─────────────────────────────────────────────────────────

pub trait UndoRepository: Send + Sync {
    fn record(&self, action: &str, payload: &str) -> Result<()>;
    fn pop_last(&self) -> Result<Option<UndoEntry>>;
}

// ─────────────────────────────────────────────────────────
//  SqliteUndoRepository
// ─────────────────────────────────────────────────────────

pub struct SqliteUndoRepository {
    pool: Arc<DbPool>,
}

impl SqliteUndoRepository {
    pub fn new(pool: Arc<DbPool>) -> Self {
        Self { pool }
    }

    fn conn(&self) -> Result<crate::state::DbConn> {
        self.pool
            .get()
            .map_err(|e| AppError::Other(format!("DB pool error: {e}")))
    }
}

// ─────────────────────────────────────────────────────────
//  Trait implementation
// ─────────────────────────────────────────────────────────

impl UndoRepository for SqliteUndoRepository {
    /// Insert a new undo-log entry, then prune to the 50 most recent rows.
    fn record(&self, action: &str, payload: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO undo_log (action, payload) VALUES (?1, ?2)",
            rusqlite::params![action, payload],
        )?;
        // Keep only the 50 most recent entries.
        conn.execute(
            "DELETE FROM undo_log WHERE id NOT IN \
             (SELECT id FROM undo_log ORDER BY id DESC LIMIT 50)",
            [],
        )?;
        Ok(())
    }

    /// Atomically fetch the most recent undo entry and delete it.
    /// Returns `None` when the log is empty.
    fn pop_last(&self) -> Result<Option<UndoEntry>> {
        let conn = self.conn()?;

        // Fetch the newest row.
        let row: Option<UndoEntry> = conn
            .query_row(
                "SELECT id, action, payload, created_at \
                 FROM undo_log ORDER BY id DESC LIMIT 1",
                [],
                |row| {
                    Ok(UndoEntry {
                        id: row.get(0)?,
                        action: row.get(1)?,
                        payload: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                },
            )
            .ok();

        // Delete it (only if it exists).
        if let Some(ref entry) = row {
            conn.execute(
                "DELETE FROM undo_log WHERE id = ?1",
                rusqlite::params![entry.id],
            )?;
        }

        Ok(row)
    }
}
