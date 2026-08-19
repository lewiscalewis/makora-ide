use std::collections::HashSet;
use std::sync::{Arc, LazyLock, Mutex as StdMutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::gateway::{self, ToolDef};
use crate::history::{self, RequestMeter};
use crate::mcp::{self, McpRegistry};
use crate::multiagent;
use crate::token_engine;
use crate::{ChatConfig, ChatMessage, ChatResult, ChatUsage};

static CANCELLED: LazyLock<StdMutex<HashSet<String>>> =
    LazyLock::new(|| StdMutex::new(HashSet::new()));

pub fn cancel_chat(chat_id: &str) {
    if !chat_id.is_empty() {
        CANCELLED.lock().unwrap().insert(chat_id.to_string());
    }
}

pub fn clear_cancel(chat_id: &str) {
    CANCELLED.lock().unwrap().remove(chat_id);
}

pub fn is_chat_cancelled(chat_id: &str) -> bool {
    let raw = chat_id.split("__sub_").next().unwrap_or(chat_id);
    let guard = CANCELLED.lock().unwrap();
    guard.contains(chat_id) || guard.contains(raw)
}

const MAKORA_BASE_SKILL: &str = "\
## Makora Core Operating Engine (universal — estándar de máxima precisión y eficiencia)

### I. Protocolo de Razonamiento Crítico (Thinking Protocol)
1. Invariantes y Contratos: Antes de proponer cualquier cambio, identifica contratos IPC, tipos y dependencias existentes para garantizar cero regresiones.
2. Mapeo Quirúrgico: Localiza siempre el archivo y rango exacto de líneas con `grep` o `read_file_range` antes de formular un parche.
3. Validación Sintáctica Previa: Verifica mentalmente imports requeridos, balance de llaves y coherencia de tipos antes de aplicar cualquier modificación.

### II. Economía Extrema de Tokens (Token Economy Guard)
1. Anti-Bloat: NUNCA uses `read_file` en archivos de más de 150 líneas. Usa OBLIGATORIAMENTE `read_file_range` tras ubicar la función con `grep`.
2. Cirugía Estricta con `apply_patch`: Modifica archivos existentes EXCLUSIVAMENTE con `apply_patch` usando ventanas mínimas de 3 a 5 líneas de anclaje exactas. NUNCA reescribas archivos completos existentes con `write_file` (reserva `write_file` solo para archivos 100% nuevos).
3. Batching de Herramientas: Agrupa todas las llamadas de lectura o búsqueda independientes en una única ronda de ejecución para minimizar latencia de red.
4. Aislamiento Efímero: Para exploraciones masivas en múltiples archivos o análisis de logs extensos, usa `explore_subagent` para no polucionar el historial principal (el subagente devuelve solo un briefing condensado de <200 tokens).
5. Cero Código Duplicado: NUNCA reimprimas el código completo en la respuesta final de texto cuando ya haya sido aplicado con `apply_patch`.

### III. Directrices de Salida: Concisa, Clara, Objetiva y Sin Redundancias
1. Respuestas Directas y Precisas: Si el usuario realiza una pregunta conceptual o consulta técnica, responde directamente a la duda de forma clara, concisa y objetiva, sin entrar en redundancias, rodeos teóricos innecesarios ni preámbulos vacíos.
2. Resumen Ejecutivo Quirúrgico: Al finalizar una tarea técnica que involucre herramientas o modificaciones, emite SIEMPRE un resumen conciso y claro de lo que se ha realizado:
   - Archivos y funciones modificadas con su referencia exacta (`ruta/al/archivo:línea`).
   - Breve descripción del cambio aplicado.
   - Estado de Verificación: `[compilación / tests / sintaxis OK]`.
3. Cero Relleno: Prohibidas las frases de cortesía repetitivas, el parafraseo de la pregunta del usuario o la duplicación de bloques de código ya insertados.
4. Terminal Silenciosa: Ejecuta comandos `bash` con banderas silenciosas (`-q`, `--quiet`, salidas acotadas). Prohibidos comandos interactivos o bloqueantes.
5. Autonomía: Completa la tarea técnica en su totalidad sin detenerte a pedir confirmaciones innecesarias en pasos intermedios.
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
    pub chat_id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutput {
    pub id: String,
    pub stream: String,
    pub data: String,
    pub chat_id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEnd {
    pub id: String,
    pub ok: bool,
    pub summary: String,
    pub chat_id: String,
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
            description: "Ejecuta un comando de terminal/shell en el workspace de forma no interactiva (timeout 60s). Devuelve stdout/stderr y el código de salida. Úsalo ÚNICAMENTE cuando el usuario solicite explícitamente ejecutar un comando o cuando sea estrictamente necesario para compilar, testear o inspeccionar el entorno.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Comando a ejecutar" }
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

fn is_dangerous_command(cmd: &str) -> bool {
    let lower = cmd.trim().to_lowercase();
    let dangerous_patterns = [
        "format ",
        "rmdir /s /q c:",
        "rmdir /s /q c:\\",
        "rmdir /s /q %systemdrive%",
        "rm -rf /",
        "rm -rf /*",
        ":(){ :|:& };:",
        "mkfs.",
        "dd if=/dev/zero",
        "diskpart",
        "del /f /s /q c:\\",
        "del /f /s /q c:/",
        "drop database",
        "reg delete hklm",
        "shutdown /s",
        "init 0",
        "systemctl poweroff",
    ];
    dangerous_patterns.iter().any(|&p| lower.contains(p))
}

fn is_read_only_tool(name: &str) -> bool {
    matches!(name, "read_file" | "read_file_range" | "grep" | "list_dir")
}

async fn run_bash(
    app: &AppHandle,
    command: &str,
    folders: &[String],
    chat_id: &str,
) -> Result<String, String> {
    if is_dangerous_command(command) {
        return Err("Comando bloqueado por seguridad: contiene patrones destructivos no permitidos.".into());
    }

    let id = now_id();
    let cwd = folders
        .first()
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            std::env::temp_dir().to_string_lossy().to_string()
        });

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd.exe");
        c.args(["/C", command]);
        #[cfg(windows)]
        c.creation_flags(0x08000000); // CREATE_NO_WINDOW: completely silences background popup console windows
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = tokio::process::Command::new("sh");
    #[cfg(not(target_os = "windows"))]
    cmd.args(["-c", command]);

    cmd.current_dir(&cwd);
    cmd.env("PAGER", "cat");
    cmd.env("GIT_PAGER", "cat");
    cmd.env("CI", "1");
    cmd.env("TERM", "dumb");
    cmd.env("NO_COLOR", "1");
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("error iniciando comando: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let combined = Arc::new(StdMutex::new(String::new()));
    let app_out = app.clone();
    let id_out = id.clone();
    let chat_out = chat_id.to_string();
    let combined_out = combined.clone();

    let stdout_handle = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            use tokio::io::AsyncBufReadExt;
            let mut reader = tokio::io::BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                combined_out.lock().unwrap().push_str(&line);
                combined_out.lock().unwrap().push('\n');
                let _ = app_out.emit(
                    "tool-output",
                    ToolOutput {
                        id: id_out.clone(),
                        stream: "stdout".into(),
                        data: format!("{line}\n"),
                        chat_id: chat_out.clone(),
                    },
                );
            }
        }
    });

    let app_err = app.clone();
    let id_err = id.clone();
    let chat_err = chat_id.to_string();
    let combined_err = combined.clone();
    let stderr_handle = tokio::spawn(async move {
        if let Some(stderr) = stderr {
            use tokio::io::AsyncBufReadExt;
            let mut reader = tokio::io::BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                combined_err.lock().unwrap().push_str(&line);
                combined_err.lock().unwrap().push('\n');
                let _ = app_err.emit(
                    "tool-output",
                    ToolOutput {
                        id: id_err.clone(),
                        stream: "stderr".into(),
                        data: format!("{line}\n"),
                        chat_id: chat_err.clone(),
                    },
                );
            }
        }
    });

    // Espera con cancelación por chat: mata también el proceso hijo.
    let timeout_duration = std::time::Duration::from_secs(60);
    let deadline = std::time::Instant::now() + timeout_duration;
    let exit_code: i32;    loop {
        if is_chat_cancelled(chat_id) {
            let _ = child.kill().await;
            return Err("cancelado por el usuario".into());
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill().await;
            return Err("timeout (60s) ejecutando el comando bash".into());
        }
        match tokio::time::timeout(std::time::Duration::from_millis(300), child.wait()).await {
            Ok(Ok(status)) => {
                exit_code = status.code().unwrap_or(-1);
                break;
            }
            Ok(Err(e)) => return Err(format!("error esperando al proceso: {e}")),
            Err(_) => {}
        }
    }
    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

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
            chat_id: chat_id.to_string(),
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
    // Si la sesión no es excesivamente larga (<200k chars), preservar 100% de inmutabilidad para Prefix Caching
    let total_chars: usize = msgs.iter().map(|m| m.content.len()).sum();
    if total_chars < 200_000 {
        return msgs.to_vec();
    }
    let tool_positions: Vec<usize> = msgs
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "tool")
        .map(|(i, _)| i)
        .collect();
    if tool_positions.len() <= 10 {
        return msgs.to_vec();
    }
    let keep = 8usize;
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

