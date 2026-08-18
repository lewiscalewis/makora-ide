use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::gateway::{self, ToolDef};
use crate::history::{self, RequestMeter};
use crate::mcp::{self, McpRegistry};
use crate::token_engine;
use crate::{ChatConfig, ChatMessage, ChatResult, ChatUsage};

static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

const MAKORA_BASE_SKILL: &str = "\
## Makora Core Skill (universal — aplica en todos los proveedores y modelos)

Directrices Operativas de Calidad, Precisión y Eficiencia Extrema de Tokens:
1. Cero prosa innecesaria: NUNCA generes introducciones, saludos ('Hola', 'Entendido'), confirmaciones verbales vacías ni despedidas redundantes. Responde directamente ejecutando las herramientas necesarias o con el resultado técnico concreto.
2. Edición quirúrgica obligatoria: NUNCA uses write_file en archivos existentes ni reescribas archivos completos. Usa EXCLUSIVAMENTE apply_patch con bloques:
   <<<<<<< SEARCH
   [líneas exactas a reemplazar]
   =======
   [nuevas líneas]
   >>>>>>> REPLACE
   con 3-5 líneas de anclaje de contexto. Usa write_file ÚNICAMENTE para archivos 100% nuevos.
3. Lectura progresiva y focalizada: NUNCA leas archivos enteros con read_file si solo requieres una función o sección. Usa read_file_range con rango [start_line, end_line]. Usa list_dir para ubicar archivos antes de leerlos.
4. Tool Batching: Agrupa todas las lecturas de herramientas independientes en el primer turno para minimizar iteraciones de red y latencia.
5. Exploración aislada: Cuando necesites buscar en múltiples archivos, logs extensos o diagnosticar dependencias complejas, utiliza explore_subagent para no polucionar el historial principal.
6. Terminal silenciosa: Ejecuta comandos bash con parámetros de silencio (-q, --quiet, salidas acotadas). Evita volcados masivos.
7. Conclusión estructurada y compacta: Al finalizar la tarea, emite un resumen conciso de máximo 1 línea por archivo modificado:
   - `ruta/al/archivo:línea - acción realizada`
8. Continúa autónomamente hasta COMPLETAR la tarea técnica en su totalidad; no te detengas a mitad de camino pidiendo confirmaciones triviales.
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
            name: "explore_subagent".into(),
            description: "Ejecuta una tarea de investigación, búsqueda en logs o análisis multifichero en un contexto efímero aislado. Devuelve únicamente el resumen técnico condensado (100-200 tokens) sin ensuciar el historial principal.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Objetivo técnico concreto de la exploración (ej. 'Busca dónde se implementa calculate_correlations y resume sus parámetros y retorno')"
                    }
                },
                "required": ["task"]
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

