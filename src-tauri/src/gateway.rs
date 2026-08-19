use std::collections::BTreeMap;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_specta::Event;

use crate::{ChatConfig, ChatDeltaEvent, ChatMessage, ChatUsage, ToolCall};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingDelta {
    pub chat_id: String,
    pub text: String,
}

pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

pub struct TurnOutcome {
    pub usage: ChatUsage,
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
}

pub static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(45))
        .timeout(std::time::Duration::from_secs(900))
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default()
});

async fn for_each_sse_event<F>(response: reqwest::Response, chat_id: &str, mut f: F)
where
    F: FnMut(&str, &str),
{
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut raw_bytes: Vec<u8> = Vec::with_capacity(8192);
    while let Some(chunk) = stream.next().await {
        if crate::agent::is_chat_cancelled(chat_id) {
            break;
        }
        if let Ok(c) = chunk {
            raw_bytes.extend_from_slice(&c);
        }
        while let Some(pos) = raw_bytes.windows(2).position(|w| w == b"\n\n" || w == b"\r\n\r\n") {
            let (delim_len, slice_end) = if raw_bytes[pos..].starts_with(b"\r\n\r\n") {
                (4, pos)
            } else {
                (2, pos)
            };
            let block_bytes: Vec<u8> = raw_bytes.drain(..slice_end + delim_len).collect();
            let block_str = String::from_utf8_lossy(&block_bytes[..slice_end]);
            let mut event = String::new();
            let mut data_lines: Vec<String> = Vec::new();
            for line in block_str.lines() {
                if let Some(r) = line.strip_prefix("event:") {
                    event = r.trim().to_string();
                } else if let Some(r) = line.strip_prefix("data:") {
                    data_lines.push(r.trim().to_string());
                }
            }
            if !data_lines.is_empty() {
                f(&event, &data_lines.join("\n"));
            }
        }
    }
    if !raw_bytes.is_empty() {
        let rest = String::from_utf8_lossy(&raw_bytes).trim().to_string();
        let mut data_lines: Vec<String> = Vec::new();
        for line in rest.lines() {
            if let Some(r) = line.strip_prefix("data:") {
                data_lines.push(r.trim().to_string());
            }
        }
        if !data_lines.is_empty() {
            f("", &data_lines.join("\n"));
        }
    }
}

pub fn parse_tool_args(raw: &str) -> Value {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return json!({});
    }
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        return v;
    }
    let clean = if trimmed.starts_with("```") {
        let lines: Vec<&str> = trimmed.lines().collect();
        if lines.len() >= 2 {
            lines[1..lines.len().saturating_sub(1)].join("\n")
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };
    if let Ok(v) = serde_json::from_str::<Value>(&clean) {
        return v;
    }
    // Handle concatenated stream of JSON objects: e.g. {"pattern":"a"}{"pattern":"b"}
    let mut merged = json!({});
    let mut stream = serde_json::Deserializer::from_str(trimmed).into_iter::<Value>();
    let mut count = 0;
    while let Some(Ok(val)) = stream.next() {
        if let Some(obj) = val.as_object() {
            for (k, v) in obj {
                merged[k] = v.clone();
            }
            count += 1;
        } else if count == 0 {
            return val;
        }
    }
    if count > 0 {
        return merged;
    }
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            if end > start {
                if let Ok(v) = serde_json::from_str::<Value>(&trimmed[start..=end]) {
                    return v;
                }
            }
        }
    }
    json!({})
}

