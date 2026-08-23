//! Servidor remoto HTTPS + WebSocket para acceso desde el móvil/navegador.
//!
//! Arquitectura:
//! - `cert.rs`         → certificado autofirmado (TLS 1.3) persistido en appdata
//! - `auth.rs`         → emparejamiento por código + tokens de acceso + rate limiting
//! - `remote_config.rs`→ configuración persistida del servidor remoto
//! - `mod.rs`          → estado global, comandos Tauri y servidor axum (HTTP + WS)

pub(crate) mod auth;
pub(crate) mod cert;
pub(crate) mod chat;
pub(crate) mod remote_config;
pub(crate) mod tunnel;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use include_dir::{Dir, include_dir};

/// Assets de la SPA móvil (web/), embebidos en el binario en tiempo de compilación.
pub(crate) static WEB_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../web");

use axum::{
    Router,
    extract::{State, ws::{Message, WebSocket, WebSocketUpgrade}},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
    Json,
};
use axum_server::tls_rustls::RustlsConfig;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};
use tokio::sync::broadcast;

use crate::remote::auth::{
    TOKEN_TTL, PairingCode, RateLimiter, TokenRecord, generate_pair_code,
    generate_token, hash_token,
};
use crate::remote::cert::{RemoteCert, load_or_create, rustls_config};
use crate::remote::remote_config::RemoteConfig;

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------

/// Estado compartido entre los comandos Tauri y el servidor axum.
pub struct RemoteState {
    pub app: AppHandle,
    pub config: RwLock<RemoteConfig>,
    pub pairing: Mutex<Option<PairingCode>>,
    pub token: Mutex<Option<TokenRecord>>,
    pub rate_limiter: Mutex<RateLimiter>,
    pub running: AtomicBool,
    pub addr: RwLock<Option<SocketAddr>>,
    pub fingerprint: RwLock<String>,
    pub broadcast: broadcast::Sender<String>,
    pub tunnel_active: AtomicBool,
    pub tunnel_url: RwLock<Option<String>>,
    pub tunnel_child: Mutex<Option<std::process::Child>>,
}

impl RemoteState {
    pub fn new(app: AppHandle) -> Self {
        let (broadcast, _) = broadcast::channel(256);
        Self {
            app,
            config: RwLock::new(RemoteConfig::default()),
            pairing: Mutex::new(None),
            token: Mutex::new(None),
            rate_limiter: Mutex::new(RateLimiter::new()),
            running: AtomicBool::new(false),
            addr: RwLock::new(None),
            fingerprint: RwLock::new(String::new()),
            broadcast,
            tunnel_active: AtomicBool::new(false),
            tunnel_url: RwLock::new(None),
            tunnel_child: Mutex::new(None),
        }
    }

    pub fn app_data_dir(&self) -> Result<PathBuf, String> {
        self.app
            .path()
            .app_data_dir()
            .map_err(|e| format!("No se pudo obtener app_data_dir: {e}"))
    }

    fn load_cert(&self) -> Result<RemoteCert, String> {
        let dir = self.app_data_dir()?;
        load_or_create(&dir)
    }

    pub fn ensure_certificate(&self) -> Result<RemoteCert, String> {
        self.load_cert()
    }

