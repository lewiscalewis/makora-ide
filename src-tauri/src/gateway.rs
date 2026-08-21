use std::collections::BTreeMap;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_specta::Event;

use crate::{ChatConfig, ChatDeltaEvent, ChatMessage, ChatTextFinal, ChatUsage, ToolCall};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingDelta {
    pub chat_id: String,
    pub text: String,
}

#[derive(Clone)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

pub struct TurnOutcome {
    pub usage: ChatUsage,
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub reasoning: String,
}

pub static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(45))
        .timeout(std::time::Duration::from_secs(900))
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .build()
        .unwrap_or_else(|e| {
            eprintln!("[HTTP_CLIENT] Fallo en configuraciÃ³n avanzada: {e}, usando cliente seguro con timeout");
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(900))
                .build()
                .unwrap_or_default()
        })
});

pub fn find_sse_boundary(bytes: &[u8]) -> Option<(usize, usize)> {
    let len = bytes.len();
    if len < 2 {
        return None;
    }
    for i in 0..len - 1 {
        if bytes[i] == b'\n' && bytes[i + 1] == b'\n' {
            return Some((i, 2));
        }
        if bytes[i] == b'\r' {
            if i + 3 < len && &bytes[i..i + 4] == b"\r\n\r\n" {
                return Some((i, 4));
            }
            if bytes[i + 1] == b'\r' {
                return Some((i, 2));
            }
        }
    }
    None
}

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
        while let Some((slice_end, delim_len)) = find_sse_boundary(&raw_bytes) {
            let total_drain = slice_end.saturating_add(delim_len);
            if total_drain > raw_bytes.len() {
                break;
            }
            let block_bytes: Vec<u8> = raw_bytes.drain(..total_drain).collect();
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
    // opencode transform.ts: DeepSeek exige reasoning en TODOS los assistant
    // (se envÃ­a vacÃ­o si no hay, para evitar el 400 en multi-turno).
    if m.role == "assistant" && requires_reasoning_echo(cfg) {
        obj["reasoning_content"] = json!(m.reasoning.as_deref().unwrap_or(""));
    }
    if m.role == "tool" && m.content.trim().is_empty() {
        obj["content"] = json!("[sin salida]");
    }
    obj
}

fn requires_reasoning_echo(cfg: &ChatConfig) -> bool {
    let m = cfg.model.to_lowercase();
    let b = cfg.base_url.to_lowercase();
    m.contains("deepseek") || m.contains("reasoner") || b.contains("deepseek") || b.contains("openrouter")
}

fn scrub_tool_id(id: &str) -> String {
    let s: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    if s.trim_matches('_').is_empty() {
        "call_0".to_string()
    } else {
        s
    }
}

fn mistral_tool_id(id: &str) -> String {
    let s: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).take(9).collect();
    format!("{s:0<9}")
}

fn is_mistral(cfg: &ChatConfig) -> bool {
    let m = cfg.model.to_lowercase();
    let b = cfg.base_url.to_lowercase();
    m.contains("mistral") || m.contains("pixtral") || b.contains("mistral")
}

fn fix_mistral_wire(msgs: Vec<Value>) -> Vec<Value> {
    let mut msgs: Vec<Value> = msgs
        .into_iter()
        .map(|mut m| {
            if m.get("role").and_then(|r| r.as_str()) == Some("assistant") {
                if let Some(arr) = m.get_mut("tool_calls").and_then(|t| t.as_array_mut()) {
                    for tc in arr.iter_mut() {
                        if let Some(id) = tc.get("id").and_then(|i| i.as_str()) {
                            tc["id"] = json!(mistral_tool_id(id));
                        }
                    }
                }
            }
            if m.get("role").and_then(|r| r.as_str()) == Some("tool") {
                if let Some(id) = m.get("tool_call_id").and_then(|i| i.as_str()) {
                    m["tool_call_id"] = json!(mistral_tool_id(id));
                }
            }
            m
        })
        .collect();
    let mut out: Vec<Value> = Vec::with_capacity(msgs.len() + 4);
    for i in 0..msgs.len() {
        out.push(msgs[i].clone());
        let cur_role = msgs[i].get("role").and_then(|r| r.as_str());
        let next_role = msgs
            .get(i + 1)
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str());
        if cur_role == Some("tool") && next_role == Some("user") {
            out.push(json!({"role": "assistant", "content": "Done."}));
        }
    }
    out
}

