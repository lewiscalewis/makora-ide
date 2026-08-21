//! Makora agent loop (port of opencode's agent architecture).
//!
//! The design mirrors opencode's clean separation:
//!   * `gateway` (provider layer) exposes one async `*_turn` per provider that
//!     streams normalized deltas (`chat-delta-event`, `thinking-delta`) and
//!     returns a full `TurnOutcome` with properly accumulated tool calls.
//!   * The agent loop is a simple `stream -> execute tools -> append results ->
//!     repeat` cycle. There is no text-based tool-call extraction, no vigilante
//!     state machine and no forced synthesis: we trust the model's native
//!     function calling, exactly like opencode.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex as StdMutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::gateway::{self, ToolDef};
use crate::history::{self, RequestMeter};
use crate::mcp::{self, McpRegistry};
use crate::token_engine;
use crate::{ChatConfig, ChatMessage, ChatResult, ChatUsage, ToolCall};

// ---------------------------------------------------------------------------
// Global state (keyed by chat_id)
// ---------------------------------------------------------------------------

static CANCELLED: LazyLock<StdMutex<HashSet<String>>> =
    LazyLock::new(|| StdMutex::new(HashSet::new()));
static TODOS: LazyLock<StdMutex<HashMap<String, Vec<TodoItem>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
static SESSION_PERMS: LazyLock<StdMutex<HashMap<String, Vec<PermRule>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
static SKILLS_BY_CHAT: LazyLock<StdMutex<HashMap<String, Vec<Skill>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
static SNAPSHOTS: LazyLock<StdMutex<HashMap<String, Vec<String>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
static PENDING_QUESTIONS: LazyLock<
    StdMutex<HashMap<String, Option<tokio::sync::oneshot::Sender<String>>>>,
> = LazyLock::new(|| StdMutex::new(HashMap::new()));
static PENDING_APPROVALS: LazyLock<
    StdMutex<HashMap<String, (PendingApproval, Option<tokio::sync::oneshot::Sender<ApprovalReply>>)>>,
> = LazyLock::new(|| StdMutex::new(HashMap::new()));

fn guard<T>(m: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_id() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("t{}", d.as_nanos()))
        .unwrap_or_else(|_| "t0".to_string())
}

pub fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max_chars).collect();
        format!("{cut}\n…[truncado]")
    }
}

// ---------------------------------------------------------------------------
// Cancellation / lifecycle
// ---------------------------------------------------------------------------

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

/// Libera el estado en memoria asociado a un chat (mapas keyed por chat_id).
pub fn cleanup_chat(chat_id: &str) {
    guard(&TODOS).remove(chat_id);
    guard(&SESSION_PERMS).remove(chat_id);
    guard(&SKILLS_BY_CHAT).remove(chat_id);
}

// ---------------------------------------------------------------------------
// Events (emitted to the frontend)
// ---------------------------------------------------------------------------

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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequiredEvent {
    pub chat_id: String,
    pub id: String,
    pub tool: String,
    pub arguments: String,
    pub summary: String,
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

// ---------------------------------------------------------------------------
// Questions (blocking user decision)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Permissions (session-scoped rules + approval)
// ---------------------------------------------------------------------------

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

struct PendingApproval {
    chat_id: String,
    tool: String,
    pattern: String,
}

struct ApprovalReply {
    decision: String,
    feedback: String,
}

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

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const MAKORA_BASE_SKILL: &str = "\
## Makora Core Operating Engine (agente autónomo de precisión)

Eres un agente de desarrollo. Trabaja hasta RESOLVER por completo la tarea del usuario; solo termina el turno cuando estés seguro de haberla completado. Si te falta información sobre el código o la estructura del proyecto, usa las herramientas para leerla; NO adivines ni inventes.

### Protocolo de trabajo
1. Para tareas de 3 o más pasos usa `todowrite` al inicio y actualízala al completar cada paso (una sola in_progress a la vez).
2. Localiza el código con `grep` o `repo_map_query`; lee SOLO el fragmento necesario con `read_file` o `read_file_range`. No leas archivos completos si no vas a editarlos.
3. Modifica archivos existentes con `edit` (old_string exacto y único, con contexto, + new_string). `write_file` solo para archivos 100% nuevos; `apply_patch` para parches multi-bloque.
4. Agrupa todas las lecturas o búsquedas independientes en una única ronda de llamadas.
5. NO uses comandos Unix (`ls`, `find`, `cat`, `grep`, `sed`, `awk`, `head`, `tail`, `rm`) dentro de `bash` en Windows: la shell es `cmd.exe` y esos comandos fallan. Para listar/leer/buscar usa SIEMPRE las herramientas `list_dir`, `read_file`, `read_file_range` y `grep`. Para comandos de shell usa los equivalentes Windows (`dir`, `type`, `where`, `copy`, `del`, `powershell -c ...`) o `git`/`python`/`node`/`cargo`/`npm`, que sí están disponibles.
6. El acceso web en `bash` está prohibido (`curl`/`wget`/`nc`/`telnet`): usa la herramienta `webfetch`.
7. Si una herramienta devuelve ERROR, interpreta el mensaje, corrige los argumentos y reintenta o adapta la estrategia. NUNCA repitas la misma llamada fallida ni te quedes atascado reintentando.
8. No reimprimas código que ya fue aplicado.
9. No releas archivos que ya leíste en este turno ni explores proyectos/carpetas no relacionados. Concéntrate SOLO en los archivos que requiere la tarea.

### Respuesta final (obligatoria)
- Termina SIEMPRE tu turno con un mensaje de texto dirigido al usuario: un resumen conciso de lo realizado (archivos modificados con `ruta:línea`), el estado de verificación y los pasos siguientes si los hay.
- Nunca termines con texto vacío ni únicamente con llamadas a herramientas. Tras usar herramientas, resume el resultado para el usuario (el usuario no ve la salida completa de las herramientas).
- Cuando hayas aplicado los cambios del plan, DETENTE y escribe el resumen final; no sigas explorando o verificando indefinidamente.
- Si en el system prompt aparece una skill de proyecto relevante, cárgala con la herramienta `skill` antes de empezar y sigue sus instrucciones.
";

fn environment_info(folders: &[String]) -> String {
    let platform = std::env::consts::OS;
    let platform_label = match platform {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    };
    let cwd = folders
        .iter()
        .find(|f| !f.is_empty())
        .cloned()
        .unwrap_or_default();
    let is_git = std::path::Path::new(&cwd).join(".git").exists();
    format!(
        "## Entorno\n- Plataforma: {platform_label}\n- Shell de `bash`: cmd.exe (Windows) — no uses comandos Unix, usa las herramientas dedicadas o comandos Windows.\n- Workspace: {cwd}\n- Es repositorio git: {}",
        if is_git { "sí" } else { "no" }
    )
}

// ---------------------------------------------------------------------------
// Tool catalog
// ---------------------------------------------------------------------------

fn core_tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "read_file".into(),
            description: "Lee el contenido de un archivo del workspace (texto, con números de línea `N| contenido`, truncado si es muy largo).".into(),
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
            description: "Busca un texto (subcadena, no sensible a mayúsculas) en los archivos del workspace y devuelve las líneas coincidentes con su ubicación (path:línea: contenido).".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Texto a buscar (subcadena, no sensible a mayúsculas)" },
                    "path": { "type": "string", "description": "Directorio donde buscar (opcional; por defecto todo el workspace)" },
                    "include": { "type": "string", "description": "Filtro glob de archivo (opcional; ej. \"*.rs\", \"*.ts\"). Solo busca en archivos que coincidan" }
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
            name: "edit".into(),
            description: "Reemplaza UNA ocurrencia exacta de old_string por new_string en un archivo. Es la forma PREFERIDA de modificar archivos existentes.\n- old_string: texto exacto a reemplazar; debe ser ÚNICO en el archivo e incluir contexto (3-5 líneas antes y después del cambio, con indentación y espacios exactos).\n- new_string: texto de reemplazo.\n- Para CREAR un archivo nuevo: deja old_string vacío.\n- Para BORRAR contenido: deja new_string vacío.\nUsa write_file solo para archivos 100% nuevos; usa edit para modificar archivos existentes.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Ruta del archivo a editar" },
                    "old_string": { "type": "string", "description": "Texto exacto a reemplazar (vacío para crear el archivo)" },
                    "new_string": { "type": "string", "description": "Texto de reemplazo (vacío para borrar)" }
                },
                "required": ["path", "old_string", "new_string"]
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

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

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

