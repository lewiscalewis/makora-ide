// M4 HistoryManager: persistencia SQLite (bundled + WAL) de sesiones, items,
// checkpoints y metering de requests por turno. Schema alineado con
// docs/architecture.md (sessions/items/checkpoints/requests).

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde_json::Value;

use crate::ChatMessage;

static DB_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

fn data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("MakoraIDE")
}

pub fn init() {
    let dir = data_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("makora_history.db");
    *DB_PATH.lock().unwrap() = Some(path.clone());
    let conn = match Connection::open(&path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            workspace TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            model TEXT
        );
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            turn INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            tool_call_id TEXT,
            tool_calls TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_items_session_turn ON items(session_id, turn);
        CREATE TABLE IF NOT EXISTS checkpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            turn INTEGER NOT NULL,
            transcript TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            turn INTEGER NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            cached_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            reasoning_tokens INTEGER DEFAULT 0,
            cost_usd REAL DEFAULT 0.0,
            latency_ms INTEGER DEFAULT 0,
            cache_read_ratio REAL DEFAULT 0.0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id, created_at);
        CREATE TABLE IF NOT EXISTS makora_vault (
            key TEXT PRIMARY KEY,
            secret TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    );
}

fn xor_cipher(input: &str) -> String {
    let key = b"Makora_Vault_Hardware_Salt_2026";
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    for (i, b) in bytes.iter().enumerate() {
        out.push(b ^ key[i % key.len()]);
    }
    let mut hex = String::with_capacity(out.len() * 2);
    for b in out {
        hex.push_str(&format!("{:02x}", b));
    }
    hex
}

fn xor_decipher(hex: &str) -> Option<String> {
    if hex.len() % 2 != 0 {
        return None;
    }
    let key = b"Makora_Vault_Hardware_Salt_2026";
    let mut bytes = Vec::new();
    for i in (0..hex.len()).step_by(2) {
        let byte = u8::from_str_radix(&hex[i..i + 2], 16).ok()?;
        bytes.push(byte);
    }
    let mut out = Vec::with_capacity(bytes.len());
    for (i, b) in bytes.iter().enumerate() {
        out.push(b ^ key[i % key.len()]);
    }
    String::from_utf8(out).ok()
}

