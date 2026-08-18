use std::collections::BTreeMap;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_specta::Event;

use crate::{ChatConfig, ChatDeltaEvent, ChatMessage, ChatUsage, ToolCall};

#[derive(Clone, serde::Serialize)]
pub struct ThinkingDelta {
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

async fn for_each_sse_event<F>(response: reqwest::Response, mut f: F)
where
    F: FnMut(&str, &str),
{
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        if let Ok(c) = chunk {
            buf.push_str(&String::from_utf8_lossy(&c).replace("\r\n", "\n"));
        }
        while let Some(pos) = buf.find("\n\n") {
            let block = buf[..pos].to_string();
            buf.drain(..pos + 2);
            let mut event = String::new();
            let mut data_lines: Vec<String> = Vec::new();
            for line in block.lines() {
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
    let rest = buf.trim().to_string();
    if !rest.is_empty() {
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
            // Provider Shield: modelo de solo texto â†’ guardar a disco y referenciar
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
            .map(|tc| {
                json!({
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.name, "arguments": tc.arguments}
                })
            })
            .collect();
        obj["tool_calls"] = json!(arr);
        if m.content.trim().is_empty() {
            if let Some(o) = obj.as_object_mut() {
                o.remove("content");
            }
        }
    }
    if let Some(tid) = &m.tool_call_id {
        obj["tool_call_id"] = json!(tid);
    }
    obj
}

pub async fn openai_turn(
    app: &AppHandle,
    cfg: &ChatConfig,
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
    for m in messages {
        msgs.push(to_wire(m, cfg));
    }

    let mut body = json!({
        "model": cfg.model,
        "messages": msgs,
        "stream": true,
        "stream_options": { "include_usage": true }
    });
    if let Some(e) = &cfg.reasoning_effort {
        if e != "none" {
            body["reasoning_effort"] = json!(e);
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
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters
                    }
                })
            })
            .collect();
        body["tools"] = json!(arr);
        body["tool_choice"] = json!("auto");
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }

    let mut usage = ChatUsage::default();
    let mut text = String::new();
    let mut output_chars = 0usize;
    let mut tcs: BTreeMap<u32, (String, String, String)> = BTreeMap::new();

    for_each_sse_event(resp, |_event, data| {
        if data == "[DONE]" {
            return;
        }
        let v: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return,
        };
        if let Some(choices) = v.get("choices").and_then(|c| c.as_array()) {
            if let Some(delta) = choices.first().and_then(|c| c.get("delta")) {
                if let Some(rc) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
                    if !rc.is_empty() {
                        let _ = app.emit(
                            "thinking-delta",
                            ThinkingDelta {
                                text: rc.to_string(),
                            },
                        );
                    }
                }
                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                    if !content.is_empty() {
                        text.push_str(content);
                        let _ = ChatDeltaEvent {
                            text: content.to_string(),
                        }
                        .emit(app);
                        output_chars += content.len();
                    }
                }
                if let Some(calls) = delta.get("tool_calls").and_then(|c| c.as_array()) {
                    for call in calls {
                        let idx = call.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as u32;
                        let entry = tcs
                            .entry(idx)
                            .or_insert_with(|| (String::new(), String::new(), String::new()));
                        if let Some(id) = call.get("id").and_then(|i| i.as_str()) {
                            entry.0 = id.to_string();
                        }
                        if let Some(f) = call.get("function") {
                            if let Some(n) = f.get("name").and_then(|x| x.as_str()) {
                                entry.1 = n.to_string();
                            }
                            if let Some(a) = f.get("arguments").and_then(|x| x.as_str()) {
                                entry.2.push_str(a);
                            }
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
    let tool_calls: Vec<ToolCall> = tcs
        .into_values()
        .map(|(id, name, arguments)| ToolCall {
            id,
            name,
            arguments,
        })
        .collect();

    Ok(TurnOutcome {
        usage,
        text,
        tool_calls,
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
    system: &str,
    messages: &[ChatMessage],
    tools: &[ToolDef],
) -> Result<TurnOutcome, String> {
    let base = cfg.base_url.trim_end_matches('/');
    let url = format!("{base}/messages");

    let mut msgs: Vec<Value> = Vec::new();
    for m in messages {
        match m.role.as_str() {
            "user" => {
                if !m.images.is_empty() {
                    if cfg.vision_enabled {
                        let mut blocks: Vec<Value> = Vec::new();
                        for img in &m.images {
                            if let Some((media_type, data)) = parse_data_url(img) {
                                blocks.push(json!({
                                    "type": "image",
                                    "source": {"type": "base64", "media_type": media_type, "data": data}
                                }));
                            }
                        }
                        if !m.content.is_empty() {
                            blocks.push(json!({"type": "text", "text": m.content}));
                        }
                        msgs.push(json!({"role": "user", "content": blocks}));
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
                        msgs.push(json!({"role": "user", "content": content}));
                    }
                } else {
                    msgs.push(json!({"role": "user", "content": m.content}));
                }
            }
            "assistant" => {
                let mut blocks: Vec<Value> = Vec::new();
                if !m.content.trim().is_empty() {
                    blocks.push(json!({"type": "text", "text": m.content}));
                }
                if let Some(tcs) = &m.tool_calls {
                    for tc in tcs {
                        let input: Value =
                            serde_json::from_str(&tc.arguments).unwrap_or(json!({}));
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.name,
                            "input": input
                        }));
                    }
                }
                msgs.push(json!({"role": "assistant", "content": blocks}));
            }
            "tool" => {
                msgs.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                        "content": m.content
                    }]
                }));
            }
            _ => {}
        }
    }

    let mut body = json!({
        "model": cfg.model,
        "stream": true,
        "messages": msgs
    });
    if !system.trim().is_empty() {
        body["system"] = json!(system);
    }
    body["max_tokens"] = json!(cfg.max_output_tokens.unwrap_or(4096));
    if let Some(t) = cfg.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(e) = &cfg.reasoning_effort {
        if e != "none" {
            // Claude 4.7+ usa adaptive thinking; 4.5/anteriores solo "enabled"
            body["thinking"] = json!({"type": "adaptive"});
            body["output_config"] = json!({"effort": e});
        }
    }
    if !tools.is_empty() {
        let arr: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters
                })
            })
            .collect();
        body["tools"] = json!(arr);
        body["tool_choice"] = json!({"type": "auto"});
    }

    let client = reqwest::Client::new();
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
        return Err(format!("HTTP {status}: {text}"));
    }

    let mut usage = ChatUsage::default();
    let mut text = String::new();
    let mut output_chars = 0usize;
    let mut tool_blocks: Vec<(String, String, String)> = Vec::new();
    let mut current_block: Option<usize> = None;

    for_each_sse_event(resp, |_event, data| {
        let v: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return,
        };
        match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "message_start" => {
                if let Some(u) = v.pointer("/message/usage") {
                    usage.input_tokens =
                        u.get("input_tokens").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                    usage.cached_tokens = u
                        .get("cache_read_input_tokens")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0) as u32;
                }
            }
            "content_block_start" => {
                let block = &v["content_block"];
                if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                    let id = block.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let name = block
                        .get("name")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    tool_blocks.push((id, name, String::new()));
                    current_block = Some(tool_blocks.len() - 1);
                } else {
                    current_block = None;
                }
            }
            "content_block_delta" => {
                let delta = &v["delta"];
                match delta.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                    "text_delta" => {
                        if let Some(t) = delta.get("text").and_then(|x| x.as_str()) {
                            text.push_str(t);
                            let _ = ChatDeltaEvent {
                                text: t.to_string(),
                            }
                            .emit(app);
                            output_chars += t.len();
                        }
                    }
                    "input_json_delta" => {
                        if let Some(i) = current_block {
                            if let Some(part) =
                                delta.get("partial_json").and_then(|x| x.as_str())
                            {
                                tool_blocks[i].2.push_str(part);
                            }
                        }
                    }
                    "thinking_delta" => {
                        if let Some(t) = delta.get("thinking").and_then(|x| x.as_str()) {
                            let _ = app.emit(
                                "thinking-delta",
                                ThinkingDelta {
                                    text: t.to_string(),
                                },
                            );
                        }
                    }
                    _ => {}
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
        })
        .collect();
    Ok(TurnOutcome {
        usage,
        text,
        tool_calls,
    })
}

pub async fn fetch_models(cfg: &ChatConfig) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    match cfg.kind.as_str() {
        "anthropic" => {
            let url = format!("{}/models", cfg.base_url.trim_end_matches('/'));
            let resp = client
                .get(&url)
                .header("x-api-key", &cfg.api_key)
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
            let resp = client
                .get(&url)
                .bearer_auth(&cfg.api_key)
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
    }
}

fn extract_ids(body: &Value) -> Vec<String> {
    body.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|x| x.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}