/// Resuelve `.` y `..` de forma léxica sin tocar el sistema de archivos. Se usa
/// como fallback cuando `canonicalize` no puede resolver (p. ej. un archivo que
/// aún no existe), para que un `../fuera.txt` no engañe al chequeo de prefijo.
fn lexical_normalize(p: &std::path::Path) -> std::path::PathBuf {
    let mut out = std::path::PathBuf::new();
    for comp in p.components() {
        match comp {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn within(folders: &[String], p: &std::path::Path) -> bool {
    if folders.is_empty() {
        return true;
    }
    let p_resolved = p.canonicalize().unwrap_or_else(|_| lexical_normalize(p));
    let p_norm = normalize_path_str(&p_resolved);

    folders.iter().any(|f| {
        let fp = std::path::Path::new(f);
        let f_resolved = fp.canonicalize().unwrap_or_else(|_| lexical_normalize(fp));
        let f_norm = normalize_path_str(&f_resolved);
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

        if !root_name.is_empty() && clean.eq_ignore_ascii_case(&root_name) {
            return Ok(root.clone());
        }

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

// ---------------------------------------------------------------------------
// Search / read helpers
// ---------------------------------------------------------------------------

/// Convierte un patrón glob (`*.rs`, `*.{ts,tsx}`, `foo*`) a una expresión regular
/// (insensible a mayúsculas) para filtrar nombres de archivo en `grep`.
fn glob_to_regex(glob: &str) -> Option<regex::Regex> {
    let mut re = String::from("(?i)^");
    let mut chars = glob.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' => {
                while chars.peek() == Some(&'*') {
                    chars.next();
                }
                re.push_str(".*");
            }
            '?' => re.push('.'),
            '{' => {
                let mut alts = String::new();
                let mut closed = false;
                while let Some(&c2) = chars.peek() {
                    chars.next();
                    if c2 == '}' {
                        closed = true;
                        break;
                    }
                    if c2 == ',' {
                        alts.push('|');
                    } else {
                        alts.push(c2);
                    }
                }
                if closed {
                    re.push('(');
                    re.push_str(&alts);
                    re.push(')');
                }
            }
            '.' | '+' | '(' | ')' | '|' | '^' | '$' | '\\' | '[' | ']' | '@' | '%' => {
                re.push('\\');
                re.push(c);
            }
            _ => re.push(c),
        }
    }
    re.push('$');
    regex::Regex::new(&re).ok()
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

fn grep_dir(dir: &str, pattern: &str, include: Option<&regex::Regex>, out: &mut String, count: &mut u32, max: u32) {
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
        if let Some(re) = include {
            if !re.is_match(&name) {
                continue;
            }
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

/// Números de línea con ancho fijo (como opencode `view`): `     1| ...`.
fn number_lines(text: &str) -> String {
    text.lines()
        .enumerate()
        .map(|(i, l)| format!("{:>6}| {}", i + 1, l))
        .collect::<Vec<_>>()
        .join("\n")
}

fn read_file_guarded(path: &str, max_tokens: usize) -> Result<String, String> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) => {
            let p = std::path::Path::new(path);
            let dir = p.parent().unwrap_or(std::path::Path::new("."));
            let base = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if let Ok(rd) = std::fs::read_dir(dir) {
                let mut sugg: Vec<String> = Vec::new();
                for entry in rd.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.to_lowercase().contains(&base.to_lowercase())
                        || base.to_lowercase().contains(&name.to_lowercase())
                    {
                        sugg.push(entry.path().to_string_lossy().to_string());
                        if sugg.len() >= 3 {
                            break;
                        }
                    }
                }
                if !sugg.is_empty() {
                    return Err(format!(
                        "no se pudo leer {path}: {e}\n¿Querías decir alguno de estos?\n{}",
                        sugg.join("\n")
                    ));
                }
            }
            return Err(format!("no se pudo leer {path}: {e}"));
        }
    };
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
    Ok(truncate_tool_output("read_file", &number_lines(&text), max_tokens))
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

// ---------------------------------------------------------------------------
// bash
// ---------------------------------------------------------------------------

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

/// Devuelve el nombre del comando de red prohibido si el comando empieza por él.
fn banned_network_command(cmd: &str) -> Option<&'static str> {
    let first = cmd.trim_start().split_whitespace().next().unwrap_or("");
    let base = first.split('.').next().unwrap_or(first).to_lowercase();
    match base.as_str() {
        "curl" => Some("curl"),
        "wget" => Some("wget"),
        "nc" | "netcat" => Some("nc"),
        "telnet" => Some("telnet"),
        "nmap" => Some("nmap"),
        "lynx" => Some("lynx"),
        "w3m" => Some("w3m"),
        "aria2c" => Some("aria2c"),
        "httpie" => Some("httpie"),
        "xh" => Some("xh"),
        _ => None,
    }
}

fn normalize_bash_command(command: &str) -> String {
    #[cfg(target_os = "windows")]
    {
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
    if let Some(cmd) = banned_network_command(command) {
        return Err(format!(
            "El comando '{cmd}' no está permitido en bash (acceso de red). Usa la herramienta `webfetch` para descargar contenido web."
        ));
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
        c.creation_flags(0x08000000); // CREATE_NO_WINDOW
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
    if exit_code != 0 {
        return Err(format!(
            "el comando falló (exit {exit_code}): {}\n{}",
            truncate(command, 200),
            summarized
        ));
    }
    Ok(format!("exit: 0\n{summarized}"))
}

// ---------------------------------------------------------------------------
// Edit / patch helpers
// ---------------------------------------------------------------------------

/// Aplica una edición estilo opencode/Claude: reemplaza la ÚNICA ocurrencia de
/// `old_string` por `new_string` en `text`.
fn apply_edit_to_text(text: &str, old_string: &str, new_string: &str, path: &str) -> Result<String, String> {
    if old_string.is_empty() {
        return Ok(new_string.to_string());
    }
    if old_string == new_string {
        return Err("old_string y new_string son idénticos; no hay cambios que aplicar.".into());
    }
    let occurrences = text.matches(old_string).count();
    if occurrences == 0 {
        return Err(format!(
            "old_string no encontrado en {path}. Lee el archivo con read_file y copia el texto EXACTO (sin los prefijos de número de línea, con la indentación y espacios exactos) que quieres reemplazar."
        ));
    }
    if occurrences > 1 {
        return Err(format!(
            "old_string aparece {occurrences} veces en {path}; añade más contexto (líneas alrededor del cambio) para que sea único."
        ));
    }
    Ok(text.replacen(old_string, new_string, 1))
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

        if let Some(pos) = result.find(&search_block) {
            result.replace_range(pos..pos + search_block.len(), &replace_block);
            replaced = true;
        }

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

// ---------------------------------------------------------------------------
// Output truncation helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Web fetch (SSRF-safe)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct Skill {
    name: String,
    description: String,
    content: String,
}

fn parse_skill_frontmatter(raw: &str) -> Option<(String, String, String)> {
    let trimmed = raw.trim_start_matches('\u{feff}').trim_start();
    // Formato 1: frontmatter YAML `--- name/description ---`.
    if let Some(rest) = trimmed.strip_prefix("---") {
        if let Some((fm, body)) = rest.split_once("---") {
            let mut name = String::new();
            let mut description = String::new();
            for line in fm.lines() {
                if let Some(v) = line.strip_prefix("name:") {
                    name = v.trim().to_string();
                } else if let Some(v) = line.strip_prefix("description:") {
                    description = v.trim().to_string();
                }
            }
            if !name.is_empty() {
                return Some((name, description, body.trim().to_string()));
            }
        }
    }
    // Formato 2: encabezado Markdown `# Skill: <name>`.
    let first_line = trimmed.lines().next().unwrap_or("");
    let after_hash = first_line.trim_start_matches('#').trim();
    if after_hash.len() >= 6 && after_hash[..6].eq_ignore_ascii_case("skill:") {
        let name = after_hash[6..].trim().to_string();
        if !name.is_empty() {
            let body = trimmed
                .strip_prefix(first_line)
                .unwrap_or(trimmed)
                .trim()
                .to_string();
            let description = body
                .lines()
                .find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
                .map(|l| l.trim().to_string())
                .unwrap_or_default();
            return Some((name, description, body));
        }
    }
    None
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
            let dir_name = e.file_name().to_string_lossy().to_string();
            let md_path = e.path().join("SKILL.md");
            if let Ok(raw) = std::fs::read_to_string(&md_path) {
                let (name, description, content) = match parse_skill_frontmatter(&raw) {
                    Some(t) => t,
                    None => {
                        let desc = raw
                            .lines()
                            .find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
                            .map(|l| l.trim().to_string())
                            .unwrap_or_default();
                        (dir_name.clone(), desc, raw.trim().to_string())
                    }
                };
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

// ---------------------------------------------------------------------------
// Tool name repair / todo normalization / permission target
// ---------------------------------------------------------------------------

fn repair_tool_name<'a>(name: &'a str, mcp_names: &[String]) -> std::borrow::Cow<'a, str> {
    const CORE: &[&str] = &[
        "read_file",
        "read_file_range",
        "list_dir",
        "grep",
        "apply_patch",
        "edit",
        "write_file",
        "bash",
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
        "write_file" | "apply_patch" | "edit" => {
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

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

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
    _cfg: &ChatConfig,
    name: &str,
    arguments: &str,
    folders: &[String],
    registry: &'static McpRegistry,
    chat_id: &str,
    _usage_acc: &mut ChatUsage,
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
            read_file_guarded(&path, 12000)
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
        "edit" => {
            let path = resolve_path(folders, &s("path"), true)?;
            if std::path::Path::new(&path).is_dir() {
                return Err(format!("{path} es un directorio; edit solo edita archivos"));
            }
            let old_string = s("old_string");
            let new_string = s("new_string");

            if old_string.is_empty() {
                if std::path::Path::new(&path).exists() {
                    return Err(format!(
                        "{path} ya existe; usa edit con old_string para modificarlo o write_file para sobrescribirlo"
                    ));
                }
                if let Some(parent) = std::path::Path::new(&path).parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                snapshot.capture(&path);
                std::fs::write(&path, &new_string).map_err(|e| e.to_string())?;
                let mut msg = format!("archivo creado: {path}");
                if let Some(syntax_err) = check_file_syntax(&path, &new_string) {
                    msg.push_str(&format!("\n⚠️ ALERTA DE SINTAXIS: {syntax_err}"));
                }
                return Ok(msg);
            }

            let current = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let new_text = apply_edit_to_text(&current, &old_string, &new_string, &path)?;
            snapshot.capture(&path);
            std::fs::write(&path, &new_text).map_err(|e| e.to_string())?;
            let mut msg = format!("edición aplicada en {path}");
            if let Some(syntax_err) = check_file_syntax(&path, &new_text) {
                msg.push_str(&format!("\n⚠️ ALERTA DE SINTAXIS: {syntax_err}"));
            }
            Ok(msg)
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
            let include = if s("include").trim().is_empty() {
                None
            } else {
                match glob_to_regex(&s("include")) {
                    Some(re) => Some(re),
                    None => return Err("patrón 'include' inválido".into()),
                }
            };
            let dirs: Vec<String> = if path_arg.is_empty() {
                folders.to_vec()
            } else {
                vec![resolve_path(folders, &path_arg, false)?]
            };
            let mut out = String::new();
            let mut count = 0u32;
            for d in dirs {
                grep_dir(&d, &pattern, include.as_ref(), &mut out, &mut count, 200);
                if count >= 200 {
                    break;
                }
            }
            if out.is_empty() {
                out = "sin coincidencias".into();
            }
            Ok(truncate_tool_output("grep", &out, 2500))
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
            if let Ok(existing) = std::fs::read_to_string(&path) {
                if existing == content {
                    return Ok(format!("sin cambios: {path} ya contiene exactamente ese contenido"));
                }
            }
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
                        Err("no hay skills registradas en este workspace (ninguna en .makora/skills ni .opencode/skills). Si existe un SKILL.md, léelo directamente con read_file en vez de reintentar esta herramienta.".into())
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

// ---------------------------------------------------------------------------
// Session / snapshot
// ---------------------------------------------------------------------------

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

    fn commit(self) {
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

// ---------------------------------------------------------------------------
// Cost / accounting
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Final synthesis / finish
// ---------------------------------------------------------------------------

fn synthesize_summary(msgs: &[ChatMessage], reason: Option<&str>) -> String {
    let mut modified: Vec<String> = Vec::new();
    let mut read: Vec<String> = Vec::new();
    let mut bash: Vec<(String, String)> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    let mut bash_by_id: HashMap<String, String> = HashMap::new();
    for m in msgs {
        if let Some(tcs) = &m.tool_calls {
            for tc in tcs {
                match tc.name.as_str() {
                    "write_file" | "apply_patch" | "edit" => {
                        if let Ok(v) = serde_json::from_str::<Value>(&tc.arguments) {
                            if let Some(p) = v.get("path").and_then(|p| p.as_str()) {
                                modified.push(p.to_string());
                            }
                        }
                    }
                    "read_file" | "read_file_range" => {
                        if let Ok(v) = serde_json::from_str::<Value>(&tc.arguments) {
                            if let Some(p) = v.get("path").and_then(|p| p.as_str()) {
                                read.push(p.to_string());
                            }
                        }
                    }
                    "bash" => {
                        if let Ok(v) = serde_json::from_str::<Value>(&tc.arguments) {
                            if let Some(cmd) = v.get("command").and_then(|c| c.as_str()) {
                                bash_by_id.insert(tc.id.clone(), cmd.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        if m.role == "tool" {
            if let Some(tid) = &m.tool_call_id {
                if let Some(cmd) = bash_by_id.remove(tid) {
                    bash.push((cmd, summarize_bash_result(&m.content)));
                }
            }
            if m.content.starts_with("ERROR:") {
                errors.push(m.content.clone());
            }
        }
    }
    modified.sort();
    modified.dedup();
    read.sort();
    read.dedup();

    let mut s = String::from("### Resumen del turno\n\n");
    if let Some(r) = reason {
        s.push_str(&format!("**Motivo del cierre:** {r}\n\n"));
    }
    if !modified.is_empty() {
        s.push_str("**Archivos modificados:**\n");
        for f in &modified {
            s.push_str(&format!("- `{f}`\n"));
        }
        s.push('\n');
    }
    if !bash.is_empty() {
        s.push_str("**Comandos ejecutados:**\n");
        for (cmd, res) in &bash {
            s.push_str(&format!("- `{}` — {res}\n", truncate(cmd, 90)));
        }
        s.push('\n');
    }
    if !read.is_empty() {
        s.push_str("**Archivos consultados:**\n");
        for f in &read {
            s.push_str(&format!("- `{f}`\n"));
        }
        s.push('\n');
    }
    if !errors.is_empty() {
        s.push_str("**Errores de herramientas:**\n");
        for e in errors.iter().take(5) {
            s.push_str(&format!("- {}\n", truncate(e, 160)));
        }
        s.push('\n');
    }
    if modified.is_empty() && bash.is_empty() && read.is_empty() && errors.is_empty() {
        s.push_str("No se ejecutaron herramientas en este turno.\n");
    } else {
        s.push_str("> El modelo concluyó sin emitir una respuesta final; este resumen refleja las operaciones registradas durante el turno.\n");
    }
    s
}

fn summarize_bash_result(content: &str) -> String {
    if let Some(rest) = content.strip_prefix("ERROR: el comando falló (exit ") {
        let code = rest.split(')').next().unwrap_or("?");
        format!("falló (exit {code})")
    } else if let Some(rest) = content.strip_prefix("exit: ") {
        let code = rest.lines().next().unwrap_or("?").trim();
        if code == "0" {
            "ok".to_string()
        } else {
            format!("exit {code}")
        }
    } else {
        "ejecutado".to_string()
    }
}

/// Cierra el turno con un mensaje final del asistente (garantizado no vacío),
/// persiste checkpoint/transcript y devuelve el `ChatResult`.
fn finish_turn(
    msgs: &mut Vec<ChatMessage>,
    content: String,
    reasoning: Option<String>,
    session_id: &str,
    turn: u32,
    total: &ChatUsage,
) -> ChatResult {
    msgs.push(ChatMessage {
        role: "assistant".into(),
        content,
        images: vec![],
        tool_calls: None,
        tool_call_id: None,
        reasoning,
    });
    history::create_checkpoint(session_id, turn, msgs);
    history::archive_transcript(session_id, turn, msgs);
    let summary = history::requests_summary(session_id);
    println!(
        "[TOKEN_ENGINE] sesión terminada: {} turnos, in={} cached={} out={} cost=${}",
        summary.turns, summary.input_tokens, summary.cached_tokens, summary.output_tokens, summary.cost_usd
    );
    ChatResult {
        input_tokens: total.input_tokens,
        output_tokens: total.output_tokens,
        cached_tokens: total.cached_tokens,
        messages: msgs.clone(),
    }
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

/// Poda el historial que verá el modelo: sin esto el wire crece O(n²) conforme
/// se acumulan resultados de herramientas y se quema el presupuesto de tokens.
/// `msgs` (historial completo) se conserva para UI/persistencia/checkpoint; solo
/// se recorta la vista enviada al proveedor, manteniendo la atomicidad de los
/// bloques assistant+tool (opencode usa un mecanismo equivalente de resumen).
///
/// Estrategia (opencode `summarize` + ADR-014):
///   1. Los resultados de herramientas antiguos se RESUMEN a una línea (la mayor
///      parte del historial son outputs de read_file/grep/bash de miles de tokens).
///   2. `fit_history` acota el total a un presupuesto de tokens como backstop.
fn prepare_wire(msgs: &[ChatMessage], cfg: &ChatConfig) -> Vec<ChatMessage> {
    let evicted = evict_tool_results(msgs);
    let counter = token_engine::global();
    let composer =
        token_engine::ContextComposer::for_window(cfg.context_window.unwrap_or(128_000), None);
    composer.fit_history(counter, &evicted)
}

/// Conserva los últimos `KEEP_RAW` resultados de herramientas crudos; los más
/// antiguos se comprimen a una línea. El transcript completo (para la UI) no se
/// toca: esto solo afecta a la vista enviada al modelo.
fn evict_tool_results(msgs: &[ChatMessage]) -> Vec<ChatMessage> {
    const KEEP_RAW: usize = 6;
    let mut out: Vec<ChatMessage> = msgs.to_vec();
    let mut raw_seen = 0usize;
    for i in (0..out.len()).rev() {
        if out[i].role == "tool" {
            if raw_seen >= KEEP_RAW {
                out[i].content = summarize_old_tool_result(&out[i].content);
            }
            raw_seen += 1;
        }
    }
    out
}

fn summarize_old_tool_result(content: &str) -> String {
    let first_line = content.lines().next().unwrap_or("").trim();
    let lines = content.lines().count();
    if content.starts_with("parche aplicado:")
        || content.starts_with("archivo escrito:")
        || content.starts_with("edición aplicada")
        || content.starts_with("archivo creado:")
    {
        format!("[{first_line}]")
    } else if content.starts_with("ERROR:") {
        format!("[Resultado previo con error: {}]", truncate(content, 120))
    } else if content.starts_with("exit: 0") {
        format!("[Comando previo completado: {lines} líneas]")
    } else if content.contains("coincidencias") {
        format!("[Búsqueda previa completada: {lines} líneas]")
    } else {
        format!("[Resultado previo de herramienta: {lines} líneas]")
    }
}

/// Configuración de respaldo local (MakoraAI/Ollama) para conmutar cuando el
/// proveedor cloud agota cuota/saldo (402/429). Solo se activa si está configurada.
fn fallback_cfg(cfg: &ChatConfig) -> Option<ChatConfig> {
    if cfg.fallback_model.trim().is_empty() && cfg.fallback_base_url.trim().is_empty() {
        return None;
    }
    let kind = if cfg.fallback_kind.trim().is_empty() {
        "ollama".to_string()
    } else {
        cfg.fallback_kind.clone()
    };
    let base_url = if cfg.fallback_base_url.trim().is_empty() {
        "http://localhost:11434/v1".to_string()
    } else {
        cfg.fallback_base_url.clone()
    };
    let model = if cfg.fallback_model.trim().is_empty() {
        "makoraai".to_string()
    } else {
        cfg.fallback_model.clone()
    };
    Some(ChatConfig {
        kind,
        base_url,
        model,
        api_key: cfg.fallback_api_key.clone(),
        reasoning_effort: cfg.reasoning_effort.clone(),
        max_output_tokens: cfg.max_output_tokens,
        temperature: cfg.temperature,
        vision_enabled: cfg.vision_enabled,
        context_window: cfg.context_window,
        fallback_kind: String::new(),
        fallback_base_url: String::new(),
        fallback_model: String::new(),
        fallback_api_key: String::new(),
    })
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

    // Modo Plan: solo herramientas de lectura; las mutaciones quedan fuera del
    // catálogo (el modelo no puede invocarlas).
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

    // Resume por checkpoint cuando el frontend entrega un transcript vacío.
    if msgs.is_empty() {
        if let Some((_, restored)) = history::latest_checkpoint(&session_id) {
            msgs = restored;
        }
    }

    // Protección anti-loop: NO corta trabajo legítimo. Los topes de turnos/tokens
    // son solo redes de seguridad para procesos desbocados (casi nunca se tocan);
    // la detección real de bucle degenerado es la repetición EXACTA del lote de
    // herramientas, que sí indica que el modelo no progresa.
    const MAX_AGENT_TURNS: u32 = 500;
    const MAX_TURN_TOKENS: u64 = 50_000_000;
    const REPEAT_LIMIT: u32 = 3;
    // Nudge mínimo anti-estancamiento: en modo Act, empujar a implementar una
    // única vez si el modelo encadena demasiadas rondas de solo lectura.
    const ACT_STALL_NUDGE: u32 = 8;

    let mut turn: u32 = 0;
    let mut rounds_since_write: u32 = 0;
    let mut stall_noted = false;
    let mut budget_asked = false;
    let mut accumulated_cost: f64 = 0.0;
    let mut empty_recoveries: u32 = 0;
    let mut wrap_up_requested = false;
    let mut prev_sig: Vec<String> = Vec::new();
    let mut repeats: u32 = 0;
    let mut system_extra = String::new();

    loop {
        if is_chat_cancelled(chat_id) {
            return Err("cancelado por el usuario".into());
        }
        turn += 1;

        if !plan_mode && !stall_noted && rounds_since_write >= ACT_STALL_NUDGE {
            stall_noted = true;
            system_extra = format!(
                "{system_extra}\n\n[Nota del sistema Makora]: llevas {rounds_since_write} rondas seguidas sin modificar archivos. Deja de explorar; ya tienes contexto suficiente. Implementa AHORA los cambios con edit/write_file/apply_patch (o bash) y completa la tarea de principio a fin."
            );
        }

        let started = std::time::Instant::now();
        let effective_system = format!("{full_system}{system_extra}");
        let wire_msgs = prepare_wire(&msgs, cfg);
        let raw = if cfg.kind == "anthropic" {
            gateway::anthropic_turn(app, cfg, chat_id, &effective_system, &wire_msgs, &tools).await
        } else {
            gateway::openai_turn(app, cfg, chat_id, &effective_system, &wire_msgs, &tools).await
        };
        // Fallback local por cuota/saldo (402/429): conmuta a MakoraAI (Ollama)
        // y reintenta UNA vez antes de propagar el error.
        let raw = match raw {
            Err(e) if gateway::is_quota_or_billing_error(&e) => match fallback_cfg(cfg) {
                Some(fb) if fb.kind != cfg.kind || fb.base_url != cfg.base_url => {
                    if fb.kind == "anthropic" {
                        gateway::anthropic_turn(app, &fb, chat_id, &effective_system, &wire_msgs, &tools).await
                    } else {
                        gateway::openai_turn(app, &fb, chat_id, &effective_system, &wire_msgs, &tools).await
                    }
                }
                _ => Err(e),
            },
            other => other,
        };
        let outcome = match raw {
            Ok(o) => o,
            Err(e) => {
                // Degradación controlada: si ya hay progreso (herramientas
                // ejecutadas), sintetiza una respuesta final honesta en vez de
                // abortar el turno y perder el trabajo hecho.
                let has_progress = msgs.iter().any(|m| {
                    m.role == "tool"
                        || m.tool_calls.as_ref().map(|t| !t.is_empty()).unwrap_or(false)
                });
                if has_progress {
                    let summary =
                        synthesize_summary(&msgs, Some(&format!("error del proveedor: {e}")));
                    return Ok(finish_turn(&mut msgs, summary, None, &session_id, turn, &total));
                }
                return Err(e);
            }
        };
        total += outcome.usage.clone();
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
            "[TOKEN_ENGINE] turn={turn} api_in={} api_cached={} api_out={}",
            outcome.usage.input_tokens, outcome.usage.cached_tokens, outcome.usage.output_tokens
        );

        // Presupuesto de coste opcional (off por defecto): pregunta una vez al
        // alcanzarlo; nunca corta por sorpresa.
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
                        let summary = synthesize_summary(
                            &msgs,
                            Some("presupuesto de coste alcanzado (detenido por el usuario)"),
                        );
                        return Ok(finish_turn(&mut msgs, summary, None, &session_id, turn, &total));
                    }
                }
            }
        }

        if outcome.tool_calls.is_empty() {
            if !outcome.text.trim().is_empty() {
                let reasoning = if outcome.reasoning.is_empty() {
                    None
                } else {
                    Some(outcome.reasoning.clone())
                };
                return Ok(finish_turn(
                    &mut msgs,
                    outcome.text,
                    reasoning,
                    &session_id,
                    turn,
                    &total,
                ));
            }
            // Respuesta vacía: recuperación ACOTADA. El modelo pudo cortarse por
            // el límite de tokens de salida, querer más herramientas (llamadas
            // perdidas) o simplemente no emitir texto. Le damos UNA oportunidad
            // de continuar/responder antes de sintetizar un resumen honesto.
            let reason = outcome.finish_reason.clone().unwrap_or_default();
            let note = if reason == "tool_calls" || reason == "tool_use" {
                "Indicaste que querías usar herramientas pero las llamadas llegaron vacías. Vuelve a emitir la(s) llamada(s) usando el function calling nativo."
            } else if reason == "length" || reason == "max_tokens" {
                "Tu respuesta se cortó por el límite de tokens de salida. Continúa exactamente donde te quedaste o responde con un resumen conciso."
            } else {
                "Tu respuesta quedó vacía. Responde al usuario con un resumen conciso de lo realizado o del plan a seguir; si aún falta trabajo, usa las herramientas."
            };
            if empty_recoveries < 1 {
                empty_recoveries += 1;
                println!("[TOKEN_ENGINE] recuperación de respuesta vacía (turno {turn}, motivo: {reason})");
                system_extra = format!("{system_extra}\n\n[Nota del sistema Makora]: {note}");
                continue;
            }
            let summary = synthesize_summary(&msgs, Some("el modelo concluyó sin emitir texto"));
            return Ok(finish_turn(&mut msgs, summary, None, &session_id, turn, &total));
        }

        empty_recoveries = 0;

        let attempted_write = outcome
            .tool_calls
            .iter()
            .any(|tc| matches!(tc.name.as_str(), "write_file" | "apply_patch" | "edit"));
        if attempted_write {
            rounds_since_write = 0;
        } else {
            rounds_since_write += 1;
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

        // Ejecución por lotes: lecturas en paralelo, mutaciones secuenciales.
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
                            ToolEnd {
                                id: tc.id.clone(),
                                ok,
                                summary,
                                chat_id: chat_id.to_string(),
                            },
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
                        let tasks: Vec<_> = calls
                            .iter()
                            .map(|tc| {
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
                                    let result = execute_tool(
                                        &app,
                                        &cfg,
                                        &name,
                                        &arguments,
                                        &folders,
                                        registry,
                                        &chat,
                                        &mut u,
                                        &mut snap,
                                    )
                                    .await;
                                    let (ok, summary) = match &result {
                                        Ok(s) => (true, truncate(s, 400)),
                                        Err(e) => (false, e.clone()),
                                    };
                                    let _ = app.emit(
                                        "tool-end",
                                        ToolEnd {
                                            id: id.clone(),
                                            ok,
                                            summary,
                                            chat_id: chat.clone(),
                                        },
                                    );
                                    let content = match result {
                                        Ok(s) => s,
                                        Err(e) => format!("ERROR: {e}"),
                                    };
                                    (id, content, u)
                                }
                            })
                            .collect();

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
                        ToolEnd {
                            id: tc.id.clone(),
                            ok,
                            summary,
                            chat_id: chat_id.to_string(),
                        },
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

        // Detección de bucle degenerado: repetición EXACTA del lote de tools
        // (mismas llamadas y argumentos, en rondas consecutivas).
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

        // Cierre del turno solo ante una señal CLARA: bucle real (repetición) o
        // red de seguridad anti-desbocado (500 turnos / 50M tokens). Antes de
        // sintetizar un resumen frío, se pide UNA vez al modelo que resuma su
        // propio trabajo.
        let token_fuse =
            (total.input_tokens as u64 + total.output_tokens as u64) >= MAX_TURN_TOKENS;
        if repeats >= REPEAT_LIMIT || turn >= MAX_AGENT_TURNS || token_fuse {
            if !wrap_up_requested {
                wrap_up_requested = true;
                let note = if repeats >= REPEAT_LIMIT {
                    "Estás repitiendo exactamente las mismas llamadas a herramientas sin progreso. Cambia de estrategia o TERMINA AHORA: escribe el resumen final de lo realizado."
                } else {
                    "Has alcanzado el límite de turnos/tokens de esta sesión. TERMINA AHORA: escribe el resumen final de lo que has modificado (archivos, cambios aplicados y estado de verificación)."
                };
                println!(
                    "[TOKEN_ENGINE] cierre de turno (turno {turn}, repeats={repeats}); pidiendo resumen final al modelo"
                );
                system_extra = format!("{system_extra}\n\n[Nota del sistema Makora]: {note}");
                continue;
            }
            let reason = if repeats >= REPEAT_LIMIT {
                "Bucle de herramientas idénticas sin progreso."
            } else if turn >= MAX_AGENT_TURNS {
                "Fusible de seguridad (500 turnos) alcanzado."
            } else {
                "Fusible de seguridad (50M tokens en el turno) alcanzado."
            };
            let summary = synthesize_summary(&msgs, Some(reason));
            return Ok(finish_turn(&mut msgs, summary, None, &session_id, turn, &total));
        }

        // Persistencia de progreso cada 5 turnos (el checkpoint final siempre se guarda).
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
    let env_section = environment_info(folders);
    let full_system = if plan_mode {
        format!("{MAKORA_BASE_SKILL}\n\n{env_section}\n\n{system}\n\n{PLAN_MODE_DIRECTIVE}{skills_section}{repo_section}")
    } else {
        format!("{MAKORA_BASE_SKILL}\n\n{env_section}\n\n{system}{skills_section}{repo_section}")
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

- Estás en MODO PLAN: las herramientas de modificación (`write_file`, `apply_patch`, `edit`, `bash`) están DESHABILITADAS a nivel de sistema; no las llames.
- Explora con `read_file_range`/`grep`/`list_dir` y produce un plan de implementación en Markdown con esta estructura:
  1. `# Implementation Plan: [Título]`
  2. `## 1. Análisis y Diagnóstico`
  3. `## 2. Cambios Propuestos` (archivo por archivo, rutas exactas y desglose)
  4. `## 3. Plan de Verificación y Pruebas`
  5. Preguntas abiertas o decisiones críticas que requieran validación.
- Usa `todowrite` para estructurar el plan en pasos. NO repitas lecturas ya hechas: si el contexto es suficiente, redacta ya el plan final.
- Presenta el plan completo de forma clara y directa para que el usuario lo revise y pulse «Implementar». Cuando lo apruebe, recibirás un nuevo mensaje en modo Act con las herramientas habilitadas; ejecuta entonces el plan al pie de la letra.";

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
    // El modo "multiagente" se reduce al mismo bucle de agente con el objetivo
    // explícito en el system prompt: la delegación se gestiona en un único hilo
    // de herramientas, sin pipeline de fases frágil.
    let system_with_objective = format!("{system}\n\n## Objetivo del usuario\n{objective}");
    run(
        app,
        cfg,
        chat_id,
        &system_with_objective,
        messages,
        folders,
        registry,
        plan_mode,
        budget_usd,
    )
    .await
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("makora_test_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.to_string(),
            content: content.to_string(),
            images: vec![],
            tool_calls: None,
            tool_call_id: None,
            reasoning: None,
        }
    }

    #[test]
    fn test_resolve_path_root_and_dot() {
        let folder = std::env::temp_dir().to_string_lossy().to_string();
        let folders = vec![folder.clone()];
        assert_eq!(resolve_path(&folders, ".", false).unwrap(), folder);
        assert_eq!(resolve_path(&folders, "", false).unwrap(), folder);
        assert_eq!(resolve_path(&folders, "./", false).unwrap(), folder);
    }

    #[test]
    fn test_resolve_path_empty_workspace_err() {
        assert!(resolve_path(&[], "x", false).is_err());
    }

    #[test]
    fn test_resolve_path_traversal_prevention() {
        let tmp = temp_dir("trav");
        let root = tmp.join("ws");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.txt"), "hello").unwrap();
        let folders = vec![root.to_string_lossy().to_string()];
        assert!(resolve_path(&folders, "../outside.txt", false).is_err());
        std::fs::remove_dir_all(&tmp).ok();
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
        assert!(check_file_syntax("a.ts", valid_ts).is_none());
        let invalid_ts = "function test() { if (true) { return 1; }";
        assert!(check_file_syntax("a.ts", invalid_ts).is_some());
    }

    #[test]
    fn test_apply_edit_to_text() {
        let text = "line1\nline2\nline3\n";
        let out = apply_edit_to_text(text, "line2", "LINE2", "f").unwrap();
        assert_eq!(out, "line1\nLINE2\nline3\n");
        assert!(apply_edit_to_text(text, "nope", "x", "f").is_err());
        assert!(apply_edit_to_text("a\na\n", "a", "b", "f").is_err());
        assert!(apply_edit_to_text(text, "line2", "line2", "f").is_err());
    }

    #[test]
    fn test_glob_to_regex_matching() {
        let re = glob_to_regex("*.rs").unwrap();
        assert!(re.is_match("main.rs"));
        assert!(!re.is_match("main.ts"));
        let re2 = glob_to_regex("*.{ts,tsx}").unwrap();
        assert!(re2.is_match("a.ts"));
        assert!(re2.is_match("b.tsx"));
        assert!(!re2.is_match("c.rs"));
    }

    #[test]
    fn test_banned_network_command() {
        assert_eq!(banned_network_command("curl https://x"), Some("curl"));
        assert_eq!(banned_network_command("wget -q x"), Some("wget"));
        assert_eq!(banned_network_command("npm install"), None);
    }

    #[test]
    fn test_number_lines_padded() {
        let out = number_lines("a\nb");
        assert_eq!(out, "     1| a\n     2| b");
    }

    #[test]
    fn test_truncate_head_tail() {
        let many: Vec<String> = (0..100).map(|i| format!("line{i}")).collect();
        let out = truncate_head_tail(&many.join("\n"), 2, 2);
        assert!(out.contains("líneas omitidas"));
        assert!(out.starts_with("line0\nline1\n"));
    }

    #[test]
    fn test_is_ignored_path() {
        assert!(is_ignored_path("node_modules"));
        assert!(is_ignored_path(".git"));
        assert!(is_ignored_path("Cargo.lock"));
        assert!(!is_ignored_path("main.rs"));
    }

    #[test]
    fn test_is_read_only_tool() {
        assert!(is_read_only_tool("read_file"));
        assert!(is_read_only_tool("grep"));
        assert!(!is_read_only_tool("write_file"));
        assert!(!is_read_only_tool("bash"));
    }

    #[test]
    fn test_within_blocks_sibling_prefix_escape() {
        let tmp = temp_dir("within");
        let proj = tmp.join("proj");
        let proj2 = tmp.join("proj2");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::create_dir_all(&proj2).unwrap();
        let folders = vec![proj.to_string_lossy().to_string()];
        assert!(within(&folders, &proj));
        assert!(!within(&folders, &proj2));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_is_public_url_blocks_ssrf_targets() {
        assert!(is_public_url("https://example.com"));
        assert!(!is_public_url("http://localhost:8080"));
        assert!(!is_public_url("http://127.0.0.1/x"));
        assert!(!is_public_url("http://10.0.0.5/x"));
        assert!(!is_public_url("file:///etc/passwd"));
    }

    #[test]
    fn test_html_to_markdown_strips_scripts() {
        let md = html_to_markdown("<html><head><script>alert(1)</script></head><body><p>hi</p></body></html>");
        assert!(!md.contains("alert(1)"));
        assert!(md.contains("hi"));
    }

    #[test]
    fn test_normalize_bash_command_only_rewrites_path_tokens() {
        assert_eq!(normalize_bash_command("cat /c/Users/x/a.txt"), "cat c:/Users/x/a.txt");
        // URLs must not be corrupted.
        assert_eq!(
            normalize_bash_command("git clone https://host/a/b"),
            "git clone https://host/a/b"
        );
    }

    #[test]
    fn test_compute_turn_cost_usd_conservative() {
        assert_eq!(compute_turn_cost_usd("ollama", "llama3", 1000, 0, 1000), 0.0);
        let c = compute_turn_cost_usd("openai", "gpt-4o", 1_000_000, 0, 0);
        assert!((c - 2.5).abs() < 0.01);
    }

    #[test]
    fn test_repair_tool_name() {
        let mcp: Vec<String> = vec!["mcp__git__status".into()];
        assert_eq!(repair_tool_name("read_file", &mcp), "read_file");
        assert_eq!(repair_tool_name("Read File", &mcp), "read_file");
        assert_eq!(repair_tool_name("mcp__git__status", &mcp), "mcp__git__status");
    }

    #[test]
    fn test_normalize_todos() {
        let v = json!({"todos": [
            {"content": "a", "status": "in_progress"},
            {"content": "b", "status": "in_progress"},
            {"content": "c", "status": "pending"}
        ]});
        let todos = normalize_todos(&v).unwrap();
        assert_eq!(todos.len(), 3);
        // Only one in_progress allowed.
        assert_eq!(todos.iter().filter(|t| t.status == "in_progress").count(), 1);
    }

    #[test]
    fn test_bash_prefix_and_pattern_matches() {
        assert_eq!(bash_prefix("git status"), "git status *");
        assert!(pattern_matches("git status *", "git status --porcelain"));
        assert!(pattern_matches("*", "anything"));
        assert!(!pattern_matches("npm *", "git status"));
    }

    #[test]
    fn test_evaluate_rules_last_wins() {
        let rules = vec![
            PermRule { tool: "bash".into(), pattern: "*".into(), action: PermAction::Allow },
            PermRule { tool: "bash".into(), pattern: "rm *".into(), action: PermAction::Deny },
        ];
        assert_eq!(evaluate_rules(&rules, "bash", "rm -rf x"), Some(PermAction::Deny));
        assert_eq!(evaluate_rules(&rules, "bash", "ls"), Some(PermAction::Allow));
    }

    #[test]
    fn test_is_sensitive_path() {
        assert!(is_sensitive_path("/x/.env"));
        assert!(is_sensitive_path("/x/id_rsa"));
        assert!(!is_sensitive_path("/x/main.rs"));
    }

    #[test]
    fn test_synthesize_summary_never_empty_and_lists_files() {
        let mut msgs = vec![msg("user", "haz X")];
        let tc = ToolCall {
            id: "1".into(),
            name: "write_file".into(),
            arguments: r#"{"path":"/x/a.txt"}"#.into(),
            extra_content: None,
        };
        msgs.push(ChatMessage {
            role: "assistant".into(),
            content: String::new(),
            images: vec![],
            tool_calls: Some(vec![tc]),
            tool_call_id: None,
            reasoning: None,
        });
        msgs.push(ChatMessage {
            role: "tool".into(),
            content: "archivo escrito".into(),
            images: vec![],
            tool_calls: None,
            tool_call_id: Some("1".into()),
            reasoning: None,
        });
        let s = synthesize_summary(&msgs, None);
        assert!(s.contains("a.txt"));
    }

    #[test]
    fn test_summarize_bash_result_and_exit_codes() {
        assert_eq!(summarize_bash_result("exit: 0\nok"), "ok");
        assert_eq!(summarize_bash_result("exit: 1\nfail"), "exit 1");
        assert_eq!(
            summarize_bash_result("ERROR: el comando falló (exit 2): x"),
            "falló (exit 2)"
        );
    }

    #[test]
    fn test_parse_skill_frontmatter() {
        let raw = "---\nname: test-skill\ndescription: does things\n---\nbody here";
        let (name, desc, body) = parse_skill_frontmatter(raw).unwrap();
        assert_eq!(name, "test-skill");
        assert_eq!(desc, "does things");
        assert_eq!(body, "body here");
    }

    #[test]
    fn test_parse_skill_heading_format() {
        let raw = "# Skill: mi-skill\n\nInstrucciones";
        let (name, _desc, body) = parse_skill_frontmatter(raw).unwrap();
        assert_eq!(name, "mi-skill");
        assert!(body.contains("Instrucciones"));
    }

    #[test]
    fn test_spill_output_writes_full_content() {
        let full = "line\n".repeat(5000);
        let out = spill_output("grep", &full, "truncated".into());
        assert!(out.contains("truncated"));
        assert!(out.contains("makora_truncated"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_bat_script_preserves_inner_quotes() {
        let p = write_bat_script("node -e \"console.log('hi')\"").unwrap();
        let content = std::fs::read_to_string(&p).unwrap();
        assert!(content.contains("node -e \"console.log('hi')\""));
        assert!(content.contains("chcp 65001"));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn test_evict_tool_results_keeps_last_six_raw() {
        let mut msgs: Vec<ChatMessage> = Vec::new();
        for i in 0..10 {
            msgs.push(ChatMessage {
                role: "tool".into(),
                content: format!("archivo escrito: /x/f{i}.rs\nmuchas líneas de contenido"),
                images: vec![],
                tool_calls: None,
                tool_call_id: Some(format!("c{i}")),
                reasoning: None,
            });
        }
        let out = evict_tool_results(&msgs);
        // Los 6 últimos quedan crudos (índices 4..=9); los 4 primeros se resumen.
        assert!(out[9].content.starts_with("archivo escrito:"));
        assert!(out[4].content.starts_with("archivo escrito:"));
        assert!(out[3].content.starts_with("[archivo escrito:"));
        assert!(out[0].content.starts_with("[archivo escrito:"));
        assert!(out[0].content.len() < msgs[0].content.len());
    }

    #[test]
    fn test_summarize_old_tool_result() {
        assert!(summarize_old_tool_result("archivo escrito: /x/a.rs\nbody").starts_with("[archivo escrito:"));
        assert!(summarize_old_tool_result("ERROR: no existe").contains("con error"));
        assert!(summarize_old_tool_result("exit: 0\nhola\nadios").contains("Comando previo"));
        assert!(summarize_old_tool_result("a\nb\nc").contains("Resultado previo de herramienta"));
    }
}