fn to_wire(m: &ChatMessage, cfg: &ChatConfig) -> Value {
    let mut obj = json!({"role": m.role, "content": m.content});
    if !m.images.is_empty() && m.role == "user" {
        if cfg.vision_enabled {
            let mut parts = vec![json!({"type": "text", "text": m.content})];
            for img in &m.images {
                parts.push(json!({"type": "image_url", "image_url": {"url": img}}));
            }
            obj["content"] = json!(parts);
        } else {
            // Provider Shield: modelo de solo texto -> guardar a disco y referenciar
            let mut content = m.content.clone();
            for img in &m.images {
                match save_image_temp(img) {
                    Ok(p) => content.push_str(&format!("\n[Imagen adjunta guardada en: {p}]")),
                    Err(_) => content.push_str("\n[Imagen adjunta: no se pudo guardar]"),
                }
            }
            obj["content"] = json!(content);
        }
    }
    if let Some(tcs) = &m.tool_calls {
        let arr: Vec<Value> = tcs
            .iter()
            .enumerate()
            .map(|(i, tc)| {
                let clean_name = tc.name.replace(':', "_");
                let id = if tc.id.trim().is_empty() {
                    format!("call_{i}")
                } else {
                    tc.id.clone()
                };
                let valid_args = match serde_json::from_str::<Value>(&tc.arguments) {
                    Ok(v) => serde_json::to_string(&v).unwrap_or_else(|_| tc.arguments.clone()),
                    Err(_) => {
                        let parsed = parse_tool_args(&tc.arguments);
                        serde_json::to_string(&parsed).unwrap_or_else(|_| "{}".to_string())
                    }
                };
                let mut tc_obj = json!({
                    "id": id,
                    "type": "function",
                    "function": {"name": clean_name, "arguments": valid_args}
                });
                if let Some(ec) = &tc.extra_content {
                    tc_obj["extra_content"] = ec.clone();
                }
                tc_obj
            })
            .collect();
        obj["tool_calls"] = json!(arr);
        if m.content.trim().is_empty() {
            obj["content"] = Value::Null;
        }
    }
    if let Some(tid) = &m.tool_call_id {
        let id = if tid.trim().is_empty() {
            "call_0".to_string()
        } else {
            tid.clone()
        };
        obj["tool_call_id"] = json!(id);
    }
    if m.role == "tool" && m.content.trim().is_empty() {
        obj["content"] = json!("[sin salida]");
    }
    obj
}

fn is_local_endpoint(base: &str) -> bool {
    let lower = base.to_lowercase();
    lower.contains("localhost")
        || lower.contains("127.0.0.1")
        || lower.contains("[::1]")
        || lower.contains("0.0.0.0")
}

fn norm_effort_openai(e: &str) -> Option<String> {
    match e {
        "minimal" | "low" | "medium" | "high" => Some(e.to_string()),
        _ => None,
    }
}

fn norm_effort_anthropic(e: &str) -> Option<String> {
    match e {
        "minimal" => Some("low".into()),
        "low" | "medium" | "high" => Some(e.into()),
        _ => None,
    }
}

/// Garantiza una secuencia válida para cualquier API OpenAI-compatible:
/// - descarta mensajes `tool` sin `tool_call_id` conocido o huérfanos al inicio;
/// - descarta asistentes vacíos (sin contenido ni tool_calls).
fn sanitize_openai_wire(msgs: Vec<Value>) -> Vec<Value> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut started = false;
    let mut out: Vec<Value> = Vec::with_capacity(msgs.len());
    for m in msgs {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("").to_string();
        match role.as_str() {
            "assistant" => {
                if let Some(tcs) = m.get("tool_calls").and_then(|t| t.as_array()) {
                    for tc in tcs {
                        if let Some(id) = tc.get("id").and_then(|i| i.as_str()) {
                            if !id.is_empty() {
                                seen.insert(id.to_string());
                            }
                        }
                    }
                }
                let has_content = m
                    .get("content")
                    .map(|c| c.as_str().map(|s| !s.trim().is_empty()).unwrap_or(false))
                    .unwrap_or(false);
                let has_tools = m
                    .get("tool_calls")
                    .map(|t| t.as_array().map(|a| !a.is_empty()).unwrap_or(false))
                    .unwrap_or(false);
                if !has_content && !has_tools {
                    continue;
                }
                started = true;
                out.push(m);
            }
            "tool" => {
                let id = m.get("tool_call_id").and_then(|i| i.as_str()).unwrap_or("");
                if !started || id.is_empty() || !seen.contains(id) {
                    continue;
                }
                out.push(m);
            }
            _ => {
                started = true;
                out.push(m);
            }
        }
    }
    out
}

fn format_http_error(status: reqwest::StatusCode, raw_body: &str) -> String {
    let clean = raw_body.trim();
    let detail = if clean.is_empty() {
        "(sin respuesta adicional del servidor)"
    } else {
        clean
    };

    match status.as_u16() {
        401 => format!("Error de Autenticación (401): API Key no válida o revocada. Revisa la clave en Configuración.\nDetalles: {detail}"),
        403 => format!("Acceso Denegado (403): Tu API Key no tiene permisos para acceder a este modelo o región.\nDetalles: {detail}"),
        404 => format!("Modelo no encontrado (404): El identificador de modelo o endpoint no existe en este proveedor.\nDetalles: {detail}"),
        429 => format!("Límite de Cuota o Saldo Agotado (429): Se ha superado el rate limit o tu cuenta no dispone de créditos suficientes.\nDetalles: {detail}"),
        500..=599 => format!("Fallo Temporal del Proveedor ({status}): El servidor de IA experimenta sobrecarga o mantenimiento. Intenta de nuevo en unos instantes.\nDetalles: {detail}"),
        _ => format!("HTTP {status}: {detail}"),
    }
}

