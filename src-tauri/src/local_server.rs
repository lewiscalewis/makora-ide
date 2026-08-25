// Gestor de ciclo de vida del servidor de inferencia local embebido (llama-server sidecar y fallback a Ollama).

use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use specta::Type;
use tauri::AppHandle;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalServerStatus {
    pub is_running: bool,
    pub backend_type: String, // "managed_sidecar", "ollama_service", "stopped"
    pub base_url: String,
    pub active_model_id: String,
    pub port: u16,
}

struct ManagedServer {
    child: Option<std::process::Child>,
    port: u16,
    active_model_id: String,
}

static SERVER_STATE: LazyLock<Mutex<Option<ManagedServer>>> = LazyLock::new(|| Mutex::new(None));

fn guard<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn get_server_status() -> LocalServerStatus {
    let g = guard(&SERVER_STATE);
    if let Some(srv) = g.as_ref() {
        if srv.child.is_some() {
            return LocalServerStatus {
                is_running: true,
                backend_type: "managed_sidecar".into(),
                base_url: format!("http://127.0.0.1:{}/v1", srv.port),
                active_model_id: srv.active_model_id.clone(),
                port: srv.port,
            };
        }
    }

    LocalServerStatus {
        is_running: false,
        backend_type: "stopped".into(),
        base_url: "http://127.0.0.1:11434/v1".into(),
        active_model_id: String::new(),
        port: 11434,
    }
}

pub fn stop_managed_server() {
    let mut g = guard(&SERVER_STATE);
    if let Some(mut srv) = g.take() {
        if let Some(mut child) = srv.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn find_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(58432)
}

pub async fn start_local_model_server(
    _app_handle: &AppHandle,
    model_filename: &str,
    model_id: &str,
) -> Result<LocalServerStatus, String> {
    let models_dir = crate::model_downloader::models_dir();
    let model_path = models_dir.join(model_filename);

    if !model_path.exists() {
        return Err(format!("El archivo de modelo no existe en: {:?}", model_path));
    }

    // Detener cualquier instancia previa
    stop_managed_server();

    let port = find_free_port();

    // Buscar binario sidecar de llama-server
    let sidecar_candidates = [
        models_dir.join("bin").join("llama-server.exe"),
        models_dir.join("llama-server.exe"),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("llama-server.exe")))
            .unwrap_or_default(),
    ];

    let binary_path = sidecar_candidates
        .iter()
        .find(|p| p.exists())
        .cloned();

    if let Some(bin) = binary_path {
        let mut cmd = std::process::Command::new(bin);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        cmd.args([
            "-m",
            &model_path.to_string_lossy(),
            "--port",
            &port.to_string(),
            "--host",
            "127.0.0.1",
            "-c",
            "32768",
            "-ngl",
            "99", // Auto offload máximo a GPU
            "--flash-attn",
            "-ctk",
            "q8_0",
            "-ctv",
            "q8_0",
        ]);

        let child = cmd.spawn().map_err(|e| format!("Error iniciando llama-server: {e}"))?;

        // Guardar estado
        *guard(&SERVER_STATE) = Some(ManagedServer {
            child: Some(child),
            port,
            active_model_id: model_id.to_string(),
        });

        // Esperar a que /health responda
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()
            .map_err(|e| e.to_string())?;

        let health_url = format!("http://127.0.0.1:{port}/health");
        let mut ready = false;

        for _ in 0..60 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Ok(resp) = client.get(&health_url).send().await {
                if resp.status().is_success() {
                    ready = true;
                    break;
                }
            }
        }

        if !ready {
            eprintln!("[local_server] AVISO: El servidor sigue cargando tensores en background...");
        }

        return Ok(LocalServerStatus {
            is_running: true,
            backend_type: "managed_sidecar".into(),
            base_url: format!("http://127.0.0.1:{port}/v1"),
            active_model_id: model_id.to_string(),
            port,
        });
    }

    // Fallback si no hay binario embebido pero el usuario tiene Ollama corriendo
    Ok(LocalServerStatus {
        is_running: true,
        backend_type: "ollama_service".into(),
        base_url: "http://127.0.0.1:11434/v1".into(),
        active_model_id: model_id.to_string(),
        port: 11434,
    })
}
