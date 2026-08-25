// M4 HistoryManager: persistencia SQLite (bundled + WAL) de sesiones, items,
// checkpoints y metering de requests por turno. Schema alineado con
// docs/architecture.md (sessions/items/checkpoints/requests).

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::ChatMessage;

static DB_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
// Conexión compartida: abrir SQLite por cada escritura (como antes) era caro y
// con WAL + sesiones concurrentes podía chocar con el busy_timeout y perder
// escrituras. Una única conexión protegida por mutex elimina ese riesgo.
static DB_CONN: Mutex<Option<Connection>> = Mutex::new(None);

fn guard<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());

    #[cfg(target_os = "macos")]
    let base = std::env::var("HOME")
        .map(|h| PathBuf::from(h).join("Library/Application Support"))
        .unwrap_or_else(|_| std::env::temp_dir());

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|_| std::env::temp_dir());

    base.join("MakoraIDE")
}

pub fn init() {
    let dir = data_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("makora_history.db");
    *guard(&DB_PATH) = Some(path.clone());
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
        CREATE TABLE IF NOT EXISTS kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    );
    // Limpieza única al arrancar: poda los checkpoints antiguos (se guardaban
    // completos en cada turno → O(n²) → DB de >1 GB). Conserva 3 por sesión y
    // compacta el WAL para liberar espacio en disco.
    let _ = conn.execute(
        "DELETE FROM checkpoints WHERE id NOT IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY id DESC) AS rn
                FROM checkpoints
            ) WHERE rn <= 3
        )",
        [],
    );
    let _ = conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
    drop(conn);

    // Si la DB quedó muy grande por el historial de checkpoints, compacta el
    // fichero en segundo plano (VACUUM) para devolver el espacio al disco sin
    // bloquear el arranque de la app.
    let file_len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if file_len > 200 * 1024 * 1024 {
        let path_clone = path.clone();
        std::thread::spawn(move || {
            if let Ok(vconn) = Connection::open(&path_clone) {
                let _ = vconn.busy_timeout(std::time::Duration::from_secs(30));
                let _ = vconn.execute_batch("VACUUM;");
            }
        });
    }
}

fn ensure_db_path() -> Option<PathBuf> {
    {
        let g = guard(&DB_PATH);
        if let Some(p) = g.clone() {
            return Some(p);
        }
    }
    init();
    guard(&DB_PATH).clone()
}

fn with_conn<T>(f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
    {
        let mut g = guard(&DB_CONN);
        if g.is_none() {
            if let Some(path) = ensure_db_path() {
                if let Ok(c) = Connection::open(path) {
                    let _ = c.busy_timeout(std::time::Duration::from_secs(2));
                    *g = Some(c);
                }
            }
        }
    }
    let g = guard(&DB_CONN);
    let conn = g.as_ref()?;
    f(conn).ok()
}

fn xor_encipher(plain: &str) -> String {
    let key = b"Makora_Vault_Hardware_Salt_2026";
    let bytes = plain.as_bytes();
    let mut out = String::with_capacity(bytes.len() * 2);
    for (i, b) in bytes.iter().enumerate() {
        let x = b ^ key[i % key.len()];
        out.push_str(&format!("{:02x}", x));
    }
    out
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

pub fn vault_set(key: &str, secret: &str) -> bool {
    let enc = xor_encipher(secret);
    with_conn(|conn| {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS makora_vault (
                key TEXT PRIMARY KEY,
                secret TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;
        conn.execute(
            "INSERT INTO makora_vault (key, secret, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET secret = ?2, updated_at = ?3",
            rusqlite::params![key, enc, now_ms()],
        )?;
        Ok(())
    })
    .is_some()
}

pub fn vault_get(key: &str) -> Option<String> {
    with_conn(|conn| {
        let table_exists: bool = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='makora_vault'",
                [],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !table_exists {
            return Ok(None);
        }

        let mut stmt = conn.prepare("SELECT secret FROM makora_vault WHERE key = ?1")?;
        let mut rows = stmt.query(rusqlite::params![key])?;
        if let Some(row) = rows.next()? {
            let enc: String = row.get(0)?;
            if let Some(dec) = xor_decipher(&enc) {
                return Ok(Some(dec));
            }
        }
        Ok(None)
    })
    .flatten()
}

pub fn vault_delete(key: &str) -> bool {
    with_conn(|conn| {
        let _ = conn.execute("DELETE FROM makora_vault WHERE key = ?1", rusqlite::params![key]);
        Ok(())
    })
    .is_some()
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

// Watermark por sesión para que `archive_transcript` sea incremental: antes
// insertaba el transcript COMPLETO en cada turno final → O(n²) de filas en
// `items`. Ahora solo inserta los mensajes nuevos desde la última archivación.
static ARCHIVE_WATERMARK: Mutex<Option<std::collections::HashMap<String, usize>>> = Mutex::new(None);

pub fn archive_transcript(session_id: &str, turn: u32, msgs: &[ChatMessage]) {
    let start = {
        let mut wm = guard(&ARCHIVE_WATERMARK);
        let map = wm.get_or_insert_with(std::collections::HashMap::new);
        let prev = map.get(session_id).copied().unwrap_or(0).min(msgs.len());
        map.insert(session_id.to_string(), msgs.len());
        prev
    };
    if start >= msgs.len() {
        return;
    }
    let _ = with_conn(|c| {
        for m in &msgs[start..] {
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
        )?;
        // Evitar crecimiento O(n²): conservar solo los últimos 3 checkpoints
        // por sesión (el resume solo necesita el más reciente).
        c.execute(
            "DELETE FROM checkpoints WHERE session_id = ?1 AND id NOT IN (
                SELECT id FROM checkpoints WHERE session_id = ?1
                ORDER BY id DESC LIMIT 3
             )",
            rusqlite::params![session_id],
        )?;
        Ok(())
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

/// Resumen de metering de una sesión (devuelto por `get_history_summary`).
/// Tipado explícito en vez de `serde_json::Value`, que es un tipo recursivo y
/// rompe el exportador de tipos de specta (stack overflow en `tauri dev`).
#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummary {
    pub turns: u32,
    pub input_tokens: u32,
    pub cached_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
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

const SESSIONS_KV_KEY: &str = "sessions.v1";

/// Guarda el blob JSON completo de sesiones (fuente de verdad durable).
/// Sustituye a localStorage como almacenamiento autoritativo; localStorage
/// queda como caché de arranque rápido.
pub fn save_session_store(json: &str) -> Result<(), String> {
    let t = now_ms();
    match with_conn(|c| {
        c.execute(
            "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            rusqlite::params![SESSIONS_KV_KEY, json, t],
        )
    }) {
        Some(_) => Ok(()),
        None => Err("base de datos de sesiones no disponible".into()),
    }
}

pub fn load_session_store() -> Option<String> {
    with_conn(|c| {
        c.query_row(
            "SELECT value FROM kv WHERE key = ?1",
            rusqlite::params![SESSIONS_KV_KEY],
            |r| r.get::<_, String>(0),
        )
    })
}

pub fn requests_summary(session_id: &str) -> HistorySummary {
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
        Ok(HistorySummary {
            turns: row.0 as u32,
            input_tokens: row.1 as u32,
            cached_tokens: row.2 as u32,
            output_tokens: row.3 as u32,
            cost_usd: row.4,
        })
    })
    .unwrap_or_else(|| HistorySummary {
        turns: 0,
        input_tokens: 0,
        cached_tokens: 0,
        output_tokens: 0,
        cost_usd: 0.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
            CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id, created_at);",
        );
        assert!(res.is_ok());
    }
}