fn within(folders: &[String], p: &std::path::Path) -> bool {
    if folders.is_empty() {
        return true;
    }
    let p_canon = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let p_norm = normalize_path_str(&p_canon);

    folders.iter().any(|f| {
        let fp = std::path::Path::new(f);
        let f_canon = fp.canonicalize().unwrap_or_else(|_| fp.to_path_buf());
        let f_norm = normalize_path_str(&f_canon);
        p_norm.starts_with(&f_norm)
    })
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
    let clean = path.trim().replace('\\', "/");
    let clean = clean.trim_start_matches("./").to_string();
    let usable = |c: &std::path::Path| {
        allow_missing
            || c.exists()
            || c.parent().map(|x| x.exists()).unwrap_or(false)
    };

    if folders.is_empty() {
        return Err("no hay workspace activo".into());
    }

    // 1. If path is empty or root reference (".", "", "/")
    if clean.is_empty() || clean == "." || clean == "/" {
        if let Some(first_root) = folders.first() {
            return Ok(first_root.clone());
        }
    }

    // 2. Check if clean matches any workspace root directory name or path directly
    for root in folders {
        let root_p = std::path::Path::new(root);
        let root_name = root_p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Exact match with root name (e.g. path == "makora-ide" and root is ".../makora-ide")
        if !root_name.is_empty() && clean.eq_ignore_ascii_case(&root_name) {
            return Ok(root.clone());
        }

        // Prefix match with root name (e.g. path == "makora-ide/src/App.tsx")
        if !root_name.is_empty() {
            let prefix_slash = format!("{root_name}/");
            if clean.to_lowercase().starts_with(&prefix_slash.to_lowercase()) {
                let stripped = &clean[prefix_slash.len()..];
                let direct = root_p.join(stripped);
                if usable(&direct) && within(folders, &direct) {
                    return Ok(direct.to_string_lossy().to_string());
                }
            }
        }
    }

    let p = std::path::Path::new(path);
    if p.is_absolute() {
        if usable(p) && within(folders, p) {
            return Ok(p.to_string_lossy().to_string());
        }
    }

    // 3. Try relative to each workspace folder
    for root in folders {
        let direct = std::path::Path::new(root).join(&clean);
        if usable(&direct) && within(folders, &direct) {
            return Ok(direct.to_string_lossy().to_string());
        }
    }

    // 4. Fuzzy search by first directory component
    let comps: Vec<String> = clean
        .split('/')
        .filter(|c| !c.is_empty())
        .map(String::from)
        .collect();
    if let Some(first) = comps.first() {
        for root in folders {
            if let Some(found) = find_by_name(root, first, 3) {
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
    #[cfg(target_os = "windows")]
    let shell_exec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let shell_exec = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

    let mut builder = portable_pty::CommandBuilder::new(shell_exec);

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

        let mut replaced = false;

        // Pass 1: Exact match
        if let Some(pos) = result.find(&search_block) {
            result.replace_range(pos..pos + search_block.len(), &replace_block);
            replaced = true;
        }

        // Pass 2: Trailing whitespace tolerance on each line
        if !replaced {
            let search_trimmed = search_block
                .lines()
                .map(|l| l.trim_end())
                .collect::<Vec<_>>()
                .join("\n");
            if let Some(pos) = result.find(&search_trimmed) {
                result.replace_range(pos..pos + search_trimmed.len(), &replace_block);
                replaced = true;
            }
        }

        // Pass 3: Fuzzy window matching (tolerant to indentation/whitespace differences)
        if !replaced {
            let result_lines: Vec<&str> = result.lines().collect();
            let search_lines: Vec<&str> = search_block.lines().collect();
            let s_len = search_lines.len();

            if s_len > 0 && result_lines.len() >= s_len {
                for i in 0..=result_lines.len() - s_len {
                    let window = &result_lines[i..i + s_len];
                    let matches = window
                        .iter()
                        .zip(search_lines.iter())
                        .all(|(a, b)| a.trim() == b.trim());
                    if matches {
                        let mut new_lines = Vec::new();
                        new_lines.extend_from_slice(&result_lines[..i]);
                        new_lines.push(&replace_block);
                        new_lines.extend_from_slice(&result_lines[i + s_len..]);
                        result = new_lines.join("\n");
                        replaced = true;
                        break;
                    }
                }
            }
        }

        if !replaced {
            return Err(format!(
                "anclaje no encontrado:\n{}",
                search_block.lines().take(5).collect::<Vec<_>>().join("\n")
            ));
        }
        count += 1;
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

fn summarize_old_tool_result(content: &str) -> String {
    let first_line = content.lines().next().unwrap_or("").trim();
    let lines = content.lines().count();
    if content.starts_with("parche aplicado:") {
        format!("[{first_line}]")
    } else if content.starts_with("archivo escrito:") {
        format!("[{first_line}]")
    } else if content.starts_with("ERROR:") {
        let err_snippet = truncate(content, 120);
        format!("[Resultado previo con error: {err_snippet}]")
    } else if content.contains("coincidencias") {
        format!("[Búsqueda previa grep completada: {lines} líneas]")
    } else {
        format!("[Resultado previo de herramienta: {lines} líneas]")
    }
}

fn check_file_syntax(path: &str, content: &str) -> Option<String> {
    let lower = path.to_lowercase();
    if lower.ends_with(".json") {
        if let Err(e) = serde_json::from_str::<serde_json::Value>(content) {
            return Some(format!("JSON inválido: {e}"));
        }
    } else if lower.ends_with(".ts")
        || lower.ends_with(".tsx")
        || lower.ends_with(".js")
        || lower.ends_with(".jsx")
        || lower.ends_with(".rs")
    {
        let mut curly = 0i32;
        let mut paren = 0i32;
        let mut square = 0i32;
        let mut in_str: Option<char> = None;
        let mut escape = false;
        let mut in_line_comment = false;
        let mut in_block_comment = false;
        let chars: Vec<char> = content.chars().collect();
        let len = chars.len();
        let mut i = 0;

        while i < len {
            let c = chars[i];
            let next_c = if i + 1 < len { chars[i + 1] } else { '\0' };

            if in_line_comment {
                if c == '\n' {
                    in_line_comment = false;
                }
                i += 1;
                continue;
            }
            if in_block_comment {
                if c == '*' && next_c == '/' {
                    in_block_comment = false;
                    i += 2;
                    continue;
                }
                i += 1;
                continue;
            }

            if in_str.is_some() {
                if escape {
                    escape = false;
                } else if c == '\\' {
                    escape = true;
                } else if Some(c) == in_str {
                    in_str = None;
                }
                i += 1;
                continue;
            }

            if c == '/' && next_c == '/' {
                in_line_comment = true;
                i += 2;
                continue;
            }
            if c == '/' && next_c == '*' {
                in_block_comment = true;
                i += 2;
                continue;
            }

            if c == '"' || c == '\'' || (c == '`' && !lower.ends_with(".rs")) {
                in_str = Some(c);
                i += 1;
                continue;
            }

            match c {
                '{' => curly += 1,
                '}' => curly -= 1,
                '(' => paren += 1,
                ')' => paren -= 1,
                '[' => square += 1,
                ']' => square -= 1,
                _ => {}
            }
            i += 1;
        }

        if in_str.is_some() {
            return Some("Literal de texto/comillas no cerrado al final del archivo".into());
        }
        if in_block_comment {
            return Some("Comentario de bloque /* ... */ no cerrado".into());
        }
        if curly != 0 {
            return Some(format!("Desbalance en llaves {{ }}: diferencia de {curly}"));
        }
        if paren != 0 {
            return Some(format!("Desbalance en paréntesis ( ): diferencia de {paren}"));
        }
        if square != 0 {
            return Some(format!("Desbalance en corchetes [ ]: diferencia de {square}"));
        }
    }
    None
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
                ChatMessage {
                    role: "tool".into(),
                    content: summarize_old_tool_result(&m.content),
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

async fn run_explore_subagent(
    app: &AppHandle,
    cfg: &ChatConfig,
    task: &str,
    folders: &[String],
    registry: &McpRegistry,
) -> Result<String, String> {
    let sub_system = format!(
        "Eres el Subagente Explorer de MakoraIDE. Tu misión exclusiva es investigar y responder con síntesis técnica concisa (100-250 palabras):\n{task}\n\nUsa las herramientas read_file_range, list_dir, grep para localizar la información. Al terminar emite directamente tu conclusión técnica sin rodeos."
    );
    let mut current_msgs = vec![ChatMessage {
        role: "user".into(),
        content: format!("Objetivo de exploración técnica: {task}"),
        images: vec![],
        tool_calls: None,
        tool_call_id: None,
    }];
    let sub_tools = vec![
        ToolDef {
            name: "read_file_range".into(),
            description: "Lee un intervalo de líneas [start_line, end_line] de un archivo.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "start_line": { "type": "integer" },
                    "end_line": { "type": "integer" }
                },
                "required": ["path", "start_line", "end_line"]
            }),
        },
        ToolDef {
            name: "list_dir".into(),
            description: "Lista archivos en un directorio.".into(),
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "grep".into(),
            description: "Busca patrones en archivos del workspace.".into(),
            parameters: json!({
                "type": "object",
                "properties": { "pattern": { "type": "string" }, "path": { "type": "string" } },
                "required": ["pattern"]
            }),
        },
    ];

    let mut last_text = String::new();
    for _ in 0..4 {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("exploración cancelada".into());
        }
        let outcome = if cfg.kind == "anthropic" {
            gateway::anthropic_turn(app, cfg, &sub_system, &current_msgs, &sub_tools).await?
        } else {
            gateway::openai_turn(app, cfg, &sub_system, &current_msgs, &sub_tools).await?
        };

        if !outcome.text.trim().is_empty() {
            last_text = outcome.text.clone();
        }

        if outcome.tool_calls.is_empty() {
            break;
        }

        let mut tool_results = Vec::new();
        for tc in &outcome.tool_calls {
            let res = execute_tool(app, cfg, &tc.name, &tc.arguments, folders, registry).await
                .unwrap_or_else(|e| format!("ERROR: {e}"));
            tool_results.push(ChatMessage {
                role: "tool".into(),
                content: res,
                images: vec![],
                tool_calls: None,
                tool_call_id: Some(tc.id.clone()),
            });
        }
        current_msgs.push(ChatMessage {
            role: "assistant".into(),
            content: outcome.text,
            images: vec![],
            tool_calls: Some(outcome.tool_calls),
            tool_call_id: None,
        });
        current_msgs.extend(tool_results);
    }

    if last_text.trim().is_empty() {
        Ok("[Subagente Explorer completó la investigación sin texto final]".into())
    } else {
        Ok(format!("[Resultado de Explorer Subagent]:\n{last_text}"))
    }
}

async fn execute_tool(
    app: &AppHandle,
    cfg: &ChatConfig,
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
            Ok(token_engine::global().truncate(&text, 15000))
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
            std::fs::write(&path, &new_text).map_err(|e| e.to_string())?;
            let mut msg = format!("parche aplicado: {blocks} bloque(s) modificados en {path}");
            if let Some(syntax_err) = check_file_syntax(&path, &new_text) {
                msg.push_str(&format!("\n⚠️ ALERTA DE SINTAXIS: {syntax_err}"));
            }
            Ok(msg)
        }
        "explore_subagent" => {
            let task = s("task");
            if task.trim().is_empty() {
                return Err("debes especificar la tarea para explore_subagent".into());
            }
            run_explore_subagent(app, cfg, &task, folders, registry).await
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
            Ok(token_engine::global().truncate(&out, 3000))
        }
        "bash" => run_bash(app, &s("command"), folders).await,
        "write_file" => {
            let path = resolve_path(folders, &s("path"), true)?;
            let content = s("content");
            if let Some(parent) = std::path::Path::new(&path).parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&path, &content).map_err(|e| e.to_string())?;
            let mut msg = format!("archivo escrito: {path}");
            if let Some(syntax_err) = check_file_syntax(&path, &content) {
                msg.push_str(&format!("\n⚠️ ALERTA DE SINTAXIS: {syntax_err}"));
            }
            Ok(msg)
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
    history::init();
    let full_system = format!("{MAKORA_BASE_SKILL}\n\n{system}");
    let mut msgs: Vec<ChatMessage> = messages.to_vec();
    let mut total = ChatUsage::default();
    let counter = token_engine::global();
    let workspace = folders
        .iter()
        .find(|f| !f.is_empty())
        .cloned()
        .unwrap_or_else(|| "default".into());
    let session_id = {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in workspace.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        format!("{h:016x}")
    };
    history::upsert_session(&session_id, &workspace, &cfg.model);
    // M4: resume por checkpoint cuando el frontend entrega un transcript vacío.
    if msgs.is_empty() {
        if let Some((_, restored)) = history::latest_checkpoint(&session_id) {
            println!("[TOKEN_ENGINE] resume por checkpoint: {} mensajes restaurados", restored.len());
            msgs = restored;
        }
    }
    let mut turn: u32 = 0;
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
        turn += 1;
        let started = std::time::Instant::now();
        let local_tokens = counter.count_messages(&full_system, &msgs);
        let outcome = if cfg.kind == "anthropic" {
            gateway::anthropic_turn(app, cfg, &full_system, &msgs, &tools).await?
        } else {
            gateway::openai_turn(app, cfg, &full_system, &msgs, &tools).await?
        };
        total.input_tokens += outcome.usage.input_tokens;
        total.output_tokens += outcome.usage.output_tokens;
        total.cached_tokens += outcome.usage.cached_tokens;
        history::record_request(
            &session_id,
            turn,
            &cfg.kind,
            &cfg.model,
            &RequestMeter {
                input_tokens: outcome.usage.input_tokens,
                cached_tokens: outcome.usage.cached_tokens,
                output_tokens: outcome.usage.output_tokens,
                cost_usd: 0.0,
                latency_ms: started.elapsed().as_millis() as i64,
            },
        );
        println!(
            "[TOKEN_ENGINE] turn={turn} local={local_tokens} api_in={} api_cached={} api_out={}",
            outcome.usage.input_tokens, outcome.usage.cached_tokens, outcome.usage.output_tokens
        );

        if outcome.tool_calls.is_empty() {
            msgs.push(ChatMessage {
                role: "assistant".into(),
                content: outcome.text,
                images: vec![],
                tool_calls: None,
                tool_call_id: None,
            });
            history::create_checkpoint(&session_id, turn, &msgs);
            history::archive_transcript(&session_id, turn, &msgs);
            println!(
                "[TOKEN_ENGINE] sesión terminada: {}",
                history::requests_summary(&session_id)
            );
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
                history::record_request(
                    &session_id,
                    turn,
                    &cfg.kind,
                    &cfg.model,
                    &RequestMeter {
                        input_tokens: forced.usage.input_tokens,
                        cached_tokens: forced.usage.cached_tokens,
                        output_tokens: forced.usage.output_tokens,
                        cost_usd: 0.0,
                        latency_ms: 0,
                    },
                );
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
                history::create_checkpoint(&session_id, turn, &msgs);
                history::archive_transcript(&session_id, turn, &msgs);
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
            let result = execute_tool(app, cfg, &tc.name, &tc.arguments, folders, registry).await;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_path_root_and_dot() {
        let temp_dir = std::env::temp_dir();
        let folder = temp_dir.to_string_lossy().to_string();
        let folders = vec![folder.clone()];

        // Dot or empty should return root
        assert_eq!(resolve_path(&folders, ".", false).unwrap(), folder);
        assert_eq!(resolve_path(&folders, "", false).unwrap(), folder);
        assert_eq!(resolve_path(&folders, "./", false).unwrap(), folder);
    }

    #[test]
    fn test_check_file_syntax_json() {
        let valid_json = r#"{"name": "makora", "version": 1}"#;
        assert!(check_file_syntax("config.json", valid_json).is_none());

        let invalid_json = r#"{"name": "makora", version: 1}"#;
        assert!(check_file_syntax("config.json", invalid_json).is_some());
    }

    #[test]
    fn test_check_file_syntax_curly_balance() {
        let valid_ts = "function test() { if (true) { return 1; } }";
        assert!(check_file_syntax("test.ts", valid_ts).is_none());

        let broken_ts = "function test() { if (true) { return 1; }";
        let err = check_file_syntax("test.ts", broken_ts);
        assert!(err.is_some());
        assert!(err.unwrap().contains("Desbalance en llaves"));
    }

    #[test]
    fn test_summarize_old_tool_result() {
        let patch_res = "parche aplicado: 2 bloque(s) modificados en src/App.tsx";
        assert_eq!(
            summarize_old_tool_result(patch_res),
            "[parche aplicado: 2 bloque(s) modificados en src/App.tsx]"
        );

        let err_res = "ERROR: la ruta no existe dentro del workspace: test.txt";
        assert!(summarize_old_tool_result(err_res).contains("Resultado previo con error"));
    }
}