pub async fn openai_turn(
    app: &AppHandle,
    cfg: &ChatConfig,
    chat_id: &str,
    system: &str,
    messages: &[ChatMessage],
    tools: &[ToolDef],
) -> Result<TurnOutcome, String> {
    let base = cfg.base_url.trim_end_matches('/');
    let url = format!("{base}/chat/completions");

    let mut msgs: Vec<Value> = Vec::new();
    if !system.trim().is_empty() {
        msgs.push(json!({"role": "system", "content": system}));
    }
    for m in messages.iter() {
        msgs.push(to_wire(m, cfg));
    }
    let msgs = sanitize_openai_wire(msgs);

    let mut model_name = cfg.model.trim_start_matches("models/");
    let is_gemini = cfg.base_url.contains("googleapis.com") || model_name.starts_with("gemini");
    if is_gemini {
        model_name = match model_name {
            "gemini-2.5-flash" | "gemini-2.0-flash" | "gemini-1.5-flash" => "gemini-3.7-flash",
            "gemini-2.5-pro" | "gemini-2.0-pro" | "gemini-1.5-pro" => "gemini-3.1-pro-preview",
            other => other,
        };
    }
    let mut body = json!({
        "model": model_name,
        "messages": msgs,
        "stream": true,
    });
    let local = is_local_endpoint(&base);
    if !is_gemini && !local {
        body["stream_options"] = json!({ "include_usage": true });
        if let Some(e) = &cfg.reasoning_effort {
            if let Some(eff) = norm_effort_openai(e) {
                body["reasoning_effort"] = json!(eff);
            }
        }
    }
    if let Some(t) = cfg.max_output_tokens {
        body["max_tokens"] = json!(t);
    }
    if let Some(t) = cfg.temperature {
        body["temperature"] = json!(t);
    }
    if !tools.is_empty() {
        let arr: Vec<Value> = tools
            .iter()
            .map(|t| {
                let clean_name = t.name.replace(':', "_");
                json!({
                    "type": "function",
                    "function": {
                        "name": clean_name,
                        "description": t.description,
                        "parameters": t.parameters
                    }
                })
            })
            .collect();
        body["tools"] = json!(arr);
        body["tool_choice"] = json!("auto");
    }

    let client = &*HTTP_CLIENT;
    let api_key = cfg.api_key.trim();
    let mut req = client.post(&url).bearer_auth(api_key).json(&body);
    if is_gemini {
        req = req.header("x-goog-api-key", api_key);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format_http_error(status, &text));
    }

    let mut usage = ChatUsage::default();
    let mut text = String::new();
    let mut output_chars = 0usize;
    let mut tcs: BTreeMap<u32, (String, String, String, Option<Value>)> = BTreeMap::new();
    let mut global_extra_content: Option<Value> = None;

    for_each_sse_event(resp, chat_id, |_event, data| {
        if data == "[DONE]" {
            return;
        }
        let v: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return,
        };
        if let Some(choices) = v.get("choices").and_then(|c| c.as_array()) {
            if let Some(delta) = choices.first().and_then(|c| c.get("delta")) {
                if let Some(ec) = delta.get("extra_content") {
                    global_extra_content = Some(ec.clone());
                }
                if let Some(rc) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
                    if !rc.is_empty() {
                        let _ = app.emit(
                            "thinking-delta",
                            ThinkingDelta {
                                chat_id: chat_id.to_string(),
                                text: rc.to_string(),
                            },
                        );
                    }
                }
                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                    if !content.is_empty() {
                        text.push_str(content);
                        let _ = ChatDeltaEvent {
                            chat_id: chat_id.to_string(),
                            text: content.to_string(),
                        }
                        .emit(app);
                        output_chars += content.len();
                    }
                }
                if let Some(calls) = delta.get("tool_calls").and_then(|c| c.as_array()) {
                    for call in calls {
                        let idx = match call.get("index").and_then(|i| i.as_u64()) {
                            Some(i) => i as u32,
                            None => {
                                if let Some(id) = call.get("id").and_then(|i| i.as_str()) {
                                    if let Some((&k, _)) = tcs.iter().find(|(_, v)| v.0 == id) {
                                        k
                                    } else if tcs.is_empty() {
                                        0
                                    } else {
                                        tcs.keys().max().map(|m| m + 1).unwrap_or(0)
                                    }
                                } else {
                                    tcs.keys().max().copied().unwrap_or(0)
                                }
                            }
                        };
                        let entry = tcs
                            .entry(idx)
                            .or_insert_with(|| (String::new(), String::new(), String::new(), None));
                        if let Some(id) = call.get("id").and_then(|i| i.as_str()) {
                            if !id.is_empty() {
                                entry.0 = id.to_string();
                            }
                        }
                        if let Some(f) = call.get("function") {
                            if let Some(n) = f.get("name").and_then(|x| x.as_str()) {
                                if !n.is_empty() {
                                    entry.1 = n.to_string();
                                }
                            }
                            if let Some(a) = f.get("arguments").and_then(|x| x.as_str()) {
                                entry.2.push_str(a);
                            }
                        }
                        if let Some(ec) = call.get("extra_content").or(global_extra_content.as_ref()) {
                            entry.3 = Some(ec.clone());
                        }
                    }
                }
            }
        }
        if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
            usage.input_tokens =
                u.get("prompt_tokens").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
            usage.output_tokens =
                u.get("completion_tokens").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
            let cached = u
                .get("prompt_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .and_then(|x| x.as_u64())
                .or_else(|| u.get("prompt_cache_hit_tokens").and_then(|x| x.as_u64()))
                .unwrap_or(0);
            usage.cached_tokens = cached as u32;
        }
    })
    .await;

    if usage.output_tokens == 0 && output_chars > 0 {
        usage.output_tokens = (output_chars / 4).max(1) as u32;
    }
    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut tool_calls: Vec<ToolCall> = tcs
        .into_values()
        .enumerate()
        .map(|(i, (mut id, name, arguments, mut extra_content))| {
            if id.trim().is_empty() {
                id = format!("call_{i}_{now_ts}");
            }
            if extra_content.is_none() {
                extra_content = global_extra_content.clone();
            }
            ToolCall {
                id,
                name,
                arguments,
                extra_content,
            }
        })
        .collect();

    // Sanitize text and extract embedded DSML / XML tool calls (e.g. DeepSeek V3/R1 text outputs)
    sanitize_and_extract_embedded_tool_calls(&mut text, &mut tool_calls, now_ts);

    Ok(TurnOutcome {
        usage,
        text,
        tool_calls,
    })
}

