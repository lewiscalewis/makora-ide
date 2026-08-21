use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex as StdMutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::gateway::{self, ToolDef};
use crate::history::{self, RequestMeter};
use crate::mcp::{self, McpRegistry};
use crate::multiagent;
use crate::token_engine;
use crate::{ChatConfig, ChatMessage, ChatResult, ChatUsage, ToolCall};

const MAX_ACTIVE_TOOL_RESULTS: usize = 3;

static CANCELLED: LazyLock<StdMutex<HashSet<String>>> =
    LazyLock::new(|| StdMutex::new(HashSet::new()));

fn guard<T>(m: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn cancel_chat(chat_id: &str) {
    if !chat_id.is_empty() {
        guard(&CANCELLED).insert(chat_id.to_string());
    }
}

pub fn clear_cancel(chat_id: &str) {
    guard(&CANCELLED).remove(chat_id);
}

pub fn is_chat_cancelled(chat_id: &str) -> bool {
    let raw = chat_id.split("__sub_").next().unwrap_or(chat_id);
    let g = guard(&CANCELLED);
    g.contains(chat_id) || g.contains(raw)
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub content: String,
    pub status: String,
    pub priority: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoUpdateEvent {
    pub chat_id: String,
    pub todos: Vec<TodoItem>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionAskEvent {
    pub chat_id: String,
    pub id: String,
    pub question: String,
    pub options: Vec<String>,
    pub header: String,
}

static TODOS: LazyLock<StdMutex<HashMap<String, Vec<TodoItem>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

static PENDING_QUESTIONS: LazyLock<
    StdMutex<HashMap<String, Option<tokio::sync::oneshot::Sender<String>>>>,
> = LazyLock::new(|| StdMutex::new(HashMap::new()));

pub fn reply_question(question_id: &str, answer: String) -> Result<(), String> {
    let sender = guard(&PENDING_QUESTIONS).remove(question_id);
    match sender {
        Some(Some(tx)) => {
            let _ = tx.send(answer);
            Ok(())
        }
        _ => Err("la pregunta ya fue respondida o expiró".into()),
    }
}

#[derive(Clone, PartialEq, Debug)]
enum PermAction {
    Allow,
    Deny,
}

#[derive(Clone)]
struct PermRule {
    tool: String,
    pattern: String,
    action: PermAction,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequiredEvent {
    pub chat_id: String,
    pub id: String,
    pub tool: String,
    pub arguments: String,
    pub summary: String,
}

struct PendingApproval {
    chat_id: String,
    tool: String,
    pattern: String,
}

struct ApprovalReply {
    decision: String,
    feedback: String,
}

static SESSION_PERMS: LazyLock<StdMutex<HashMap<String, Vec<PermRule>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

static SKILLS_BY_CHAT: LazyLock<StdMutex<HashMap<String, Vec<Skill>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

static PENDING_APPROVALS: LazyLock<
    StdMutex<HashMap<String, (PendingApproval, Option<tokio::sync::oneshot::Sender<ApprovalReply>>)>>,
> = LazyLock::new(|| StdMutex::new(HashMap::new()));

pub fn reply_approval(
    approval_id: &str,
    decision: String,
    feedback: String,
) -> Result<(), String> {
    let entry = guard(&PENDING_APPROVALS).remove(approval_id);
    match entry {
        Some((pending, Some(tx))) => {
            let mut perms = guard(&SESSION_PERMS);
            match decision.as_str() {
                "allow_always" => perms
                    .entry(pending.chat_id.clone())
                    .or_default()
                    .push(PermRule {
                        tool: pending.tool.clone(),
                        pattern: pending.pattern.clone(),
                        action: PermAction::Allow,
                    }),
                "deny_always" => perms
                    .entry(pending.chat_id.clone())
                    .or_default()
                    .push(PermRule {
                        tool: pending.tool.clone(),
                        pattern: pending.pattern.clone(),
                        action: PermAction::Deny,
                    }),
                "trust_session" => perms
                    .entry(pending.chat_id.clone())
                    .or_default()
                    .push(PermRule {
                        tool: "*".to_string(),
                        pattern: "*".to_string(),
                        action: PermAction::Allow,
                    }),
                _ => {}
            }
            let _ = tx.send(ApprovalReply {
                decision,
                feedback,
            });
            Ok(())
        }
        _ => Err("la aprobación ya fue respondida o expiró".into()),
    }
}

pub fn clear_session_perms(chat_id: &str) {
    guard(&SESSION_PERMS).remove(chat_id);
}

fn bash_prefix(command: &str) -> String {
    let tokens: Vec<&str> = command
        .split_whitespace()
        .take(3)
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        "*".to_string()
    } else {
        format!("{} *", tokens.join(" "))
    }
}

fn is_sensitive_path(path: &str) -> bool {
    let lower = path.replace('\\', "/").to_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    name.contains(".env")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
        || name.starts_with("id_dsa")
        || name.ends_with(".npmrc")
        || name.ends_with(".pypirc")
        || name.ends_with(".gitconfig")
        || name.ends_with(".htpasswd")
        || name.contains("secret")
        || name.contains("credential")
        || name.contains("password")
}

fn pattern_matches(pattern: &str, value: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let p = pattern.replace('\\', "/").to_lowercase();
    let v = value.replace('\\', "/").to_lowercase();
    if p == v {
        return true;
    }
    if let Some(prefix) = p.strip_suffix(" *") {
        let prefix_tokens: Vec<&str> = prefix.split_whitespace().collect();
        let value_tokens: Vec<&str> = v.split_whitespace().collect();
        if prefix_tokens.len() <= value_tokens.len() {
            return prefix_tokens
                .iter()
                .zip(value_tokens.iter())
                .all(|(a, b)| a == b);
        }
    }
    if let Some(prefix) = p.strip_suffix('*') {
        if !prefix.is_empty() && v.starts_with(prefix) {
            return true;
        }
    }
    false
}

fn evaluate_rules(rules: &[PermRule], tool: &str, pattern: &str) -> Option<PermAction> {
    let mut decision: Option<PermAction> = None;
    for r in rules {
        let tool_ok = r.tool == "*" || r.tool == tool;
        if tool_ok && pattern_matches(&r.pattern, pattern) {
            decision = Some(r.action.clone());
        }
    }
    decision
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
4. Formato Estricto de Herramientas: Cada llamada a herramienta debe recibir EXACTAMENTE un único objeto JSON válido. Queda terminantemente prohibido concatenar múltiples objetos JSON (ej. NUNCA emitir '{\"pattern\":\"a\"}{\"pattern\":\"b\"}'). Si requieres múltiples búsquedas, usa llamadas separadas.
5. Aislamiento Efímero: Para exploraciones masivas en múltiples archivos o análisis de logs extensos, usa `explore_subagent` para no polucionar el historial principal (el subagente devuelve solo un briefing condensado de <200 tokens).
6. Cero Código Duplicado: NUNCA reimprimas el código completo en la respuesta final de texto cuando ya haya sido aplicado con `apply_patch`.

### III. Directrices de Salida: Concisa, Clara, Objetiva y Sin Redundancias
1. Respuestas Directas y Precisas: Si el usuario realiza una pregunta conceptual o consulta técnica, responde directamente a la duda de forma clara, concisa y objetiva, sin entrar en redundancias, rodeos teóricos innecesarios ni preámbulos vacíos.
2. Resumen Ejecutivo Quirúrgico: Al finalizar una tarea técnica que involucre herramientas o modificaciones, emite SIEMPRE un resumen conciso y claro de lo que se ha realizado:
   - Archivos y funciones modificadas con su referencia exacta (`ruta/al/archivo:línea`).
   - Breve descripción del cambio aplicado.
   - Estado de Verificación: `[compilación / tests / sintaxis OK]`.
3. Cero Relleno: Prohibidas las frases de cortesía repetitivas, el parafraseo de la pregunta del usuario o la duplicación de bloques de código ya insertados.
4. Terminal Silenciosa: Ejecuta comandos `bash` con banderas silenciosas (`-q`, `--quiet`, salidas acotadas). Prohibidos comandos interactivos o bloqueantes.
5. Autonomía: Completa la tarea técnica en su totalidad sin detenerte a pedir confirmaciones innecesarias en pasos intermedios.
6. Plan de Tareas: Para tareas de 3 o más pasos usa `todowrite` al inicio y actualízala al completar cada paso (una sola tarea in_progress a la vez). Para decisiones realmente bloqueantes (ambigüedad crítica de requisitos, elección de enfoque con consecuencias) usa `question` con opciones sugeridas; nunca para confirmaciones triviales.
7. Documentación Web: Para consultar documentación externa (APIs, librerías, READMEs online) usa `webfetch` con la URL concreta de la página relevante; una única petición por página es suficiente, no descargues sitios completos.
8. Skills de Proyecto: Si en el system prompt aparece una skill de proyecto relevante para la tarea, cárgala con la herramienta `skill` (nombre exacto) antes de empezar y sigue sus instrucciones al pie de la letra.
9. Gestión de errores de herramientas: si una herramienta devuelve ERROR, interpreta el mensaje, corrige los argumentos y reintenta o adapta la estrategia. NUNCA incluyas la sintaxis de llamada a herramientas en tu respuesta al usuario; si un fallo es definitivo, explícalo brevemente en la respuesta final.
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
            description: "Aplica parches quirúrgicos a un archivo existente. Formato de cada bloque:\n<<<<<<< SEARCH\n[líneas originales exactas]\n=======\n[líneas nuevas]\n>>>>>>> REPLACE".into(),
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
            description: "Ejecuta una tarea de investigación/análisis en un contexto efímero aislado; devuelve solo un resumen condensado sin ensuciar el historial principal.".into(),
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
            description: "Ejecuta un comando de shell no interactivo en el workspace (timeout 600s). Devuelve stdout/stderr y código de salida.".into(),
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
        ToolDef {
            name: "todowrite".into(),
            description: "Crea/actualiza la lista de tareas del turno (visible al usuario). Úsala para tareas de 3+ pasos. Estados: pending, in_progress, completed, cancelled; una sola in_progress a la vez.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "content": { "type": "string", "description": "Descripción breve de la tarea" },
                                "status": { "type": "string", "enum": ["pending", "in_progress", "completed", "cancelled"] },
                                "priority": { "type": "string", "enum": ["high", "medium", "low"] }
                            },
                            "required": ["content", "status"]
                        },
                        "description": "Lista completa de tareas con su estado actual"
                    }
                },
                "required": ["todos"]
            }),
        },
        ToolDef {
            name: "question".into(),
            description: "Pregunta al usuario una decisión bloqueante (espera su respuesta). Solo para ambigüedad crítica de requisitos o de enfoque; nunca para confirmaciones triviales.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "question": { "type": "string", "description": "Pregunta concreta y clara para el usuario" },
                    "options": { "type": "array", "items": { "type": "string" }, "description": "Opciones de respuesta sugeridas (el usuario siempre puede escribir una respuesta libre)" },
                    "header": { "type": "string", "description": "Título corto opcional de la pregunta" }
                },
                "required": ["question"]
            }),
        },
        ToolDef {
            name: "webfetch".into(),
            description: "Descarga una página web y la convierte a Markdown. Solo http/https, máx 5 MB; requiere aprobación del usuario por URL.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "URL completa http/https a descargar" }
                },
                "required": ["url"]
            }),
        },
        ToolDef {
            name: "skill".into(),
            description: "Carga el contenido de una skill del proyecto (SKILL.md) por su nombre exacto para seguir sus instrucciones.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Nombre exacto de la skill a cargar (ver lista en el system prompt)" }
                },
                "required": ["name"]
            }),
        },
        ToolDef {
            name: "repo_map_query".into(),
            description: "Consulta el índice semántico del workspace: busca funciones, clases, structs, traits, interfaces o módulos por nombre (o fragmento) y devuelve las definiciones más relevantes con su ruta y línea. Úsalo para localizar dónde se define algo sin hacer grep ciego.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Nombre (o fragmento) del símbolo a localizar, p. ej. 'calculate_correlations' o 'Regime'" },
                    "top": { "type": "integer", "description": "Número máximo de resultados (por defecto 20)" }
                },
                "required": ["query"]
            }),
        },
    ]
}

fn delegate_tool_def() -> ToolDef {
    ToolDef {
        name: "delegate_subagent".into(),
        description: "Delega una tarea pesada en un subagente efímero que devuelve solo un briefing condensado. Roles: explorer (análisis, solo lectura), coder (implementa con apply_patch), tester (verifica con bash), reviewer (audita cambios). Pasa hallazgos previos en `context` para evitar re-exploración.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "role": {
                    "type": "string",
                    "enum": ["explorer", "coder", "tester", "reviewer"],
                    "description": "Rol del subagente a invocar"
                },
                "task": {
                    "type": "string",
                    "description": "Objetivo técnico concreto que debe resolver el subagente"
                },
                "context": {
                    "type": "string",
                    "description": "Contexto previo opcional: rutas, símbolos y hallazgos ya conocidos para evitar re-exploración"
                }
            },
            "required": ["role", "task"]
        }),
    }
}

fn role_short(role: multiagent::SubagentRole) -> &'static str {
    match role {
        multiagent::SubagentRole::Explorer => "explorer",
        multiagent::SubagentRole::Coder => "coder",
        multiagent::SubagentRole::Tester => "tester",
        multiagent::SubagentRole::Reviewer => "reviewer",
    }
}

fn role_tools(role: multiagent::SubagentRole) -> Vec<ToolDef> {
    let allowed: &[&str] = match role {
        multiagent::SubagentRole::Explorer => &["list_dir", "grep", "read_file_range", "webfetch", "repo_map_query"],
        multiagent::SubagentRole::Coder => &["list_dir", "grep", "read_file_range", "apply_patch", "write_file"],
        multiagent::SubagentRole::Tester => &["bash", "list_dir", "grep", "read_file_range"],
        multiagent::SubagentRole::Reviewer => &["list_dir", "grep", "read_file_range"],
    };
    core_tools()
        .into_iter()
        .filter(|t| allowed.contains(&t.name.as_str()))
        .collect()
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
        if p_norm == f_norm {
            return true;
        }
        let prefix = if f_norm.ends_with('/') {
            f_norm.clone()
        } else {
            format!("{f_norm}/")
        };
        p_norm.starts_with(&prefix)
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

    Err(format!(
        "la ruta no existe dentro del workspace: {path} (raíces: {})",
        folders.join(", ")
    ))
}


