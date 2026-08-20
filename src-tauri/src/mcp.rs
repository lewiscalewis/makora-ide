use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

pub struct McpServer {
    pub child: Child,
    pub stdin: ChildStdin,
    pub lines: mpsc::Receiver<String>,
}

#[derive(Default)]
pub struct McpRegistry {
    pub servers: Mutex<HashMap<String, McpServer>>,
    pub tools: Mutex<HashMap<String, (String, Value)>>,
}

fn guard<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn send_request(
    stdin: &mut ChildStdin,
    lines: &mpsc::Receiver<String>,
    id: u64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let req = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
    let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    line.push('\n');
    stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;

    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        match lines.recv_timeout(remaining) {
            Ok(line) => {
                let v: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if v.get("id").and_then(|i| i.as_u64()) == Some(id) {
                    if let Some(err) = v.get("error") {
                        return Err(err.to_string());
                    }
                    return Ok(v.get("result").cloned().unwrap_or(Value::Null));
                }
            }
            Err(_) => return Err("timeout esperando respuesta del servidor MCP".into()),
        }
    }
}

pub fn configure(registry: &McpRegistry, specs: &[crate::McpSpec]) -> Result<Vec<String>, String> {
    let mut servers = guard(&registry.servers);
    let mut tools = guard(&registry.tools);

    for (_, mut s) in servers.drain() {
        let _ = s.child.kill();
    }
    tools.clear();

    let mut all: Vec<String> = Vec::new();
    for spec in specs.iter().filter(|s| s.enabled) {
        let mut cmd = Command::new(&spec.command);
        cmd.args(&spec.args);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let mut child = match cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[MCP] Error iniciando {}: {}", spec.name, e);
                continue;
            }
        };

        let stdin = match child.stdin.take() {
            Some(si) => si,
            None => {
                let _ = child.kill();
                continue;
            }
        };
        let stdout = match child.stdout.take() {
            Some(so) => so,
            None => {
                let _ = child.kill();
                continue;
            }
        };

        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        let mut server = McpServer {
            child,
            stdin,
            lines: rx,
        };

        let init_res = send_request(
            &mut server.stdin,
            &server.lines,
            1,
            "initialize",
            json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "makora-ide", "version": "0.1.0" }
            }),
        );
        let init_caps = match init_res {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[MCP] Error en handshake initialize para {}: {}", spec.name, e);
                let _ = server.child.kill();
                continue;
            }
        };

        let mut note = json!({"jsonrpc": "2.0", "method": "notifications/initialized"}).to_string();
        note.push('\n');
        let _ = server.stdin.write_all(note.as_bytes());

        let list_res = send_request(&mut server.stdin, &server.lines, 2, "tools/list", json!({}));
        let resp = match list_res {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[MCP] Error listando tools de {}: {}", spec.name, e);
                let _ = server.child.kill();
                continue;
            }
        };

        let mut names: Vec<String> = Vec::new();
        if let Some(arr) = resp.get("tools").and_then(|t| t.as_array()) {
            for t in arr {
                let name = t.get("name").and_then(|n| n.as_str()).unwrap_or("");
                if name.is_empty() {
                    continue;
                }
                let schema = t.get("inputSchema").cloned().unwrap_or_else(|| {
                    json!({"type": "object", "properties": {}})
                });
                let full = format!("mcp__{}__{}", spec.name, name);
                tools.insert(full.clone(), (spec.name.clone(), schema));
                names.push(full);
            }
        }

        let has_resources = init_caps
            .get("capabilities")
            .and_then(|c| c.get("resources"))
            .is_some();
        if has_resources {
            if let Ok(rl) = send_request(&mut server.stdin, &server.lines, 3, "resources/list", json!({})) {
                if let Some(arr) = rl.get("resources").and_then(|r| r.as_array()) {
                    let mut uris: Vec<String> = Vec::new();
                    for r in arr {
                        if let Some(uri) = r.get("uri").and_then(|u| u.as_str()) {
                            uris.push(uri.to_string());
                        }
                    }
                    if !uris.is_empty() {
                        tools.insert(
                            format!("mcp__{}__list_resources", spec.name),
                            (spec.name.clone(), json!({"type": "object", "properties": {}})),
                        );
                        tools.insert(
                            format!("mcp__{}__read_resource", spec.name),
                            (
                                spec.name.clone(),
                                json!({
                                    "type": "object",
                                    "properties": {
                                        "uri": {"type": "string", "description": "URI del recurso (ver list_resources)"}
                                    },
                                    "required": ["uri"]
                                }),
                            ),
                        );
                        names.push(format!("mcp__{}__list_resources", spec.name));
                        names.push(format!("mcp__{}__read_resource", spec.name));
                        println!(
                            "[MCP] {} expone {} recursos",
                            spec.name,
                            uris.len()
                        );
                    }
                }
            }
        }

        let has_prompts = init_caps
            .get("capabilities")
            .and_then(|c| c.get("prompts"))
            .is_some();
        if has_prompts {
            if let Ok(pl) = send_request(&mut server.stdin, &server.lines, 4, "prompts/list", json!({})) {
                let count = pl
                    .get("prompts")
                    .and_then(|p| p.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                if count > 0 {
                    tools.insert(
                        format!("mcp__{}__list_prompts", spec.name),
                        (spec.name.clone(), json!({"type": "object", "properties": {}})),
                    );
                    tools.insert(
                        format!("mcp__{}__get_prompt", spec.name),
                        (
                            spec.name.clone(),
                            json!({
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string", "description": "Nombre del prompt (ver list_prompts)"},
                                    "arguments": {"type": "object", "description": "Argumentos del prompt (opcional)"}
                                },
                                "required": ["name"]
                            }),
                        ),
                    );
                    names.push(format!("mcp__{}__list_prompts", spec.name));
                    names.push(format!("mcp__{}__get_prompt", spec.name));
                    println!("[MCP] {} expone {} prompts", spec.name, count);
                }
            }
        }

        servers.insert(spec.name.clone(), server);
        all.extend(names);
    }
    Ok(all)
}

