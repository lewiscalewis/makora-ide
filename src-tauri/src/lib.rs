mod agent;
mod balance;
mod gateway;
mod mcp;
mod terminal;

use std::sync::LazyLock;

use specta::Type;
use specta_typescript::Typescript;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_specta::{collect_commands, collect_events, Builder, Event};

static TERMINALS: LazyLock<terminal::Terminals> = LazyLock::new(Default::default);
static MCP: LazyLock<mcp::McpRegistry> = LazyLock::new(Default::default);

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
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
}

#[derive(Clone, serde::Serialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cached_tokens: u32,
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
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in rd.flatten() {
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
}

#[tauri::command]
#[specta::specta]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn write_file(folders: Vec<String>, path: String, content: String) -> Result<Option<String>, String> {
    let p = std::path::Path::new(&path);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        let root = folders.first().ok_or("no hay workspace activo")?;
        std::path::Path::new(root).join(&path)
    };
    let canon = abs.canonicalize().unwrap_or(abs);
    let within = folders
        .iter()
        .any(|f| canon.starts_with(std::path::Path::new(f)));
    if !within {
        return Err(format!("la ruta está fuera del workspace: {path}"));
    }
    let old = std::fs::read_to_string(&canon).ok();
    if let Some(parent) = std::path::Path::new(&canon).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&canon, content).map_err(|e| e.to_string())?;
    Ok(old)
}

fn path_within(folders: &[String], path: &str) -> bool {
    let p = std::path::Path::new(path);
    let canon = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    folders
        .iter()
        .any(|f| canon.starts_with(std::path::Path::new(f)))
}

#[tauri::command]
#[specta::specta]
fn rename_path(folders: Vec<String>, old_path: String, new_path: String) -> Result<(), String> {
    if !path_within(&folders, &old_path) {
        return Err(format!("la ruta está fuera del workspace: {old_path}"));
    }
    if let Some(parent) = std::path::Path::new(&new_path).parent() {
        if !path_within(&folders, &parent.to_string_lossy()) {
            return Err(format!("la ruta está fuera del workspace: {new_path}"));
        }
    }
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn create_file(folders: Vec<String>, path: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !path_within(&folders, &parent.to_string_lossy()) {
            return Err(format!("la ruta está fuera del workspace: {path}"));
        }
    }
    std::fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn create_dir(folders: Vec<String>, path: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !path_within(&folders, &parent.to_string_lossy()) {
            return Err(format!("la ruta está fuera del workspace: {path}"));
        }
    }
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
fn delete_path(folders: Vec<String>, path: String) -> Result<(), String> {
    if !path_within(&folders, &path) {
        return Err(format!("la ruta está fuera del workspace: {path}"));
    }
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
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
fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|pb| pb.to_string_lossy().to_string()))
}

#[tauri::command]
#[specta::specta]
fn count_tokens(text: String) -> Result<u32, String> {
    let bpe = tiktoken_rs::o200k_base().map_err(|e| e.to_string())?;
    Ok(bpe.encode_ordinary(&text).len() as u32)
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
) -> Result<ChatResult, String> {
    let folders = effective_folders(folders);
    agent::run(&app, &config, &system, &messages, &folders, &MCP).await
}

#[tauri::command]
#[specta::specta]
fn chat_cancel() {
    agent::cancel();
}

#[tauri::command]
#[specta::specta]
fn mcp_configure(specs: Vec<McpSpec>) -> Result<Vec<String>, String> {
    mcp::configure(&MCP, &specs)
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
    if *count >= 50 {
        return;
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut items: Vec<_> = rd.flatten().collect();
    items.sort_by_key(|e| e.file_name());
    for e in items {
        if *count >= 50 {
            return;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let path = e.path().to_string_lossy().to_string();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if name.to_lowercase().contains(q) || path.to_lowercase().contains(q) {
            out.push(path.clone());
            *count += 1;
        }
        if is_dir {
            search_walk(&path, q, out, count);
        }
    }
}

#[tauri::command]
#[specta::specta]
fn search_paths(folders: Vec<String>, query: String) -> Result<Vec<String>, String> {
    let q = query.to_lowercase();
    let mut out = Vec::new();
    let mut count = 0u32;
    for f in effective_folders(folders) {
        search_walk(&f, &q, &mut out, &mut count);
    }
    Ok(out)
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
fn workspace_summary(folders: Vec<String>) -> Result<String, String> {
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = Builder::new()
        .commands(collect_commands![
            home_dir,
            list_dir,
            read_text_file,
            write_file,
            rename_path,
            create_file,
            create_dir,
            delete_path,
            reveal_in_explorer,
            pick_folder,
            count_tokens,
            spawn_stream,
            list_models,
            chat,
            chat_cancel,
            mcp_configure,
            fetch_balance,
            term_spawn,
            term_write,
            term_resize,
            term_kill,
            search_paths,
            workspace_summary
        ])
        .events(collect_events![StreamEvent, ChatDeltaEvent]);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);
            #[cfg(debug_assertions)]
            specta_builder
                .export(Typescript::default(), "../src/bindings.ts")
                .expect("failed to export typescript bindings");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
