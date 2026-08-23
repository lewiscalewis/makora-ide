mod agent;
mod balance;
mod gateway;
mod history;
mod mcp;
pub(crate) mod remote;

use remote::{
    remote_get_config, remote_list_models, remote_pair_code, remote_revoke, remote_start,
    remote_status, remote_stop, remote_sync_config, remote_tunnel_start, remote_tunnel_stop,
};

mod repo_map;
mod symbol_index;
mod terminal;
mod token_engine;

use std::sync::{Arc, LazyLock};

use specta::Type;
#[cfg(debug_assertions)]
use specta_typescript::Typescript;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_specta::{collect_commands, collect_events, Builder, Event};

static TERMINALS: LazyLock<terminal::Terminals> = LazyLock::new(Default::default);
pub(crate) static MCP: LazyLock<mcp::McpRegistry> = LazyLock::new(Default::default);

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunk {
    pub seq: u32,
    pub text: String,
}

#[derive(Clone, serde::Serialize, Type, Event)]
pub struct StreamEvent(pub StreamChunk);

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatConfig {
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub reasoning_effort: Option<String>,
    pub max_output_tokens: Option<u32>,
    pub temperature: Option<f64>,
    #[serde(default)]
    pub vision_enabled: bool,
    #[serde(default)]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub fallback_kind: String,
    #[serde(default)]
    pub fallback_base_url: String,
    #[serde(default)]
    pub fallback_model: String,
    #[serde(default)]
    pub fallback_api_key: String,
    #[serde(default)]
    pub input_price_per_1m: f64,
    #[serde(default)]
    pub output_price_per_1m: f64,
    #[serde(default)]
    pub cached_price_per_1m: f64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<std::collections::HashMap<String, String>>)]
    pub extra_content: Option<serde_json::Value>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TurnMetrics {
    pub duration_ms: u64,
    pub input_tokens: u32,
    pub cached_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Default, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cached_tokens: u32,
}

impl std::ops::AddAssign for ChatUsage {
    fn add_assign(&mut self, other: Self) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cached_tokens += other.cached_tokens;
    }
}

#[derive(Clone, serde::Serialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatResult {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cached_tokens: u32,
    pub messages: Vec<ChatMessage>,
}

#[derive(Clone, serde::Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ChatDeltaEvent {
    pub chat_id: String,
    pub text: String,
}

#[derive(Clone, serde::Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ChatTextFinal {
    pub chat_id: String,
    pub text: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpSpec {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub enabled: bool,
}

#[tauri::command]
#[specta::specta]
fn home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "no home directory found".to_string())
}

#[tauri::command]
#[specta::specta]
async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let mut builder = ignore::WalkBuilder::new(&path);
        builder
            .max_depth(Some(1))
            .follow_links(false)
            .hidden(true)
            .ignore(true)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true);
        let mut entries = Vec::new();
        for result in builder.build() {
            let Ok(entry) = result else { continue };
            if entry.depth() == 0 {
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.push(DirEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir,
            });
        }
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
async fn read_text_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn normalize_path_str(p: &std::path::Path) -> String {
    let s = p.to_string_lossy().to_string();
    let s = s.trim_start_matches(r"\\?\").replace('\\', "/");
    #[cfg(target_os = "windows")]
    {
        s.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        s
    }
}

fn path_within(folders: &[String], path: &str) -> bool {
    let p = std::path::Path::new(path);
    let p_canon = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let p_norm = normalize_path_str(&p_canon);

    if folders.is_empty() {
        let temp = std::env::temp_dir();
        let temp_norm = normalize_path_str(&temp);
        return p_norm.starts_with(&temp_norm);
    }

    folders.iter().any(|f| {
        let fp = std::path::Path::new(f);
        let f_canon = fp.canonicalize().unwrap_or_else(|_| fp.to_path_buf());
        let f_norm = normalize_path_str(&f_canon);
        p_norm.starts_with(&f_norm)
    })
}

#[tauri::command]
#[specta::specta]
async fn write_file(folders: Vec<String>, path: String, content: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let abs = if p.is_absolute() {
            p.to_path_buf()
        } else {
            let root = folders.first().ok_or("no hay workspace activo")?;
            std::path::Path::new(root).join(&path)
        };
        if !path_within(&folders, &abs.to_string_lossy()) {
            return Err(format!("la ruta está fuera del workspace: {path}"));
        }
        let old = std::fs::read_to_string(&abs).ok();
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&abs, content).map_err(|e| e.to_string())?;
        Ok(old)
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
#[specta::specta]
async fn rename_path(folders: Vec<String>, old_path: String, new_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if !path_within(&folders, &old_path) {
            return Err(format!("la ruta está fuera del workspace: {old_path}"));
        }
        if let Some(parent) = std::path::Path::new(&new_path).parent() {
            if !path_within(&folders, &parent.to_string_lossy()) {
                return Err(format!("la ruta está fuera del workspace: {new_path}"));
            }
        }
        std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
async fn create_file(folders: Vec<String>, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            if !path_within(&folders, &parent.to_string_lossy()) {
                return Err(format!("la ruta está fuera del workspace: {path}"));
            }
        }
        std::fs::write(&path, "").map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
async fn create_dir(folders: Vec<String>, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            if !path_within(&folders, &parent.to_string_lossy()) {
                return Err(format!("la ruta está fuera del workspace: {path}"));
            }
        }
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
async fn delete_path(folders: Vec<String>, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if !path_within(&folders, &path) {
            return Err(format!("la ruta está fuera del workspace: {path}"));
        }
        let p = std::path::Path::new(&path);
        if p.is_dir() {
            std::fs::remove_dir_all(p).map_err(|e| e.to_string())
        } else {
            std::fs::remove_file(p).map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Error al leer archivo: {e}"))
}

#[tauri::command]
#[specta::specta]
fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|pb| pb.to_string_lossy().to_string()))
}