fn grep_dir(dir: &str, pattern: &str, out: &mut String, count: &mut u32, max: u32) {
    if *count >= max {
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
        if *count >= max {
            return;
        }
        let Ok(entry) = result else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let Some(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_ignored_path(&name) {
            continue;
        }
        let path = entry.path();
        if let Ok(text) = std::fs::read_to_string(path) {
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

fn list_dir_entries(path: &str, max_entries: usize) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("no se pudo acceder a {path}: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("{path} es un archivo, no un directorio; usa read_file"));
    }
    let mut builder = ignore::WalkBuilder::new(path);
    builder
        .max_depth(Some(1))
        .follow_links(false)
        .hidden(true)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true);
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    for result in builder.build() {
        let Ok(entry) = result else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_ignored_path(&name) {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            dirs.push(name);
        } else {
            files.push(name);
        }
    }
    dirs.sort();
    files.sort();
    let mut out = String::new();
    let mut total = 0usize;
    for d in dirs {
        if total >= max_entries {
            break;
        }
        out.push_str(&format!("{d}/\n"));
        total += 1;
    }
    for f in files {
        if total >= max_entries {
            break;
        }
        out.push_str(&format!("{f}\n"));
        total += 1;
    }
    if out.is_empty() {
        return Ok("(directorio vacío)".into());
    }
    Ok(out)
}

const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;

fn arg_number(args: &Value, key: &str) -> Option<u64> {
    match args.get(key) {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn read_file_guarded(path: &str, max_tokens: usize) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err(format!("{path} es un directorio; usa list_dir"));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(format!(
            "archivo demasiado grande ({} MB) para read_file; usa read_file_range con líneas concretas",
            meta.len() / (1024 * 1024)
        ));
    }
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(truncate_tool_output("read_file", &text, max_tokens))
}

fn read_file_range_lines(
    path: &str,
    start: usize,
    end: usize,
    max_tokens: usize,
) -> Result<String, String> {
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    use std::io::BufRead;
    let reader = std::io::BufReader::new(f);
    let mut out = String::new();
    let mut found = 0usize;
    for (i, line) in reader.lines().enumerate() {
        let ln = i + 1;
        if ln > end {
            break;
        }
        if ln < start {
            continue;
        }
        let line = line.map_err(|e| e.to_string())?;
        out.push_str(&format!("{ln}| {line}\n"));
        found += 1;
    }
    if found == 0 {
        return Ok("(sin líneas en el rango solicitado: el archivo es más corto)".into());
    }
    Ok(truncate_tool_output("read_file_range", &out, max_tokens))
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

pub fn is_ignored_path(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with('.')
        || lower == "node_modules"
        || lower == "target"
        || lower == "dist"
        || lower == "build"
        || lower == "coverage"
        || lower == ".venv"
        || lower == "venv"
        || lower == "__pycache__"
        || lower == ".next"
        || lower == ".nuxt"
        || lower == ".git"
        || lower == ".idea"
        || lower == ".vscode"
        || lower.ends_with(".lock")
        || lower.ends_with("-lock.json")
        || lower.ends_with("-lock.yaml")
        || lower.ends_with(".min.js")
        || lower.ends_with(".min.css")
        || lower.ends_with(".map")
}

pub fn is_read_only_tool(name: &str) -> bool {
    matches!(
        name,
        "read_file" | "read_file_range" | "grep" | "list_dir" | "skill" | "repo_map_query"
    )
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum ToolKind {
    ReadOnly,
    Neutral,
    Mutating,
}

fn tool_kind(name: &str) -> ToolKind {
    if is_read_only_tool(name) || name == "webfetch" || name == "explore_subagent" {
        ToolKind::ReadOnly
    } else if name == "todowrite" || name == "question" {
        ToolKind::Neutral
    } else {
        ToolKind::Mutating
    }
}

fn ip_is_local_or_private(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
                || {
                    let oct = v4.octets();
                    oct[0] == 100 && (64..=127).contains(&oct[1])
                }
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
        }
    }
}

fn is_public_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url.trim()) else {
        return false;
    };
    let scheme = parsed.scheme().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let host_lower = host.to_ascii_lowercase();
    if host_lower == "localhost" || host_lower.ends_with(".localhost") {
        return false;
    }
    let host_clean = host_lower.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host_clean.parse::<std::net::IpAddr>() {
        let canonical = match ip {
            std::net::IpAddr::V6(v6) => v6.to_canonical(),
            other => other,
        };
        if ip_is_local_or_private(&canonical) {
            return false;
        }
    }
    true
}

static FETCH_CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            attempt.error("demasiadas redirecciones")
        } else if is_public_url(attempt.url().as_str()) {
            attempt.follow()
        } else {
            attempt.error("la redirección apunta a una dirección no permitida (local/privada)")
        }
    });
    reqwest::Client::builder()
        .redirect(policy)
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default()
});

async fn fetch_url_markdown(url: &str) -> Result<String, String> {
    if !is_public_url(url) {
        return Err(
            "solo se permiten URLs http/https públicas (sin localhost, IPs privadas ni destinos internos)"
                .into(),
        );
    }
    let text = tokio::time::timeout(
        std::time::Duration::from_secs(25),
        async {
            let resp = FETCH_CLIENT
                .get(url)
                .header(
                    reqwest::header::USER_AGENT,
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
                )
                .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
                .send()
                .await
                .map_err(|e| format!("error descargando {url}: {e}"))?;
            let status = resp.status();
            if !status.is_success() {
                return Err(format!("HTTP {status} descargando {url}"));
            }
            if resp.content_length().unwrap_or(0) > 5_000_000 {
                return Err("respuesta demasiado grande (>5 MB)".into());
            }
            resp.text()
                .await
                .map_err(|e| format!("error leyendo respuesta: {e}"))
        },
    )
    .await
    .map_err(|_| "timeout (25s) descargando la página".to_string())??;
    if text.len() > 5_000_000 {
        return Err("respuesta demasiado grande (>5 MB)".into());
    }
    let markdown = html_to_markdown(&text);
    let mut out = format!("Contenido de {url} (convertido a Markdown):\n\n");
    out.push_str(&truncate_tool_output("webfetch", &markdown, 6000));
    Ok(out)
}

fn html_to_markdown(html: &str) -> String {
    let mut cleaned = html.to_string();
    for pat in [
        r"(?is)<script.*?</script>",
        r"(?is)<style.*?</style>",
        r"(?is)<noscript.*?</noscript>",
        r"(?is)<iframe.*?</iframe>",
        r"(?is)<svg.*?</svg>",
        r"(?is)<head.*?</head>",
    ] {
        if let Ok(re) = regex::Regex::new(pat) {
            cleaned = re.replace_all(&cleaned, "").to_string();
        }
    }
    html2md::parse_html(&cleaned)
}

fn normalize_bash_command(command: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        // Normaliza rutas estilo unix (/c/Users/... -> C:/Users/...) que los LLMs
        // envían por error, SOLO cuando el patrón aparece como token de ruta
        // (inicio, tras espacio, comilla o igual). Así no corrompe URLs como
        // https://host/a/b ni textos arbitrarios.
        if let Ok(re) = regex::Regex::new(r#"(?i)(^|[\s"'=])/([a-z])/(\S*)"#) {
            let out = re.replace_all(command, |caps: &regex::Captures<'_>| {
                let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let drive = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let rest = caps.get(3).map(|m| m.as_str()).unwrap_or("");
                format!("{prefix}{drive}:/{rest}")
            });
            return out.into_owned();
        }
    }
    command.to_string()
}

#[cfg(target_os = "windows")]
fn write_bat_script(command: &str) -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join("makora_cmds");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("cmd_{}_{}.bat", std::process::id(), now_id()));
    let normalized = normalize_bash_command(command);
    let content = format!("@echo off\r\nchcp 65001 >nul\r\n{normalized}\r\nexit /b %errorlevel%\r\n");
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(target_os = "windows")]
async fn kill_process_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    let mut cmd = tokio::process::Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let _ = cmd.spawn();
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
    let bat_path: Option<std::path::PathBuf> = Some(write_bat_script(command)?);
    #[cfg(not(target_os = "windows"))]
    let bat_path: Option<std::path::PathBuf> = None;

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd.exe");
        c.args([
            "/C",
            &bat_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        ]);
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
                {
                    let mut g = guard(&combined_out);
                    g.push_str(&line);
                    g.push('\n');
                }
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
                {
                    let mut g = guard(&combined_err);
                    g.push_str(&line);
                    g.push('\n');
                }
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

    // Espera con cancelación por chat: mata también el árbol de procesos hijo.
    let timeout_duration = std::time::Duration::from_secs(600);
    let deadline = std::time::Instant::now() + timeout_duration;
    let exit_code: i32;
    loop {
        if is_chat_cancelled(chat_id) {
            let _ = child.kill().await;
            #[cfg(target_os = "windows")]
            kill_process_tree(child.id()).await;
            #[cfg(target_os = "windows")]
            if let Some(p) = &bat_path {
                let _ = std::fs::remove_file(p);
            }
            return Err("cancelado por el usuario".into());
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill().await;
            #[cfg(target_os = "windows")]
            kill_process_tree(child.id()).await;
            #[cfg(target_os = "windows")]
            if let Some(p) = &bat_path {
                let _ = std::fs::remove_file(p);
            }
            return Err("timeout (600s) ejecutando el comando bash".into());
        }
        match tokio::time::timeout(std::time::Duration::from_millis(300), child.wait()).await {
            Ok(Ok(status)) => {
                exit_code = status.code().unwrap_or(-1);
                break;
            }
            Ok(Err(e)) => {
                #[cfg(target_os = "windows")]
                if let Some(p) = &bat_path {
                    let _ = std::fs::remove_file(p);
                }
                return Err(format!("error esperando al proceso: {e}"));
            }
            Err(_) => {}
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(p) = &bat_path {
        let _ = std::fs::remove_file(p);
    }
    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    let out = guard(&combined).clone();
    let mut summarized = truncate_head_tail(&out, 40, 40);
    if summarized.chars().count() > 12000 {
        let trimmed = truncate(&summarized, 12000);
        summarized = spill_output("bash", &out, trimmed);
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

static SPILL_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn spill_output(tool: &str, full: &str, truncated: String) -> String {
    let dir = std::env::temp_dir().join("makora_truncated");
    if std::fs::create_dir_all(&dir).is_err() {
        return truncated;
    }
    let id = SPILL_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let name = format!("{}_{}_{}.txt", tool, std::process::id(), id);
    let path = dir.join(&name);
    if std::fs::write(&path, full).is_err() {
        return truncated;
    }
    format!(
        "{truncated}\n…[salida completa guardada en: {}]…",
        path.to_string_lossy()
    )
}

fn truncate_tool_output(tool: &str, text: &str, max_tokens: usize) -> String {
    let truncated = token_engine::global().truncate(text, max_tokens);
    if truncated.len() < text.len() {
        spill_output(tool, text, truncated)
    } else {
        truncated
    }
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
    if tool_positions.len() <= MAX_ACTIVE_TOOL_RESULTS {
        return msgs.to_vec();
    }
    let threshold = tool_positions.len().saturating_sub(MAX_ACTIVE_TOOL_RESULTS);
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
                    reasoning: None,
                }
            } else {
                m.clone()
            }
        })
        .collect()
}

fn sanitize_history(msgs: &[ChatMessage]) -> Vec<ChatMessage> {
    let mut out: Vec<ChatMessage> = Vec::with_capacity(msgs.len());
    let mut i = 0;
    let n = msgs.len();

    while i < n {
        let m = &msgs[i];
        match m.role.as_str() {
            "assistant" => {
                let has_content = !m.content.trim().is_empty();
                let has_tools = m.tool_calls.as_ref().map(|t| !t.is_empty()).unwrap_or(false);

                if !has_content && !has_tools {
                    i += 1;
                    continue;
                }

                if let Some(tcs) = &m.tool_calls {
                    if !tcs.is_empty() {
                        let required_ids: Vec<String> = tcs
                            .iter()
                            .map(|tc| {
                                if tc.id.trim().is_empty() {
                                    "call_0".to_string()
                                } else {
                                    tc.id.clone()
                                }
                            })
                            .collect();

                        let mut tool_responses: HashMap<String, ChatMessage> = HashMap::new();
                        let mut j = i + 1;
                        while j < n && msgs[j].role == "tool" {
                            let tid = msgs[j].tool_call_id.clone().unwrap_or_default();
                            if !tid.is_empty() {
                                tool_responses.insert(tid, msgs[j].clone());
                            }
                            j += 1;
                        }

                        out.push(m.clone());

                        for id in &required_ids {
                            if let Some(resp) = tool_responses.remove(id) {
                                out.push(resp);
                            } else {
                                out.push(ChatMessage {
                                    role: "tool".into(),
                                    content: "[Llamada a herramienta interrumpida o completada previamente]".into(),
                                    images: vec![],
                                    tool_calls: None,
                                    tool_call_id: Some(id.clone()),
                                    reasoning: None,
                                });
                            }
                        }

                        i = j;
                        continue;
                    }
                }

                out.push(m.clone());
                i += 1;
            }
            "tool" => {
                // Herramienta huérfana
                i += 1;
            }
            _ => {
                out.push(m.clone());
                i += 1;
            }
        }
    }

    out
}

fn prepare_wire(msgs: &[ChatMessage], cfg: &ChatConfig) -> Vec<ChatMessage> {
    let counter = token_engine::global();
    let composer =
        token_engine::ContextComposer::for_window(cfg.context_window.unwrap_or(128_000), None);
    let evicted = evict_tool_results(msgs);
    let fitted = composer.fit_history(counter, &evicted);
    sanitize_history(&fitted)
}

fn serialize_msg_for_compaction(m: &ChatMessage) -> String {
    match m.role.as_str() {
        "user" => format!("[Usuario]: {}", truncate(&m.content, 1000)),
        "assistant" => {
            if let Some(tcs) = &m.tool_calls {
                if !tcs.is_empty() {
                    let calls: Vec<String> = tcs
                        .iter()
                        .map(|tc| format!("{}({})", tc.name, truncate(&tc.arguments, 300)))
                        .collect();
                    let mut s = format!("[Asistente - llamadas a herramientas]: {}", calls.join("; "));
                    if !m.content.trim().is_empty() {
                        s.push_str(&format!("\n[Asistente]: {}", truncate(&m.content, 500)));
                    }
                    return s;
                }
            }
            format!("[Asistente]: {}", truncate(&m.content, 1000))
        }
        "tool" => format!("[Resultado de herramienta]: {}", summarize_old_tool_result(&m.content)),
        _ => String::new(),
    }
}