fn ensure_schema_types(value: &mut Value) {
    match value {
        Value::Bool(_) => {
            *value = json!({"type": "string"});
        }
        Value::Object(map) => {
            let looks_like_schema = map.contains_key("type")
                || map.contains_key("properties")
                || map.contains_key("items")
                || map.contains_key("enum")
                || map.contains_key("description")
                || map.contains_key("required")
                || map.contains_key("anyOf")
                || map.contains_key("oneOf")
                || map.contains_key("allOf")
                || map.contains_key("$ref")
                || map.contains_key("minimum")
                || map.contains_key("maximum")
                || map.is_empty();
            if !looks_like_schema {
                return;
            }
            let has_type = map.contains_key("type")
                || map.contains_key("$ref")
                || map.contains_key("anyOf")
                || map.contains_key("oneOf")
                || map.contains_key("allOf");
            if !has_type {
                if map.contains_key("properties") || map.contains_key("required") {
                    map.insert("type".into(), json!("object"));
                } else if map.contains_key("items") {
                    map.insert("type".into(), json!("array"));
                } else if map.contains_key("enum") {
                    map.insert("type".into(), json!("string"));
                } else if map.contains_key("minimum") || map.contains_key("maximum") {
                    map.insert("type".into(), json!("number"));
                } else {
                    map.insert("type".into(), json!("string"));
                }
            }
            if let Some(props) = map.get_mut("properties") {
                if let Value::Object(pm) = props {
                    let keys: Vec<String> = pm.keys().cloned().collect();
                    for k in keys {
                        if let Some(child) = pm.get_mut(&k) {
                            ensure_schema_types(child);
                        }
                    }
                }
            }
            if let Some(ap) = map.get_mut("additionalProperties") {
                if ap.is_object() {
                    ensure_schema_types(ap);
                }
            }
            if let Some(it) = map.get_mut("items") {
                ensure_schema_types(it);
            }
            for comb in ["anyOf", "oneOf", "allOf"] {
                if let Some(arr) = map.get_mut(comb) {
                    if let Value::Array(a) = arr {
                        for item in a.iter_mut() {
                            ensure_schema_types(item);
                        }
                    }
                }
            }
            for def in ["$defs", "definitions"] {
                if let Some(defs) = map.get_mut(def) {
                    if let Value::Object(dm) = defs {
                        let keys: Vec<String> = dm.keys().cloned().collect();
                        for k in keys {
                            if let Some(child) = dm.get_mut(&k) {
                                ensure_schema_types(child);
                            }
                        }
                    }
                }
            }
        }
        Value::Array(arr) => {
            for item in arr.iter_mut() {
                ensure_schema_types(item);
            }
        }
        _ => {}
    }
}