static RE_INVOKE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r#"(?s)<\s*(?:\|\s*DSML\s*\|\s*)?invoke\s+name=["']([^"']+)["']\s*>(.*?)<\s*/\s*(?:\|\s*DSML\s*\|\s*)?invoke\s*>"#).unwrap()
});

static RE_PARAM: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r#"(?s)<\s*(?:\|\s*DSML\s*\|\s*)?parameter\s+name=["']([^"']+)["'][^>]*>(.*?)<\s*/\s*(?:\|\s*DSML\s*\|\s*)?parameter\s*>"#).unwrap()
});

static RE_TAG_JSON: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r#"(?s)<\s*tool_calls?\s*>(.*?)<\s*/\s*tool_calls?\s*>"#).unwrap()
});

static RE_CLEAN_TOOL_CALLS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r#"(?s)<\s*(?:\|\s*DSML\s*\|\s*)?tool_calls?\s*>.*?<\s*/\s*(?:\|\s*DSML\s*\|\s*)?tool_calls?\s*>"#).unwrap()
});

static RE_CLEAN_INVOKE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r#"(?s)<\s*(?:\|\s*DSML\s*\|\s*)?invoke.*?<\s*/\s*(?:\|\s*DSML\s*\|\s*)?invoke\s*>"#).unwrap()
});

static RE_CLEAN_STRAY_TAGS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r#"<\s*/?\s*(?:\|\s*DSML\s*\|\s*)?(?:tool_calls?|invoke|parameter|DSML).*?>"#).unwrap()
});