fn find_compaction_split(msgs: &[ChatMessage], keep_tail: usize) -> usize {
    if msgs.len() <= keep_tail {
        return 0;
    }
    let max_split = msgs.len() - keep_tail;
    for i in (1..=max_split).rev() {
        if msgs[i].role == "assistant"
            && msgs[i]
                .tool_calls
                .as_ref()
                .map(|t| !t.is_empty())
                .unwrap_or(false)
        {
            return i;
        }
    }
    for i in (1..=max_split).rev() {
        if msgs[i].role == "user" {
            return i;
        }
    }
    max_split
}

fn serialize_head_for_compaction(msgs: &[ChatMessage], max_chars: usize) -> String {
    let mut out = String::new();
    for m in msgs.iter().rev() {
        let line = serialize_msg_for_compaction(m);
        if line.is_empty() {
            continue;
        }
        if out.is_empty() && line.chars().count() > max_chars {
            out = truncate(&line, max_chars.saturating_sub(16).max(1));
            break;
        }
        let candidate = if out.is_empty() {
            line
        } else {
            format!("{line}\n{out}")
        };
        if candidate.chars().count() > max_chars {
            break;
        }
        out = candidate;
    }
    out
}

fn apply_compaction_mapping(wire_prefix_len: usize, wire_tail_start: usize, split: usize) -> usize {
    wire_tail_start + split.saturating_sub(wire_prefix_len)
}

const COMPACTION_SYSTEM: &str = "\
 Eres un compactador de historial de conversación. Resume el historial proporcionado en español \
 técnico conciso, preservando TODA la información accionable para continuar la tarea sin perder \
 contexto: (1) decisiones de diseño tomadas y su razón, (2) archivos modificados y cambios \
 aplicados (rutas exactas), (3) errores encontrados y cómo se resolvieron o su estado, \
 (4) verificaciones ejecutadas y resultados, (5) pasos pendientes. No añadas información nueva. \
 Responde SOLO con el resumen (viñetas compactas, máximo 400 palabras).";

async fn compact_history_llm(
    app: &AppHandle,
    cfg: &ChatConfig,
    chat_id: &str,
    msgs: &[ChatMessage],
) -> Result<(Vec<ChatMessage>, usize, ChatUsage), String> {
    const MIN_HEAD_MSGS: usize = 4;
    const KEEP_TAIL: usize = 8;
    let split = find_compaction_split(msgs, KEEP_TAIL);
    if split < MIN_HEAD_MSGS {
        return Ok((Vec::new(), 0, ChatUsage::default()));
    }
    let head = &msgs[..split];
    let serialized = serialize_head_for_compaction(head, 12_000);
    if serialized.trim().is_empty() {
        return Ok((Vec::new(), 0, ChatUsage::default()));
    }

    let compact_chat_id = format!("{chat_id}__compact");
    let mut cfg_small = cfg.clone();
    cfg_small.max_output_tokens = Some(1_200);
    cfg_small.reasoning_effort = None;
    cfg_small.temperature = Some(0.3);
    let prompt_msgs = vec![ChatMessage {
        role: "user".into(),
        content: format!("Historial a compactar:\n\n{serialized}"),
        images: vec![],
        tool_calls: None,
        tool_call_id: None,
        reasoning: None,
    }];
    let outcome = if cfg.kind == "anthropic" {
        gateway::anthropic_turn(
            app,
            &cfg_small,
            &compact_chat_id,
            COMPACTION_SYSTEM,
            &prompt_msgs,
            &[],
        )
        .await?
    } else {
        gateway::openai_turn(
            app,
            &cfg_small,
            &compact_chat_id,
            COMPACTION_SYSTEM,
            &prompt_msgs,
            &[],
        )
        .await?
    };
    let summary = outcome.text.trim().to_string();
    if summary.is_empty() {
        return Ok((Vec::new(), 0, outcome.usage));
    }
    let pair = vec![
        ChatMessage {
            role: "user".into(),
            content: "(El historial anterior de esta conversación se resume a continuación de forma automática e interna para ahorrar contexto. Este resumen NO es visible para el usuario: no lo menciones ni lo cites en tu respuesta.)".into(),
            images: vec![],
            tool_calls: None,
            tool_call_id: None,
            reasoning: None,
        },
        ChatMessage {
            role: "assistant".into(),
            content: format!("Resumen del historial anterior:\n{summary}"),
            images: vec![],
            tool_calls: None,
            tool_call_id: None,
            reasoning: None,
        },
    ];
    Ok((pair, split, outcome.usage))
}

async fn execute_subagent_tool(
    app: &AppHandle,
    name: &str,
    arguments: &str,
    folders: &[String],
    chat_id: &str,
    display_name: &str,
    snapshot: &mut SnapshotGuard,
) -> Result<String, String> {
    let args: Value = if arguments.trim().is_empty() {
        json!({})
    } else {
        gateway::parse_tool_args(arguments)
    };
    if let Some(pattern) = tool_permission_target(name, &args, folders) {
        gate_permission(app, chat_id, name, display_name, &pattern, arguments).await?;
    }
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();

    let repaired = repair_tool_name(name, &[]);
    let name = repaired.as_ref();

    match name {
        "read_file" => {
            let path = resolve_path(folders, &s("path"), false)?;
            read_file_guarded(&path, 10000)
        }
        "read_file_range" => {
            let path = resolve_path(folders, &s("path"), false)?;
            let start = arg_number(&args, "start_line").unwrap_or(1).max(1) as usize;
            let end = arg_number(&args, "end_line")
                .unwrap_or(start as u64)
                .max(start as u64) as usize;
            read_file_range_lines(&path, start, end, 10000)
        }
        "list_dir" => {
            let path = resolve_path(folders, &s("path"), false)?;
            list_dir_entries(&path, 200)
        }
        "grep" => {
            let pattern = s("pattern");
            if pattern.trim().is_empty() {
                return Err("grep requiere un 'pattern' no vacío".into());
            }
            let pattern = pattern.to_lowercase();
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
            Ok(truncate_tool_output("grep", &out, 3000))
        }
        "repo_map_query" => {
            let q = s("query");
            if q.trim().is_empty() {
                return Err("repo_map_query requiere un 'query' no vacío".into());
            }
            let top = arg_number(&args, "top").unwrap_or(20) as usize;
            let out = crate::symbol_index::query(folders, &q, top);
            Ok(truncate_tool_output("repo_map_query", &out, 4000))
        }
        "webfetch" => {
            let url = s("url");
            fetch_url_markdown(&url).await
        }
        "apply_patch" => {
            let path = resolve_path(folders, &s("path"), false)?;
            if std::path::Path::new(&path).is_dir() {
                return Err(format!("{path} es un directorio; apply_patch solo edita archivos"));
            }
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let (new_text, blocks) = apply_patch_to(&text, &s("patch"))?;
            snapshot.capture(&path);
            std::fs::write(&path, &new_text).map_err(|e| e.to_string())?;
            let mut msg = format!("parche aplicado: {blocks} bloque(s) en {path}");
            if let Some(syntax_err) = check_file_syntax(&path, &new_text) {
                msg.push_str(&format!("\n⚠️ ALERTA DE SINTAXIS: {syntax_err}"));
            }
            Ok(msg)
        }
        "write_file" => {
            let path = resolve_path(folders, &s("path"), true)?;
            if std::path::Path::new(&path).is_dir() {
                return Err(format!("{path} es un directorio; write_file solo escribe archivos"));
            }
            let content = s("content");
            if let Some(parent) = std::path::Path::new(&path).parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            snapshot.capture(&path);
            std::fs::write(&path, &content).map_err(|e| e.to_string())?;
            let mut msg = format!("archivo escrito: {path}");
            if let Some(syntax_err) = check_file_syntax(&path, &content) {
                msg.push_str(&format!("\n⚠️ ALERTA DE SINTAXIS: {syntax_err}"));
            }
            Ok(msg)
        }
        "bash" => run_bash(app, &s("command"), folders, chat_id).await,
        _ => Err(format!("herramienta no permitida en subagente: {name}")),
    }
}

pub struct SubagentReport {
    pub summary: String,
    pub modified_files: Vec<String>,
    pub success: bool,
}

async fn run_subagent(
    app: &AppHandle,
    cfg: &ChatConfig,
    chat_id: &str,
    role: multiagent::SubagentRole,
    task: &str,
    context: &str,
    folders: &[String],
    usage_acc: &mut ChatUsage,
    snapshot: &mut SnapshotGuard,
) -> Result<SubagentReport, String> {
    let role_name = role.name();
    let role_short = role_short(role);
    let mut sub_system = format!(
        "{MAKORA_BASE_SKILL}\n\n## Subagente {role_name} (contexto efímero aislado)\n{}\n\n## Tarea delegada\n{task}",
        role.system_prompt()
    );
    if !context.trim().is_empty() {
        sub_system.push_str(&format!(
            "\n\n## Contexto aportado por el agente principal\n{context}"
        ));
    }
    sub_system.push_str(&format!(
        "\n\n## Workspace (raíces)\n{}\n\n## Reglas de salida\n- Trabaja de forma autónoma y termina SIEMPRE con un resumen final conciso (máximo 400 palabras) de lo realizado: hallazgos, archivos modificados y resultados de verificación.\n- No repitas código completo; referencia rutas y líneas exactas.",
        folders.join("\n")
    ));

    let mut current = vec![ChatMessage {
        role: "user".into(),
        content: format!("Tarea: {task}"),
        images: vec![],
        tool_calls: None,
        tool_call_id: None,
        reasoning: None,
    }];
    let tools = role_tools(role);
    let sub_chat_id = format!("{chat_id}__sub_{role_short}");

    let mut last_text = String::new();
    let mut modified: Vec<String> = Vec::new();
    let mut ok = true;
    let mut prev_sig: Vec<String> = Vec::new();
    let mut repeats: u32 = 0;
    const MAX_SUBAGENT_TOKENS: u32 = 250_000;

    for _step in 0..8 {
        if is_chat_cancelled(chat_id) {
            return Err("cancelado por el usuario".into());
        }
        if usage_acc.input_tokens + usage_acc.output_tokens > MAX_SUBAGENT_TOKENS {
            println!("[SUBAGENT] Presupuesto de tokens de subagente alcanzado ({} tok)", usage_acc.input_tokens + usage_acc.output_tokens);
            break;
        }
        let outcome = if cfg.kind == "anthropic" {
            gateway::anthropic_turn(app, cfg, &sub_chat_id, &sub_system, &current, &tools).await?
        } else {
            gateway::openai_turn(app, cfg, &sub_chat_id, &sub_system, &current, &tools).await?
        };
        usage_acc.input_tokens += outcome.usage.input_tokens;
        usage_acc.output_tokens += outcome.usage.output_tokens;
        usage_acc.cached_tokens += outcome.usage.cached_tokens;

        if !outcome.text.trim().is_empty() {
            last_text = outcome.text.clone();
        }
        if outcome.tool_calls.is_empty() {
            break;
        }

        let sig: Vec<String> = outcome
            .tool_calls
            .iter()
            .map(|t| format!("{}:{}", t.name, t.arguments))
            .collect();
        if sig == prev_sig {
            repeats += 1;
            if repeats >= 2 {
                println!("[SUBAGENT] Detección de bucle de herramientas en subagente; deteniendo delegación");
                break;
            }
        } else {
            repeats = 0;
            prev_sig = sig;
        }

        current.push(ChatMessage {
            role: "assistant".into(),
            content: outcome.text.clone(),
            images: vec![],
            tool_calls: Some(outcome.tool_calls.clone()),
            tool_call_id: None,
            reasoning: if outcome.reasoning.is_empty() {
                None
            } else {
                Some(outcome.reasoning.clone())
            },
        });

        for tc in &outcome.tool_calls {
            if is_chat_cancelled(chat_id) {
                return Err("cancelado por el usuario".into());
            }
            let display_name = format!("sub:{role_short}:{}", tc.name);
            let _ = app.emit(
                "tool-start",
                ToolStart {
                    id: tc.id.clone(),
                    name: display_name.clone(),
                    arguments: tc.arguments.clone(),
                    chat_id: chat_id.to_string(),
                },
            );
            let result = execute_subagent_tool(
                app,
                &tc.name,
                &tc.arguments,
                folders,
                chat_id,
                &display_name,
                snapshot,
            )
            .await
            .unwrap_or_else(|e| format!("ERROR: {e}"));
            if result.starts_with("ERROR:") {
                ok = false;
            }
            if tc.name == "apply_patch" || tc.name == "write_file" {
                if let Ok(v) = serde_json::from_str::<Value>(&tc.arguments) {
                    if let Some(p) = v.get("path").and_then(|x| x.as_str()) {
                        if !modified.contains(&p.to_string()) {
                            modified.push(p.to_string());
                        }
                    }
                }
            }
            let (tool_ok, summary) = if result.starts_with("ERROR:") {
                (false, truncate(&result, 400))
            } else {
                (true, truncate(&result, 400))
            };
            let _ = app.emit(
                "tool-end",
                ToolEnd {
                    id: tc.id.clone(),
                    ok: tool_ok,
                    summary,
                    chat_id: chat_id.to_string(),
                },
            );
            current.push(ChatMessage {
                role: "tool".into(),
                content: result,
                images: vec![],
                tool_calls: None,
                tool_call_id: Some(tc.id.clone()),
                reasoning: None,
            });
        }
    }

    let summary = if last_text.trim().is_empty() {
        format!(
            "[Subagente {role_name} concluyó sus operaciones{}]",
            if modified.is_empty() {
                String::new()
            } else {
                format!("; archivos modificados: {}", modified.join(", "))
            }
        )
    } else {
        last_text
    };
    Ok(SubagentReport {
        summary,
        modified_files: modified,
        success: ok,
    })
}

#[derive(Clone)]
struct Skill {
    name: String,
    description: String,
    content: String,
}