#[tauri::command]
#[specta::specta]
fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    let picked = app.dialog().file().blocking_pick_files();
    match picked {
        Some(paths) => Ok(paths
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .map(|pb| pb.to_string_lossy().to_string())
            .collect()),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
#[specta::specta]
fn count_tokens(text: String) -> Result<u32, String> {
    Ok(token_engine::global().count(&text) as u32)
}

#[tauri::command]
#[specta::specta]
fn spawn_stream(app: AppHandle, message: String, chunk_ms: u32) -> Result<(), String> {
    let chunk_ms = chunk_ms.max(5);
    tauri::async_runtime::spawn(async move {
        let mut seq: u32 = 0;
        for chunk in message.chars().collect::<Vec<_>>().chunks(4) {
            let text: String = chunk.iter().collect();
            let _ = StreamEvent(StreamChunk { seq, text }).emit(&app);
            seq += 1;
            tokio::time::sleep(std::time::Duration::from_millis(chunk_ms as u64)).await;
        }
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn list_models(config: ChatConfig) -> Result<Vec<String>, String> {
    gateway::fetch_models(&config).await
}

/// Devuelve las IPs de red local de este equipo (sin enviar tráfico real).
#[tauri::command]
#[specta::specta]
async fn get_lan_ips() -> Result<Vec<String>, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("error creando socket: {e}"))?;
    let mut ips: Vec<String> = Vec::new();
    for dst in [
        "8.8.8.8:80",
        "1.1.1.1:80",
        "192.168.1.1:80",
        "10.0.0.1:80",
    ] {
        if socket.connect(dst).is_ok() {
            if let Ok(addr) = socket.local_addr() {
                let ip = addr.ip().to_string();
                if !ips.contains(&ip) {
                    ips.push(ip);
                }
            }
        }
    }
    Ok(ips)
}

fn effective_folders(mut folders: Vec<String>) -> Vec<String> {
    if folders.is_empty() {
        if let Some(h) = dirs::home_dir() {
            folders.push(h.to_string_lossy().to_string());
        }
    }
    folders
}

#[tauri::command]
#[specta::specta]
async fn chat(
    app: AppHandle,
    config: ChatConfig,
    system: String,
    messages: Vec<ChatMessage>,
    folders: Vec<String>,
    chat_id: String,
    plan_mode: bool,
    budget_usd: Option<f64>,
) -> Result<ChatResult, String> {
    let folders = effective_folders(folders);
    agent::run(
        &app,
        &config,
        &chat_id,
        &system,
        &messages,
        &folders,
        &MCP,
        plan_mode,
        budget_usd,
    )
    .await
}

#[tauri::command]
#[specta::specta]
fn chat_cancel(chat_id: String) {
    agent::cancel_chat(&chat_id);
}

#[tauri::command]
#[specta::specta]
fn chat_cleanup(chat_id: String) {
    agent::cleanup_chat(&chat_id);
}

#[tauri::command]
#[specta::specta]
fn question_reply(question_id: String, answer: String) -> Result<(), String> {
    agent::reply_question(&question_id, answer)
}

#[tauri::command]
#[specta::specta]
fn approval_reply(approval_id: String, decision: String, feedback: String) -> Result<(), String> {
    agent::reply_approval(&approval_id, decision, feedback)
}

#[tauri::command]
#[specta::specta]
fn revert_last_turn(chat_id: String) -> Result<String, String> {
    agent::revert_last_turn(&chat_id)
}

#[tauri::command]
#[specta::specta]
async fn generate_title(app: AppHandle, config: ChatConfig, content: String) -> Result<String, String> {
    let mut cfg = config.clone();
    cfg.max_output_tokens = Some(24);
    cfg.reasoning_effort = None;
    cfg.temperature = Some(0.2);
    let system = "Eres un generador de títulos. Genera un título de MÁXIMO 6 palabras, en el idioma del usuario, que resuma el objetivo de esta conversación de desarrollo. Responde ÚNICAMENTE con el título (sin comillas, sin prefijos como \"Título:\", sin explicaciones).";
    let msgs = vec![ChatMessage {
        role: "user".into(),
        content: content.chars().take(600).collect(),
        images: vec![],
        tool_calls: None,
        tool_call_id: None,
        reasoning: None,
    }];
    let title_chat_id = format!(
        "{}__title_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(25), async {
        if config.kind == "anthropic" {
            gateway::anthropic_turn(&app, &cfg, &title_chat_id, system, &msgs, &[]).await
        } else {
            gateway::openai_turn(&app, &cfg, &title_chat_id, system, &msgs, &[]).await
        }
    })
    .await
    .map_err(|_| "timeout generando el título".to_string())??;
    let title = outcome
        .text
        .trim()
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches(['"', '\'', '`', '"', '"', '“', '”'])
        .trim_start_matches("Título:")
        .trim_start_matches("Title:")
        .trim()
        .to_string();
    if title.is_empty() {
        Err("sin título generado".into())
    } else {
        Ok(title)
    }
}

#[tauri::command]
#[specta::specta]
async fn mcp_configure(specs: Vec<McpSpec>) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || mcp::configure(&MCP, &specs))
        .await
        .map_err(|e| format!("error configurando MCP: {e}"))?
}