fn sanitize_and_extract_embedded_tool_calls(
    text: &mut String,
    tool_calls: &mut Vec<ToolCall>,
    now_ts: u128,
) {
    if text.contains("DSML")
        || text.contains("invoke")
        || text.contains("tool_call")
        || text.contains("tool_calls")
        || text.contains("<parameter")
    {
        // 1. Extract DSML and standard XML invoke tags (<invoke name="...">...)
        for cap in RE_INVOKE.captures_iter(text) {
            let name = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("").to_string();
            let body = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let mut args_map = serde_json::Map::new();
            for p_cap in RE_PARAM.captures_iter(body) {
                let p_name = p_cap.get(1).map(|m| m.as_str().trim()).unwrap_or("").to_string();
                let p_val = p_cap.get(2).map(|m| m.as_str().trim()).unwrap_or("").to_string();
                args_map.insert(p_name, Value::String(p_val));
            }
            let args_str = Value::Object(args_map).to_string();
            if !name.is_empty() {
                let id = format!("call_xml_{}_{now_ts}", tool_calls.len());
                tool_calls.push(ToolCall {
                    id,
                    name,
                    arguments: args_str,
                    extra_content: None,
                });
            }
        }

        // 2. Extract <tool_call> / <tool_calls> JSON format
        for cap in RE_TAG_JSON.captures_iter(text) {
            if let Some(body) = cap.get(1) {
                let trimmed = body.as_str().trim();
                if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                    if let Some(arr) = v.as_array() {
                        for item in arr {
                            if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                                let arguments = if let Some(args) = item.get("arguments") {
                                    if args.is_string() {
                                        args.as_str().unwrap().to_string()
                                    } else {
                                        args.to_string()
                                    }
                                } else {
                                    "{}".to_string()
                                };
                                let id = format!("call_tag_{}_{now_ts}", tool_calls.len());
                                tool_calls.push(ToolCall {
                                    id,
                                    name: name.to_string(),
                                    arguments,
                                    extra_content: None,
                                });
                            }
                        }
                    } else if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                        let arguments = if let Some(args) = v.get("arguments") {
                            if args.is_string() {
                                args.as_str().unwrap().to_string()
                            } else {
                                args.to_string()
                            }
                        } else {
                            "{}".to_string()
                        };
                        let id = format!("call_tag_{}_{now_ts}", tool_calls.len());
                        tool_calls.push(ToolCall {
                            id,
                            name: name.to_string(),
                            arguments,
                            extra_content: None,
                        });
                    }
                }
            }
        }

        // 3. Clean all DSML, XML, & tool_call tags from user-facing text
        let mut cleaned = RE_CLEAN_TOOL_CALLS.replace_all(text, "").to_string();
        cleaned = RE_CLEAN_INVOKE.replace_all(&cleaned, "").to_string();
        cleaned = RE_CLEAN_STRAY_TAGS.replace_all(&cleaned, "").to_string();
        *text = cleaned.trim().to_string();
    }
}

