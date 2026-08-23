//! Túnel público con Cloudflare Quick Tunnel (`cloudflared`).
//!
//! Expone el servidor HTTPS local (autofirmado) a internet mediante una URL
//! `https://*.trycloudflare.com` efímera, sin necesidad de cuenta ni token.
//! TLS termina en Cloudflare, por lo que el móvil ve un certificado válido.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, RwLock};

/// Manejador del proceso cloudflared y su URL pública.
pub struct Tunnel {
    pub url: Arc<RwLock<Option<String>>>,
    pub child: Child,
}

/// Localiza el binario `cloudflared` (PATH) o lo descarga en `app_data_dir`.
pub async fn resolve_binary(app_data_dir: &Path) -> Result<PathBuf, String> {
    if let Some(p) = find_in_path(bin_name()) {
        return Ok(p);
    }
    let local = app_data_dir.join(bin_name());
    if local.is_file() {
        return Ok(local);
    }
    download_binary(app_data_dir, &local).await?;
    Ok(local)
}

/// Arranca `cloudflared tunnel --url https://127.0.0.1:<port>`.
pub fn spawn_tunnel(binary: &Path, local_port: u16) -> Result<Tunnel, String> {
    let url = Arc::new(RwLock::new(None));

    let mut cmd = Command::new(binary);
    cmd.arg("tunnel")
        .arg("--url")
        .arg(format!("https://127.0.0.1:{local_port}"))
        .arg("--no-tls-verify")
        .arg("--no-autoupdate")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo iniciar cloudflared: {e}"))?;

    if let Some(out) = child.stdout.take() {
        spawn_reader(out, url.clone());
    }
    if let Some(err) = child.stderr.take() {
        spawn_reader(err, url.clone());
    }

    Ok(Tunnel { url, child })
}

fn bin_name() -> &'static str {
    if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    }
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

async fn download_binary(dir: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {dir:?}: {e}"))?;

    let url = download_url()?;
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Descarga de cloudflared fallida: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Descarga de cloudflared fallida (HTTP {})", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Error leyendo la descarga: {e}"))?;
    std::fs::write(dest, &bytes).map_err(|e| format!("No se pudo escribir {dest:?}: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

fn download_url() -> Result<String, String> {
    let base = "https://github.com/cloudflare/cloudflared/releases/latest/download/";
    let asset = if cfg!(windows) {
        "cloudflared-windows-amd64.exe"
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "aarch64") {
            "cloudflared-linux-arm64"
        } else {
            "cloudflared-linux-amd64"
        }
    } else if cfg!(target_os = "macos") {
        return Err(
            "En macOS instala cloudflared previamente con: brew install cloudflared".into(),
        );
    } else {
        return Err("Plataforma no soportada para descargar cloudflared automáticamente".into());
    };
    Ok(format!("{base}{asset}"))
}

fn spawn_reader(stream: impl Read + Send + 'static, url: Arc<RwLock<Option<String>>>) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(found) = extract_tunnel_url(&line) {
                if let Ok(mut w) = url.write() {
                    *w = Some(found);
                }
            }
        }
    });
}

/// Extrae la URL `https://*.trycloudflare.com` del volcado de salida de cloudflared.
fn extract_tunnel_url(line: &str) -> Option<String> {
    for token in line.split(|c: char| {
        c.is_whitespace() || matches!(c, '"' | '\'' | '`' | '|' | '(' | ')' | '[' | ']')
    }) {
        let t = token.trim_matches(|c| matches!(c, '"' | '\'' | '`' | ',' | '.' | ';'));
        if t.starts_with("https://") && t.contains("trycloudflare.com") {
            return Some(t.to_string());
        }
    }
    None
}