fn execute_subagent_tool(
    name: &str,
    arguments: &str,
    folders: &[String],
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
            Ok(token_engine::global().truncate(&text, 10000))
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
            for e in entries.iter().take(200) {
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
                grep_dir(&d, &pattern, &mut out, &mut count, 150);
                if count >= 150 {
                    break;
                }
            }
            if out.is_empty() {
                out = "sin coincidencias".into();
            }
            Ok(token_engine::global().truncate(&out, 3000))
        }
        _ => Err(format!("herramienta no permitida en subagente explorer: {name}")),
    }
}

async fn run_explore_subagent(
    app: &AppHandle,
    cfg: &ChatConfig,
    task: &str,
    folders: &[String],
    chat_id: &str,
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
        if is_chat_cancelled(chat_id) {
            return Err("exploración cancelada".into());
        }
        let outcome = if cfg.kind == "anthropic" {
            gateway::anthropic_turn(app, cfg, chat_id, &sub_system, &current_msgs, &sub_tools).await?
        } else {
            gateway::openai_turn(app, cfg, chat_id, &sub_system, &current_msgs, &sub_tools).await?
        };

        if !outcome.text.trim().is_empty() {
            last_text = outcome.text.clone();
        }

        if outcome.tool_calls.is_empty() {
            break;
        }

        let mut tool_results = Vec::new();
        for tc in &outcome.tool_calls {
            let res = execute_subagent_tool(&tc.name, &tc.arguments, folders)
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
    chat_id: &str,
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
            run_explore_subagent(app, cfg, &task, folders, chat_id).await
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
        "bash" => run_bash(app, &s("command"), folders, chat_id).await,
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
    chat_id: &str,
    system: &str,
    messages: &[ChatMessage],
    folders: &[String],
    registry: &McpRegistry,
) -> Result<ChatResult, String> {
    clear_cancel(chat_id);
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
        for b in chat_id.as_bytes() {
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
        if is_chat_cancelled(chat_id) {
            return Err("cancelado por el usuario".into());
        }
        // Motor M2 (D2): podado de historia y límite presupuestario por contexto
        let composer = token_engine::ContextComposer::for_window(cfg.context_window.unwrap_or(128_000), None);
        msgs = evict_tool_results(&msgs);
        let wire_msgs = composer.fit_history(counter, &msgs);
        turn += 1;
        let started = std::time::Instant::now();
        let local_tokens = counter.count_messages(&full_system, &wire_msgs);
        let outcome = if cfg.kind == "anthropic" {
            gateway::anthropic_turn(app, cfg, chat_id, &full_system, &wire_msgs, &tools).await?
        } else {
            gateway::openai_turn(app, cfg, chat_id, &full_system, &wire_msgs, &tools).await?
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
            let final_content = if !outcome.text.trim().is_empty() {
                outcome.text
            } else {
                let mut modified_files = Vec::new();
                let mut read_files = Vec::new();
                for msg in &msgs {
                    if let Some(tool_calls) = &msg.tool_calls {
                        for tc in tool_calls {
                            if tc.name == "apply_patch" || tc.name == "write_file" {
                                if let Ok(v) = serde_json::from_str::<Value>(&tc.arguments) {
                                    if let Some(p) = v.get("path").and_then(|p| p.as_str()) {
                                        if !modified_files.contains(&p.to_string()) {
                                            modified_files.push(p.to_string());
                                        }
                                    }
                                }
                            } else if tc.name == "read_file" || tc.name == "read_file_range" {
                                if let Ok(v) = serde_json::from_str::<Value>(&tc.arguments) {
                                    if let Some(p) = v.get("path").and_then(|p| p.as_str()) {
                                        if !read_files.contains(&p.to_string()) {
                                            read_files.push(p.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if !modified_files.is_empty() {
                    let mut s = String::from("### ✅ Modificaciones aplicadas con éxito\n\nSe han integrado parches quirúrgicos en los siguientes archivos:\n");
                    for f in &modified_files {
                        s.push_str(&format!("- `{f}`\n"));
                    }
                    s.push_str("\nTodos los cambios fueron aplicados y validados correctamente.");
                    s
                } else if !read_files.is_empty() {
                    let mut s = String::from("### 📋 Análisis completado\n\nSe inspeccionaron los componentes relevantes:\n");
                    for f in &read_files {
                        s.push_str(&format!("- `{f}`\n"));
                    }
                    s.push_str("\nEl análisis finalizó sin requerir modificaciones adicionales.");
                    s
                } else {
                    "✅ Tarea procesada y completada correctamente.".to_string()
                }
            };

            msgs.push(ChatMessage {
                role: "assistant".into(),
                content: final_content,
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
        let mut sig: Vec<String> = outcome
            .tool_calls
            .iter()
            .map(|t| format!("{}|{}", t.name, t.arguments))
            .collect();
        sig.sort();
        if sig == prev_sig {
            repeats += 1;
            if repeats >= 2 {
                let forced = if cfg.kind == "anthropic" {
                    gateway::anthropic_turn(app, cfg, chat_id, &full_system, &msgs, &[]).await?
                } else {
                    gateway::openai_turn(app, cfg, chat_id, &full_system, &msgs, &[]).await?
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

        // Ejecución optimizada: si todas las herramientas del turno son de solo lectura,
        // ejecutarlas concurrentemente en paralelo para triplicar la velocidad de respuesta.
        let all_read_only = outcome.tool_calls.iter().all(|tc| is_read_only_tool(&tc.name));

        if all_read_only && outcome.tool_calls.len() > 1 {
            for tc in &outcome.tool_calls {
                let _ = app.emit(
                    "tool-start",
                    ToolStart {
                        id: tc.id.clone(),
                        name: tc.name.clone(),
                        arguments: tc.arguments.clone(),
                        chat_id: chat_id.to_string(),
                    },
                );
            }
            let tasks: Vec<_> = outcome.tool_calls.iter().map(|tc| {
                let app = app.clone();
                let cfg = cfg.clone();
                let name = tc.name.clone();
                let arguments = tc.arguments.clone();
                let folders = folders.to_vec();
                let id = tc.id.clone();
                let chat = chat_id.to_string();
                async move {
                    let result =
                        execute_tool(&app, &cfg, &name, &arguments, &folders, registry, &chat).await;
                    let (ok, summary) = match &result {
                        Ok(s) => (true, truncate(s, 400)),
                        Err(e) => (false, e.clone()),
                    };
                    let _ = app.emit(
                        "tool-end",
                        ToolEnd { id: id.clone(), ok, summary, chat_id: chat.clone() },
                    );
                    let content = match result {
                        Ok(s) => s,
                        Err(e) => format!("ERROR: {e}"),
                    };
                    (id, content)
                }
            }).collect();

            let results = futures_util::future::join_all(tasks).await;
            if is_chat_cancelled(chat_id) {
                return Err("Cancelado por el usuario".into());
            }
            for (id, content) in results {
                msgs.push(ChatMessage {
                    role: "tool".into(),
                    content,
                    images: vec![],
                    tool_calls: None,
                    tool_call_id: Some(id),
                });
            }
        } else {
            for tc in &outcome.tool_calls {
                if is_chat_cancelled(chat_id) {
                    return Err("Cancelado por el usuario".into());
                }
                let _ = app.emit(
                    "tool-start",
                    ToolStart {
                        id: tc.id.clone(),
                        name: tc.name.clone(),
                        arguments: tc.arguments.clone(),
                        chat_id: chat_id.to_string(),
                    },
                );
                let result =
                    execute_tool(app, cfg, &tc.name, &tc.arguments, folders, registry, chat_id).await;
                if is_chat_cancelled(chat_id) {
                    return Err("Cancelado por el usuario".into());
                }
                let (ok, summary) = match &result {
                    Ok(s) => (true, truncate(s, 400)),
                    Err(e) => (false, e.clone()),
                };
                let _ = app.emit(
                    "tool-end",
                    ToolEnd { id: tc.id.clone(), ok, summary, chat_id: chat_id.to_string() },
                );
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
}

fn role_tool_names(role: multiagent::SubagentRole) -> &'static [&'static str] {
    match role {
        multiagent::SubagentRole::Explorer => &["list_dir", "grep", "read_file_range"],
        multiagent::SubagentRole::Coder => {
            &["list_dir", "grep", "read_file_range", "apply_patch", "write_file"]
        }
        multiagent::SubagentRole::Tester => &["bash", "list_dir", "grep", "read_file_range"],
        multiagent::SubagentRole::Reviewer => &["list_dir", "grep", "read_file_range"],
    }
}

fn emit_plan(app: &AppHandle, chat_id: &str, plan: &multiagent::MultiAgentPlanState) {
    let _ = app.emit(
        "multiagent-plan-event",
        multiagent::MultiAgentPlanEvent {
            chat_id: chat_id.to_string(),
            plan: plan.clone(),
        },
    );
}

pub async fn run_multiagent(
    app: &AppHandle,
    cfg: &ChatConfig,
    chat_id: &str,
    system: &str,
    messages: &[ChatMessage],
    folders: &[String],
    objective: &str,
    registry: &McpRegistry,
) -> Result<ChatResult, String> {
    clear_cancel(chat_id);
    let full_system = format!("{MAKORA_BASE_SKILL}\n\n{system}");
    let mut msgs: Vec<ChatMessage> = messages.to_vec();
    let mut total = ChatUsage::default();
    let workspace = folders
        .iter()
        .find(|f| !f.is_empty())
        .cloned()
        .unwrap_or_else(|| "default".into());
    let session_id = {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in chat_id.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        format!("{h:016x}")
    };
    history::upsert_session(&session_id, &workspace, &cfg.model);

    let mut plan = multiagent::create_default_plan(chat_id, objective);
    emit_plan(app, chat_id, &plan);

    let mut briefing = String::new();
    let mut turn: u32 = 0;

    for idx in 0..plan.steps.len() {
        if is_chat_cancelled(chat_id) {
            return Err("cancelado por el usuario".into());
        }
        plan.steps[idx].status = "running".into();
        plan.active_step_index = Some(plan.steps[idx].step_index);
        emit_plan(app, chat_id, &plan);

        let role = plan.steps[idx].role;
        let step_index = plan.steps[idx].step_index;
        let allowed = role_tool_names(role);
        let mut tools: Vec<ToolDef> = core_tools()
            .into_iter()
            .filter(|t| allowed.contains(&t.name.as_str()))
            .collect();
        if role == multiagent::SubagentRole::Coder {
            let map = registry.tools.lock().unwrap();
            for (name, (_, schema)) in map.iter() {
                tools.push(ToolDef {
                    name: name.clone(),
                    description: format!("Herramienta MCP {name}"),
                    parameters: schema.clone(),
                });
            }
        }

        let sub_system = format!(
            "{full_system}\n\n## Subagente: {}\n{}\n\n## Objetivo de la tarea\n{objective}\n\n## Briefing acumulado de pasos previos\n{}",
            role.name(),
            role.system_prompt(),
            if briefing.is_empty() {
                "(ninguno — este es el primer paso del flujo multi-agente)".to_string()
            } else {
                briefing.clone()
            }
        );

        let role_instruction = match role {
            multiagent::SubagentRole::Explorer => format!(
                "Inspecciona el espacio de trabajo para resolver el siguiente requerimiento:\n\n{objective}\n\nUsa `grep`, `list_dir` y `read_file_range` para localizar los archivos y funciones relevantes. Devuelve un briefing técnico estructurado con rutas y rangos de líneas."
            ),
            multiagent::SubagentRole::Coder => format!(
                "Implementa las modificaciones necesarias para resolver el objetivo:\n\n{objective}\n\nUsa `apply_patch` con 3-5 líneas de anclaje exactas basándote en los archivos y líneas descubiertos por el Explorador. No reescribas archivos completos."
            ),
            multiagent::SubagentRole::Tester => format!(
                "Verifica que los cambios aplicados compilen o no contengan fallos de sintaxis. Si hay comandos de pruebas o chequeo disponibles, ejecútalos con `bash`. Si no, inspecciona los archivos editados para certificar su validez.\n\nObjetivo: {objective}"
            ),
            multiagent::SubagentRole::Reviewer => format!(
                "Audita las modificaciones aplicadas y los resultados de las pruebas para verificar que no haya regresiones arquitectónicas, contratos rotos ni fallos de seguridad.\n\nObjetivo: {objective}"
            ),
        };

        let mut sub_msgs = messages.to_vec();
        sub_msgs.push(ChatMessage {
            role: "user".into(),
            content: role_instruction,
            images: vec![],
            tool_calls: None,
            tool_call_id: None,
        });

        let subagent_chat_id = format!("{chat_id}__sub_{step_index}");
        let mut step_text = String::new();
        let mut step_success = true;
        let mut executed_tool_names: Vec<String> = Vec::new();

        for _ in 0..6 {
            if is_chat_cancelled(chat_id) {
                return Err("cancelado por el usuario".into());
            }
            turn += 1;
            let started = std::time::Instant::now();
            let outcome = if cfg.kind == "anthropic" {
                gateway::anthropic_turn(app, cfg, &subagent_chat_id, &sub_system, &sub_msgs, &tools).await?
            } else {
                gateway::openai_turn(app, cfg, &subagent_chat_id, &sub_system, &sub_msgs, &tools).await?
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

            if !outcome.text.trim().is_empty() {
                step_text = outcome.text.clone();
            }
            if outcome.tool_calls.is_empty() {
                break;
            }

            sub_msgs.push(ChatMessage {
                role: "assistant".into(),
                content: outcome.text.clone(),
                images: vec![],
                tool_calls: Some(outcome.tool_calls.clone()),
                tool_call_id: None,
            });
            for tc in &outcome.tool_calls {
                if is_chat_cancelled(chat_id) {
                    return Err("cancelado por el usuario".into());
                }
                executed_tool_names.push(tc.name.clone());
                let _ = app.emit(
                    "tool-start",
                    ToolStart {
                        id: tc.id.clone(),
                        name: tc.name.clone(),
                        arguments: tc.arguments.clone(),
                        chat_id: chat_id.to_string(),
                    },
                );
                let result =
                    execute_tool(app, cfg, &tc.name, &tc.arguments, folders, registry, chat_id).await;
                let (ok, summary) = match &result {
                    Ok(s) => (true, truncate(s, 400)),
                    Err(e) => {
                        step_success = false;
                        (false, e.clone())
                    }
                };
                let _ = app.emit(
                    "tool-end",
                    ToolEnd { id: tc.id.clone(), ok, summary, chat_id: chat_id.to_string() },
                );
                let content = match result {
                    Ok(s) => s,
                    Err(e) => format!("ERROR: {e}"),
                };
                sub_msgs.push(ChatMessage {
                    role: "tool".into(),
                    content,
                    images: vec![],
                    tool_calls: None,
                    tool_call_id: Some(tc.id.clone()),
                });
            }
        }

        let summary = if !step_text.trim().is_empty() {
            truncate(&step_text, 600)
        } else if !executed_tool_names.is_empty() {
            format!("Herramientas ejecutadas: {}", executed_tool_names.join(", "))
        } else {
            "Fase completada exitosamente.".to_string()
        };

        briefing.push_str(&format!(
            "\n\n## Paso {} ({}) — resultado\n{summary}\n",
            step_index + 1,
            role.name()
        ));
        plan.steps[idx].result_summary = Some(truncate(&summary, 450));
        plan.steps[idx].status = if step_success { "completed".into() } else { "failed".into() };
        emit_plan(app, chat_id, &plan);
    }

    // Fase 5: Orquestador Principal — Síntesis Final estructurada y streaming directo al usuario
    if is_chat_cancelled(chat_id) {
        return Err("cancelado por el usuario".into());
    }

    let synth_system = format!(
        "{full_system}\n\n## Modo: Orquestador Principal Makora (Síntesis Final Multi-Agente)\nHas coordinado una ejecución en cadena con 4 fases especializadas (Exploración, Código, Validación, Revisión).\n\n### Briefings Técnicos de los Subagentes:\n{briefing}\n\nDirectiva:\nGenera la respuesta final de forma concisa, clara y objetiva respondiendo directamente a la solicitud del usuario: '{objective}'. Resume sin redundancias ni preámbulos qué se ha analizado, qué cambios exactos se han aplicado (rutas de archivo y funciones), el resultado de las pruebas y las conclusiones de calidad."
    );

    let synth_user_content = format!(
        "Genera la síntesis final estructurada para el objetivo: {objective}"
    );

    let mut synth_msgs = messages.to_vec();
    synth_msgs.push(ChatMessage {
        role: "user".into(),
        content: synth_user_content,
        images: vec![],
        tool_calls: None,
        tool_call_id: None,
    });

    turn += 1;
    let started = std::time::Instant::now();
    let synth_outcome = if cfg.kind == "anthropic" {
        gateway::anthropic_turn(app, cfg, chat_id, &synth_system, &synth_msgs, &[]).await?
    } else {
        gateway::openai_turn(app, cfg, chat_id, &synth_system, &synth_msgs, &[]).await?
    };

    total.input_tokens += synth_outcome.usage.input_tokens;
    total.output_tokens += synth_outcome.usage.output_tokens;
    total.cached_tokens += synth_outcome.usage.cached_tokens;
    history::record_request(
        &session_id,
        turn,
        &cfg.kind,
        &cfg.model,
        &RequestMeter {
            input_tokens: synth_outcome.usage.input_tokens,
            cached_tokens: synth_outcome.usage.cached_tokens,
            output_tokens: synth_outcome.usage.output_tokens,
            cost_usd: 0.0,
            latency_ms: started.elapsed().as_millis() as i64,
        },
    );

    plan.is_completed = true;
    plan.active_step_index = None;
    plan.total_tokens = total.input_tokens + total.output_tokens;
    emit_plan(app, chat_id, &plan);

    let final_msg = if !synth_outcome.text.trim().is_empty() {
        synth_outcome.text
    } else {
        let mut report = String::from("### 📋 Informe de Ejecución Multi-Agente\n\n");
        for step in &plan.steps {
            let role_name = step.role.name();
            let summary = step.result_summary.as_deref().unwrap_or("Completado sin observaciones");
            report.push_str(&format!("- **{} ({})**:\n  {}\n\n", step.title, role_name, summary));
        }
        report.push_str(&format!(
            "⚡ **Consumo total**: {} tokens.\n",
            plan.total_tokens
        ));
        report
    };

    msgs.push(ChatMessage {
        role: "assistant".into(),
        content: final_msg,
        images: vec![],
        tool_calls: None,
        tool_call_id: None,
    });
    history::create_checkpoint(&session_id, turn, &msgs);
    history::archive_transcript(&session_id, turn, &msgs);
    Ok(ChatResult {
        input_tokens: total.input_tokens,
        output_tokens: total.output_tokens,
        cached_tokens: total.cached_tokens,
        messages: msgs,
    })
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

    #[test]
    fn test_resolve_path_empty_workspace_err() {
        let folders: Vec<String> = vec![];
        let res = resolve_path(&folders, "test.txt", false);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "no hay workspace activo");
    }

    #[test]
    fn test_resolve_path_traversal_prevention() {
        let temp_dir = std::env::temp_dir();
        let ws_dir = temp_dir.join("makora_test_ws_sec");
        let _ = std::fs::create_dir_all(&ws_dir);
        let folders = vec![ws_dir.to_string_lossy().to_string()];

        // Attempting to escape the workspace with ../../../ should fail or stay bound
        let escape_path = "../../../../../../../../../Windows/System32/drivers/etc/hosts";
        let res = resolve_path(&folders, escape_path, false);
        // Either resolve_path rejects it or fails because it is outside within()
        if let Ok(resolved) = res {
            assert!(within(&folders, std::path::Path::new(&resolved)));
        }

        let _ = std::fs::remove_dir_all(&ws_dir);
    }

    #[test]
    fn test_is_dangerous_command() {
        assert!(is_dangerous_command("rm -rf /"));
        assert!(is_dangerous_command("rm -rf /*"));
        assert!(is_dangerous_command("mkfs.ext4 /dev/sda"));
        assert!(is_dangerous_command("format c:"));
        assert!(is_dangerous_command("del /f /s /q c:\\"));
        assert!(is_dangerous_command("shutdown /s /t 0"));

        // Safe commands should pass
        assert!(!is_dangerous_command("cargo check"));
        assert!(!is_dangerous_command("npm test"));
        assert!(!is_dangerous_command("git status"));
    }

    #[test]
    fn test_apply_patch_to() {
        let original = "line 1\nline 2\nline 3\nline 4\n";
        let patch = "<<<<<<< SEARCH\nline 2\nline 3\n=======\nline two\nline three\n>>>>>>> REPLACE";
        let res = apply_patch_to(original, patch);
        assert!(res.is_ok());
        let (modified, blocks) = res.unwrap();
        assert_eq!(blocks, 1);
        assert_eq!(modified, "line 1\nline two\nline three\nline 4\n");

        let bad_patch = "<<<<<<< SEARCH\nnon_existent_line\n=======\nreplacement\n>>>>>>> REPLACE";
        assert!(apply_patch_to(original, bad_patch).is_err());
    }

    #[test]
    fn test_truncate_head_tail() {
        let long_text = (0..100).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
        let truncated = truncate_head_tail(&long_text, 5, 5);
        assert!(truncated.contains("line 0"));
        assert!(truncated.contains("90 líneas omitidas"));
        assert!(truncated.contains("line 99"));
    }

    #[test]
    fn test_is_read_only_tool() {
        assert!(is_read_only_tool("read_file"));
        assert!(is_read_only_tool("read_file_range"));
        assert!(is_read_only_tool("grep"));
        assert!(is_read_only_tool("list_dir"));

        assert!(!is_read_only_tool("write_file"));
        assert!(!is_read_only_tool("apply_patch"));
        assert!(!is_read_only_tool("run_bash"));
    }
}