fn parse_data_url(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    let media_type = meta.split(';').next().unwrap_or("image/png").to_string();
    Some((media_type, data.to_string()))
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for c in s.bytes() {
        if c == b'=' {
            break;
        }
        if c == b'\n' || c == b'\r' {
            continue;
        }
        let v = TABLE
            .iter()
            .position(|&x| x == c)
            .ok_or("carácter base64 inválido")? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

static IMG_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn save_image_temp(data_url: &str) -> Result<String, String> {
    let (media_type, b64) = parse_data_url(data_url).ok_or("data url inválida")?;
    let ext = media_type.split('/').nth(1).unwrap_or("png");
    let dir = std::env::temp_dir().join("makora_attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = IMG_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let name = format!("image_{}_{}.{}", std::process::id(), id, ext);
    let path = dir.join(&name);
    let bytes = base64_decode(&b64)?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub async fn anthropic_turn(
    app: &AppHandle,
    cfg: &ChatConfig,
    chat_id: &str,
    system: &str,
    messages: &[ChatMessage],
    tools: &[ToolDef],
) -> Result<TurnOutcome, String> {
    let base = cfg.base_url.trim_end_matches('/');
    let url = format!("{base}/messages");

    struct AntMsg {
        role: String,
        blocks: Vec<Value>,
    }

    let mut raw: Vec<AntMsg> = Vec::new();
    let mut known_tool_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for m in messages.iter() {
        match m.role.as_str() {
            "user" => {
                let mut blocks: Vec<Value> = Vec::new();
                if !m.images.is_empty() {
                    if cfg.vision_enabled {
                        for img in &m.images {
                            if let Some((media_type, data)) = parse_data_url(img) {
                                blocks.push(json!({
                                    "type": "image",
                                    "source": {"type": "base64", "media_type": media_type, "data": data}
                                }));
                            }
                        }
                    } else {
                        let mut content = m.content.clone();
                        for img in &m.images {
                            match save_image_temp(img) {
                                Ok(p) => content.push_str(&format!(
                                    "\n[Imagen adjunta guardada en: {p}]"
                                )),
                                Err(_) => content.push_str("\n[Imagen adjunta: no se pudo guardar]"),
                            }
                        }
                        blocks.push(json!({"type": "text", "text": content}));
                    }
                }
                if !m.content.trim().is_empty() {
                    blocks.push(json!({"type": "text", "text": m.content}));
                }
                if blocks.is_empty() {
                    blocks.push(json!({"type": "text", "text": "[sin contenido]"}));
                }
                raw.push(AntMsg {
                    role: "user".into(),
                    blocks,
                });
            }
            "assistant" => {
                let mut blocks: Vec<Value> = Vec::new();
                if !m.content.trim().is_empty() {
                    blocks.push(json!({"type": "text", "text": m.content}));
                }
                if let Some(tcs) = &m.tool_calls {
                    for (i, tc) in tcs.iter().enumerate() {
                        let id = if tc.id.trim().is_empty() {
                            format!("call_{i}")
                        } else {
                            tc.id.clone()
                        };
                        known_tool_ids.insert(id.clone());
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": id,
                            "name": tc.name,
                            "input": parse_tool_args(&tc.arguments)
                        }));
                    }
                }
                if blocks.is_empty() {
                    continue;
                }
                raw.push(AntMsg {
                    role: "assistant".into(),
                    blocks,
                });
            }
            "tool" => {
                let id = m.tool_call_id.clone().unwrap_or_default();
                if id.trim().is_empty() || !known_tool_ids.contains(&id) {
                    continue;
                }
                let content = if m.content.trim().is_empty() {
                    "[sin salida]".to_string()
                } else {
                    m.content.clone()
                };
                let block = json!({"type": "tool_result", "tool_use_id": id, "content": content});
                match raw.last_mut() {
                    Some(last) if last.role == "user" => last.blocks.push(block),
                    _ => raw.push(AntMsg {
                        role: "user".into(),
                        blocks: vec![block],
                    }),
                }
            }
            _ => {}
        }
    }

    while let Some(first) = raw.first() {
        if first.role == "user" {
            break;
        }
        raw.remove(0);
    }
    let mut merged: Vec<AntMsg> = Vec::new();
    for m in raw {
        if let Some(last) = merged.last_mut() {
            if last.role == m.role {
                last.blocks.extend(m.blocks);
                continue;
            }
        }
        merged.push(m);
    }
    let msgs: Vec<Value> = merged
        .into_iter()
        .map(|m| json!({"role": m.role, "content": m.blocks}))
        .collect();

    let mut body = json!({
        "model": cfg.model,
        "stream": true,
        "messages": msgs
    });
    if !system.trim().is_empty() {
        // Prefijo estable + breakpoint de caché explícito (M4):
        // el system prompt va siempre primero y con cache_control ephemeral.
        body["system"] = json!([{
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"}
        }]);
    }
    body["max_tokens"] = json!(cfg.max_output_tokens.unwrap_or(4096));
    if let Some(t) = cfg.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(e) = &cfg.reasoning_effort {
        if let Some(eff) = norm_effort_anthropic(e) {
            let model_lower = cfg.model.to_lowercase();
            let supports_adaptive = model_lower.contains("4-7")
                || model_lower.contains("4.7")
                || model_lower.contains("opus-4")
                || model_lower.contains("sonnet-4")
                || model_lower.contains("haiku-4");
            if supports_adaptive {
                body["thinking"] = json!({"type": "adaptive"});
                body["output_config"] = json!({"effort": eff});
            } else {
                body["thinking"] = json!({"type": "enabled", "budget_tokens": 2048});
            }
        }
    }
    if !tools.is_empty() {
        let mut arr: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters
                })
            })
            .collect();
        // Breakpoint de caché al final del bloque de herramientas (prefijo estable).
        if let Some(last) = arr.last_mut() {
            last["cache_control"] = json!({"type": "ephemeral"});
        }
        body["tools"] = json!(arr);
        body["tool_choice"] = json!({"type": "auto"});
    }

    let client = &*HTTP_CLIENT;
    let resp = client
        .post(&url)
        .header("x-api-key", &cfg.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format_http_error(status, &text));
    }

    let mut usage = ChatUsage::default();
    let mut text = String::new();
    let mut output_chars = 0usize;
    let mut tool_blocks: Vec<(String, String, String)> = Vec::new();

    for_each_sse_event(resp, chat_id, |_event, data| {
        let v: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return,
        };
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match t {
            "message_start" => {
                if let Some(msg) = v.get("message") {
                    if let Some(u) = msg.get("usage") {
                        usage.input_tokens =
                            u.get("input_tokens").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                        usage.cached_tokens = u
                            .get("cache_read_input_tokens")
                            .and_then(|x| x.as_u64())
                            .unwrap_or(0) as u32;
                    }
                }
            }
            "content_block_start" => {
                if let Some(cb) = v.get("content_block") {
                    let cbt = cb.get("type").and_then(|x| x.as_str()).unwrap_or("");
                    if cbt == "tool_use" {
                        let id = cb.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                        let name = cb
                            .get("name")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string();
                        tool_blocks.push((id, name, String::new()));
                    }
                }
            }
            "content_block_delta" => {
                if let Some(delta) = v.get("delta") {
                    let dt = delta.get("type").and_then(|x| x.as_str()).unwrap_or("");
                    if dt == "text_delta" {
                        if let Some(t) = delta.get("text").and_then(|x| x.as_str()) {
                            text.push_str(t);
                            let _ = ChatDeltaEvent {
                                chat_id: chat_id.to_string(),
                                text: t.to_string(),
                            }
                            .emit(app);
                            output_chars += t.len();
                        }
                    } else if dt == "thinking_delta" {
                        if let Some(t) = delta.get("thinking").and_then(|x| x.as_str()) {
                            let _ = app.emit(
                                "thinking-delta",
                                ThinkingDelta {
                                    chat_id: chat_id.to_string(),
                                    text: t.to_string(),
                                },
                            );
                        }
                    } else if dt == "input_json_delta" {
                        if let Some(p) = delta.get("partial_json").and_then(|x| x.as_str()) {
                            if let Some(last) = tool_blocks.last_mut() {
                                last.2.push_str(p);
                            }
                        }
                    }
                }
            }
            "message_delta" => {
                if let Some(u) = v.get("usage") {
                    usage.output_tokens =
                        u.get("output_tokens").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                }
            }
            _ => {}
        }
    })
    .await;

    if usage.output_tokens == 0 && output_chars > 0 {
        usage.output_tokens = (output_chars / 4).max(1) as u32;
    }
    let tool_calls: Vec<ToolCall> = tool_blocks
        .into_iter()
        .map(|(id, name, arguments)| ToolCall {
            id,
            name,
            arguments,
            extra_content: None,
        })
        .collect();
    Ok(TurnOutcome {
        usage,
        text,
        tool_calls,
    })
}