fn requires_openai_schema_sanitize(cfg: &ChatConfig) -> bool {
    let m = cfg.model.to_lowercase();
    let b = cfg.base_url.to_lowercase();
    m.contains("gpt") || m.contains("o1") || m.contains("o3") || b.contains("openai.com")
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

fn classify_http_error(status: reqwest::StatusCode, raw_body: &str) -> String {
    let clean = raw_body.trim();
    let detail = if clean.is_empty() {
        "(sin respuesta adicional del servidor)"
    } else {
        clean
    };

    match status.as_u16() {
        401 => format!("Error de AutenticaciÃ³n (401): API Key no vÃ¡lida o revocada. Revisa la clave en ConfiguraciÃ³n.\nDetalles: {detail}"),
        403 => format!("Acceso Denegado (403): Tu API Key no tiene permisos para acceder a este modelo o regiÃ³n.\nDetalles: {detail}"),
        404 => format!("Modelo no encontrado (404): El identificador de modelo o endpoint no existe en este proveedor.\nDetalles: {detail}"),
        429 => format!("LÃ­mite de Cuota o Saldo Agotado (429): Se ha superado el rate limit o tu cuenta no dispone de crÃ©ditos suficientes.\nDetalles: {detail}"),
        500..=599 => format!("Fallo Temporal del Proveedor ({status}): El servidor de IA experimenta sobrecarga o mantenimiento. Intenta de nuevo en unos instantes.\nDetalles: {detail}"),
        _ => format!("HTTP {status}: {detail}"),
    }
}


fn format_http_error(status: reqwest::StatusCode, raw_body: &str) -> String {
    classify_http_error(status, raw_body)
}

fn is_retryable_status(status: u16, body: &str) -> bool {
    if status == 429 {
        let lower = body.to_lowercase();
        let exhausted = ["balance", "insufficient", "billing", "quota", "credit"]
            .iter()
            .any(|k| lower.contains(k));
        return !exhausted;
    }
    status == 408 || (500..=599).contains(&status)
}

async fn sleep_backoff(
    attempt: u32,
    retry_after: Option<std::time::Duration>,
    chat_id: &str,
) -> Result<(), String> {
    let base = 750u64;
    let exp = 1u64 << attempt.min(4);
    let jitter = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 % 500)
        .unwrap_or(0);
    let mut delay = std::time::Duration::from_millis(base * exp + jitter);
    if let Some(ra) = retry_after {
        delay = delay.max(ra).min(std::time::Duration::from_secs(30));
    }
    tokio::time::sleep(delay).await;
    if crate::agent::is_chat_cancelled(chat_id) {
        return Err("cancelado por el usuario".into());
    }
    Ok(())
}

async fn send_with_retry<F>(chat_id: &str, mut build: F) -> Result<reqwest::Response, String>
where
    F: FnMut() -> reqwest::RequestBuilder,
{
    const MAX_ATTEMPTS: u32 = 3;
    let mut last_err: Option<String> = None;
    for attempt in 0..MAX_ATTEMPTS {
        if crate::agent::is_chat_cancelled(chat_id) {
            return Err("cancelado por el usuario".into());
        }
        let resp = match build().send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = Some(format!("error de red: {e}"));
                if attempt + 1 < MAX_ATTEMPTS {
                    sleep_backoff(attempt, None, chat_id).await?;
                }
                continue;
            }
        };
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        let retry_after = resp
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .map(|s| std::time::Duration::from_secs(s.min(30)));
        let body_text = resp.text().await.unwrap_or_default();
        if is_retryable_status(status.as_u16(), &body_text) && attempt + 1 < MAX_ATTEMPTS {
            last_err = Some(format_http_error(status, &body_text));
            sleep_backoff(attempt, retry_after, chat_id).await?;
            continue;
        }
        return Err(format_http_error(status, &body_text));
    }
    Err(last_err.unwrap_or_else(|| "agotados los reintentos".into()))
}

fn sanitize_openai_wire(msgs: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::with_capacity(msgs.len());
    let mut i = 0;
    let n = msgs.len();

    while i < n {
        let m = &msgs[i];
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");

        if role == "assistant" {
            if let Some(tcs) = m.get("tool_calls").and_then(|t| t.as_array()) {
                if !tcs.is_empty() {
                    let required_ids: Vec<String> = tcs
                        .iter()
                        .filter_map(|tc| tc.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()))
                        .collect();

                    let mut tool_responses: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
                    let mut j = i + 1;
                    while j < n {
                        let next_role = msgs[j].get("role").and_then(|r| r.as_str()).unwrap_or("");
                        if next_role == "tool" {
                            if let Some(tid) = msgs[j].get("tool_call_id").and_then(|id| id.as_str()) {
                                tool_responses.insert(tid.to_string(), msgs[j].clone());
                            }
                            j += 1;
                        } else {
                            break;
                        }
                    }

                    out.push(m.clone());

                    for id in &required_ids {
                        if let Some(resp) = tool_responses.remove(id) {
                            out.push(resp);
                        } else {
                            out.push(json!({
                                "role": "tool",
                                "tool_call_id": id,
                                "content": "[Llamada a herramienta interrumpida o completada previamente]"
                            }));
                        }
                    }

                    i = j;
                    continue;
                }
            }
        }

        if role == "tool" {
            i += 1;
            continue;
        }

        out.push(m.clone());
        i += 1;
    }

    out
}

