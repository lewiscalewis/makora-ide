use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use futures_util::StreamExt;
use specta::Type;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub model_id: String,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub speed_mb_s: f64,
    pub status: String, // "downloading", "paused", "completed", "error"
    pub error_message: Option<String>,
}

struct DownloadTask {
    cancel_tx: tokio::sync::watch::Sender<bool>,
}

static ACTIVE_DOWNLOADS: LazyLock<Mutex<HashMap<String, DownloadTask>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static LATEST_PROGRESS: LazyLock<Mutex<HashMap<String, DownloadProgress>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn guard<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn models_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());

    #[cfg(target_os = "macos")]
    let base = std::env::var("HOME")
        .map(|h| PathBuf::from(h).join("Library/Application Support"))
        .unwrap_or_else(|_| std::env::temp_dir());

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|_| std::env::temp_dir());

    let dir = base.join("MakoraIDE").join("models");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn get_download_progress(model_id: &str) -> Option<DownloadProgress> {
    guard(&LATEST_PROGRESS).get(model_id).cloned()
}

pub fn cancel_download(model_id: &str) -> bool {
    if let Some(task) = guard(&ACTIVE_DOWNLOADS).remove(model_id) {
        let _ = task.cancel_tx.send(true);
        if let Some(p) = guard(&LATEST_PROGRESS).get_mut(model_id) {
            p.status = "paused".into();
        }
        true
    } else {
        false
    }
}

pub async fn start_download(
    app: AppHandle,
    model_id: String,
    download_url: String,
    filename: String,
) -> Result<(), String> {
    let dir = models_dir();
    let final_path = dir.join(&filename);
    let part_path = dir.join(format!("{filename}.part"));

    if final_path.exists() {
        return Ok(());
    }

    // Cancelar si ya hay una activa
    cancel_download(&model_id);

    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    guard(&ACTIVE_DOWNLOADS).insert(model_id.clone(), DownloadTask { cancel_tx });

    let model_id_clone = model_id.clone();

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let existing_bytes = if part_path.exists() {
            std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        let mut req = client.get(&download_url);
        if existing_bytes > 0 {
            req = req.header("Range", format!("bytes={existing_bytes}-"));
        }

        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                emit_error(&app, &model_id_clone, &format!("Error de conexión: {e}"));
                return;
            }
        };

        let is_partial = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        let content_len = resp.content_length().unwrap_or(0);
        let total_bytes = if is_partial {
            existing_bytes + content_len
        } else {
            content_len
        };

        let mut file = match tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part_path)
            .await
        {
            Ok(f) => f,
            Err(e) => {
                emit_error(&app, &model_id_clone, &format!("No se pudo abrir archivo: {e}"));
                return;
            }
        };

        let mut stream = resp.bytes_stream();
        let mut downloaded = if is_partial { existing_bytes } else { 0 };
        let mut last_emit = Instant::now();
        let mut last_bytes = downloaded;

        while let Some(chunk_res) = stream.next().await {
            if *cancel_rx.borrow() {
                let _ = file.flush().await;
                emit_status(&app, &model_id_clone, downloaded, total_bytes, 0.0, "paused", None);
                return;
            }

            match chunk_res {
                Ok(chunk) => {
                    if let Err(e) = file.write_all(&chunk).await {
                        emit_error(&app, &model_id_clone, &format!("Error escribiendo en disco: {e}"));
                        return;
                    }
                    downloaded += chunk.len() as u64;

                    if last_emit.elapsed().as_millis() > 300 {
                        let elapsed_sec = last_emit.elapsed().as_secs_f64();
                        let bytes_diff = downloaded.saturating_sub(last_bytes);
                        let speed_mb_s = (bytes_diff as f64 / (1024.0 * 1024.0)) / elapsed_sec.max(0.001);

                        emit_status(
                            &app,
                            &model_id_clone,
                            downloaded,
                            total_bytes,
                            speed_mb_s,
                            "downloading",
                            None,
                        );

                        last_emit = Instant::now();
                        last_bytes = downloaded;
                    }
                }
                Err(e) => {
                    emit_error(&app, &model_id_clone, &format!("Error de descarga: {e}"));
                    return;
                }
            }
        }

        let _ = file.flush().await;
        drop(file);

        // Renombrar de .part a .gguf final
        if let Err(e) = tokio::fs::rename(&part_path, &final_path).await {
            emit_error(&app, &model_id_clone, &format!("Error finalizando archivo: {e}"));
            return;
        }

        guard(&ACTIVE_DOWNLOADS).remove(&model_id_clone);
        emit_status(
            &app,
            &model_id_clone,
            total_bytes,
            total_bytes,
            0.0,
            "completed",
            None,
        );
    });

    Ok(())
}

fn emit_status(
    app: &AppHandle,
    model_id: &str,
    bytes_downloaded: u64,
    total_bytes: u64,
    speed_mb_s: f64,
    status: &str,
    error_message: Option<String>,
) {
    let percentage = if total_bytes > 0 {
        ((bytes_downloaded as f64 / total_bytes as f64) * 100.0).min(100.0)
    } else {
        0.0
    };

    let p = DownloadProgress {
        model_id: model_id.to_string(),
        bytes_downloaded,
        total_bytes,
        percentage,
        speed_mb_s,
        status: status.to_string(),
        error_message,
    };

    guard(&LATEST_PROGRESS).insert(model_id.to_string(), p.clone());
    let _ = app.emit("model-download-progress", p);
}

fn emit_error(app: &AppHandle, model_id: &str, err: &str) {
    guard(&ACTIVE_DOWNLOADS).remove(model_id);
    emit_status(app, model_id, 0, 0, 0.0, "error", Some(err.to_string()));
}