pub fn vault_set(key: &str, secret: &str) -> Result<(), String> {
    init();
    let enc = xor_cipher(secret);
    let t = now_ms();
    let path = DB_PATH.lock().unwrap().clone().ok_or("Database path unavailable")?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO makora_vault (key, secret, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET secret = ?2, updated_at = ?3",
        rusqlite::params![key, enc, t],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn vault_get(key: &str) -> Result<Option<String>, String> {
    init();
    let path = DB_PATH.lock().unwrap().clone().ok_or("Database path unavailable")?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT secret FROM makora_vault WHERE key = ?1").map_err(|e| e.to_string())?;
    let mut rows = stmt.query(rusqlite::params![key]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let enc: String = row.get(0).map_err(|e| e.to_string())?;
        if let Some(dec) = xor_decipher(&enc) {
            return Ok(Some(dec));
        }
    }
    Ok(None)
}

pub fn vault_delete(key: &str) -> Result<(), String> {
    init();
    let path = DB_PATH.lock().unwrap().clone().ok_or("Database path unavailable")?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM makora_vault WHERE key = ?1", rusqlite::params![key]).map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_db_path() -> Option<PathBuf> {
    {
        let guard = DB_PATH.lock().unwrap();
        if let Some(p) = guard.clone() {
            return Some(p);
        }
    }
    init();
    DB_PATH.lock().unwrap().clone()
}

fn with_conn<T>(f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
    let path = ensure_db_path()?;
    let conn = Connection::open(path).ok()?;
    // Varias sesiones pueden escribir en paralelo: esperar hasta 2s por el lock WAL.
    let _ = conn.busy_timeout(std::time::Duration::from_secs(2));
    f(&conn).ok()
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn upsert_session(id: &str, workspace: &str, model: &str) {
    let t = now_ms();
    let _ = with_conn(|c| {
        c.execute(
            "INSERT INTO sessions (id, workspace, created_at, updated_at, model)
             VALUES (?1, ?2, ?3, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET updated_at = ?3, model = ?4",
            rusqlite::params![id, workspace, t, model],
        )
    });
}

pub fn archive_transcript(session_id: &str, turn: u32, msgs: &[ChatMessage]) {
    let _ = with_conn(|c| {
        for m in msgs {
            let tcs = m
                .tool_calls
                .as_ref()
                .map(|v| serde_json::to_string(v).unwrap_or_default());
            c.execute(
                "INSERT INTO items (session_id, turn, role, content, tool_call_id, tool_calls)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    session_id,
                    turn,
                    m.role,
                    m.content,
                    m.tool_call_id,
                    tcs
                ],
            )?;
        }
        Ok(())
    });
}

pub fn create_checkpoint(session_id: &str, turn: u32, msgs: &[ChatMessage]) {
    let json = serde_json::to_string(msgs).unwrap_or_default();
    let t = now_ms();
    let _ = with_conn(|c| {
        c.execute(
            "INSERT INTO checkpoints (session_id, turn, transcript, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![session_id, turn, json, t],
        )
    });
}

pub fn latest_checkpoint(session_id: &str) -> Option<(u32, Vec<ChatMessage>)> {
    with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT turn, transcript FROM checkpoints WHERE session_id = ?1
             ORDER BY id DESC LIMIT 1",
        )?;
        let row = stmt.query_row(rusqlite::params![session_id], |r| {
            Ok((r.get::<_, u32>(0)?, r.get::<_, String>(1)?))
        });
        match row {
            Ok((turn, json)) => {
                let msgs: Vec<ChatMessage> =
                    serde_json::from_str(&json).unwrap_or_default();
                Ok(Some((turn, msgs)))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
    .flatten()
}

#[derive(Default, Clone)]
pub struct RequestMeter {
    pub input_tokens: u32,
    pub cached_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub latency_ms: i64,
}

pub fn record_request(
    session_id: &str,
    turn: u32,
    provider: &str,
    model: &str,
    meter: &RequestMeter,
) {
    let t = now_ms();
    let ratio = if meter.input_tokens > 0 {
        meter.cached_tokens as f64 / meter.input_tokens as f64
    } else {
        0.0
    };
    let _ = with_conn(|c| {
        c.execute(
            "INSERT INTO requests (session_id, turn, provider, model, input_tokens,
             cached_tokens, output_tokens, cost_usd, latency_ms, cache_read_ratio, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                session_id,
                turn,
                provider,
                model,
                meter.input_tokens,
                meter.cached_tokens,
                meter.output_tokens,
                meter.cost_usd,
                meter.latency_ms,
                ratio,
                t
            ],
        )
    });
}

pub fn requests_summary(session_id: &str) -> Value {
    with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(cached_tokens),0),
                    COALESCE(SUM(output_tokens),0), COALESCE(SUM(cost_usd),0)
             FROM requests WHERE session_id = ?1",
        )?;
        let row = stmt.query_row(rusqlite::params![session_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, f64>(4)?,
            ))
        })?;
        Ok(serde_json::json!({
            "turns": row.0,
            "input_tokens": row.1,
            "cached_tokens": row.2,
            "output_tokens": row.3,
            "cost_usd": row.4
        }))
    })
    .unwrap_or(serde_json::json!({"turns": 0}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xor_cipher_roundtrip() {
        let plain = "sk-test-secret-key-1234567890";
        let encrypted = xor_cipher(plain);
        assert_ne!(plain, encrypted);
        let decrypted = xor_decipher(&encrypted).expect("decipher");
        assert_eq!(plain, decrypted);
    }

    #[test]
    fn test_xor_cipher_invalid_hex() {
        assert!(xor_decipher("odd_length").is_none());
        assert!(xor_decipher("zz").is_none());
    }

    #[test]
    fn test_history_schema_creation_in_memory() {
        let conn = Connection::open_in_memory().expect("open in memory db");
        let res = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                workspace TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                model TEXT
            );
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                turn INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT,
                tool_call_id TEXT,
                tool_calls TEXT
            );
            CREATE TABLE IF NOT EXISTS checkpoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                turn INTEGER NOT NULL,
                transcript TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                turn INTEGER NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                input_tokens INTEGER NOT NULL,
                cached_tokens INTEGER NOT NULL,
                output_tokens INTEGER NOT NULL,
                cost_usd REAL DEFAULT 0.0,
                latency_ms INTEGER DEFAULT 0,
                cache_read_ratio REAL DEFAULT 0.0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS makora_vault (
                key TEXT PRIMARY KEY,
                secret TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );",
        );
        assert!(res.is_ok());
    }
}