pub async fn fetch_models(cfg: &ChatConfig) -> Result<Vec<String>, String> {
    let client = &*HTTP_CLIENT;
    let api_key = cfg.api_key.trim();
    match cfg.kind.as_str() {
        "anthropic" => {
            let url = format!("{}/models", cfg.base_url.trim_end_matches('/'));
            let resp = client
                .get(&url)
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = resp.status();
            let body: Value = resp.json().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                return Err(format!("HTTP {status}: {body}"));
            }
            Ok(extract_ids(&body))
        }
        "ollama" => {
            let base = cfg.base_url.trim_end_matches('/').trim_end_matches("/v1");
            let url = format!("{base}/api/tags");
            let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
            let status = resp.status();
            let body: Value = resp.json().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                return Err(format!("HTTP {status}: {body}"));
            }
            Ok(body
                .get("models")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("name").and_then(|x| x.as_str()).map(String::from))
                        .collect()
                })
                .unwrap_or_default())
        }
        _ => {
            let url = format!("{}/models", cfg.base_url.trim_end_matches('/'));
            let is_gemini = cfg.base_url.contains("googleapis.com");
            let mut req = client.get(&url).bearer_auth(api_key);
            if is_gemini {
                req = req.header("x-goog-api-key", api_key);
            }
            let resp = req.send().await.map_err(|e| format!("No se pudo conectar con el endpoint ({url}): {e}"))?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(format!("HTTP {status}: {text}"));
            }
            let body: Value = serde_json::from_str(&text)
                .map_err(|_| format!("Respuesta no es JSON válido: {text}"))?;
            let mut ids = extract_ids(&body);
            if ids.is_empty() {
                if let Some(arr) = body.get("models").and_then(|m| m.as_array()) {
                    ids = arr
                        .iter()
                        .filter_map(|m| {
                            m.get("name")
                                .or_else(|| m.get("id"))
                                .and_then(|x| x.as_str())
                                .map(|s| s.trim_start_matches("models/").to_string())
                        })
                        .collect();
                }
            }
            Ok(ids)
        }
    }
}

