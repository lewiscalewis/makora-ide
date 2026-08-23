//! Chat remoto vía HTTP/SSE (MVPs del acceso móvil).
//!
//! POST /api/chat  ->  `text/event-stream`
//!
//! Reutiliza el pipeline de streaming de `crate::gateway` (openai/anthropic_turn)
//! escuchando los mismos eventos Tauri que usa el frontend de escritorio
//! (`chat-delta-event` / `thinking-delta`), filtrados por `chat_id`.
//!
//! Fase actual (MVP-1): chat conversacional sin herramientas ni acceso a
//! workspace/terminal. El historial lo mantiene el cliente (móvil).

use std::task::Poll;

use axum::{
    Json,
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use tauri::Listener;

use crate::remote::{RemoteState, require_auth};

/// Número máximo de mensajes de cliente que se reenvían al modelo.
const MAX_CONTEXT_MESSAGES: usize = 12;

/// Cuerpo de la petición: historial completo (el servidor recorta al máximo).
#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessageIn>,
}

#[derive(Debug, Deserialize)]
pub struct ChatMessageIn {
    pub role: String,
    pub content: String,
}

/// Manejador SSE de chat.
pub async fn chat_handler(
    State(state): State<std::sync::Arc<RemoteState>>,
    headers: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> Response {
    // 1) Autenticación (Bearer token obtenido en /api/pair).
    if let Err((code, msg)) = require_auth(&state, &headers) {
        return json_error(code, msg);
    }

    // 2) Configuración del modelo activa en la sesión de escritorio.
    let chat_cfg = match state.config.read() {
        Ok(guard) => match guard.build_chat_config() {
            Ok(cfg) => cfg,
            Err(e) => return json_error(StatusCode::BAD_REQUEST, format!("Config remota inválida: {e}")),
        },
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Estado remoto no disponible"),
    };

    // 3) Mensajes: solo los últimos MAX_CONTEXT_MESSAGES del cliente.
    let messages: Vec<crate::ChatMessage> = req
        .messages
        .into_iter()
        .take(MAX_CONTEXT_MESSAGES)
        .map(|m| crate::ChatMessage {
            role: m.role,
            content: m.content,
            images: vec![],
            tool_calls: None,
            tool_call_id: None,
            reasoning: None,
        })
        .collect();

    if messages.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "No hay mensajes");
    }

    let system = SYSTEM_PROMPT.to_string();

    // 4) Canal SSE + puente de eventos Tauri -> SSE.
    let (tx, rx) = tokio::sync::mpsc::channel::<String>(256);
    let chat_id = format!(
        "remote-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let app = state.app.clone();

    // Puente: chat-delta-event -> SSE "delta"
    let tx_delta = tx.clone();
    let chat_id_delta = chat_id.clone();
    let h_delta = app.listen("chat-delta-event", move |event| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            if v.get("chatId").and_then(|c| c.as_str()) == Some(chat_id_delta.as_str()) {
                if let Some(t) = v.get("text").and_then(|t| t.as_str()) {
                    let _ = tx_delta.try_send(format!(
                        "event: delta\ndata: {}\n\n",
                        serde_json::json!({ "text": t })
                    ));
                }
            }
        }
    });

    // Puente: thinking-delta -> SSE "thinking" (razonamiento opcional).
    let tx_think = tx.clone();
    let h_think = app.listen("thinking-delta", move |event| {
        let text = serde_json::from_str::<String>(event.payload())
            .ok()
            .or_else(|| {
                serde_json::from_str::<serde_json::Value>(event.payload())
                    .ok()
                    .and_then(|v| v.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()))
            });
        if let Some(t) = text {
            let _ = tx_think.try_send(format!(
                "event: thinking\ndata: {}\n\n",
                serde_json::json!({ "text": t })
            ));
        }
    });

    // 5) Lanzar el turno en background; los deltas ya fluyen por el canal.
    let app_turn = app.clone();
    let tx_turn = tx.clone();
    let chat_id_turn = chat_id.clone();
    tauri::async_runtime::spawn(async move {
        let provider = chat_cfg.kind.to_lowercase();
        let outcome = if provider.contains("anthropic") {
            crate::gateway::anthropic_turn(
                &app_turn,
                &chat_cfg,
                &chat_id_turn,
                &system,
                &messages,
                &[],
            )
            .await
        } else {
            crate::gateway::openai_turn(
                &app_turn,
                &chat_cfg,
                &chat_id_turn,
                &system,
                &messages,
                &[],
            )
            .await
        };
        app_turn.unlisten(h_delta);
        app_turn.unlisten(h_think);
        match outcome {
            Ok(o) => {
                let _ = tx_turn
                    .send(format!(
                        "event: done\ndata: {}\n\n",
                        serde_json::json!({ "text": o.text })
                    ))
                    .await;
            }
            Err(e) => {
                let _ = tx_turn
                    .send(format!(
                        "event: error\ndata: {}\n\n",
                        serde_json::json!({ "message": e })
                    ))
                    .await;
            }
        }
    });

    // 6) Respuesta SSE.
    let mut resp = Response::new(Body::from_stream(SseStream { rx }));
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        "text/event-stream; charset=utf-8".parse().unwrap(),
    );
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, "no-cache".parse().unwrap());
    resp.headers_mut()
        .insert(header::CONNECTION, "keep-alive".parse().unwrap());
    resp
}

/// Prompt de sistema para la sesión remota (MVP-1: sin herramientas).
const SYSTEM_PROMPT: &str = "Eres Makora, el asistente de IA de MakoraIDE, conectado \
remotamente desde el movil del usuario a su sesion de escritorio (la app esta abierta en su PC). \
Responde de forma directa, concisa y util. De momento no tienes acceso a herramientas, archivos \
ni terminal: si el usuario pide editar archivos, usar git o ejecutar comandos, dale los pasos \
exactos para que el los haga en su PC.";

/// Stream SSE simple sobre un canal mpsc.
struct SseStream {
    rx: tokio::sync::mpsc::Receiver<String>,
}

impl futures_util::Stream for SseStream {
    type Item = Result<axum::body::Bytes, std::io::Error>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        match self.rx.poll_recv(cx) {
            Poll::Ready(Some(s)) => Poll::Ready(Some(Ok(axum::body::Bytes::from(s)))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}

fn json_error(code: StatusCode, msg: impl Into<String>) -> Response {
    (code, serde_json::json!({ "error": msg.into() }).to_string()).into_response()
}