fn parse_skill_frontmatter(raw: &str) -> Option<(String, String, String)> {
    let rest = raw.strip_prefix("---")?;
    let (fm, body) = rest.split_once("---")?;
    let mut name = String::new();
    let mut description = String::new();
    for line in fm.lines() {
        if let Some(v) = line.strip_prefix("name:") {
            name = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("description:") {
            description = v.trim().to_string();
        }
    }
    if name.is_empty() {
        return None;
    }
    Some((name, description, body.trim().to_string()))
}

fn skill_dirs(folders: &[String]) -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    for f in folders {
        for rel in [".makora/skills", ".opencode/skills"] {
            dirs.push(std::path::Path::new(f).join(rel));
        }
    }
    if let Some(home) = dirs::home_dir() {
        for rel in [".makora/skills", ".claude/skills"] {
            dirs.push(home.join(rel));
        }
    }
    dirs
}

fn load_skills(folders: &[String]) -> Vec<Skill> {
    let mut skills: Vec<Skill> = Vec::new();
    for root in skill_dirs(folders) {
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let md_path = e.path().join("SKILL.md");
            if let Ok(raw) = std::fs::read_to_string(&md_path) {
                if let Some((name, description, content)) = parse_skill_frontmatter(&raw) {
                    if !skills.iter().any(|s| s.name.eq_ignore_ascii_case(&name)) {
                        skills.push(Skill {
                            name,
                            description,
                            content,
                        });
                    }
                }
            }
        }
    }
    skills
}

fn skills_system_section(skills: &[Skill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let mut out = String::from("\n\n## Skills disponibles (cárgalas con la herramienta `skill` cuando apliquen)\n");
    for s in skills {
        let desc = if s.description.is_empty() {
            "sin descripción".to_string()
        } else {
            truncate(&s.description, 200)
        };
        out.push_str(&format!("- `{}` — {desc}\n", s.name));
    }
    out
}

fn repo_map_section(folders: &[String]) -> String {
    let map = crate::repo_map::repo_map_for(folders);
    if map.trim().is_empty() {
        return String::new();
    }
    format!("\n\n## Mapa del workspace (estructura de archivos)\n```\n{map}\n```")
}

fn repair_tool_name<'a>(name: &'a str, mcp_names: &[String]) -> std::borrow::Cow<'a, str> {    const CORE: &[&str] = &[
        "read_file",
        "read_file_range",
        "list_dir",
        "grep",
        "apply_patch",
        "write_file",
        "bash",
        "explore_subagent",
        "delegate_subagent",
        "todowrite",
        "question",
        "webfetch",
        "skill",
        "repo_map_query",
    ];
    let collapse = |s: &str| -> String {
        s.trim()
            .to_lowercase()
            .replace(['-', ' ', ':', '/'], "_")
            .split('_')
            .filter(|p| !p.is_empty())
            .collect::<Vec<_>>()
            .join("_")
    };
    if CORE.iter().any(|c| *c == name) || mcp_names.iter().any(|c| c == name) {
        return std::borrow::Cow::Borrowed(name);
    }
    let target = collapse(name);
    for c in CORE {
        if collapse(c) == target {
            return std::borrow::Cow::Owned(c.to_string());
        }
    }
    for m in mcp_names {
        if collapse(m) == target {
            return std::borrow::Cow::Owned(m.clone());
        }
    }
    std::borrow::Cow::Borrowed(name)
}

fn normalize_todos(args: &Value) -> Result<Vec<TodoItem>, String> {
    let arr = args
        .get("todos")
        .and_then(|t| t.as_array())
        .ok_or("todowrite requiere un array 'todos'")?;
    let mut todos: Vec<TodoItem> = Vec::new();
    for item in arr {
        let content = item
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if content.is_empty() {
            continue;
        }
        let status = item
            .get("status")
            .and_then(|c| c.as_str())
            .unwrap_or("pending");
        let status = match status {
            "in_progress" | "completed" | "cancelled" | "pending" => status.to_string(),
            _ => "pending".to_string(),
        };
        let priority = item
            .get("priority")
            .and_then(|c| c.as_str())
            .unwrap_or("medium");
        todos.push(TodoItem {
            content,
            status,
            priority: priority.to_string(),
        });
    }
    let mut warned = false;
    for t in &mut todos {
        if t.status == "in_progress" {
            if warned {
                t.status = "pending".to_string();
            }
            warned = true;
        }
    }
    Ok(todos)
}

fn tool_permission_target(name: &str, args: &Value, folders: &[String]) -> Option<String> {
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    match name {
        "write_file" | "apply_patch" => {
            let path = s("path");
            if path.is_empty() {
                None
            } else {
                resolve_path(folders, &path, true).ok()
            }
        }
        "read_file" | "read_file_range" => {
            let path = s("path");
            if path.is_empty() {
                None
            } else {
                let resolved = resolve_path(folders, &path, false).ok()?;
                if is_sensitive_path(&resolved) {
                    Some(resolved)
                } else {
                    None
                }
            }
        }
        "bash" => Some(bash_prefix(&s("command"))),
        "webfetch" => Some(s("url")),
        _ if name.starts_with("mcp__") => Some(name.to_string()),
        _ => None,
    }
}