fn extract_ids(body: &Value) -> Vec<String> {
    body.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    m.get("id")
                        .and_then(|x| x.as_str())
                        .map(|s| s.trim_start_matches("models/").to_string())
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_wire_preserves_extra_content_for_gemini() {
        let cfg = ChatConfig {
            kind: "openai".into(),
            base_url: "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            model: "gemini-3.7-flash".into(),
            api_key: "dummy".into(),
            reasoning_effort: None,
            max_output_tokens: None,
            temperature: None,
            vision_enabled: false,
            context_window: None,
        };
        let msg = ChatMessage {
            role: "assistant".into(),
            content: "".into(),
            images: vec![],
            tool_calls: Some(vec![ToolCall {
                id: "call_123".into(),
                name: "read_file".into(),
                arguments: "{\"path\":\"foo.rs\"}".into(),
                extra_content: Some(json!({
                    "google": {
                        "thought_signature": "signature_abc_123"
                    }
                })),
            }]),
            tool_call_id: None,
        };

        let wire = to_wire(&msg, &cfg);
        assert_eq!(wire["role"], "assistant");
        let tcs = wire["tool_calls"].as_array().expect("tool_calls array");
        assert_eq!(tcs.len(), 1);
        assert_eq!(
            tcs[0]["extra_content"]["google"]["thought_signature"],
            "signature_abc_123"
        );
        assert_eq!(tcs[0]["function"]["name"], "read_file");
    }

    #[test]
    fn test_extract_ids_strips_models_prefix() {
        let body = json!({
            "data": [
                { "id": "models/gemini-3.7-flash" },
                { "id": "models/gemini-3.6-flash" },
                { "id": "deepseek-chat" }
            ]
        });
        let ids = extract_ids(&body);
        assert_eq!(ids, vec!["gemini-3.7-flash", "gemini-3.6-flash", "deepseek-chat"]);
    }

    #[test]
    fn test_sanitize_and_extract_embedded_dsml_tool_calls() {
        let mut text = "Voy a inspeccionar el estado del repositorio... < | DSML | tool_calls > < | DSML | invoke name=\"bash\" > < | DSML | parameter name=\"command\" string=\"true\">python _deploy_vps.py build 2>&1</ | DSML | parameter > </ | DSML | invoke > </ | DSML | tool_calls >".to_string();
        let mut tool_calls = Vec::new();
        sanitize_and_extract_embedded_tool_calls(&mut text, &mut tool_calls, 123456);

        assert_eq!(text, "Voy a inspeccionar el estado del repositorio...");
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].name, "bash");
        let args: Value = serde_json::from_str(&tool_calls[0].arguments).unwrap();
        assert_eq!(args["command"], "python _deploy_vps.py build 2>&1");
    }

    #[test]
    fn test_sanitize_and_extract_standard_xml_tool_calls() {
        let mut text = "<tool_calls> <invoke name=\"bash\"> <parameter name=\"command\" string=\"true\">git -C \"C:\\Users\\lewis\\Projects\\makora-ide\" status --short && git -C \"C:\\Users\\lewis\\Projects\\makora-ide\" diff --stat</parameter> <parameter name=\"description\" string=\"true\">Inspect working tree changes</parameter> </invoke> </tool_calls>".to_string();
        let mut tool_calls = Vec::new();
        sanitize_and_extract_embedded_tool_calls(&mut text, &mut tool_calls, 987654);

        assert_eq!(text, "");
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].name, "bash");
        let args: Value = serde_json::from_str(&tool_calls[0].arguments).unwrap();
        assert_eq!(
            args["command"],
            "git -C \"C:\\Users\\lewis\\Projects\\makora-ide\" status --short && git -C \"C:\\Users\\lewis\\Projects\\makora-ide\" diff --stat"
        );
        assert_eq!(args["description"], "Inspect working tree changes");
    }
}

