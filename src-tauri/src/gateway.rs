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

async fn for_each_sse_event<F>(response: reqwest::Response, chat_id: &str, mut f: F)
where
    F: FnMut(&str, &str),
{
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        if crate::agent::is_chat_cancelled(chat_id) {
            break;
        }
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
                let mut tc_obj = json!({
                    "id": id,
                    "type": "function",
                    "function": {"name": clean_name, "arguments": tc.arguments}
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
    obj
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
    if !is_gemini {
        body["stream_options"] = json!({ "include_usage": true });
        if let Some(e) = &cfg.reasoning_effort {
            if e != "none" {
                body["reasoning_effort"] = json!(e);
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

    let client = reqwest::Client::new();
    let api_key = cfg.api_key.trim();
    let mut req = client.post(&url).bearer_auth(api_key).json(&body);
    if is_gemini {
        req = req.header("x-goog-api-key", api_key);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
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
                        let idx = call.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as u32;
                        let entry = tcs
                            .entry(idx)
                            .or_insert_with(|| (String::new(), String::new(), String::new(), None));
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

fn sanitize_and_extract_embedded_tool_calls(
    text: &mut String,
    tool_calls: &mut Vec<ToolCall>,
    now_ts: u128,
) {
    if text.contains("DSML") || text.contains("<tool_call>") || text.contains("<|tool_calls|>") {
        // 1. Extract DSML invoke tags
        let invoke_re = regex::Regex::new(r#"(?s)<\s*\|\s*DSML\s*\|\s*invoke\s+name=["']([^"']+)["']\s*>(.*?)<\s*/\s*\|\s*DSML\s*\|\s*invoke\s*>"#);
        let param_re = regex::Regex::new(r#"(?s)<\s*\|\s*DSML\s*\|\s*parameter\s+name=["']([^"']+)["'][^>]*>(.*?)<\s*/\s*\|\s*DSML\s*\|\s*parameter\s*>"#);

        if let Ok(re_inv) = invoke_re {
            if let Ok(re_param) = param_re {
                for cap in re_inv.captures_iter(text) {
                    let name = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("").to_string();
                    let body = cap.get(2).map(|m| m.as_str()).unwrap_or("");
                    let mut args_map = serde_json::Map::new();
                    for p_cap in re_param.captures_iter(body) {
                        let p_name = p_cap.get(1).map(|m| m.as_str().trim()).unwrap_or("").to_string();
                        let p_val = p_cap.get(2).map(|m| m.as_str().trim()).unwrap_or("").to_string();
                        args_map.insert(p_name, Value::String(p_val));
                    }
                    let args_str = Value::Object(args_map).to_string();
                    if !name.is_empty() {
                        let id = format!("call_dsml_{}_{now_ts}", tool_calls.len());
                        tool_calls.push(ToolCall {
                            id,
                            name,
                            arguments: args_str,
                            extra_content: None,
                        });
                    }
                }
            }
        }

        // 2. Extract <tool_call> JSON format
        if let Ok(re_json) = regex::Regex::new(r#"(?s)<\s*tool_call\s*>(.*?)<\s*/\s*tool_call\s*>"#) {
            for cap in re_json.captures_iter(text) {
                if let Some(body) = cap.get(1) {
                    if let Ok(v) = serde_json::from_str::<Value>(body.as_str().trim()) {
                        if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
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
        }

        // 3. Clean all DSML & tool_call tags from user-facing text
        if let Ok(re_clean1) = regex::Regex::new(r#"(?s)<\s*\|\s*DSML\s*\|\s*tool_calls\s*>.*?<\s*/\s*\|\s*DSML\s*\|\s*tool_calls\s*>"#) {
            *text = re_clean1.replace_all(text, "").to_string();
        }
        if let Ok(re_clean2) = regex::Regex::new(r#"(?s)<\s*\|\s*DSML\s*\|\s*invoke.*?<\s*/\s*\|\s*DSML\s*\|\s*invoke\s*>"#) {
            *text = re_clean2.replace_all(text, "").to_string();
        }
        if let Ok(re_clean3) = regex::Regex::new(r#"(?s)<\s*tool_call\s*>.*?<\s*/\s*tool_call\s*>"#) {
            *text = re_clean3.replace_all(text, "").to_string();
        }
        if let Ok(re_clean4) = regex::Regex::new(r#"<\s*\|?\s*DSML\s*\|?.*?>"#) {
            *text = re_clean4.replace_all(text, "").to_string();
        }
        if let Ok(re_clean5) = regex::Regex::new(r#"<\s*/\s*\|?\s*DSML\s*\|?.*?>"#) {
            *text = re_clean5.replace_all(text, "").to_string();
        }
        *text = text.trim().to_string();
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

    let mut msgs: Vec<Value> = Vec::new();
    for m in messages.iter() {
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
        if e != "none" {
            // Claude 4.7+ usa adaptive thinking; 4.5/anteriores solo "enabled"
            body["thinking"] = json!({"type": "adaptive"});
            body["output_config"] = json!({"effort": e});
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

    for_each_sse_event(resp, chat_id, |_event, data| {
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
                                chat_id: chat_id.to_string(),
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
                                    chat_id: chat_id.to_string(),
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
    let client = reqwest::Client::new();
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
}