    /// Devuelve la huella (fingerprint) actual del certificado.
    pub fn fingerprint(&self) -> String {
        self.load_cert()
            .map(|c| c.fingerprint.clone())
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// Tipos serializables (IPC Tauri)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub fingerprint: String,
    pub pair_code_active: bool,
    pub device_label: Option<String>,
    pub configured: bool,
    pub config: RemoteConfig,
    pub tunnel_active: bool,
    pub tunnel_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemotePairResponse {
    pub token: String,
    pub expires_in: u64,
    pub fingerprint: String,
    pub config: RemoteConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairCodeRequest {
    pub code: String,
    pub device_label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeRequest {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigRequest {
    pub config: RemoteConfig,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
    pub enabled: bool,
    pub fingerprint: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateResponse {
    pub config: RemoteConfig,
    pub fingerprint: String,
    pub enabled: bool,
    pub device_label: Option<String>,
    pub workspace_name: String,
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

/// Devuelve el estado actual del servidor remoto.
#[tauri::command]
#[specta::specta]
pub fn remote_status(state: TauriState<'_, Arc<RemoteState>>) -> Result<RemoteStatus, String> {
    let running = state.running.load(Ordering::SeqCst);
    let addr = *state.addr.read().map_err(|e| e.to_string())?;
    let pairing = state.pairing.lock().map_err(|e| e.to_string())?;
    let token = state.token.lock().map_err(|e| e.to_string())?;
    let config = state.config.read().map_err(|e| e.to_string())?.clone();
    Ok(RemoteStatus {
        running,
        port: addr.map(|a| a.port()),
        fingerprint: state.fingerprint(),
        pair_code_active: pairing.is_some(),
        device_label: token.as_ref().map(|t| t.device_label.clone()),
        configured: config.is_configured(),
        config,
        tunnel_active: state.tunnel_active.load(Ordering::SeqCst),
        tunnel_url: state.tunnel_url.read().map_err(|e| e.to_string())?.clone(),
    })
}

/// Genera (o regenera) un código de emparejamiento de 8 caracteres alfanuméricos válido durante PAIR_CODE_TTL.
#[tauri::command]
#[specta::specta]
pub fn remote_pair_code(state: TauriState<'_, Arc<RemoteState>>) -> Result<String, String> {
    let mut pairing = state.pairing.lock().map_err(|e| e.to_string())?;
    let code = generate_pair_code();
    *pairing = Some(PairingCode {
        code: code.clone(),
        created_at: std::time::Instant::now(),
    });
    Ok(code)
}

/// Revoca el token de acceso actual (desempareja el dispositivo).
#[tauri::command]
#[specta::specta]
pub fn remote_revoke(state: TauriState<'_, Arc<RemoteState>>) -> Result<(), String> {
    let mut token = state.token.lock().map_err(|e| e.to_string())?;
    *token = None;
    let mut pairing = state.pairing.lock().map_err(|e| e.to_string())?;
    *pairing = None;
    Ok(())
}

/// Actualiza la configuración remota (modelo, proveedor, puerto, etc.).
#[tauri::command]
#[specta::specta]
pub fn remote_sync_config(
    state: TauriState<'_, Arc<RemoteState>>,
    config: RemoteConfig,
) -> Result<RemoteConfig, String> {
    let dir = state.app_data_dir()?;
    remote_config::save(&dir, &config)?;
    *state.config.write().map_err(|e| e.to_string())? = config.clone();
    Ok(config)
}

/// Devuelve la configuración remota actual.
#[tauri::command]
#[specta::specta]
pub fn remote_get_config(state: TauriState<'_, Arc<RemoteState>>) -> Result<RemoteConfig, String> {
    Ok(state.config.read().map_err(|e| e.to_string())?.clone())
}

/// Lista los modelos disponibles usando la configuración remota.
#[tauri::command]
#[specta::specta]
pub async fn remote_list_models(
    state: TauriState<'_, Arc<RemoteState>>,
) -> Result<Vec<String>, String> {
    let config = state.config.read().map_err(|e| e.to_string())?.clone();
    let chat_cfg = config.build_chat_config()?;
    crate::list_models(chat_cfg).await
}

/// Arranca el servidor HTTPS en el puerto configurado (o el indicado).
#[tauri::command]
#[specta::specta]
pub fn remote_start(
    state: TauriState<'_, Arc<RemoteState>>,
    port: Option<u16>,
) -> Result<RemoteStatus, String> {
    if state.running.load(Ordering::SeqCst) {
        return remote_status(state);
    }
    let cert = state.ensure_certificate()?;
    *state.fingerprint.write().map_err(|e| e.to_string())? = cert.fingerprint.clone();

    let port = port.unwrap_or(8443);
    let addr: SocketAddr = format!("0.0.0.0:{port}")
        .parse()
        .map_err(|e| format!("Puerto inválido: {e}"))?;

    let tls = rustls_config(&cert)?;
    let tls = tauri::async_runtime::block_on(async move { RustlsConfig::from_config(tls) });

    let shared = state.inner().clone();
    let router = build_router(shared.clone());

    state.running.store(true, Ordering::SeqCst);
    *state.addr.write().map_err(|e| e.to_string())? = Some(addr);

    let app = state.app.clone();
    tauri::async_runtime::spawn(async move {
        let result = axum_server::bind_rustls(addr, tls)
            .serve(router.into_make_service_with_connect_info::<SocketAddr>())
            .await;
        if let Err(e) = result {
            let _ = app.emit("remote-server-error", format!("{e}"));
        }
        shared.running.store(false, Ordering::SeqCst);
        let mut addr_guard = shared.addr.write().unwrap();
        *addr_guard = None;
    });

    let running = state.running.load(Ordering::SeqCst);
    let _ = state.app.emit("remote-status-changed", running);
    remote_status(state)
}

/// Detiene el servidor HTTPS.
#[tauri::command]
#[specta::specta]
pub fn remote_stop(state: TauriState<'_, Arc<RemoteState>>) -> Result<(), String> {
    state.running.store(false, Ordering::SeqCst);
    *state.addr.write().map_err(|e| e.to_string())? = None;
    // Detener también el túnel público si estaba activo.
    state.tunnel_active.store(false, Ordering::SeqCst);
    if let Ok(mut child) = state.tunnel_child.lock() {
        if let Some(mut c) = child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
    *state.tunnel_url.write().map_err(|e| e.to_string())? = None;
    let _ = state.app.emit("remote-status-changed", false);
    let _ = state.app.emit("remote-tunnel-changed", Option::<String>::None);
    Ok(())
}

/// Expone el servidor HTTPS a internet mediante Cloudflare Quick Tunnel.
/// Devuelve la URL pública `https://*.trycloudflare.com`.
#[tauri::command]
#[specta::specta]
pub async fn remote_tunnel_start(
    state: TauriState<'_, Arc<RemoteState>>,
) -> Result<String, String> {
    if state.tunnel_active.load(Ordering::SeqCst) {
        if let Some(u) = state.tunnel_url.read().map_err(|e| e.to_string())?.clone() {
            return Ok(u);
        }
    }
    if !state.running.load(Ordering::SeqCst) {
        return Err("Inicia primero el servidor HTTPS".into());
    }
    let port = state
        .addr
        .read()
        .map_err(|e| e.to_string())?
        .map(|a| a.port())
        .ok_or_else(|| "Servidor sin puerto asignado".to_string())?;

    let dir = state.app_data_dir()?;
    let bin = tunnel::resolve_binary(&dir).await?;
    let t = tunnel::spawn_tunnel(&bin, port)?;
    let url = t.url.clone();
    *state.tunnel_child.lock().map_err(|e| e.to_string())? = Some(t.child);
    state.tunnel_active.store(true, Ordering::SeqCst);

    // Watcher: si cloudflared termina, limpia el estado y notifica al frontend.
    let shared = state.inner().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let exited = shared
            .tunnel_child
            .lock()
            .map(|mut c| match c.as_mut() {
                Some(ch) => matches!(ch.try_wait(), Ok(Some(_))),
                None => true,
            })
            .unwrap_or(true);
        if exited {
            shared.tunnel_active.store(false, Ordering::SeqCst);
            if let Ok(mut u) = shared.tunnel_url.write() {
                *u = None;
            }
            let _ = shared.app.emit("remote-tunnel-changed", Option::<String>::None);
            break;
        }
    });

    // Espera (máx 30s) a que cloudflared imprima la URL pública.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        if let Some(u) = url.read().map_err(|e| e.to_string())?.clone() {
            *state.tunnel_url.write().map_err(|e| e.to_string())? = Some(u.clone());
            let _ = state.app.emit("remote-tunnel-changed", Some(u.clone()));
            return Ok(u);
        }
        if !state.tunnel_active.load(Ordering::SeqCst) {
            return Err("cloudflared terminó antes de exponer el túnel".into());
        }
        if std::time::Instant::now() > deadline {
            return Err("No se obtuvo la URL del túnel (timeout 30s). Revisa tu conexión".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

/// Detiene el túnel público (Cloudflare) sin detener el servidor HTTPS local.
#[tauri::command]
#[specta::specta]
pub fn remote_tunnel_stop(state: TauriState<'_, Arc<RemoteState>>) -> Result<(), String> {
    state.tunnel_active.store(false, Ordering::SeqCst);
    let mut child = state.tunnel_child.lock().map_err(|e| e.to_string())?;
    if let Some(mut c) = child.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
    *state.tunnel_url.write().map_err(|e| e.to_string())? = None;
    let _ = state.app.emit("remote-tunnel-changed", Option::<String>::None);
    Ok(())
}

// ---------------------------------------------------------------------------
// Router axum
// ---------------------------------------------------------------------------

fn build_router(state: Arc<RemoteState>) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/api/state", get(state_handler))
        .route("/api/pair", axum::routing::post(pair_handler))
        .route("/api/revoke", axum::routing::post(revoke_handler))
        .route("/api/sync-config", axum::routing::post(sync_config_handler))
        .route("/api/list-models", get(list_models_handler))
        .route("/api/providers", get(providers_handler))
        .route("/api/chat", axum::routing::post(chat::chat_handler))
        .route("/", get(spa_index))
        .route("/assets/{*path}", get(spa_asset))
        .route("/ws", get(ws_handler))
        .with_state(state)
}

/// Sirve el `index.html` de la SPA móvil (web/), que se incrusta en el binario.
async fn spa_index() -> Response {
    match WEB_DIR.get_file("index.html") {
        Some(f) => static_file_response(f),
        None => (
            StatusCode::NOT_FOUND,
            "Sitio web no embebido (falta web/index.html)",
        )
            .into_response(),
    }
}

/// Sirve los assets estáticos de la SPA (app.js, styles.css, ...).
/// Cualquier ruta no encontrada cae al index.html para permitir SPA fallback.
async fn spa_asset(axum::extract::Path(path): axum::extract::Path<String>) -> Response {
    match WEB_DIR.get_file(&path) {
        Some(f) => static_file_response(f),
        None => spa_index().await,
    }
}

fn static_file_response(f: &'static include_dir::File<'static>) -> Response {
    let content_type = match f.path().extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("json") => "application/json",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        _ => "application/octet-stream",
    };
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, content_type)],
        f.contents(),
    )
        .into_response()
}

async fn health_handler(
    State(state): State<Arc<RemoteState>>,
) -> Result<Json<HealthResponse>, (StatusCode, String)> {
    let configured = state
        .config
        .read()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .is_configured();
    let fingerprint = state.fingerprint();
    Ok(Json(HealthResponse {
        ok: true,
        enabled: configured,
        fingerprint,
        name: "makora-remote".into(),
    }))
}

async fn state_handler(
    State(state): State<Arc<RemoteState>>,
    headers: HeaderMap,
) -> Result<Json<StateResponse>, (StatusCode, String)> {
    require_auth(&state, &headers)?;
    let config = state
        .config
        .read()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .clone();
    let enabled = config.is_configured();
    let device_label = state
        .token
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .as_ref()
        .map(|t| t.device_label.clone());
    Ok(Json(StateResponse {
        config,
        fingerprint: state.fingerprint(),
        enabled,
        device_label,
        workspace_name: "MakoraIDE".into(),
    }))
}

async fn pair_handler(
    State(state): State<Arc<RemoteState>>,
    headers: HeaderMap,
    Json(req): Json<PairCodeRequest>,
) -> Result<Json<RemotePairResponse>, (StatusCode, String)> {
    // Rate limiting por IP
    let ip = client_ip(&headers);
    {
        let limiter = state
            .rate_limiter
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if limiter.is_blocked(&ip) {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                "Demasiados intentos. Espera unos minutos.".into(),
            ));
        }
    }

    let now = std::time::Instant::now();
    let pairing = {
        let p = state
            .pairing
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        p.as_ref().cloned()
    };
    let Some(pairing) = pairing else {
        return Err((StatusCode::UNAUTHORIZED, "No hay código de emparejamiento activo".into()));
    };
    if pairing.is_expired() {
        return Err((StatusCode::UNAUTHORIZED, "Código expirado. Genera uno nuevo.".into()));
    }
    if pairing.code != req.code.trim() {
        let mut limiter = state
            .rate_limiter
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        limiter.register_failure(&ip);
        return Err((StatusCode::UNAUTHORIZED, "Código incorrecto".into()));
    }

    // Código válido → generar token
    let token = generate_token();
    let hash = hash_token(&token);
    let mut token_slot = state
        .token
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    *token_slot = Some(TokenRecord {
        hash,
        created_at: now,
        last_active: now,
        device_label: req.device_label.clone().unwrap_or_else(|| "Móvil".into()),
        revoked: false,
    });

    let mut pairing_slot = state
        .pairing
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    *pairing_slot = None; // el código se consume

    let config = state
        .config
        .read()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .clone();
    Ok(Json(RemotePairResponse {
        token,
        expires_in: TOKEN_TTL.as_secs(),
        fingerprint: state.fingerprint(),
        config,
    }))
}

async fn revoke_handler(
    State(state): State<Arc<RemoteState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    require_auth(&state, &headers)?;
    let mut token = state
        .token
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    *token = None;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn sync_config_handler(
    State(state): State<Arc<RemoteState>>,
    headers: HeaderMap,
    Json(req): Json<SyncConfigRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    require_auth(&state, &headers)?;
    let dir = state
        .app_data_dir()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    remote_config::save(&dir, &req.config)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    *state
        .config
        .write()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))? = req.config;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn providers_handler() -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let providers = vec![
        serde_json::json!({ "id": "deepseek", "label": "DeepSeek", "kind": "openai", "baseUrl": "https://api.deepseek.com/v1", "needsKey": true }),
        serde_json::json!({ "id": "openai", "label": "OpenAI", "kind": "openai", "baseUrl": "https://api.openai.com/v1", "needsKey": true }),
        serde_json::json!({ "id": "anthropic", "label": "Anthropic", "kind": "anthropic", "baseUrl": "https://api.anthropic.com/v1", "needsKey": true }),
        serde_json::json!({ "id": "openrouter", "label": "OpenRouter", "kind": "openai", "baseUrl": "https://openrouter.ai/api/v1", "needsKey": true }),
        serde_json::json!({ "id": "groq", "label": "Groq", "kind": "openai", "baseUrl": "https://api.groq.com/openai/v1", "needsKey": true }),
        serde_json::json!({ "id": "mistral", "label": "Mistral", "kind": "openai", "baseUrl": "https://api.mistral.ai/v1", "needsKey": true }),
        serde_json::json!({ "id": "gemini", "label": "Gemini", "kind": "openai", "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai", "needsKey": true }),
        serde_json::json!({ "id": "fireworks", "label": "Fireworks", "kind": "openai", "baseUrl": "https://api.fireworks.ai/inference/v1", "needsKey": true }),
        serde_json::json!({ "id": "together", "label": "Together", "kind": "openai", "baseUrl": "https://api.together.xyz/v1", "needsKey": true }),
        serde_json::json!({ "id": "makoraai", "label": "Makora AI", "kind": "openai", "baseUrl": "https://api.makora.ai/v1", "needsKey": true }),
        serde_json::json!({ "id": "ollama", "label": "Ollama (local)", "kind": "ollama", "baseUrl": "http://localhost:11434/v1", "needsKey": false }),
        serde_json::json!({ "id": "lmstudio", "label": "LM Studio (local)", "kind": "ollama", "baseUrl": "http://localhost:1234/v1", "needsKey": false }),
    ];
    Ok(Json(providers))
}