pub fn call(registry: &McpRegistry, full_name: &str, arguments: &str) -> Result<String, String> {
    let (server_name, _) = {
        let tools = guard(&registry.tools);
        tools
            .get(full_name)
            .cloned()
            .ok_or_else(|| "herramienta MCP no encontrada".to_string())?
    };
    let tool_name = full_name.trim_start_matches(&format!("mcp__{}__", server_name));
    let args: Value = if arguments.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(arguments).unwrap_or(json!({}))
    };

    let mut servers = guard(&registry.servers);
    let server = servers
        .get_mut(&server_name)
        .ok_or_else(|| "servidor MCP no activo".to_string())?;

    match tool_name {
        "list_resources" => {
            let resp = send_request(&mut server.stdin, &server.lines, 100, "resources/list", json!({}))?;
            let mut out = String::from("Recursos disponibles:\n");
            if let Some(arr) = resp.get("resources").and_then(|r| r.as_array()) {
                for r in arr {
                    let uri = r.get("uri").and_then(|u| u.as_str()).unwrap_or("");
                    let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    out.push_str(&format!("- {name} ({uri})\n"));
                }
            }
            Ok(out)
        }
        "read_resource" => {
            let uri = args.get("uri").and_then(|u| u.as_str()).unwrap_or("");
            if uri.is_empty() {
                return Err("read_resource requiere el parámetro 'uri'".into());
            }
            let resp = send_request(
                &mut server.stdin,
                &server.lines,
                101,
                "resources/read",
                json!({ "uri": uri }),
            )?;
            let mut text = String::new();
            if let Some(content) = resp.get("contents").and_then(|c| c.as_array()) {
                for b in content {
                    if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                        text.push_str(t);
                    }
                }
            }
            if text.is_empty() {
                text = resp.to_string();
            }
            Ok(text)
        }
        "list_prompts" => {
            let resp = send_request(&mut server.stdin, &server.lines, 102, "prompts/list", json!({}))?;
            let mut out = String::from("Prompts disponibles:\n");
            if let Some(arr) = resp.get("prompts").and_then(|p| p.as_array()) {
                for p in arr {
                    let name = p.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    let desc = p.get("description").and_then(|d| d.as_str()).unwrap_or("");
                    out.push_str(&format!("- {name}: {desc}\n"));
                }
            }
            Ok(out)
        }
        "get_prompt" => {
            let name = args.get("name").and_then(|n| n.as_str()).unwrap_or("");
            if name.is_empty() {
                return Err("get_prompt requiere el parámetro 'name'".into());
            }
            let mut params = json!({ "name": name });
            if let Some(p_args) = args.get("arguments") {
                params["arguments"] = p_args.clone();
            }
            let resp = send_request(
                &mut server.stdin,
                &server.lines,
                103,
                "prompts/get",
                params,
            )?;
            let mut text = String::new();
            if let Some(msgs) = resp.get("messages").and_then(|m| m.as_array()) {
                for m in msgs {
                    if let Some(c) = m.get("content").and_then(|c| c.as_object()) {
                        if let Some(t) = c.get("text").and_then(|x| x.as_str()) {
                            text.push_str(t);
                            text.push('\n');
                        }
                    }
                }
            }
            if text.is_empty() {
                text = resp.to_string();
            }
            Ok(text)
        }
        _ => {
            let resp = send_request(
                &mut server.stdin,
                &server.lines,
                100,
                "tools/call",
                json!({ "name": tool_name, "arguments": args }),
            )?;

            let mut text = String::new();
            if let Some(content) = resp.get("content").and_then(|c| c.as_array()) {
                for b in content {
                    if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                        text.push_str(t);
                    }
                }
            }
            if text.is_empty() {
                text = resp.to_string();
            }
            Ok(text)
        }
    }
}