#[tauri::command]
#[specta::specta]
async fn fetch_balance(
    provider: String,
    base_url: String,
    api_key: String,
) -> Result<Option<balance::BalanceInfo>, String> {
    balance::fetch_balance(&provider, &base_url, &api_key).await
}

#[tauri::command]
#[specta::specta]
fn get_history_summary(session_id: String) -> Result<history::HistorySummary, String> {
    Ok(history::requests_summary(&session_id))
}

#[tauri::command]
#[specta::specta]
fn save_sessions_store(json: String) -> Result<(), String> {
    history::save_session_store(&json)
}

#[tauri::command]
#[specta::specta]
fn load_sessions_store() -> Result<Option<String>, String> {
    Ok(history::load_session_store())
}

#[tauri::command]
#[specta::specta]
fn term_spawn(
    app: AppHandle,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    terminal::spawn(&app, id, cols, rows, cwd, &TERMINALS)
}

#[tauri::command]
#[specta::specta]
fn term_write(id: String, data: String) -> Result<(), String> {
    terminal::write(&TERMINALS, &id, &data)
}

#[tauri::command]
#[specta::specta]
fn term_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    terminal::resize(&TERMINALS, &id, cols, rows)
}

#[tauri::command]
#[specta::specta]
fn term_kill(id: String) {
    terminal::kill(&TERMINALS, &id);
}

fn search_walk(dir: &str, q: &str, out: &mut Vec<String>, count: &mut u32) {
    if *count >= 40 {
        return;
    }
    let mut builder = ignore::WalkBuilder::new(dir);
    builder
        .max_depth(Some(12))
        .follow_links(false)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true);
    for result in builder.build() {
        if *count >= 40 {
            return;
        }
        let Ok(entry) = result else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let name_lower = name.to_lowercase();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "dist"
            || name == "build"
            || name == ".next"
            || name == "__pycache__"
            || name == ".venv"
            || name == "venv"
            || name == "coverage"
        {
            if !q.contains("node_modules") && !q.contains("dist") && !q.contains("target") {
                continue;
            }
        }
        let path = entry.path().to_string_lossy().to_string();
        if name_lower.contains(q) || path.to_lowercase().contains(q) {
            out.push(path);
            *count += 1;
        }
    }
}