async fn gate_permission(
    app: &AppHandle,
    chat_id: &str,
    tool: &str,
    display_name: &str,
    pattern: &str,
    arguments: &str,
) -> Result<(), String> {
    let rules = guard(&SESSION_PERMS).get(chat_id).cloned().unwrap_or_default();
    match evaluate_rules(&rules, tool, pattern) {
        Some(PermAction::Deny) => {
            return Err("operación denegada por la política de permisos del usuario".into())
        }
        Some(PermAction::Allow) => return Ok(()),
        None => {}
    }
    let id = now_id();
    let (tx, rx) = tokio::sync::oneshot::channel::<ApprovalReply>();
    guard(&PENDING_APPROVALS).insert(
        id.clone(),
        (
            PendingApproval {
                chat_id: chat_id.to_string(),
                tool: tool.to_string(),
                pattern: pattern.to_string(),
            },
            Some(tx),
        ),
    );
    let _ = app.emit(
        "approval-required",
        ApprovalRequiredEvent {
            chat_id: chat_id.to_string(),
            id: id.clone(),
            tool: display_name.to_string(),
            arguments: arguments.to_string(),
            summary: truncate(arguments, 140),
        },
    );
    let cancel_fut = async {
        loop {
            if is_chat_cancelled(chat_id) {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    };
    let reply = tokio::select! {
        r = rx => {
            guard(&PENDING_APPROVALS).remove(&id);
            match r {
                Ok(v) => v,
                Err(_) => return Err("la aprobación fue descartada".into()),
            }
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(600)) => {
            guard(&PENDING_APPROVALS).remove(&id);
            return Err("sin respuesta del usuario a la solicitud de permiso (timeout 600s)".into());
        }
        _ = cancel_fut => {
            guard(&PENDING_APPROVALS).remove(&id);
            return Err("cancelado por el usuario".into());
        }
    };
    match reply.decision.as_str() {
        "allow_once" | "allow_always" | "trust_session" => Ok(()),
        _ => Err(if reply.feedback.trim().is_empty() {
            "operación rechazada por el usuario".into()
        } else {
            format!(
                "operación rechazada por el usuario. Motivo: {}",
                reply.feedback.trim()
            )
        }),
    }
}

async fn ask_user_question(
    app: &AppHandle,
    chat_id: &str,
    question: &str,
    options: Vec<String>,
    header: &str,
) -> Result<String, String> {
    let qid = now_id();
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    guard(&PENDING_QUESTIONS).insert(qid.clone(), Some(tx));
    let _ = app.emit(
        "question-ask",
        QuestionAskEvent {
            chat_id: chat_id.to_string(),
            id: qid.clone(),
            question: question.to_string(),
            options: options.clone(),
            header: header.to_string(),
        },
    );
    let cancel_fut = async {
        loop {
            if is_chat_cancelled(chat_id) {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    };
    let answer = tokio::select! {
        a = rx => {
            guard(&PENDING_QUESTIONS).remove(&qid);
            match a {
                Ok(v) => v,
                Err(_) => return Err("la pregunta fue descartada por el usuario".into()),
            }
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(600)) => {
            guard(&PENDING_QUESTIONS).remove(&qid);
            return Err("sin respuesta del usuario (timeout 600s)".into());
        }
        _ = cancel_fut => {
            guard(&PENDING_QUESTIONS).remove(&qid);
            return Err("cancelado por el usuario".into());
        }
    };
    Ok(answer)
}

async fn execute_tool(
    app: &AppHandle,
    cfg: &ChatConfig,
    name: &str,
    arguments: &str,
    folders: &[String],
    registry: &'static McpRegistry,
    chat_id: &str,
    usage_acc: &mut ChatUsage,
    snapshot: &mut SnapshotGuard,
) -> Result<String, String> {
    let args: Value = if arguments.trim().is_empty() {
        json!({})
    } else {
        gateway::parse_tool_args(arguments)
    };
    if let Some(pattern) = tool_permission_target(name, &args, folders) {
        gate_permission(app, chat_id, name, name, &pattern, arguments).await?;
    }
    execute_tool_inner(
        app, cfg, name, arguments, folders, registry, chat_id, usage_acc, snapshot,
    )
    .await
}

async fn execute_tool_inner(
    app: &AppHandle,
    cfg: &ChatConfig,
    name: &str,
    arguments: &str,
    folders: &[String],
    registry: &'static McpRegistry,
    chat_id: &str,
    usage_acc: &mut ChatUsage,
    snapshot: &mut SnapshotGuard,
) -> Result<String, String> {
    let args: Value = if arguments.trim().is_empty() {
        json!({})
    } else {
        gateway::parse_tool_args(arguments)
    };
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();

    let mcp_names: Vec<String> = guard(&registry.tools).keys().cloned().collect();
    let repaired = repair_tool_name(name, &mcp_names);
    let name = repaired.as_ref();

    match name {
        "read_file" => {
            let path = resolve_path(folders, &s("path"), false)?;
            read_file_guarded(&path, 15000)
        }
        "read_file_range" => {
            let path = resolve_path(folders, &s("path"), false)?;
            let start = arg_number(&args, "start_line").unwrap_or(1).max(1) as usize;
            let end = arg_number(&args, "end_line")
                .unwrap_or(start as u64)
                .max(start as u64) as usize;
            read_file_range_lines(&path, start, end, 10000)
        }
        "apply_patch" => {
            let path = resolve_path(folders, &s("path"), false)?;
            if std::path::Path::new(&path).is_dir() {
                return Err(format!("{path} es un directorio; apply_patch solo edita archivos"));
            }
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let (new_text, blocks) = apply_patch_to(&text, &s("patch"))?;
            snapshot.capture(&path);
            std::fs::write(&path, &new_text).map_err(|e| e.to_string())?;
            let mut msg = format!("parche aplicado: {blocks} bloque(s) modificados en {path}");
            if let Some(syntax_err) = check_file_syntax(&path, &new_text) {
                msg.push_str(&format!("\n⚠️ ALERTA DE SINTAXIS: {syntax_err}"));
            }
            Ok(msg)
        }
        "explore_subagent" | "delegate_subagent" => {
            let (role, task, ctx) = if name == "delegate_subagent" {
                let role = match s("role").as_str() {
                    "coder" => multiagent::SubagentRole::Coder,
                    "tester" => multiagent::SubagentRole::Tester,
                    "reviewer" => multiagent::SubagentRole::Reviewer,
                    _ => multiagent::SubagentRole::Explorer,
                };
                (role, s("task"), s("context"))
            } else {
                (multiagent::SubagentRole::Explorer, s("task"), String::new())
            };
            if task.trim().is_empty() {
                return Err("debes especificar la tarea del subagente".into());
            }
            let mut sub_usage = ChatUsage::default();
            let report = run_subagent(
                app,
                cfg,
                chat_id,
                role,
                &task,
                &ctx,
                folders,
                &mut sub_usage,
                snapshot,
            )
            .await?;
            *usage_acc += sub_usage;
            let mut out = format!(
                "[Subagente {} — briefing condensado{}]\n{}",
                role.name(),
                if report.success { "" } else { " (con errores)" },
                report.summary
            );
            if !report.modified_files.is_empty() {
                out.push_str(&format!(
                    "\nArchivos modificados: {}",
                    report.modified_files.join(", ")
                ));
            }
            Ok(out)
        }
        "list_dir" => {
            let path = resolve_path(folders, &s("path"), false)?;
            list_dir_entries(&path, 300)
        }
        "grep" => {
            let pattern = s("pattern");
            if pattern.trim().is_empty() {
                return Err("grep requiere un 'pattern' no vacío".into());
            }
            let pattern = pattern.to_lowercase();
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
            Ok(truncate_tool_output("grep", &out, 3000))
        }
        "repo_map_query" => {
            let q = s("query");
            if q.trim().is_empty() {
                return Err("repo_map_query requiere un 'query' no vacío".into());
            }
            let top = arg_number(&args, "top").unwrap_or(20) as usize;
            let out = crate::symbol_index::query(folders, &q, top);
            Ok(truncate_tool_output("repo_map_query", &out, 4000))
        }
        "bash" => run_bash(app, &s("command"), folders, chat_id).await,
        "write_file" => {
            let path = resolve_path(folders, &s("path"), true)?;
            if std::path::Path::new(&path).is_dir() {
                return Err(format!("{path} es un directorio; write_file solo escribe archivos"));
            }
            let content = s("content");
            if let Some(parent) = std::path::Path::new(&path).parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            snapshot.capture(&path);
            std::fs::write(&path, &content).map_err(|e| e.to_string())?;
            let mut msg = format!("archivo escrito: {path}");
            if let Some(syntax_err) = check_file_syntax(&path, &content) {
                msg.push_str(&format!("\n⚠️ ALERTA DE SINTAXIS: {syntax_err}"));
            }
            Ok(msg)
        }

        "todowrite" => {
            let todos = normalize_todos(&args)?;
            guard(&TODOS).insert(chat_id.to_string(), todos.clone());
            let _ = app.emit(
                "todo-update",
                TodoUpdateEvent {
                    chat_id: chat_id.to_string(),
                    todos: todos.clone(),
                },
            );
            let done = todos.iter().filter(|t| t.status == "completed").count();
            let mut out = format!(
                "Lista de tareas actualizada ({done}/{} completadas):\n",
                todos.len()
            );
            for t in &todos {
                let icon = match t.status.as_str() {
                    "completed" => "✅",
                    "in_progress" => "🔄",
                    "cancelled" => "❌",
                    _ => "⏳",
                };
                out.push_str(&format!("{icon} [{status}] {content}\n", status = t.status, content = t.content));
            }
            Ok(out)
        }
        "question" => {
            let question = s("question");
            if question.trim().is_empty() {
                return Err("question requiere una 'question' no vacía".into());
            }
            let options: Vec<String> = args
                .get("options")
                .and_then(|o| o.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let header = s("header");
            let answer = ask_user_question(app, chat_id, &question, options, &header).await?;
            Ok(format!("Respuesta del usuario a «{question}»: {answer}"))
        }
        "webfetch" => {
            let url = s("url");
            fetch_url_markdown(&url).await
        }
        "skill" => {
            let skill_name = s("name");
            let skills = guard(&SKILLS_BY_CHAT).get(chat_id).cloned().unwrap_or_default();
            let found = skills
                .iter()
                .find(|sk| sk.name.eq_ignore_ascii_case(skill_name.trim()));
            match found {
                Some(sk) => Ok(format!(
                    "## Skill: {}\n\n{}\n\n(Instrucciones de la skill cargadas. Síguelas para el resto de la tarea.)",
                    sk.name,
                    truncate_tool_output("skill", &sk.content, 8000)
                )),
                None => {
                    let available: Vec<&str> = skills.iter().map(|sk| sk.name.as_str()).collect();
                    if available.is_empty() {
                        Err("no hay skills disponibles en este workspace".into())
                    } else {
                        Err(format!(
                            "skill «{skill_name}» no encontrada. Disponibles: {}",
                            available.join(", ")
                        ))
                    }
                }
            }
        }
        _ if name.starts_with("mcp__") => {
            let reg: &'static McpRegistry = registry;
            let nm = name.to_string();
            let args_s = arguments.to_string();
            tokio::task::spawn_blocking(move || mcp::call(reg, &nm, &args_s))
                .await
                .map_err(|e| format!("error ejecutando MCP: {e}"))?
        }
        _ => Err(format!("herramienta desconocida: {name}")),
    }
}

fn session_id_of(chat_id: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in chat_id.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn snapshot_data_dir() -> std::path::PathBuf {
    if let Ok(d) = std::env::var("MAKORA_DATA_DIR") {
        return std::path::PathBuf::from(d).join("snapshots");
    }
    let base = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .or_else(|_| std::env::var("XDG_DATA_HOME").map(std::path::PathBuf::from))
        .or_else(|_| {
            dirs::home_dir()
                .map(|h| h.join(".local").join("share"))
                .ok_or(std::env::VarError::NotPresent)
        })
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("MakoraIDE").join("snapshots")
}

pub struct TurnSnapshot {
    sid: String,
    run_id: String,
    dir: std::path::PathBuf,
    manifest: serde_json::Map<String, serde_json::Value>,
    count: usize,
}

impl TurnSnapshot {
    fn new(chat_id: &str) -> Option<Self> {
        let sid = session_id_of(chat_id);
        let run_id = now_id();
        let dir = snapshot_data_dir().join(&sid).join(&run_id);
        std::fs::create_dir_all(&dir).ok()?;
        Some(Self {
            sid,
            run_id,
            dir,
            manifest: serde_json::Map::new(),
            count: 0,
        })
    }

    fn capture(&mut self, path: &str) {
        let key = normalize_path_str(std::path::Path::new(path));
        if self.manifest.contains_key(&key) {
            return;
        }
        let file = format!("f_{}.bin", self.count);
        let entry = match std::fs::read(path) {
            Ok(bytes) => {
                let _ = std::fs::write(self.dir.join(&file), &bytes);
                serde_json::json!({ "file": file })
            }
            Err(_) => serde_json::json!({ "created": true }),
        };
        self.manifest.insert(key, entry);
        self.count += 1;
        let _ = std::fs::write(
            self.dir.join("manifest.json"),
            serde_json::to_string(&serde_json::Value::Object(self.manifest.clone()))
                .unwrap_or_default(),
        );
    }

    fn commit(mut self) {
        if self.count == 0 {
            let _ = std::fs::remove_dir_all(&self.dir);
            return;
        }
        let _ = std::fs::write(
            self.dir.join("manifest.json"),
            serde_json::to_string(&serde_json::Value::Object(self.manifest.clone()))
                .unwrap_or_default(),
        );
        let mut g = guard(&SNAPSHOTS);
        let list = g.entry(self.sid.clone()).or_default();
        list.push(self.run_id.clone());
        if list.len() > 5 {
            let old = list.remove(0);
            let _ = std::fs::remove_dir_all(snapshot_data_dir().join(&self.sid).join(&old));
        }
    }
}

pub struct SnapshotGuard(Option<TurnSnapshot>);

impl SnapshotGuard {
    fn none() -> Self {
        SnapshotGuard(None)
    }

    fn capture(&mut self, path: &str) {
        if let Some(s) = self.0.as_mut() {
            s.capture(path);
        }
    }
}

impl Drop for SnapshotGuard {
    fn drop(&mut self) {
        if let Some(s) = self.0.take() {
            s.commit();
        }
    }
}

static SNAPSHOTS: LazyLock<StdMutex<HashMap<String, Vec<String>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

pub fn revert_last_turn(chat_id: &str) -> Result<String, String> {
    let sid = session_id_of(chat_id);
    let run_id = {
        let mut g = guard(&SNAPSHOTS);
        let list = g.entry(sid.clone()).or_default();
        list.pop()
            .ok_or_else(|| "no hay turnos con cambios para deshacer".to_string())?
    };
    let dir = snapshot_data_dir().join(&sid).join(&run_id);
    let manifest_raw = std::fs::read_to_string(dir.join("manifest.json"))
        .map_err(|e| format!("no se pudo leer el snapshot: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_raw).map_err(|e| e.to_string())?;
    let mut restored: Vec<String> = Vec::new();
    let mut deleted: Vec<String> = Vec::new();
    if let Some(obj) = manifest.as_object() {
        for (path, entry) in obj {
            if entry.get("created").and_then(|c| c.as_bool()) == Some(true) {
                if std::fs::remove_file(path).is_ok() {
                    deleted.push(path.clone());
                }
            } else if let Some(f) = entry.get("file").and_then(|f| f.as_str()) {
                let bytes = std::fs::read(dir.join(f)).map_err(|e| e.to_string())?;
                std::fs::write(path, bytes).map_err(|e| e.to_string())?;
                restored.push(path.clone());
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    let mut summary = String::new();
    if !restored.is_empty() {
        summary.push_str(&format!("restaurados: {}", restored.join(", ")));
    }
    if !deleted.is_empty() {
        if !summary.is_empty() {
            summary.push_str(" · ");
        }
        summary.push_str(&format!("eliminados: {}", deleted.join(", ")));
    }
    if summary.is_empty() {
        summary = "sin cambios en archivos".to_string();
    }
    Ok(summary)
}

fn tools_with_mcp(registry: &'static McpRegistry, mut tools: Vec<ToolDef>) -> Vec<ToolDef> {
    let map = guard(&registry.tools);
    for (name, (_, schema)) in map.iter() {
        tools.push(ToolDef {
            name: name.clone(),
            description: format!("Herramienta MCP {name}"),
            parameters: schema.clone(),
        });
    }
    tools
}

pub fn compute_turn_cost_usd(kind: &str, model: &str, input: u32, cached: u32, output: u32) -> f64 {
    let m = model.to_lowercase();
    let k = kind.to_lowercase();
    if k == "ollama" {
        return 0.0;
    }
    let (in_price, out_price, cache_mult) = if m.contains("deepseek-reasoner") || m.contains("deepseek-r1") {
        (0.55, 2.19, 0.10)
    } else if m.contains("deepseek") {
        (0.27, 1.10, 0.10)
    } else if m.contains("gemini-3.1-pro") || m.contains("gemini-2.5-pro") || m.contains("gemini-1.5-pro") {
        (1.25, 5.00, 0.25)
    } else if m.contains("gemini") {
        (0.075, 0.30, 0.25)
    } else if m.contains("gpt-4o-mini") {
        (0.15, 0.60, 0.50)
    } else if m.contains("gpt-4o") {
        (2.50, 10.00, 0.50)
    } else if m.contains("o3-mini") {
        (1.10, 4.40, 0.50)
    } else if m.contains("o1") {
        (15.00, 60.00, 0.50)
    } else if m.contains("claude-3-5-haiku") {
        (0.80, 4.00, 0.10)
    } else if m.contains("claude") {
        (3.00, 15.00, 0.10)
    } else if m.contains("llama-3.1-8b") {
        (0.05, 0.08, 1.0)
    } else if m.contains("llama-3.3-70b") {
        (0.59, 0.79, 1.0)
    } else if m.contains("qwq") {
        (0.29, 0.39, 1.0)
    } else {
        (0.50, 2.00, 0.50)
    };

    let cached = cached.min(input);
    let non_cached = input.saturating_sub(cached);
    let cost = (non_cached as f64 * in_price
        + cached as f64 * in_price * cache_mult
        + output as f64 * out_price)
        / 1_000_000.0;
    let factor = 1_000_000.0;
    (cost * factor).ceil() / factor
}

#[allow(clippy::too_many_arguments)]
async fn forced_final_turn(
    app: &AppHandle,
    cfg: &ChatConfig,
    chat_id: &str,
    full_system: &str,
    msgs: &[ChatMessage],
    total: &mut ChatUsage,
    session_id: &str,
    turn: u32,
) -> Result<ChatResult, String> {
    let wire = prepare_wire(msgs, cfg);
    let forced = if cfg.kind == "anthropic" {
        gateway::anthropic_turn(app, cfg, chat_id, full_system, &wire, &[]).await?
    } else {
        gateway::openai_turn(app, cfg, chat_id, full_system, &wire, &[]).await?
    };
    total.input_tokens += forced.usage.input_tokens;
    total.output_tokens += forced.usage.output_tokens;
    total.cached_tokens += forced.usage.cached_tokens;
    let forced_cost = compute_turn_cost_usd(
        &cfg.kind,
        &cfg.model,
        forced.usage.input_tokens,
        forced.usage.cached_tokens,
        forced.usage.output_tokens,
    );
    history::record_request(
        session_id,
        turn,
        &cfg.kind,
        &cfg.model,
        &RequestMeter {
            input_tokens: forced.usage.input_tokens,
            cached_tokens: forced.usage.cached_tokens,
            output_tokens: forced.usage.output_tokens,
            cost_usd: forced_cost,
            latency_ms: 0,
        },
    );
    let mut final_msgs = msgs.to_vec();
    final_msgs.push(ChatMessage {
        role: "assistant".into(),
        content: forced.text,
        images: vec![],
        tool_calls: None,
        tool_call_id: None,
        reasoning: if forced.reasoning.is_empty() {
            None
        } else {
            Some(forced.reasoning)
        },
    });
    history::create_checkpoint(session_id, turn, &final_msgs);
    history::archive_transcript(session_id, turn, &final_msgs);
    Ok(ChatResult {
        input_tokens: total.input_tokens,
        output_tokens: total.output_tokens,
        cached_tokens: total.cached_tokens,
        messages: final_msgs,
    })
}

fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

async fn run_loop(
    app: &AppHandle,
    cfg: &ChatConfig,
    chat_id: &str,
    full_system: &str,
    messages: &[ChatMessage],
    folders: &[String],
    registry: &'static McpRegistry,
    tools: &[ToolDef],
    plan_mode: bool,
    budget_usd: Option<f64>,
) -> Result<ChatResult, String> {
    let mut msgs: Vec<ChatMessage> = messages.to_vec();
    let mut total = ChatUsage::default();
    let counter = token_engine::global();
    // Modo Plan: solo herramientas de lectura + planificación; las mutaciones
    // quedan deshabilitadas a nivel de catálogo (el modelo no puede invocarlas).
    let tools: Vec<ToolDef> = if plan_mode {
        tools
            .iter()
            .filter(|t| {
                matches!(
                    t.name.as_str(),
                    "read_file"
                        | "read_file_range"
                        | "grep"
                        | "list_dir"
                        | "todowrite"
                        | "question"
                        | "explore_subagent"
                        | "webfetch"
                        | "skill"
                        | "repo_map_query"
                )
            })
            .cloned()
            .collect()
    } else {
        tools.to_vec()
    };
    let workspace = folders
        .iter()
        .find(|f| !f.is_empty())
        .cloned()
        .unwrap_or_else(|| "default".into());
    let session_id = session_id_of(chat_id);
    history::upsert_session(&session_id, &workspace, &cfg.model);
    let mut snapshot = SnapshotGuard(TurnSnapshot::new(chat_id));
    // M4: resume por checkpoint cuando el frontend entrega un transcript vacío.
    if msgs.is_empty() {
        if let Some((_, restored)) = history::latest_checkpoint(&session_id) {
            println!("[TOKEN_ENGINE] resume por checkpoint: {} mensajes restaurados", restored.len());
            msgs = restored;
        }
    }
    const MAX_AGENT_TURNS: u32 = 100;
    const MAX_TURN_TOKENS: u64 = 2_000_000;
    const PLAN_NUDGE_READS: u32 = 8;
    const PLAN_FORCE_READS: u32 = 12;
    const NUDGE_REPEATS: u32 = 1;
    const FORCE_REPEATS: u32 = 2;
    const NUDGE_NO_NEW_INFO: u32 = 2;
    const FORCE_NO_NEW_INFO: u32 = 3;
    const NUDGE_ERROR_ROUNDS: u32 = 2;
    const FORCE_ERROR_ROUNDS: u32 = 3;
    const NUDGE_COOLDOWN: u32 = 4;

    let mut turn: u32 = 0;
    let mut prev_sig: Vec<String> = Vec::new();
    let mut repeats: u32 = 0;
    let mut plan_reads: u32 = 0;
    let mut no_new_info: u32 = 0;
    let mut error_rounds: u32 = 0;
    let mut seen_results: HashSet<u64> = HashSet::new();
    let mut last_nudge_turn: u32 = 0;
    let mut system_extra: String = String::new();
    // Conservar solo los últimos 3 nudges: evita que `system_extra` crezca sin
    // límite en loops largos (cada nudge añade tokens al prompt de sistema).
    let mut recent_nudges: Vec<String> = Vec::new();
    let mut budget_asked = false;
    let mut accumulated_cost: f64 = 0.0;
    let mut last_compact_turn: u32 = 0;
    // Compactación SOLO para el wire (lo que ve el modelo): `msgs` permanece
    // completo para la UI, persistencia y checkpoints. El usuario nunca pierde
    // sus mensajes anteriores.
    let mut wire_prefix: Vec<ChatMessage> = Vec::new();
    let mut wire_tail_start: usize = 0;
    let compact_threshold: usize =
        ((cfg.context_window.unwrap_or(128_000) as usize) * 3 / 5).clamp(16_000, 64_000);

    loop {
        if is_chat_cancelled(chat_id) {
            return Err("cancelado por el usuario".into());
        }
        // M4: compactación jerárquica con resumen LLM cuando el historial crece
        // más allá del 60% del contexto. Solo altera la vista del wire: la UI
        // conserva todos los mensajes.
        if turn >= 4 && turn.saturating_sub(last_compact_turn) >= 6 {
            let wire_view: Vec<ChatMessage> = wire_prefix
                .iter()
                .chain(msgs.iter().skip(wire_tail_start))
                .cloned()
                .collect();
            let history_tokens = counter.count_messages(&full_system, &wire_view);
            if history_tokens > compact_threshold {
                match compact_history_llm(app, cfg, chat_id, &wire_view).await {
                    Ok((pair, split, usage)) => {
                        let compacted_len = pair.len() + wire_view.len().saturating_sub(split);
                        if compacted_len < wire_view.len() {
                            println!(
                                "[TOKEN_ENGINE] compactación LLM: {} -> {} mensajes ({} tokens de historial)",
                                wire_view.len(),
                                compacted_len,
                                history_tokens
                            );
                            total += usage.clone();
                            if usage.input_tokens > 0 || usage.output_tokens > 0 {
                                let cost = compute_turn_cost_usd(
                                    &cfg.kind,
                                    &cfg.model,
                                    usage.input_tokens,
                                    usage.cached_tokens,
                                    usage.output_tokens,
                                );
                                history::record_request(
                                    &session_id,
                                    turn,
                                    &cfg.kind,
                                    &cfg.model,
                                    &RequestMeter {
                                        input_tokens: usage.input_tokens,
                                        cached_tokens: usage.cached_tokens,
                                        output_tokens: usage.output_tokens,
                                        cost_usd: cost,
                                        latency_ms: 0,
                                    },
                                );
                            }
                            wire_tail_start = apply_compaction_mapping(
                                wire_prefix.len(),
                                wire_tail_start,
                                split,
                            );
                            wire_prefix = pair;
                            last_compact_turn = turn;
                        }
                    }
                    Err(e) => {
                        println!("[TOKEN_ENGINE] compactación fallida (se continúa sin compactar): {e}");
                    }
                }
            }
        }
        // Motor M2 (D2): podado de historia y límite presupuestario por contexto
        let wire_view: Vec<ChatMessage> = wire_prefix
            .iter()
            .chain(msgs.iter().skip(wire_tail_start))
            .cloned()
            .collect();
        let wire_msgs = prepare_wire(&wire_view, cfg);
        turn += 1;
        let started = std::time::Instant::now();
        let local_tokens = counter.count_messages(&full_system, &wire_msgs);
        let effective_system = format!("{full_system}{system_extra}");
        let raw = if cfg.kind == "anthropic" {
            gateway::anthropic_turn(app, cfg, chat_id, &effective_system, &wire_msgs, &tools).await
        } else {
            gateway::openai_turn(app, cfg, chat_id, &effective_system, &wire_msgs, &tools).await
        };
        let outcome = match raw {
            Ok(o) => o,
            Err(e) => {
                // Degradación controlada: si ya hay progreso (herramientas
                // ejecutadas), sintetiza una respuesta final con lo hecho en vez
                // de abortar el turno entero y perder todo el trabajo.
                let has_progress = msgs.iter().any(|m| {
                    m.role == "tool"
                        || m.tool_calls.as_ref().map(|t| !t.is_empty()).unwrap_or(false)
                });
                if has_progress {
                    println!("[TOKEN_ENGINE] error del proveedor (turno {turn}); sintetizando respuesta final: {e}");
                    return forced_final_turn(
                        app,
                        cfg,
                        chat_id,
                        &format!("{full_system}{system_extra}\n\n[Nota: el último intento de llamada al modelo falló; resume el trabajo ya realizado.]"),
                        &msgs,
                        &mut total,
                        &session_id,
                        turn,
                    )
                    .await;
                }
                return Err(e);
            }
        };
        total.input_tokens += outcome.usage.input_tokens;
        total.output_tokens += outcome.usage.output_tokens;
        total.cached_tokens += outcome.usage.cached_tokens;
        let turn_cost = compute_turn_cost_usd(
            &cfg.kind,
            &cfg.model,
            outcome.usage.input_tokens,
            outcome.usage.cached_tokens,
            outcome.usage.output_tokens,
        );
        history::record_request(
            &session_id,
            turn,
            &cfg.kind,
            &cfg.model,
            &RequestMeter {
                input_tokens: outcome.usage.input_tokens,
                cached_tokens: outcome.usage.cached_tokens,
                output_tokens: outcome.usage.output_tokens,
                cost_usd: turn_cost,
                latency_ms: started.elapsed().as_millis() as i64,
            },
        );
        println!(
            "[TOKEN_ENGINE] turn={turn} local={local_tokens} api_in={} api_cached={} api_out={}",
            outcome.usage.input_tokens, outcome.usage.cached_tokens, outcome.usage.output_tokens
        );

        // Presupuesto de coste opcional por turno: NUNCA corta solo; pregunta al
        // usuario si continuar sin límite o detener y sintetizar (0 = sin límite).
        accumulated_cost += turn_cost;
        if let Some(limit) = budget_usd {
            if !budget_asked && turn >= 2 && accumulated_cost >= limit && limit > 0.0 {
                budget_asked = true;
                if let Ok(answer) = ask_user_question(
                    app,
                    chat_id,
                    &format!(
                        "El coste acumulado de este turno (~${accumulated_cost:.3}) alcanzó el presupuesto configurado de ${limit:.2}. ¿Cómo procedo?",
                    ),
                    vec![
                        "Continuar sin límite en este turno".to_string(),
                        "Detener ahora y sintetizar la respuesta final".to_string(),
                    ],
                    "Presupuesto por turno",
                )
                .await
                {
                    if answer.to_lowercase().contains("detener") {
                        return forced_final_turn(
                            app,
                            cfg,
                            chat_id,
                            &format!("{full_system}{system_extra}"),
                            &msgs,
                            &mut total,
                            &session_id,
                            turn,
                        )
                        .await;
                    }
                }
            }
        }

        if outcome.tool_calls.is_empty() {
            // Si el modelo terminó SIN texto y había usado herramientas en el turno,
            // le pedimos UNA conclusión real en vez de fabricar un resumen vacío.
            let had_tool_activity = msgs
                .iter()
                .any(|m| m.tool_calls.as_ref().map(|t| !t.is_empty()).unwrap_or(false));
            if outcome.text.trim().is_empty() && had_tool_activity {
                let directive = "\n\n[Nota del sistema Makora]: Has terminado de usar herramientas. Redacta AHORA tu respuesta final completa al usuario (hallazgos, conclusiones, archivos afectados y estado de verificación). No llames más herramientas.";
                return forced_final_turn(
                    app,
                    cfg,
                    chat_id,
                    &format!("{full_system}{system_extra}{directive}"),
                    &msgs,
                    &mut total,
                    &session_id,
                    turn,
                )
                .await;
            }
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
                    let mut s = String::from("### 📋 Resumen de modificaciones realizadas\n\nSe aplicaron operaciones en los siguientes archivos:\n");
                    for f in &modified_files {
                        s.push_str(&format!("- `{f}`\n"));
                    }
                    s.push_str("\n(El modelo concluyó el turno sin emitir texto explicativo adicional)");
                    s
                } else if !read_files.is_empty() {
                    let mut s = String::from("### 📋 Resumen de inspección\n\nSe consultaron los siguientes archivos durante el turno:\n");
                    for f in &read_files {
                        s.push_str(&format!("- `{f}`\n"));
                    }
                    s.push_str("\n(El modelo finalizó la consulta de herramientas sin texto adicional)");
                    s
                } else {
                    "Turno completado sin texto ni herramientas adicionales.".to_string()
                }
            };

            msgs.push(ChatMessage {
                role: "assistant".into(),
                content: final_content,
                images: vec![],
                tool_calls: None,
                tool_call_id: None,
                reasoning: if outcome.reasoning.is_empty() {
                    None
                } else {
                    Some(outcome.reasoning.clone())
                },
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

        // ===== Vigilante anti-bucles v2: nudge primero, forzar solo con señales
        // claras, fusibles extremos como última defensa (sin cortar trabajo legítimo).
        let kinds: Vec<ToolKind> = outcome.tool_calls.iter().map(|tc| tool_kind(&tc.name)).collect();
        let has_mutation = kinds.iter().any(|k| *k == ToolKind::Mutating);
        let all_readish = kinds.iter().all(|k| *k != ToolKind::Mutating);

        if plan_mode {
            if all_readish {
                plan_reads += 1;
            } else if has_mutation {
                plan_reads = 0;
            }
        }

        // Repetición exacta del lote de herramientas (misma firma ordenada).
        let mut sig: Vec<String> = outcome
            .tool_calls
            .iter()
            .map(|t| format!("{}|{}", t.name, t.arguments))
            .collect();
        sig.sort();
        if !sig.is_empty() && sig == prev_sig {
            repeats += 1;
        } else {
            repeats = 0;
            prev_sig = sig;
        }

        let is_turn_fuse = turn >= MAX_AGENT_TURNS;
        let is_token_fuse = (total.input_tokens as u64 + total.output_tokens as u64) >= MAX_TURN_TOKENS;

        let force_reason: Option<&str> = if is_turn_fuse {
            Some("Fusible extremo de seguridad (100 turnos) alcanzado; respuesta final sintetizada.")
        } else if is_token_fuse {
            Some("Fusible extremo de seguridad (2M tokens en el turno) alcanzado; respuesta final sintetizada.")
        } else if repeats >= FORCE_REPEATS {
            Some("Se detectó un bucle de herramientas idénticas sin progreso; respuesta final sintetizada.")
        } else if no_new_info >= FORCE_NO_NEW_INFO {
            Some("Las últimas rondas de herramientas no aportaron información nueva; respuesta final sintetizada.")
        } else if error_rounds >= FORCE_ERROR_ROUNDS {
            Some("Varias rondas consecutivas de herramientas fallaron; respuesta final sintetizada con lo disponible.")
        } else if plan_mode && plan_reads >= PLAN_FORCE_READS {
            Some("Modo plan: la exploración del código es suficiente; se redacta el plan final.")
        } else {
            None
        };

        if let Some(reason) = force_reason {
            println!("[TOKEN_ENGINE] vigilante: síntesis final silenciosa (motivo: {reason})");
            return forced_final_turn(
                app,
                cfg,
                chat_id,
                &format!("{full_system}{system_extra}"),
                &msgs,
                &mut total,
                &session_id,
                turn,
            )
            .await;
        }

        msgs.push(ChatMessage {
            role: "assistant".into(),
            content: outcome.text,
            images: vec![],
            tool_calls: Some(outcome.tool_calls.clone()),
            tool_call_id: None,
            reasoning: if outcome.reasoning.is_empty() {
                None
            } else {
                Some(outcome.reasoning.clone())
            },
        });

        // Ejecución concurrente inteligente por lotes:
        // Agrupa llamadas consecutivas de solo lectura para ejecutarlas en paralelo (join_all),
        // y ejecuta las mutaciones (write_file, apply_patch, bash) de forma secuencial y segura.
        enum ToolBatchItem {
            Parallel(Vec<ToolCall>),
            Sequential(ToolCall),
        }

        let mut batches: Vec<ToolBatchItem> = Vec::new();
        let mut current_parallel: Vec<ToolCall> = Vec::new();

        for tc in &outcome.tool_calls {
            if is_read_only_tool(&tc.name) {
                current_parallel.push(tc.clone());
            } else {
                if !current_parallel.is_empty() {
                    batches.push(ToolBatchItem::Parallel(std::mem::take(&mut current_parallel)));
                }
                batches.push(ToolBatchItem::Sequential(tc.clone()));
            }
        }
        if !current_parallel.is_empty() {
            batches.push(ToolBatchItem::Parallel(current_parallel));
        }

        for batch in batches {
            if is_chat_cancelled(chat_id) {
                return Err("Cancelado por el usuario".into());
            }
            match batch {
                ToolBatchItem::Parallel(calls) => {
                    if calls.len() == 1 {
                        let tc = &calls[0];
                        let _ = app.emit(
                            "tool-start",
                            ToolStart {
                                id: tc.id.clone(),
                                name: tc.name.clone(),
                                arguments: tc.arguments.clone(),
                                chat_id: chat_id.to_string(),
                            },
                        );
                        let mut tool_usage = ChatUsage::default();
                        let result = execute_tool(
                            app,
                            cfg,
                            &tc.name,
                            &tc.arguments,
                            folders,
                            registry,
                            chat_id,
                            &mut tool_usage,
                            &mut snapshot,
                        )
                        .await;
                        total += tool_usage;
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
                            reasoning: None,
                        });
                    } else {
                        for tc in &calls {
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
                        let tasks: Vec<_> = calls.iter().map(|tc| {
                            let app = app.clone();
                            let cfg = cfg.clone();
                            let name = tc.name.clone();
                            let arguments = tc.arguments.clone();
                            let folders = folders.to_vec();
                            let id = tc.id.clone();
                            let chat = chat_id.to_string();
                            async move {
                                let mut u = ChatUsage::default();
                                let mut snap = SnapshotGuard::none();
                                let result =
                                    execute_tool(&app, &cfg, &name, &arguments, &folders, registry, &chat, &mut u, &mut snap)
                                        .await;
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
                                (id, content, u)
                            }
                        }).collect();

                        let results = futures_util::future::join_all(tasks).await;
                        if is_chat_cancelled(chat_id) {
                            return Err("Cancelado por el usuario".into());
                        }
                        for (id, content, u) in results {
                            total += u;
                            msgs.push(ChatMessage {
                                role: "tool".into(),
                                content,
                                images: vec![],
                                tool_calls: None,
                                tool_call_id: Some(id),
                                reasoning: None,
                            });
                        }
                    }
                }
                ToolBatchItem::Sequential(tc) => {
                    let _ = app.emit(
                        "tool-start",
                        ToolStart {
                            id: tc.id.clone(),
                            name: tc.name.clone(),
                            arguments: tc.arguments.clone(),
                            chat_id: chat_id.to_string(),
                        },
                    );
                    let mut tool_usage = ChatUsage::default();
                    let result = execute_tool(
                        app,
                        cfg,
                        &tc.name,
                        &tc.arguments,
                        folders,
                        registry,
                        chat_id,
                        &mut tool_usage,
                        &mut snapshot,
                    )
                    .await;
                    total += tool_usage;
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
                        reasoning: None,
                    });
                }
            }
        }

        // ===== Novedad de resultados: si una ronda no aporta NINGUNA información
        // nueva (hashes ya vistos), se acumula señal de estancamiento.
        let round_results: Vec<String> = msgs
            .iter()
            .rev()
            .take_while(|m| m.role == "tool")
            .map(|m| m.content.clone())
            .collect();
        let mut novel = false;
        for c in &round_results {
            let h = fnv1a(c);
            if !seen_results.contains(&h) {
                novel = true;
                seen_results.insert(h);
            }
        }
        if !round_results.is_empty() && !novel && !has_mutation {
            no_new_info += 1;
        } else {
            no_new_info = 0;
        }

        // ===== Fallos consecutivos: si TODA la ronda de herramientas falló,
        // acumula señal para forzar una respuesta en vez de quemar tokens.
        if !round_results.is_empty() && round_results.iter().all(|c| c.starts_with("ERROR:")) {
            error_rounds += 1;
        } else if !round_results.is_empty() {
            error_rounds = 0;
        }

        // ===== Nudge TRANSPARENTE: nota de sistema real (no mensaje user falso)
        // + aviso visible al usuario vía evento. El modelo recibe la guía como
        // parte del system prompt del siguiente turno, no como intervención del
        // usuario, y el transcript no se contamina.
        let nudge: Option<String> = if turn.saturating_sub(last_nudge_turn) >= NUDGE_COOLDOWN {
            if plan_mode && plan_reads >= PLAN_NUDGE_READS {
                Some(
                    "Llevas {plan_reads} rondas de solo lectura en modo plan. Si te falta algo puntual, lee SOLO ese fragmento; en caso contrario redacta ya el plan final completo.".to_string(),
                )
            } else if repeats >= NUDGE_REPEATS {
                Some(
                    "Estás repitiendo exactamente las mismas llamadas a herramientas. Cambia de estrategia, usa otras herramientas o sintetiza tu respuesta final ahora.".to_string(),
                )
            } else if no_new_info >= NUDGE_NO_NEW_INFO {
                Some(
                    "Las últimas rondas de herramientas no aportaron información nueva (resultados ya vistos). No repitas lecturas; concluye con la información que tienes.".to_string(),
                )
            } else if error_rounds >= NUDGE_ERROR_ROUNDS {
                Some(
                    "Varias herramientas fallaron seguidas (rutas o comandos inexistentes o no permitidos). No reintentes las mismas llamadas: responde con lo que ya sabes o pide al usuario la información que falte.".to_string(),
                )
            } else {
                None
            }
        } else {
            None
        };
        if let Some(nudge_text) = nudge {
            last_nudge_turn = turn;
            recent_nudges.push(nudge_text);
            if recent_nudges.len() > 3 {
                recent_nudges.remove(0);
            }
            system_extra = recent_nudges
                .iter()
                .map(|n| format!("\n\n[Nota del sistema Makora — vigilante anti-bucles]: {n}"))
                .collect::<String>();
        }

        // Persistencia de progreso: solo cada 5 turnos. Serializar el transcript
        // completo en CADA iteración era O(n²) de CPU (y el origen de la DB de
        // 1.1 GB). El checkpoint final del turno (al terminar) siempre se guarda.
        if turn % 5 == 0 {
            history::create_checkpoint(&session_id, turn, &msgs);
        }
    }
}

pub async fn run(
    app: &AppHandle,
    cfg: &ChatConfig,
    chat_id: &str,
    system: &str,
    messages: &[ChatMessage],
    folders: &[String],
    registry: &'static McpRegistry,
    plan_mode: bool,
    budget_usd: Option<f64>,
) -> Result<ChatResult, String> {
    clear_cancel(chat_id);
    let skills = load_skills(folders);
    guard(&SKILLS_BY_CHAT).insert(chat_id.to_string(), skills.clone());
    let skills_section = skills_system_section(&skills);
    let repo_section = repo_map_section(folders);
    let full_system = if plan_mode {
        format!("{MAKORA_BASE_SKILL}\n\n{system}\n\n{PLAN_MODE_DIRECTIVE}{skills_section}{repo_section}")
    } else {
        format!("{MAKORA_BASE_SKILL}\n\n{system}{skills_section}{repo_section}")
    };
    let tools = tools_with_mcp(registry, core_tools());
    run_loop(
        app,
        cfg,
        chat_id,
        &full_system,
        messages,
        folders,
        registry,
        &tools,
        plan_mode,
        budget_usd,
    )
    .await
}

const PLAN_MODE_DIRECTIVE: &str = "\
## Modo Plan (activo y obligatorio)

- Estás en MODO PLAN: las herramientas de modificación (`write_file`, `apply_patch`, `bash`) y de delegación ejecutora están DESHABILITADAS a nivel de sistema; no las llames.
- Explora con `read_file_range`/`grep`/`list_dir` y produce un plan de implementación en Markdown con esta estructura:
  1. `# Implementation Plan: [Título]`
  2. `## 1. Análisis y Diagnóstico`
  3. `## 2. Cambios Propuestos` (archivo por archivo, rutas exactas y desglose)
  4. `## 3. Plan de Verificación y Pruebas`
  5. Preguntas abiertas o decisiones críticas que requieran validación.
- Usa `todowrite` para estructurar el plan en pasos. NO repitas lecturas ya hechas: si el contexto es suficiente, redacta ya el plan final.
- Presenta el plan completo de forma clara y directa para que el usuario lo revise y pulse «Implementar». Cuando lo apruebe, recibirás un nuevo mensaje en modo Act con las herramientas habilitadas; ejecuta entonces el plan al pie de la letra.";

const MULTI_DELEGATION_DIRECTIVE: &str = "\
## Modo Multi-Agente por Delegación (activo)

- Para cargas de trabajo pesadas (análisis multifichero, búsquedas amplias, implementaciones complejas, verificación con tests) DELEGA en un subagente mediante `delegate_subagent` en lugar de realizar el trabajo tú mismo. El subagente devuelve únicamente un briefing condensado, con lo que ahorras tokens y aceleras la respuesta.
- En `task` describe el objetivo concreto del subagente y en `context` pasa los hallazgos que ya conozcas (rutas, símbolos, líneas) para evitar re-exploración.
- Puedes encadenar delegaciones (explorer → coder → tester) pasando el contexto acumulado de cada una a la siguiente.
- Integra los resultados de los subagentes en tu respuesta final SIN alterar el formato habitual: responde o resume brevemente y con claridad lo realizado (archivos, verificación), como en cualquier tarea normal.
- No delegues tareas triviales (una sola búsqueda, preguntas conceptuales, lectura puntual de un archivo).
- La interfaz ya muestra la actividad de los subagentes al usuario; no hace falta que la expliques en detalle.";

pub async fn run_multiagent(
    app: &AppHandle,
    cfg: &ChatConfig,
    chat_id: &str,
    system: &str,
    messages: &[ChatMessage],
    folders: &[String],
    objective: &str,
    registry: &'static McpRegistry,
    plan_mode: bool,
    budget_usd: Option<f64>,
) -> Result<ChatResult, String> {
    clear_cancel(chat_id);
    let skills = load_skills(folders);
    guard(&SKILLS_BY_CHAT).insert(chat_id.to_string(), skills.clone());
    let skills_section = skills_system_section(&skills);
    let mut full_system = format!(
        "{MAKORA_BASE_SKILL}\n\n{system}\n\n{MULTI_DELEGATION_DIRECTIVE}\n\n## Objetivo del usuario\n{objective}"
    );
    if plan_mode {
        full_system.push_str(&format!("\n\n{PLAN_MODE_DIRECTIVE}"));
    }
    full_system.push_str(&skills_section);
    full_system.push_str(&repo_map_section(folders));
    let mut tools = tools_with_mcp(registry, core_tools());
    tools.push(delegate_tool_def());
    run_loop(
        app,
        cfg,
        chat_id,
        &full_system,
        messages,
        folders,
        registry,
        &tools,
        plan_mode,
        budget_usd,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ToolCall;

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
    fn test_is_ignored_path_matches_build_and_git_artifacts() {
        assert!(is_ignored_path("node_modules"));
        assert!(is_ignored_path("target"));
        assert!(is_ignored_path(".git"));
        assert!(is_ignored_path(".venv"));
        assert!(is_ignored_path("package-lock.json"));
        assert!(!is_ignored_path("main.rs"));
        assert!(!is_ignored_path("App.tsx"));
    }

    #[test]
    fn test_is_read_only_tool() {
        assert!(is_read_only_tool("read_file"));
        assert!(is_read_only_tool("read_file_range"));
        assert!(is_read_only_tool("grep"));
        assert!(is_read_only_tool("list_dir"));
        assert!(!is_read_only_tool("write_file"));
        assert!(!is_read_only_tool("apply_patch"));
        assert!(!is_read_only_tool("bash"));
    }

    #[test]
    fn test_tool_kind_classification() {
        assert_eq!(tool_kind("read_file"), ToolKind::ReadOnly);
        assert_eq!(tool_kind("grep"), ToolKind::ReadOnly);
        assert_eq!(tool_kind("webfetch"), ToolKind::ReadOnly);
        assert_eq!(tool_kind("explore_subagent"), ToolKind::ReadOnly);
        assert_eq!(tool_kind("todowrite"), ToolKind::Neutral);
        assert_eq!(tool_kind("question"), ToolKind::Neutral);
        assert_eq!(tool_kind("write_file"), ToolKind::Mutating);
        assert_eq!(tool_kind("apply_patch"), ToolKind::Mutating);
        assert_eq!(tool_kind("bash"), ToolKind::Mutating);
        assert_eq!(tool_kind("delegate_subagent"), ToolKind::Mutating);
        assert_eq!(tool_kind("mcp__git__status"), ToolKind::Mutating);
    }

    #[test]
    fn test_within_blocks_sibling_prefix_escape() {
        let root = std::env::temp_dir().join(format!("makora_within_test_{}", std::process::id()));
        let ws = root.join("proj");
        let sibling = root.join("proj2");
        let _ = std::fs::create_dir_all(&ws);
        let _ = std::fs::create_dir_all(&sibling);
        let file_in = ws.join("src").join("main.rs");
        let file_out = sibling.join("secret.txt");
        let _ = std::fs::create_dir_all(file_in.parent().unwrap());
        std::fs::write(&file_out, "x").unwrap();

        let folders = vec![ws.to_string_lossy().to_string()];
        assert!(within(&folders, &file_in));
        assert!(!within(&folders, &file_out));
        assert!(!within(&folders, &sibling));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn test_is_public_url_blocks_ssrf_targets() {
        assert!(is_public_url("https://docs.rs/regex"));
        assert!(is_public_url("https://example.com/path?q=1"));
        assert!(!is_public_url("http://localhost:3000"));
        assert!(!is_public_url("https://localhost/docs"));
        assert!(!is_public_url("http://127.0.0.1/x"));
        assert!(!is_public_url("http://[::1]/x"));
        assert!(!is_public_url("http://10.0.0.5/x"));
        assert!(!is_public_url("http://172.16.2.1/x"));
        assert!(!is_public_url("http://192.168.1.1/x"));
        assert!(!is_public_url("http://169.254.169.254/latest/meta-data"));
        assert!(!is_public_url("http://100.64.0.1/x"));
        assert!(!is_public_url("http://[::ffff:127.0.0.1]/x"));
        assert!(!is_public_url("file:///etc/passwd"));
        assert!(!is_public_url("ftp://example.com"));
        assert!(!is_public_url("not a url"));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_bat_script_preserves_inner_quotes() {
        use std::process::Command;
        let bat = write_bat_script(
            r#"powershell -NoProfile -Command "Write-Output BASH_QUOTED_OK""#,
        )
        .unwrap();
        let out = Command::new("cmd.exe")
            .args(["/C", bat.to_string_lossy().as_ref()])
            .output()
            .unwrap();
        let _ = std::fs::remove_file(&bat);
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert_eq!(out.status.code().unwrap_or(-1), 0, "stdout: {stdout}");
        assert!(stdout.contains("BASH_QUOTED_OK"), "stdout: {stdout}");
        assert!(!stdout.contains("Microsoft Windows"), "banner inesperado: {stdout}");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_bat_script_propagates_exit_code() {
        use std::process::Command;
        let bat = write_bat_script("exit /b 3").unwrap();
        let out = Command::new("cmd.exe")
            .args(["/C", bat.to_string_lossy().as_ref()])
            .output()
            .unwrap();
        let _ = std::fs::remove_file(&bat);
        assert_eq!(out.status.code().unwrap_or(-1), 3);
    }

    #[test]
    fn test_apply_compaction_mapping() {
        assert_eq!(apply_compaction_mapping(0, 0, 10), 10);
        assert_eq!(apply_compaction_mapping(2, 30, 12), 40);
        assert_eq!(apply_compaction_mapping(2, 30, 1), 30);
        assert_eq!(apply_compaction_mapping(0, 5, 20), 25);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_normalize_bash_command_only_rewrites_path_tokens() {
        assert_eq!(
            normalize_bash_command("cd /d/Projects && dir"),
            "cd d:/Projects && dir"
        );
        assert_eq!(normalize_bash_command("/c/Users/foo/file.txt"), "c:/Users/foo/file.txt");
        assert_eq!(
            normalize_bash_command("git clone https://github.com/user/repo"),
            "git clone https://github.com/user/repo"
        );
        assert_eq!(
            normalize_bash_command("curl https://api.example.com/a/b/c"),
            "curl https://api.example.com/a/b/c"
        );
        assert_eq!(normalize_bash_command("cd C:\\Projects"), "cd C:\\Projects");
    }

    #[test]
    fn test_read_helpers_guard_sizes_and_ranges() {
        let root = std::env::temp_dir().join(format!("makora_range_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&root);
        let file = root.join("f.txt");
        std::fs::write(&file, "uno\ndos\ntres\n").unwrap();
        let f = file.to_string_lossy().to_string();

        let full = read_file_guarded(&f, 1000).unwrap();
        assert!(full.contains("tres"));

        assert!(read_file_range_lines(&f, 2, 3, 1000).unwrap().contains("2| dos"));
        assert!(read_file_range_lines(&f, 1, 1, 1000).unwrap().contains("1| uno"));
        assert!(read_file_range_lines(&f, 10, 20, 1000).unwrap().contains("sin líneas"));

        assert!(read_file_guarded(&root.to_string_lossy(), 1000).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn test_sanitize_history_repairs_unanswered_tool_calls() {
        let msgs = vec![
            ChatMessage {
                role: "user".into(),
                content: "haz algo".into(),
                images: vec![],
                tool_calls: None,
                tool_call_id: None,
                reasoning: None,
            },
            ChatMessage {
                role: "assistant".into(),
                content: "".into(),
                images: vec![],
                tool_calls: Some(vec![
                    ToolCall {
                        id: "call_1".into(),
                        name: "read_file".into(),
                        arguments: "{\"path\":\"a.txt\"}".into(),
                        extra_content: None,
                    },
                    ToolCall {
                        id: "call_2".into(),
                        name: "read_file".into(),
                        arguments: "{\"path\":\"b.txt\"}".into(),
                        extra_content: None,
                    },
                ]),
                tool_call_id: None,
                reasoning: None,
            },
            // Solo se respondió call_1, call_2 fue interrumpido
            ChatMessage {
                role: "tool".into(),
                content: "contenido de a".into(),
                images: vec![],
                tool_calls: None,
                tool_call_id: Some("call_1".into()),
                reasoning: None,
            },
            ChatMessage {
                role: "user".into(),
                content: "siguiente petición".into(),
                images: vec![],
                tool_calls: None,
                tool_call_id: None,
                reasoning: None,
            },
        ];

        let sanitized = sanitize_history(&msgs);
        assert_eq!(sanitized.len(), 5);
        assert_eq!(sanitized[0].role, "user");
        assert_eq!(sanitized[1].role, "assistant");
        assert_eq!(sanitized[2].role, "tool");
        assert_eq!(sanitized[2].tool_call_id.as_deref(), Some("call_1"));
        assert_eq!(sanitized[3].role, "tool");
        assert_eq!(sanitized[3].tool_call_id.as_deref(), Some("call_2"));
        assert!(sanitized[3].content.contains("interrumpida"));
        assert_eq!(sanitized[4].role, "user");
    }

    #[test]
    fn test_compute_turn_cost_usd_conservative() {
        let cost_gemini = compute_turn_cost_usd("gemini", "gemini-3.7-flash", 10_000, 5_000, 2_000);
        assert!(cost_gemini > 0.0);

        let cost_claude = compute_turn_cost_usd("anthropic", "claude-3-7-sonnet", 100_000, 80_000, 4_000);
        assert!(cost_claude > 0.0);

        let cost_ollama = compute_turn_cost_usd("ollama", "deepseek-r1:8b", 50_000, 0, 5_000);
        assert_eq!(cost_ollama, 0.0);
    }

    #[test]
    fn test_repair_tool_name() {
        let mcp: Vec<String> = vec!["mcp__git__status".into()];
        assert_eq!(repair_tool_name("read_file", &mcp).as_ref(), "read_file");
        assert_eq!(repair_tool_name("READ_FILE", &mcp).as_ref(), "read_file");
        assert_eq!(repair_tool_name("list-dir", &mcp).as_ref(), "list_dir");
        assert_eq!(repair_tool_name("read file range", &mcp).as_ref(), "read_file_range");
        assert_eq!(repair_tool_name("mcp_git_status", &mcp).as_ref(), "mcp__git__status");
        assert_eq!(repair_tool_name("unknown_tool", &mcp).as_ref(), "unknown_tool");
    }

    #[test]
    fn test_grep_respects_gitignore() {
        let root = std::env::temp_dir().join(format!("makora_gi_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(root.join(".git"));
        std::fs::write(root.join(".gitignore"), "*.tmp\n").unwrap();
        std::fs::write(root.join("keep.rs"), "fn needle_fn() {}\n").unwrap();
        std::fs::write(root.join("junk.tmp"), "needle_fn hidden\n").unwrap();
        let mut out = String::new();
        let mut count = 0u32;
        grep_dir(&root.to_string_lossy(), "needle_fn", &mut out, &mut count, 50);
        assert!(out.contains("keep.rs"), "salida: {out}");
        assert!(!out.contains("junk.tmp"), "salida: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn test_list_dir_respects_gitignore() {
        let root = std::env::temp_dir().join(format!("makora_ld_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(root.join(".git"));
        std::fs::write(root.join(".gitignore"), "*.tmp\n").unwrap();
        std::fs::write(root.join("keep.rs"), "x").unwrap();
        std::fs::write(root.join("junk.tmp"), "x").unwrap();
        let listing = list_dir_entries(&root.to_string_lossy(), 100).unwrap();
        assert!(listing.contains("keep.rs"), "salida: {listing}");
        assert!(!listing.contains("junk.tmp"), "salida: {listing}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn test_spill_output_writes_full_content() {
        let full = "linea de salida larga\n".repeat(2_000);
        let truncated = spill_output("bash", &full, "corto".into());
        assert!(truncated.contains("salida completa guardada en"));
        let path_str = truncated
            .split("guardada en: ")
            .nth(1)
            .unwrap()
            .trim_end_matches("]…")
            .trim();
        let saved = std::fs::read_to_string(path_str).unwrap();
        assert_eq!(saved, full);
        let _ = std::fs::remove_file(path_str);
    }

    #[test]
    fn test_normalize_todos() {
        let args = json!({
            "todos": [
                { "content": "a", "status": "in_progress" },
                { "content": "b", "status": "in_progress" },
                { "content": "c", "status": "bogus" },
                { "content": "d", "status": "completed" }
            ]
        });
        let todos = normalize_todos(&args).unwrap();
        assert_eq!(todos.len(), 4);
        let in_progress: Vec<_> = todos.iter().filter(|t| t.status == "in_progress").collect();
        assert_eq!(in_progress.len(), 1);
        assert_eq!(todos[2].status, "pending");
        assert_eq!(todos[3].status, "completed");
        assert!(normalize_todos(&json!({})).is_err());
    }

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.into(),
            content: content.into(),
            images: vec![],
            tool_calls: None,
            tool_call_id: None,
            reasoning: None,
        }
    }

    fn msg_with_tools(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.into(),
            content: content.into(),
            images: vec![],
            tool_calls: Some(vec![ToolCall {
                id: "call_1".into(),
                name: "read_file".into(),
                arguments: "{\"path\":\"a\"}".into(),
                extra_content: None,
            }]),
            tool_call_id: None,
            reasoning: None,
        }
    }

    #[test]
    fn test_find_compaction_split_prefers_assistant_with_tools() {
        let msgs = vec![
            msg("user", "u1"),
            msg("assistant", "a1"),
            msg("user", "u2"),
            msg_with_tools("assistant", ""),
            msg("tool", "t1"),
            msg("tool", "t2"),
            msg("assistant", "a2"),
        ];
        let split = find_compaction_split(&msgs, 3);
        assert_eq!(split, 3);
        assert_eq!(msgs[split].role, "assistant");
        assert!(msgs[split].tool_calls.is_some());
    }

    #[test]
    fn test_find_compaction_split_falls_back_to_user() {
        let msgs = vec![
            msg("user", "u1"),
            msg("assistant", "a1"),
            msg("user", "u2"),
            msg("assistant", "a2"),
            msg("assistant", "a3"),
        ];
        let split = find_compaction_split(&msgs, 2);
        assert_eq!(split, 2);
        assert_eq!(msgs[split].role, "user");
    }

    #[test]
    fn test_serialize_head_for_compaction_truncates() {
        let msgs = vec![
            msg("user", "pregunta corta"),
            msg("assistant", "respuesta corta"),
            msg("user", "mensaje nuevo corto"),
        ];
        let serialized = serialize_head_for_compaction(&msgs, 500);
        assert!(serialized.contains("[Usuario]: pregunta corta"));
        assert!(serialized.contains("[Usuario]: mensaje nuevo corto"));
        assert!(serialized.chars().count() <= 500);

        let huge = vec![msg("user", &"x".repeat(5000))];
        let truncated = serialize_head_for_compaction(&huge, 300);
        assert!(!truncated.is_empty());
        assert!(truncated.chars().count() <= 300);
    }

    #[test]
    fn test_bash_prefix_and_pattern_matches() {
        assert_eq!(bash_prefix("git status --short"), "git status --short *");
        assert!(pattern_matches("git status *", "git status --short"));
        assert!(pattern_matches("git status *", "git status"));
        assert!(!pattern_matches("git status *", "git commit -m x"));
        assert!(pattern_matches("*", "anything"));
        assert!(pattern_matches("C:/Users/lewis/Projects/makora-ide/src/App.tsx", "C:/Users/lewis/Projects/makora-ide/src/App.tsx"));
        assert!(pattern_matches("C:/Users/lewis/Projects/*", "C:/Users/lewis/Projects/makora-ide"));
    }

    #[test]
    fn test_evaluate_rules_last_wins() {
        let rules = vec![
            PermRule {
                tool: "bash".into(),
                pattern: "git *".into(),
                action: PermAction::Allow,
            },
            PermRule {
                tool: "bash".into(),
                pattern: "git push *".into(),
                action: PermAction::Deny,
            },
        ];
        assert_eq!(
            evaluate_rules(&rules, "bash", "git status"),
            Some(PermAction::Allow)
        );
        assert_eq!(
            evaluate_rules(&rules, "bash", "git push origin main"),
            Some(PermAction::Deny)
        );
        assert_eq!(evaluate_rules(&rules, "write_file", "x"), None);
    }

    #[test]
    fn test_is_sensitive_path() {
        assert!(is_sensitive_path("C:/proj/.env"));
        assert!(is_sensitive_path("/etc/secrets/id_rsa"));
        assert!(is_sensitive_path("src/credentials.json"));
        assert!(!is_sensitive_path("src/main.rs"));
        assert!(!is_sensitive_path("src/env.d.ts"));
    }

    #[test]
    fn test_tool_permission_target() {
        let folders = vec![std::env::temp_dir().to_string_lossy().to_string()];
        let w = json!({"path": "src/main.rs"});
        assert_eq!(
            tool_permission_target("write_file", &w, &folders),
            resolve_path(&folders, "src/main.rs", true).ok()
        );
        assert_eq!(tool_permission_target("read_file", &json!({"path": "src/main.rs"}), &folders), None);
        let bash = json!({"command": "git status"});
        assert_eq!(
            tool_permission_target("bash", &bash, &folders),
            Some("git status *".into())
        );
        assert_eq!(tool_permission_target("todowrite", &json!({}), &folders), None);
        assert_eq!(
            tool_permission_target("mcp__git__status", &json!({}), &folders),
            Some("mcp__git__status".into())
        );
        assert_eq!(
            tool_permission_target("webfetch", &json!({"url": "https://docs.rs/serde"}), &folders),
            Some("https://docs.rs/serde".into())
        );
    }

    #[test]
    fn test_valid_fetch_url() {
        assert!(is_public_url("https://docs.rs/serde"));
        assert!(!is_public_url("http://localhost:3000/docs"));
        assert!(!is_public_url("file:///etc/passwd"));
        assert!(!is_public_url("ftp://example.com/x"));
        assert!(!is_public_url("javascript:alert(1)"));
    }

    #[test]
    fn test_html_to_markdown_strips_scripts() {
        let html = "<html><head><title>x</title></head><body><h1>Título</h1><script>alert('x')</script><p>texto <b>negrita</b></p></body></html>";
        let md = html_to_markdown(html);
        assert!(md.contains("Título"));
        assert!(md.contains("negrita"));
        assert!(!md.contains("alert"));
    }

    #[test]
    fn test_parse_skill_frontmatter() {
        let raw = "---\nname: deploy-vps\ndescription: Pasos para desplegar en el VPS\n---\n\n# Deploy\n\n1. Conecta por SSH";
        let (name, desc, content) = parse_skill_frontmatter(raw).unwrap();
        assert_eq!(name, "deploy-vps");
        assert_eq!(desc, "Pasos para desplegar en el VPS");
        assert!(content.starts_with("# Deploy"));
        assert!(parse_skill_frontmatter("sin frontmatter").is_none());
    }

    #[test]
    fn test_load_skills_from_workspace() {
        let root = std::env::temp_dir().join(format!("makora_sk_test_{}", std::process::id()));
        let skills_dir = root.join(".makora").join("skills").join("my-skill");
        let _ = std::fs::create_dir_all(&skills_dir);
        std::fs::write(
            skills_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: prueba\n---\n# Contenido",
        )
        .unwrap();
        let skills = load_skills(&[root.to_string_lossy().to_string()]);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "my-skill");
        let section = skills_system_section(&skills);
        assert!(section.contains("my-skill"));
        let _ = std::fs::remove_dir_all(&root);
    }

    fn snap_test_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("makora_snap_common_{}", std::process::id()))
    }

    #[test]
    fn test_turn_snapshot_capture_and_revert() {
        let root = snap_test_root();
        let _ = std::fs::create_dir_all(&root);
        std::env::set_var("MAKORA_DATA_DIR", &root);
        let file = root.join("data.txt");
        std::fs::write(&file, "original").unwrap();
        let chat_id = format!("snap_test_{}", std::process::id());
        {
            let mut snap = SnapshotGuard(TurnSnapshot::new(&chat_id));
            snap.capture(&file.to_string_lossy());
            std::fs::write(&file, "modificado").unwrap();
        }
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "modificado");
        let summary = revert_last_turn(&chat_id).unwrap();
        assert!(summary.contains("data.txt"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "original");
        assert!(revert_last_turn(&chat_id).is_err());
    }

    #[test]
    fn test_turn_snapshot_created_file_removed_on_revert() {
        let root = snap_test_root();
        let _ = std::fs::create_dir_all(&root);
        std::env::set_var("MAKORA_DATA_DIR", &root);
        let file = root.join("nuevo.txt");
        let chat_id = format!("snap_new_{}", std::process::id());
        {
            let mut snap = SnapshotGuard(TurnSnapshot::new(&chat_id));
            snap.capture(&file.to_string_lossy());
            std::fs::write(&file, "creado por el agente").unwrap();
        }
        assert!(file.exists());
        revert_last_turn(&chat_id).unwrap();
        assert!(!file.exists());
    }
}

