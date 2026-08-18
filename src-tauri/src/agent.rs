use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::gateway::{self, ToolDef};
use crate::mcp::{self, McpRegistry};
use crate::{ChatConfig, ChatMessage, ChatResult, ChatUsage};

static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

const MAKORA_BASE_SKILL: &str = "\
## Makora Core Skill (universal — aplica en todos los proveedores y modelos)

Reglas cardinales de eficiencia de tokens:
1. Cero prosa innecesaria: sin introducciones, cortesías ni resúmenes redundantes. Responde directamente con herramientas o con el resultado técnico.
2. Edición quirúrgica: NUNCA reescribas archivos completos con write_file (salvo archivos nuevos). Usa apply_patch con bloques <<<<<<< SEARCH / ======= / >>>>>>> REPLACE y ~3 líneas de anclaje.
3. Lectura progresiva: usa list_dir para localizar; lee solo el rango necesario con read_file_range; nunca archivos enteros sin necesidad; agrupa TODAS las lecturas independientes en el mismo turno.
4. Terminal silenciosa: usa bash con banderas de silencio y salidas acotadas; evita comandos que generen salidas masivas.
5. Flujo: Localizar → Diagnosticar → Modificar (apply_patch) → Verificar (bash: tests/linter) → Concluir con un resumen de 1 línea por archivo modificado (ruta:línea - acción).
6. Continúa hasta COMPLETAR la tarea entera — sin límites de pasos; el único límite es el saldo del usuario.
7. Errores de herramienta: reintenta una vez con enfoque distinto; si persiste, informa con precisión.
8. Para archivos NUEVOS completos, emite bloques ```lenguaje:ruta/del/archivo para que el usuario los aplique con un clic.
";

fn now_id() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("t{}", d.as_nanos()))
        .unwrap_or_else(|_| "t0".to_string())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStart {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutput {
    pub id: String,
    pub stream: String,
    pub data: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEnd {
    pub id: String,
    pub ok: bool,
    pub summary: String,
}

pub fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max_chars).collect();
        format!("{cut}\n…[truncado]")
    }
}

fn core_tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "read_file".into(),
            description: "Lee el contenido de un archivo del workspace (texto, truncado si es muy largo).".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Ruta relativa o absoluta dentro del workspace" }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "list_dir".into(),
            description: "Lista el contenido de un directorio del workspace (carpetas primero).".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Ruta relativa o absoluta dentro del workspace" }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "grep".into(),
            description: "Busca un texto en los archivos del workspace y devuelve las líneas coincidentes con su ubicación (path:línea).".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Texto a buscar (no sensible a mayúsculas)" },
                    "path": { "type": "string", "description": "Directorio donde buscar (opcional; por defecto todo el workspace)" }
                },
                "required": ["pattern"]
            }),
        },
        ToolDef {
            name: "read_file_range".into(),
            description: "Lee un intervalo de líneas [start_line, end_line] (1-indexado, inclusivo) de un archivo del workspace. Evita cargar archivos completos.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Ruta relativa o absoluta dentro del workspace" },
                    "start_line": { "type": "integer", "description": "Primera línea (1-indexado)" },
                    "end_line": { "type": "integer", "description": "Última línea (inclusivo)" }
                },
                "required": ["path", "start_line", "end_line"]
            }),
        },
        ToolDef {
            name: "apply_patch".into(),
            description: "Aplica parches quirúrgicos a un archivo existente con bloques de anclaje. Formato:\n<<<<<<< SEARCH\n[líneas originales]\n=======\n[líneas nuevas]\n>>>>>>> REPLACE\nPuede contener varios bloques. Ahorra tokens frente a reescribir el archivo completo.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Ruta del archivo a parchear" },
                    "patch": { "type": "string", "description": "Bloques SEARCH/REPLACE" }
                },
                "required": ["path", "patch"]
            }),
        },
        ToolDef {
            name: "bash".into(),
            description: "Ejecuta un comando de shell en el workspace. Devuelve stdout/stderr y el código de salida. Los comandos tienen un timeout de 60s.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Comando de shell a ejecutar" }
                },
                "required": ["command"]
            }),
        },
        ToolDef {
            name: "write_file".into(),
            description: "Escribe (crea o sobrescribe) un archivo de texto en el workspace.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Ruta relativa o absoluta dentro del workspace" },
                    "content": { "type": "string", "description": "Contenido completo del archivo" }
                },
                "required": ["path", "content"]
            }),
        },
    ]
}

fn within(folders: &[String], p: &std::path::Path) -> bool {
    let canon = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    folders
        .iter()
        .any(|f| canon.starts_with(std::path::Path::new(f)))
}

fn find_by_name(dir: &str, name: &str, depth: u32) -> Option<std::path::PathBuf> {
    if depth == 0 {
        return None;
    }
    let rd = std::fs::read_dir(dir).ok()?;
    let mut items: Vec<_> = rd.flatten().collect();
    items.sort_by_key(|e| e.file_name());
    for e in items {
        let ename = e.file_name().to_string_lossy().to_string();
        if ename.starts_with('.')
            || ename == "node_modules"
            || ename == "target"
            || ename == "AppData"
        {
            continue;
        }
        let p = e.path();
        if ename.eq_ignore_ascii_case(name) {
            return Some(p);
        }
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if let Some(f) = find_by_name(&p.to_string_lossy(), name, depth - 1) {
                return Some(f);
            }
        }
    }
    None
}

fn resolve_path(folders: &[String], path: &str, allow_missing: bool) -> Result<String, String> {
    let usable = |c: &std::path::Path| {
        allow_missing
            || c.exists()
            || c.parent().map(|x| x.exists()).unwrap_or(false)
    };
    let p = std::path::Path::new(path);
    let direct = if p.is_absolute() {
        p.to_path_buf()
    } else {
        let root = folders.first().ok_or("no hay workspace activo")?;
        std::path::Path::new(root).join(path)
    };
    if usable(&direct) && within(folders, &direct) {
        return Ok(direct.to_string_lossy().to_string());
    }
    let comps: Vec<String> = path
        .split(['/', '\\'])
        .filter(|c| !c.is_empty())
        .map(String::from)
        .collect();
    if let Some(first) = comps.first() {
        for root in folders {
            if let Some(found) = find_by_name(root, first, 2) {
                let mut joined = found;
                for c in comps.iter().skip(1) {
                    joined = joined.join(c);
                }
                if usable(&joined) && within(folders, &joined) {
                    return Ok(joined.to_string_lossy().to_string());
                }
            }
        }
    }
    Err(format!("la ruta no existe dentro del workspace: {path}"))
}

fn grep_dir(dir: &str, pattern: &str, out: &mut String, count: &mut u32, max: u32) {
    if *count >= max {
        return;
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut items: Vec<_> = rd.flatten().collect();
    items.sort_by_key(|e| e.file_name());
    for e in items {
        if *count >= max {
            return;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let path = e.path();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            grep_dir(&path.to_string_lossy(), pattern, out, count, max);
        } else if let Ok(text) = std::fs::read_to_string(&path) {
            if text.len() > 2_000_000 {
                continue;
            }
            for (i, line) in text.lines().enumerate() {
                if *count >= max {
                    break;
                }
                if line.to_lowercase().contains(pattern) {
                    out.push_str(&format!(
                        "{}:{}: {}\n",
                        path.to_string_lossy(),
                        i + 1,
                        line
                    ));
                    *count += 1;
                }
            }
        }
    }
}

async fn run_bash(app: &AppHandle, command: &str, folders: &[String]) -> Result<String, String> {
    let id = now_id();
    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(portable_pty::PtySize {
            rows: 24,
            cols: 200,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut builder = portable_pty::CommandBuilder::new(crate::terminal::system_shell());
    let cwd = folders
        .first()
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string())
        });
    builder.cwd(&cwd);
    let _child = pair.slave.spawn_command(builder).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let master = pair.master;
    let mut writer = master.take_writer().map_err(|e| e.to_string())?;
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    let marker = format!("__MAKORA_DONE_{}__", id.trim_start_matches('t'));
    #[cfg(target_os = "windows")]
    let payload = format!("@echo off\r\n{command}\r\necho {marker}%errorlevel% {marker}\r\n");
    #[cfg(not(target_os = "windows"))]
    let payload = format!("stty -echo 2>/dev/null; {command}\r\necho {marker}$? {marker}\r\n");
    let _ = writer.write_all(payload.as_bytes());
    let _ = writer.flush();

    let combined: Arc<StdMutex<String>> = Arc::new(StdMutex::new(String::new()));
    let done: Arc<StdMutex<Option<i32>>> = Arc::new(StdMutex::new(None));

    let app2 = app.clone();
    let c2 = combined.clone();
    let d2 = done.clone();
    let id2 = id.clone();
    let m2 = marker.clone();
    std::thread::spawn(move || {
        let mut r = reader;
        let mut buf = [0u8; 8192];
        let mut tail = String::new();
        let mut exit_seen = false;
        loop {
            match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    tail.push_str(&String::from_utf8_lossy(&buf[..n]));
                    while let Some(pos) = tail.find('\n') {
                        let line = tail[..pos].to_string();
                        tail.drain(..pos + 1);
                        if line.contains(&m2) {
                            let code = line
                                .find(&m2)
                                .and_then(|i| {
                                    let rest = &line[i + m2.len()..];
                                    let digits: String = rest
                                        .chars()
                                        .take_while(|c| c.is_ascii_digit())
                                        .collect();
                                    digits.parse::<i32>().ok()
                                })
                                .unwrap_or(-1);
                            *d2.lock().unwrap() = Some(code);
                            exit_seen = true;
                        } else {
                            let clean = line.trim_end_matches('\r').to_string();
                            if !clean.is_empty() {
                                c2.lock().unwrap().push_str(&clean);
                                c2.lock().unwrap().push('\n');
                                let _ = app2.emit(
                                    "tool-output",
                                    ToolOutput {
                                        id: id2.clone(),
                                        stream: "stdout".into(),
                                        data: format!("{clean}\n"),
                                    },
                                );
                            }
                        }
                    }
                }
            }
        }
        if !exit_seen {
            let mut g = d2.lock().unwrap();
            if g.is_none() {
                *g = Some(-1);
            }
        }
    });

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
    let exit_code: i32;
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            drop(writer);
            drop(master);
            return Err("cancelado por el usuario".into());
        }
        if let Some(c) = *done.lock().unwrap() {
            exit_code = c;
            break;
        }
        if std::time::Instant::now() > deadline {
            drop(writer);
            drop(master);
            return Err("timeout (600s) ejecutando el comando".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let out = combined.lock().unwrap().clone();
    let mut summarized = truncate_head_tail(&out, 40, 40);
    if summarized.chars().count() > 12000 {
        summarized = truncate(&summarized, 12000);
    }
    let _ = app.emit(
        "tool-output",
        ToolOutput {
            id: id.clone(),
            stream: "exit".into(),
            data: format!("exit: {exit_code}\n"),
        },
    );
    Ok(format!("exit: {exit_code}\n{summarized}"))
}

fn apply_patch_to(text: &str, patch: &str) -> Result<(String, usize), String> {
    let mut result = text.replace("\r\n", "\n");
    let mut rest = patch;
    let mut count = 0usize;
    loop {
        let Some(search_start) = rest.find("<<<<<<< SEARCH") else {
            break;
        };
        let after_start = &rest[search_start + "<<<<<<< SEARCH".len()..];
        let div = after_start
            .find("=======")
            .ok_or("bloque sin separador =======")?;
        let end = after_start
            .find(">>>>>>> REPLACE")
            .ok_or("bloque sin cierre >>>>>>> REPLACE")?;
        let search_block = after_start[..div]
            .trim_matches('\n')
            .replace("\r\n", "\n");
        let replace_block = after_start[div + "=======".len()..end]
            .trim_matches('\n')
            .replace("\r\n", "\n");

        let candidates = [
            search_block.clone(),
            search_block
                .lines()
                .map(|l| l.trim_end())
                .collect::<Vec<_>>()
                .join("\n"),
        ];
        let mut replaced = false;
        for candidate in candidates {
            if let Some(pos) = result.find(&candidate) {
                result.replace_range(pos..pos + candidate.len(), &replace_block);
                replaced = true;
                count += 1;
                break;
            }
        }
        if !replaced {
            return Err(format!(
                "anclaje no encontrado:\n{}",
                search_block.lines().take(5).collect::<Vec<_>>().join("\n")
            ));
        }
        rest = &after_start[end + ">>>>>>> REPLACE".len()..];
    }
    if count == 0 {
        return Err("no se encontraron bloques SEARCH/REPLACE".into());
    }
    Ok((result, count))
}

fn truncate_head_tail(s: &str, head: usize, tail: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    if lines.len() <= head + tail {
        return s.to_string();
    }
    let mut out = String::new();
    for l in &lines[..head] {
        out.push_str(l);
        out.push('\n');
    }
    out.push_str(&format!(
        "…[{} líneas omitidas]…\n",
        lines.len() - head - tail
    ));
    for l in &lines[lines.len() - tail..] {
        out.push_str(l);
        out.push('\n');
    }
    out
}

fn evict_tool_results(msgs: &[ChatMessage]) -> Vec<ChatMessage> {
    let tool_positions: Vec<usize> = msgs
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "tool")
        .map(|(i, _)| i)
        .collect();
    if tool_positions.len() <= 6 {
        return msgs.to_vec();
    }
    let keep = 6usize;
    let threshold = tool_positions.len() - keep;
    msgs.iter()
        .enumerate()
        .map(|(i, m)| {
            let is_old = m.role == "tool"
                && tool_positions
                    .iter()
                    .position(|&x| x == i)
                    .map(|p| p < threshold)
                    .unwrap_or(false);
            if is_old {
                let lines = m.content.lines().count();
                ChatMessage {
                    role: "tool".into(),
                    content: format!("[Resultado previo resumido: {lines} líneas]"),
                    images: vec![],
                    tool_calls: None,
                    tool_call_id: m.tool_call_id.clone(),
                }
            } else {
                m.clone()
            }
        })
        .collect()
}

async fn execute_tool(
    app: &AppHandle,
    name: &str,
    arguments: &str,
    folders: &[String],
    registry: &McpRegistry,
) -> Result<String, String> {
    let args: Value = if arguments.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(arguments).map_err(|e| format!("argumentos JSON inválidos: {e}"))?
    };
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();

    match name {
        "read_file" => {
            let path = resolve_path(folders, &s("path"), false)?;
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            Ok(truncate(&text, 60000))
        }
        "read_file_range" => {
            let path = resolve_path(folders, &s("path"), false)?;
            let start = args
                .get("start_line")
                .and_then(|x| x.as_u64())
                .unwrap_or(1)
                .max(1) as usize;
            let end = args
                .get("end_line")
                .and_then(|x| x.as_u64())
                .unwrap_or(start as u64)
                .max(start as u64) as usize;
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let lines: Vec<&str> = text.lines().collect();
            let slice: Vec<&str> = lines
                .iter()
                .skip(start - 1)
                .take(end - start + 1)
                .copied()
                .collect();
            let mut out = String::new();
            for (i, l) in slice.iter().enumerate() {
                out.push_str(&format!("{}| {}\n", start + i, l));
            }
            Ok(out)
        }
        "apply_patch" => {
            let path = resolve_path(folders, &s("path"), false)?;
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let (new_text, blocks) = apply_patch_to(&text, &s("patch"))?;
            std::fs::write(&path, new_text).map_err(|e| e.to_string())?;
            Ok(format!("parche aplicado: {blocks} bloque(s) modificados en {path}"))
        }
        "list_dir" => {
            let path = resolve_path(folders, &s("path"), false)?;
            let mut out = String::new();
            let mut entries: Vec<_> =
                std::fs::read_dir(&path).map_err(|e| e.to_string())?.flatten().collect();
            entries.sort_by(|a, b| {
                let ad = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
                let bd = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
                bd.cmp(&ad).then(a.file_name().cmp(&b.file_name()))
            });
            for e in entries.iter().take(300) {
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                out.push_str(&format!(
                    "{}{}\n",
                    e.file_name().to_string_lossy(),
                    if is_dir { "/" } else { "" }
                ));
            }
            Ok(out)
        }
        "grep" => {
            let pattern = s("pattern").to_lowercase();
            let path_arg = s("path");
            let dirs: Vec<String> = if path_arg.is_empty() {
                folders.to_vec()
            } else {
                vec![resolve_path(folders, &path_arg, false)?]
            };
            let mut out = String::new();
            let mut count = 0u32;
            for d in dirs {
                grep_dir(&d, &pattern, &mut out, &mut count, 200);
                if count >= 200 {
                    break;
                }
            }
            if out.is_empty() {
                out = "sin coincidencias".into();
            }
            Ok(truncate(&out, 12000))
        }
        "bash" => run_bash(app, &s("command"), folders).await,
        "write_file" => {
            let path = resolve_path(folders, &s("path"), true)?;
            let content = s("content");
            if let Some(parent) = std::path::Path::new(&path).parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&path, content).map_err(|e| e.to_string())?;
            Ok(format!("archivo escrito: {path}"))
        }
        _ if name.starts_with("mcp__") => mcp::call(registry, name, arguments),
        _ => Err(format!("herramienta desconocida: {name}")),
    }
}

pub async fn run(
    app: &AppHandle,
    cfg: &ChatConfig,
    system: &str,
    messages: &[ChatMessage],
    folders: &[String],
    registry: &McpRegistry,
) -> Result<ChatResult, String> {
    CANCEL.store(false, Ordering::SeqCst);
    let full_system = format!("{MAKORA_BASE_SKILL}\n\n{system}");
    let mut msgs: Vec<ChatMessage> = messages.to_vec();
    let mut total = ChatUsage::default();
    let mut tools = core_tools();
    {
        let map = registry.tools.lock().unwrap();
        for (name, (_, schema)) in map.iter() {
            tools.push(ToolDef {
                name: name.clone(),
                description: format!("Herramienta MCP {name}"),
                parameters: schema.clone(),
            });
        }
    }

    let mut prev_sig: Vec<String> = Vec::new();
    let mut repeats: u32 = 0;

    loop {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("cancelado por el usuario".into());
        }
        // ADR-014: poda de resultados antiguos de tools (evicción local)
        msgs = evict_tool_results(&msgs);
        let outcome = if cfg.kind == "anthropic" {
            gateway::anthropic_turn(app, cfg, &full_system, &msgs, &tools).await?
        } else {
            gateway::openai_turn(app, cfg, &full_system, &msgs, &tools).await?
        };
        total.input_tokens += outcome.usage.input_tokens;
        total.output_tokens += outcome.usage.output_tokens;
        total.cached_tokens += outcome.usage.cached_tokens;

        if outcome.tool_calls.is_empty() {
            msgs.push(ChatMessage {
                role: "assistant".into(),
                content: outcome.text,
                images: vec![],
                tool_calls: None,
                tool_call_id: None,
            });
            return Ok(ChatResult {
                input_tokens: total.input_tokens,
                output_tokens: total.output_tokens,
                cached_tokens: total.cached_tokens,
                messages: msgs,
            });
        }

        // Detección de bucle degenerado: las mismas llamadas repetidas sin progreso.
        // No es un límite de tarea: evita quemar saldo si el modelo se queda atascado.
        let mut sig: Vec<String> = outcome
            .tool_calls
            .iter()
            .map(|t| format!("{}|{}", t.name, t.arguments))
            .collect();
        sig.sort();
        if sig == prev_sig {
            repeats += 1;
            if repeats >= 4 {
                let forced = if cfg.kind == "anthropic" {
                    gateway::anthropic_turn(app, cfg, &full_system, &msgs, &[]).await?
                } else {
                    gateway::openai_turn(app, cfg, &full_system, &msgs, &[]).await?
                };
                total.input_tokens += forced.usage.input_tokens;
                total.output_tokens += forced.usage.output_tokens;
                total.cached_tokens += forced.usage.cached_tokens;
                msgs.push(ChatMessage {
                    role: "assistant".into(),
                    content: format!(
                        "{}\n\n⚠️ Se detectó un bucle de herramientas repetidas; continúo con la respuesta final.",
                        forced.text
                    ),
                    images: vec![],
                    tool_calls: None,
                    tool_call_id: None,
                });
                return Ok(ChatResult {
                    input_tokens: total.input_tokens,
                    output_tokens: total.output_tokens,
                    cached_tokens: total.cached_tokens,
                    messages: msgs,
                });
            }
        } else {
            repeats = 0;
            prev_sig = sig;
        }

        msgs.push(ChatMessage {
            role: "assistant".into(),
            content: outcome.text,
            images: vec![],
            tool_calls: Some(outcome.tool_calls.clone()),
            tool_call_id: None,
        });

        for tc in &outcome.tool_calls {
            let _ = app.emit(
                "tool-start",
                ToolStart {
                    id: tc.id.clone(),
                    name: tc.name.clone(),
                    arguments: tc.arguments.clone(),
                },
            );
            let result = execute_tool(app, &tc.name, &tc.arguments, folders, registry).await;
            let (ok, summary) = match &result {
                Ok(s) => (true, truncate(s, 400)),
                Err(e) => (false, e.clone()),
            };
            let _ = app.emit("tool-end", ToolEnd { id: tc.id.clone(), ok, summary });
            let content = match result {
                Ok(s) => s,
                Err(e) => format!("ERROR: {e}"),
            };
            msgs.push(ChatMessage {
                role: "tool".into(),
                content,
                images: vec![],
                tool_calls: None,
                tool_call_id: Some(tc.id.clone()),
            });
        }
    }
}