#[tauri::command]
#[specta::specta]
async fn search_paths(folders: Vec<String>, query: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let q = query.to_lowercase();
        let mut out = Vec::new();
        let mut count = 0u32;
        for f in effective_folders(folders) {
            search_walk(&f, &q, &mut out, &mut count);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn summarize_dir(
    path: &str,
    depth: u32,
    max_depth: u32,
    out: &mut String,
    counter: &mut u32,
    max_entries: u32,
) {
    if depth > max_depth || *counter >= max_entries {
        return;
    }
    let rd = match std::fs::read_dir(path) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by(|a, b| {
        let ad = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let bd = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        bd.cmp(&ad).then(a.file_name().cmp(&b.file_name()))
    });
    for e in entries {
        if *counter >= max_entries {
            return;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        *counter += 1;
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let pad = "  ".repeat(depth as usize);
        out.push_str(&format!("{pad}{}{}\n", name, if is_dir { "/" } else { "" }));
        if is_dir && depth < max_depth {
            let p = e.path().to_string_lossy().to_string();
            summarize_dir(&p, depth + 1, max_depth, out, counter, max_entries);
        }
    }
}

#[tauri::command]
#[specta::specta]
async fn workspace_summary(folders: Vec<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut out = String::new();
        let mut counter = 0u32;
        let max_entries = 600u32;
        let max_depth = 5u32;
        for f in effective_folders(folders) {
            let name = std::path::Path::new(&f)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| f.clone());
            out.push_str(&format!("{}/\n", name));
            summarize_dir(&f, 1, max_depth, &mut out, &mut counter, max_entries);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
fn keyring_get(provider_id: String) -> Result<Option<String>, String> {
    keyring_get_impl(&provider_id)
}

/// Lógica interna de lectura de clave (reutilizable por el servidor remoto,
/// que nunca expone la clave por la red).
pub(crate) fn keyring_get_impl(provider_id: &str) -> Result<Option<String>, String> {
    let clean_id = provider_id.trim().to_lowercase().replace(':', "_");
    let key = format!("api_key_{}", clean_id);

    // 1. OS Native Secure Store (Windows Credential Manager / Keychain / Secret Service)
    if let Ok(entry) = keyring::Entry::new("makora-ide", &key) {
        if let Ok(p) = entry.get_password() {
            if !p.trim().is_empty() {
                return Ok(Some(p));
            }
        }
    }

    // 2. Fallback to direct key or legacy SQLite makora_vault with transparent auto-migration
    if let Some(legacy) = history::legacy_vault_get(&key).or_else(|| history::legacy_vault_get(&clean_id)) {
        if !legacy.trim().is_empty() {
            if let Ok(entry) = keyring::Entry::new("makora-ide", &key) {
                let _ = entry.set_password(&legacy);
            }
            return Ok(Some(legacy));
        }
    }

    Ok(None)
}

#[tauri::command]
#[specta::specta]
fn keyring_set(provider_id: String, secret: String) -> Result<(), String> {
    let clean_id = provider_id.trim().to_lowercase().replace(':', "_");
    let key = format!("api_key_{}", clean_id);

    // OS Native Secure Store
    let entry = keyring::Entry::new("makora-ide", &key).map_err(|e| e.to_string())?;
    entry.set_password(&secret).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
fn keyring_delete(provider_id: String) -> Result<(), String> {
    let clean_id = provider_id.trim().to_lowercase().replace(':', "_");
    let key = format!("api_key_{}", clean_id);

    if let Ok(entry) = keyring::Entry::new("makora-ide", &key) {
        let _ = entry.delete_credential();
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
fn detect_project_rules(folders: Vec<String>) -> Result<Option<String>, String> {
    let candidates = [
        ".makora/rules.md",
        ".makora/RULES.md",
        ".makorarules",
        "MAKORA.md",
        "AGENTS.md",
        "CLAUDE.md",
        ".cursorrules",
    ];

    let mut rules_found = Vec::new();
    // Deduplicación por contenido normalizado entre workspaces: evita inyectar
    // el mismo archivo de reglas más de una vez (p.ej. un MAKORA.md universal).
    let mut seen = std::collections::HashSet::new();

    for f in effective_folders(folders) {
        let base = std::path::Path::new(&f);
        for c in &candidates {
            let p = base.join(c);
            if p.is_file() {
                if let Ok(content) = std::fs::read_to_string(&p) {
                    let trimmed = content.trim();
                    if !trimmed.is_empty() {
                        // Normalización: minúsculas + colapso de whitespace.
                        let norm: String = trimmed
                            .to_lowercase()
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" ");
                        if seen.insert(norm) {
                            rules_found
                                .push(format!("### Reglas del Proyecto ({})\n{}", c, trimmed));
                        }
                    }
                }
                // Precedencia estricta: el primer candidato existente gana por workspace.
                break;
            }
        }
    }

    if rules_found.is_empty() {
        Ok(None)
    } else {
        Ok(Some(rules_found.join("\n\n")))
    }
}

#[tauri::command]
#[specta::specta]
async fn detect_ollama() -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get("http://localhost:11434/api/tags").send().await;
    Ok(resp.map(|r| r.status().is_success()).unwrap_or(false))
}


#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusInfo {
    pub branch: String,
    pub staged: u32,
    pub modified: u32,
    pub untracked: u32,
}

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitFileItem {
    pub path: String,
    pub status: String,
    pub is_staged: bool,
}

#[tauri::command]
#[specta::specta]
async fn git_status(folder: String) -> Result<Option<GitStatusInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("git");
        cmd.current_dir(&folder);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let branch_out = match cmd.arg("branch").arg("--show-current").output() {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            _ => return Ok(None),
        };

        let mut status_cmd = std::process::Command::new("git");
        status_cmd.current_dir(&folder);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            status_cmd.creation_flags(0x08000000);
        }
        let status_out = match status_cmd.arg("status").arg("--porcelain").output() {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
            _ => return Ok(None),
        };

        let mut staged = 0u32;
        let mut modified = 0u32;
        let mut untracked = 0u32;

        for line in status_out.lines() {
            if line.starts_with("??") {
                untracked += 1;
            } else {
                let bytes = line.as_bytes();
                if bytes.len() >= 2 {
                    if bytes[0] != b' ' && bytes[0] != b'?' {
                        staged += 1;
                    }
                    if bytes[1] != b' ' && bytes[1] != b'?' {
                        modified += 1;
                    }
                }
            }
        }

        Ok(Some(GitStatusInfo {
            branch: if branch_out.is_empty() { "HEAD".to_string() } else { branch_out },
            staged,
            modified,
            untracked,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
async fn git_diff(folder: String, path: Option<String>, staged: bool) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("git");
        cmd.current_dir(&folder);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.arg("diff");
        if staged {
            cmd.arg("--staged");
        }
        if let Some(p) = path {
            cmd.arg("--").arg(p);
        }
        let out = cmd.output().map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
async fn git_log(folder: String, limit: Option<u32>) -> Result<Vec<GitCommitInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let lim = limit.unwrap_or(25);
        let mut cmd = std::process::Command::new("git");
        cmd.current_dir(&folder);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.arg("log")
            .arg(format!("-n{}", lim))
            .arg("--pretty=format:%H|%h|%an|%cr|%s");
        let out = match cmd.output() {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
            _ => return Ok(Vec::new()),
        };

        let mut list = Vec::new();
        for line in out.lines() {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            if parts.len() == 5 {
                list.push(GitCommitInfo {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    author: parts[2].to_string(),
                    date: parts[3].to_string(),
                    message: parts[4].to_string(),
                });
            }
        }
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
async fn git_files(folder: String) -> Result<Vec<GitFileItem>, String> {
    tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("git");
        cmd.current_dir(&folder);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.arg("status").arg("--porcelain");
        let out = match cmd.output() {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
            _ => return Ok(Vec::new()),
        };

        let mut files = Vec::new();
        for line in out.lines() {
            if line.len() < 4 {
                continue;
            }
            let status_code = &line[0..2];
            let path = line[3..].trim().to_string();

            if status_code == "??" {
                files.push(GitFileItem {
                    path,
                    status: "?".to_string(),
                    is_staged: false,
                });
            } else {
                let bytes = status_code.as_bytes();
                let staged_char = bytes[0] as char;
                let unstaged_char = bytes[1] as char;

                if staged_char != ' ' && staged_char != '?' {
                    files.push(GitFileItem {
                        path: path.clone(),
                        status: staged_char.to_string(),
                        is_staged: true,
                    });
                }
                if unstaged_char != ' ' && unstaged_char != '?' {
                    files.push(GitFileItem {
                        path,
                        status: unstaged_char.to_string(),
                        is_staged: false,
                    });
                }
            }
        }
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
fn git_stage(folder: String, path: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("add").arg(&path);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_unstage(folder: String, path: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("restore").arg("--staged").arg(&path);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_stage_all(folder: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("add").arg("-A");
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_commit(folder: String, message: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("commit").arg("-m").arg(&message);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_push(folder: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("push");
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        if err.trim().is_empty() {
            Ok(String::from_utf8_lossy(&out.stdout).to_string())
        } else {
            Err(err)
        }
    }
}

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
    pub fetch_or_push: String,
}

#[tauri::command]
#[specta::specta]
fn git_pull(folder: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("pull");
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_branches(folder: String) -> Result<Vec<String>, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("branch").arg("-a");
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        let text = String::from_utf8_lossy(&out.stdout);
        let list: Vec<String> = text
            .lines()
            .map(|l| l.trim_start_matches('*').trim().to_string())
            .filter(|l| !l.is_empty() && !l.contains("->"))
            .collect();
        Ok(list)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_checkout(folder: String, branch: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("checkout").arg(&branch);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        Ok(if stdout.trim().is_empty() { stderr } else { stdout })
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_branch_create(folder: String, branch: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("checkout").arg("-b").arg(&branch);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        Ok(if stdout.trim().is_empty() { stderr } else { stdout })
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_discard(folder: String, path: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("restore").arg("--").arg(&path);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        let mut cmd2 = std::process::Command::new("git");
        cmd2.current_dir(&folder);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd2.creation_flags(0x08000000);
        }
        cmd2.arg("clean").arg("-f").arg(&path);
        let _ = cmd2.output();
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
fn git_remote_get(folder: String) -> Result<Vec<GitRemoteInfo>, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("remote").arg("-v");
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        let text = String::from_utf8_lossy(&out.stdout);
        let mut list = Vec::new();
        for line in text.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                list.push(GitRemoteInfo {
                    name: parts[0].to_string(),
                    url: parts[1].to_string(),
                    fetch_or_push: parts[2].trim_matches(|c| c == '(' || c == ')').to_string(),
                });
            }
        }
        Ok(list)
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
#[specta::specta]
fn git_remote_set(folder: String, name: String, url: String) -> Result<String, String> {
    let mut check_cmd = std::process::Command::new("git");
    check_cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        check_cmd.creation_flags(0x08000000);
    }
    check_cmd.arg("remote").arg("get-url").arg(&name);
    let check_out = check_cmd.output();
    let exists = check_out.map(|o| o.status.success()).unwrap_or(false);

    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    if exists {
        cmd.arg("remote").arg("set-url").arg(&name).arg(&url);
    } else {
        cmd.arg("remote").arg("add").arg(&name).arg(&url);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(format!("Remoto '{name}' configurado correctamente con URL: {url}"))
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_fetch(folder: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("fetch").arg("--all");
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        Ok(if stdout.trim().is_empty() { stderr } else { stdout })
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn git_init(folder: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("init");
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

// Fecha límite de evaluación beta: 30 de Septiembre de 2026 23:59:59 UTC (timestamp: 1790812799)
const BETA_EXPIRATION_TIMESTAMP: i64 = 1790812799;

#[tauri::command]
#[specta::specta]
fn check_beta_validity() -> Result<(), String> {
    // En versiones de producción v1.0 o compilaciones finales, omitir restricción temporal
    if std::env::var("MAKORA_RELEASE").is_ok() || cfg!(not(debug_assertions)) {
        return Ok(());
    }
    let now = chrono::Utc::now().timestamp();
    if now > BETA_EXPIRATION_TIMESTAMP {
        return Err("Esta versión preliminar de MakoraIDE ha caducado. Por favor, solicita una actualización al desarrollador.".into());
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn get_initial_file() -> Result<Option<String>, String> {
    for arg in std::env::args().skip(1) {
        if !arg.starts_with('-') {
            let p = std::path::Path::new(&arg);
            if p.exists() && p.is_file() {
                return Ok(Some(arg));
            }
        }
    }
    Ok(None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = Builder::new()
        .commands(collect_commands![
            home_dir,
            list_dir,
            read_text_file,
            read_file_binary,
            write_file,
            rename_path,
            create_file,
            create_dir,
            delete_path,
            reveal_in_explorer,
            pick_folder,
            pick_files,
            count_tokens,
            spawn_stream,
            list_models,
            chat,
            chat_cancel,
            chat_cleanup,
            question_reply,
            approval_reply,
            revert_last_turn,
            generate_title,
            mcp_configure,
            fetch_balance,
            term_spawn,
            term_write,
            term_resize,
            term_kill,
            search_paths,
            workspace_summary,
            get_history_summary,
            save_sessions_store,
            load_sessions_store,
            keyring_get,
            keyring_set,
            keyring_delete,
            remote_status,
            remote_start,
            remote_stop,
            remote_tunnel_start,
            remote_tunnel_stop,
            remote_pair_code,
            remote_revoke,
            remote_sync_config,
            remote_get_config,
            remote_list_models,
            get_lan_ips,
            detect_project_rules,
            detect_ollama,
            git_status,
            git_diff,
            git_log,
            git_files,
            git_stage,
            git_unstage,
            git_stage_all,
            git_commit,
            git_push,
            git_pull,
            git_branches,
            git_checkout,
            git_branch_create,
            git_discard,
            git_remote_get,
            git_remote_set,
            git_fetch,
            git_init,
            get_initial_file,
            check_beta_validity
        ])
        .events(collect_events![
            StreamEvent,
            ChatDeltaEvent,
            ChatTextFinal,
        ]);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);
            #[cfg(debug_assertions)]
            if let Err(e) = specta_builder.export(Typescript::default(), "../src/bindings.ts") {
                eprintln!("[specta] no se pudo exportar bindings.ts: {e}");
            }
            app.manage(Arc::new(remote::RemoteState::new(app.handle().clone())));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("makora_rules_test_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rules_precedence_within_workspace() {
        let proj = temp_project("precedence");
        std::fs::create_dir_all(proj.join(".makora")).unwrap();
        std::fs::write(proj.join(".makora/rules.md"), "RULES_DOT_MAKORA").unwrap();
        std::fs::write(proj.join("MAKORA.md"), "ROOT_MAKORA").unwrap();

        let result = detect_project_rules(vec![proj.to_string_lossy().into_owned()]).unwrap();
        let content = result.expect("reglas esperadas");
        assert!(content.contains("RULES_DOT_MAKORA"));
        assert!(!content.contains("ROOT_MAKORA"));

        std::fs::remove_dir_all(&proj).ok();
    }

    #[test]
    fn rules_empty_when_no_files() {
        let proj = temp_project("none");
        let result = detect_project_rules(vec![proj.to_string_lossy().into_owned()]).unwrap();
        assert!(result.is_none());
        std::fs::remove_dir_all(&proj).ok();
    }

    #[test]
    fn rules_deduplicated_across_workspaces() {
        let a = temp_project("dup_a");
        let b = temp_project("dup_b");
        std::fs::write(a.join("MAKORA.md"), "UNIVERSAL RULES").unwrap();
        std::fs::write(b.join("MAKORA.md"), "UNIVERSAL RULES").unwrap();

        let result = detect_project_rules(vec![
            a.to_string_lossy().into_owned(),
            b.to_string_lossy().into_owned(),
        ])
        .unwrap();
        let content = result.expect("reglas esperadas");
        assert_eq!(content.matches("UNIVERSAL RULES").count(), 1);

        std::fs::remove_dir_all(&a).ok();
        std::fs::remove_dir_all(&b).ok();
    }

    #[test]
    fn rules_distinct_across_workspaces() {
        let a = temp_project("dist_a");
        let b = temp_project("dist_b");
        std::fs::write(a.join("MAKORA.md"), "RULES A").unwrap();
        std::fs::write(b.join("MAKORA.md"), "RULES B").unwrap();

        let result = detect_project_rules(vec![
            a.to_string_lossy().into_owned(),
            b.to_string_lossy().into_owned(),
        ])
        .unwrap();
        let content = result.expect("reglas esperadas");
        assert!(content.contains("RULES A"));
        assert!(content.contains("RULES B"));

        std::fs::remove_dir_all(&a).ok();
        std::fs::remove_dir_all(&b).ok();
    }
}