async fn list_models_handler(
    State(state): State<Arc<RemoteState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {    require_auth(&state, &headers)?;
    let config = state
        .config
        .read()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .clone();
    let chat_cfg = config
        .build_chat_config()
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let models = crate::list_models(chat_cfg)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
    Ok(Json(models))
}

// ---------------------------------------------------------------------------
// WebSocket (eventos en tiempo real)
// ---------------------------------------------------------------------------

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<RemoteState>>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, String)> {
    require_auth(&state, &headers)?;
    let rx = state.broadcast.subscribe();
    Ok(ws.on_upgrade(move |socket| ws_loop(socket, rx)))
}

async fn ws_loop(mut socket: WebSocket, mut rx: broadcast::Receiver<String>) {
    use futures_util::StreamExt;
    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = socket.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn client_ip(headers: &HeaderMap) -> std::net::IpAddr {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse().ok())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or_else(|| std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
}

pub(crate) fn require_auth(
    state: &RemoteState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, String)> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Token requerido".into()))?;

    let slot = state
        .token
        .lock()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let Some(record) = slot.as_ref() else {
        return Err((StatusCode::UNAUTHORIZED, "No hay dispositivo emparejado".into()));
    };
    if record.revoked {
        return Err((StatusCode::UNAUTHORIZED, "Token revocado".into()));
    }
    if record.is_expired() {
        return Err((StatusCode::UNAUTHORIZED, "Token expirado".into()));
    }
    let supplied = hash_token(token);
    if supplied != record.hash {
        return Err((StatusCode::UNAUTHORIZED, "Token inválido".into()));
    }
    Ok(())
}