struct AntMsg {
    role: String,
    blocks: Vec<Value>,
}

fn sanitize_anthropic_wire(msgs: Vec<AntMsg>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
        for m in msgs {
        let role = m.role;
        let content = json!(m.blocks);
        out.push(json!({
            "role": role,
            "content": content
        }));
    }
    out
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
    let mut msgs = sanitize_openai_wire(msgs);
    if is_mistral(cfg) {
        msgs = fix_mistral_wire(msgs);
    }

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
        let schema_sanitize = requires_openai_schema_sanitize(cfg);
        let arr: Vec<Value> = tools
            .iter()
            .map(|t| {
                let clean_name = t.name.replace(':', "_");
                let mut parameters = t.parameters.clone();
                if schema_sanitize {
                    ensure_schema_types(&mut parameters);
                }
                json!({
                    "type": "function",
                    "function": {
                        "name": clean_name,
                        "description": t.description,
                        "parameters": parameters
                    }
                })
            })
            .collect();
        body["tools"] = json!(arr);
        body["tool_choice"] = json!("auto");
    }

    let client = &*HTTP_CLIENT;
    let api_key = cfg.api_key.trim().to_string();
    let url_retry = url.clone();
    let body_retry = body.clone();
    let gemini_retry = is_gemini;
    let resp = send_with_retry(chat_id, move || {
        let mut req = client
            .post(&url_retry)
            .bearer_auth(&api_key)
            .json(&body_retry);
        if gemini_retry {
            req = req.header("x-goog-api-key", &api_key);
        }
        req
    })
    .await?;

    let mut usage = ChatUsage::default();
    let mut text = String::new();
    let mut reasoning = String::new();
    let mut output_chars = 0usize;
    let mut tcs: BTreeMap<u32, (String, String, String, Option<Value>)> = BTreeMap::new();
    let mut global_extra_content: Option<Value> = None;
    let mut sanitizer = crate::output_sanitizer::StreamFilter::new();
    // El thinking/reasoning tambiÃ©n puede traer sintaxis de tool-calls filtrada
    // (el modelo "piensa" las llamadas antes de emitirlas). Se sanea SOLO la
    // vista (`thinking-delta`); `reasoning` se conserva crudo para el eco que
    // exige DeepSeek en turnos siguientes.
    let mut reasoning_sanitizer = crate::output_sanitizer::StreamFilter::new();

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
                let rc_opt = delta.get("reasoning_content")
                    .or_else(|| delta.get("reasoning"))
                    .or_else(|| delta.get("thought"))
                    .and_then(|c| c.as_str());
                if let Some(rc) = rc_opt {
                    if !rc.is_empty() {
                        reasoning.push_str(rc);
                        let clean = reasoning_sanitizer.push(rc);
                        if !clean.is_empty() {
                            let _ = app.emit(
                                "thinking-delta",
                                ThinkingDelta {
                                    chat_id: chat_id.to_string(),
                                    text: clean,
                                },
                            );
                        }
                    }
                }
                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                    if !content.is_empty() {
                        text.push_str(content);
                        let clean = sanitizer.push(content);
                        if !clean.is_empty() {
                            let _ = ChatDeltaEvent {
                                chat_id: chat_id.to_string(),
                                text: clean,
                            }
                            .emit(app);
                        }
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
    let cleaned = crate::output_sanitizer::extract_embedded_tool_calls(&text, now_ts);
    tool_calls.extend(cleaned.tool_calls);
    let _ = sanitizer.flush();
    if tool_calls.is_empty() {
        let _ = ChatTextFinal {
            chat_id: chat_id.to_string(),
            text: cleaned.text.clone(),
        }
        .emit(app);
    }

    Ok(TurnOutcome {
        usage,
        text: cleaned.text,
        tool_calls,
        reasoning,
    })
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
            .ok_or("carÃ¡cter base64 invÃ¡lido")? as u32;
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
    let (media_type, b64) = parse_data_url(data_url).ok_or("data url invÃ¡lida")?;
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
                            scrub_tool_id(&tc.id)
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
                let raw_id = m.tool_call_id.clone().unwrap_or_default();
                let id = if raw_id.trim().is_empty() {
                    "call_0".to_string()
                } else {
                    scrub_tool_id(&raw_id)
                };
                if !known_tool_ids.contains(&id) {
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

    let mut msgs = sanitize_anthropic_wire(raw);

    // Dynamic Prompt Caching (M4): En conversaciones de varios turnos (>= 4 mensajes),
    // marcamos el penÃºltimo mensaje de usuario con cache_control efÃ­mero para cachear
    // todo el contexto anterior ahorrando 90% de costes y acelerando el streaming.
    if msgs.len() >= 4 {
        let user_indices: Vec<usize> = msgs
            .iter()
            .enumerate()
            .filter(|(_, m)| m["role"] == "user")
            .map(|(i, _)| i)
            .collect();
        if user_indices.len() >= 2 {
            let target_idx = user_indices[user_indices.len() - 2];
            if let Some(blocks) = msgs[target_idx]["content"].as_array_mut() {
                if let Some(last_block) = blocks.last_mut() {
                    if let Some(obj) = last_block.as_object_mut() {
                        obj.insert("cache_control".to_string(), serde_json::json!({"type": "ephemeral"}));
                    }
                }
            }
        }
    }
    let mut body = json!({
        "model": cfg.model,
        "stream": true,
        "messages": msgs
    });
    if !system.trim().is_empty() {
        // Prefijo estable + breakpoint de cachÃ© explÃ­cito (M4):
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
        // Breakpoint de cachÃ© al final del bloque de herramientas (prefijo estable).
        if let Some(last) = arr.last_mut() {
            last["cache_control"] = json!({"type": "ephemeral"});
        }
        body["tools"] = json!(arr);
        body["tool_choice"] = json!({"type": "auto"});
    }

    let client = &*HTTP_CLIENT;
    let api_key_retry = cfg.api_key.clone();
    let url_retry = url.clone();
    let body_retry = body.clone();
    let resp = send_with_retry(chat_id, move || {
        client
            .post(&url_retry)
            .header("x-api-key", &api_key_retry)
            .header("anthropic-version", "2023-06-01")
            .json(&body_retry)
    })
    .await?;

    let mut usage = ChatUsage::default();
    let mut text = String::new();
    let mut output_chars = 0usize;
    let mut tool_blocks: Vec<(String, String, String)> = Vec::new();
    let mut sanitizer = crate::output_sanitizer::StreamFilter::new();
    let mut reasoning_sanitizer = crate::output_sanitizer::StreamFilter::new();

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
                            let clean = sanitizer.push(t);
                            if !clean.is_empty() {
                                let _ = ChatDeltaEvent {
                                    chat_id: chat_id.to_string(),
                                    text: clean,
                                }
                                .emit(app);
                            }
                            output_chars += t.len();
                        }
                    } else if dt == "thinking_delta" {
                        if let Some(t) = delta.get("thinking").and_then(|x| x.as_str()) {
                            let clean = reasoning_sanitizer.push(t);
                            if !clean.is_empty() {
                                let _ = app.emit(
                                    "thinking-delta",
                                    ThinkingDelta {
                                        chat_id: chat_id.to_string(),
                                        text: clean,
                                    },
                                );
                            }
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
    let mut tool_calls: Vec<ToolCall> = tool_blocks
        .into_iter()
        .map(|(id, name, arguments)| ToolCall {
            id,
            name,
            arguments,
            extra_content: None,
        })
        .collect();
    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let cleaned = crate::output_sanitizer::extract_embedded_tool_calls(&text, now_ts);
    tool_calls.extend(cleaned.tool_calls);
    let _ = sanitizer.flush();
    if tool_calls.is_empty() {
        let _ = ChatTextFinal {
            chat_id: chat_id.to_string(),
            text: cleaned.text.clone(),
        }
        .emit(app);
    }
    Ok(TurnOutcome {
        usage,
        text: cleaned.text,
        tool_calls,
        reasoning: String::new(),
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
                .map_err(|_| format!("Respuesta no es JSON vÃ¡lido: {text}"))?;
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
            reasoning: None,
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
    fn test_find_sse_boundary_lf_and_crlf() {
        let lf_data = b"data: {\"test\": 1}\n\ndata: {\"test\": 2}\n\n";
        assert_eq!(find_sse_boundary(lf_data), Some((17, 2)));

        let crlf_data = b"data: {\"test\": 1}\r\n\r\ndata: {\"test\": 2}\r\n\r\n";
        assert_eq!(find_sse_boundary(crlf_data), Some((17, 4)));

        let incomplete = b"data: {\"test\": 1}\r\n";
        assert_eq!(find_sse_boundary(incomplete), None);
    }

    #[test]
    fn test_is_retryable_status() {
        assert!(is_retryable_status(500, ""));
        assert!(is_retryable_status(503, ""));
        assert!(is_retryable_status(408, ""));
        assert!(is_retryable_status(429, "rate limit exceeded"));
        assert!(!is_retryable_status(429, "Insufficient Balance"));
        assert!(!is_retryable_status(429, "quota exceeded"));
        assert!(!is_retryable_status(401, ""));
        assert!(!is_retryable_status(404, ""));
        assert!(!is_retryable_status(400, ""));
    }

    #[test]
    fn test_deepseek_assistant_always_gets_reasoning_content() {
        let cfg = ChatConfig {
            kind: "openai".into(),
            base_url: "https://api.deepseek.com/v1".into(),
            model: "deepseek-v4-pro".into(),
            api_key: "dummy".into(),
            reasoning_effort: None,
            max_output_tokens: None,
            temperature: None,
            vision_enabled: false,
            context_window: None,
        };
        let with_reasoning = ChatMessage {
            role: "assistant".into(),
            content: "hola".into(),
            images: vec![],
            tool_calls: None,
            tool_call_id: None,
            reasoning: Some("pienso luego existo".into()),
        };
        let wire = to_wire(&with_reasoning, &cfg);
        assert_eq!(wire["reasoning_content"], "pienso luego existo");

        let without_reasoning = ChatMessage {
            role: "assistant".into(),
            content: "hola".into(),
            images: vec![],
            tool_calls: None,
            tool_call_id: None,
            reasoning: None,
        };
        let wire2 = to_wire(&without_reasoning, &cfg);
        assert_eq!(wire2["reasoning_content"], "");

        let other_cfg = ChatConfig {
            model: "gpt-5".into(),
            base_url: "https://api.openai.com/v1".into(),
            ..cfg
        };
        let wire3 = to_wire(&with_reasoning, &other_cfg);
        assert!(wire3.get("reasoning_content").is_none());
    }

    #[test]
    fn test_fix_mistral_wire_done_bridge() {
        let msgs = vec![
            json!({"role": "user", "content": "u"}),
            json!({"role": "assistant", "content": "", "tool_calls": [{"id": "call_abc-123", "function": {"name": "read_file", "arguments": "{}"}}]}),
            json!({"role": "tool", "tool_call_id": "call_abc-123", "content": "ok"}),
            json!({"role": "user", "content": "next"}),
        ];
        let fixed = fix_mistral_wire(msgs);
        assert_eq!(fixed.len(), 5);
        assert_eq!(fixed[3]["role"], "assistant");
        assert_eq!(fixed[3]["content"], "Done.");
        let id1 = fixed[1]["tool_calls"][0]["id"].as_str().unwrap();
        let id2 = fixed[2]["tool_call_id"].as_str().unwrap();
        assert_eq!(id1, id2);
        assert!(id1.chars().all(|c| c.is_ascii_alphanumeric()));
        assert_eq!(id1.len(), 9);
    }

    #[test]
    fn test_ensure_schema_types_infers() {
        let mut v = json!({
            "type": "object",
            "properties": {
                "name": {"description": "sin tipo"},
                "tags": {"type": "array", "items": true},
                "mode": {"enum": ["a", "b"]}
            },
            "required": ["name"]
        });
        ensure_schema_types(&mut v);
        assert_eq!(v["properties"]["name"]["type"], "string");
        assert_eq!(v["properties"]["tags"]["type"], "array");
        assert_eq!(v["properties"]["tags"]["items"]["type"], "string");
        assert_eq!(v["properties"]["mode"]["type"], "string");
    }
}

