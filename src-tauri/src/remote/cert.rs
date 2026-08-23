//! Certificado TLS autofirmado para el acceso remoto (móvil/navegador).
//! Se genera en la primera ejecución y se persiste en appdata.
//! El fingerprint SHA-256 se muestra en el modal del IDE para verificación TOFU.

use std::path::PathBuf;
use std::sync::Arc;

use rcgen::{CertificateParams, KeyPair, SanType};
use sha2::{Digest, Sha256};

pub struct RemoteCert {
    pub cert_pem: String,
    pub key_pem: String,
    /// Huella SHA-256 del certificado (formato AA:BB:CC:...)
    pub fingerprint: String,
}

fn cert_dir(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("remote")
}

fn fingerprint_of_der(der: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(der);
    let digest = hasher.finalize();
    digest
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(":")
}

/// Carga el certificado persistido o genera uno nuevo si no existe.
pub fn load_or_create(app_data_dir: &PathBuf) -> Result<RemoteCert, String> {
    let dir = cert_dir(app_data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("no se pudo crear dir de certificados: {e}"))?;

    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");

    if cert_path.exists() && key_path.exists() {
        if let (Ok(cert_pem), Ok(key_pem)) = (
            std::fs::read_to_string(&cert_path),
            std::fs::read_to_string(&key_path),
        ) {
            if let Some(fp) = fingerprint_from_pem(&cert_pem) {
                return Ok(RemoteCert {
                    cert_pem,
                    key_pem,
                    fingerprint: fp,
                });
            }
        }
    }

    generate_and_save(&dir, &cert_path, &key_path)
}

fn fingerprint_from_pem(cert_pem: &str) -> Option<String> {
    let parsed = x509_parser_from_pem(cert_pem)?;
    Some(fingerprint_of_der(&parsed))
}

/// Parsea un certificado PEM y devuelve el DER (lo esencial para el fingerprint).
fn x509_parser_from_pem(cert_pem: &str) -> Option<Vec<u8>> {
    let mut der = None;
    let mut in_cert = false;
    for line in cert_pem.lines() {
        if line.trim() == "-----BEGIN CERTIFICATE-----" {
            in_cert = true;
            der = Some(Vec::new());
            continue;
        }
        if line.trim() == "-----END CERTIFICATE-----" {
            break;
        }
        if in_cert {
            if let Some(buf) = der.as_mut() {
                buf.extend_from_slice(line.trim().as_bytes());
            }
        }
    }
    let b64 = der?;
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, String::from_utf8_lossy(&b64).as_ref())
        .ok()?;
    Some(bytes)
}

fn generate_and_save(dir: &PathBuf, cert_path: &std::path::Path, key_path: &std::path::Path) -> Result<RemoteCert, String> {
    // SANC: localhost + IPs LAN típicas para evitar reconexiones por cada IP.
    let mut san_names: Vec<String> = vec!["localhost".into(), "127.0.0.1".into(), "::1".into()];
    if let Ok(ip) = local_ip_address::local_ip() {
        san_names.push(ip.to_string());
    }

    let key_pair = KeyPair::generate()
        .map_err(|e| format!("generación de clave TLS falló: {e}"))?;

    let mut params = CertificateParams::new(san_names)
        .map_err(|e| format!("parámetros de certificado inválidos: {e}"))?;
    params
        .subject_alt_names
        .push(SanType::IpAddress(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)));
    params.not_before = rcgen::date_time_ymd(2020, 1, 1);
    params.not_after = rcgen::date_time_ymd(2035, 1, 1);

    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("autofirma del certificado falló: {e}"))?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();
    let fingerprint = fingerprint_of_der(&cert.der());

    std::fs::write(cert_path, &cert_pem).map_err(|e| format!("no se pudo guardar cert: {e}"))?;
    std::fs::write(key_path, &key_pem).map_err(|e| format!("no se pudo guardar key: {e}"))?;
    let _ = dir;

    Ok(RemoteCert {
        cert_pem,
        key_pem,
        fingerprint,
    })
}

/// Crea la configuración TLS de rustls a partir del certificado persistido.
pub fn rustls_config(cert: &RemoteCert) -> Result<Arc<rustls::ServerConfig>, String> {
    let certs = rustls_pemfile::certs(&mut cert.cert_pem.as_bytes())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("lectura de cert TLS falló: {e}"))?;
    let key = rustls_pemfile::private_key(&mut cert.key_pem.as_bytes())
        .map_err(|e| format!("lectura de key TLS falló: {e}"))?
        .ok_or_else(|| "no hay clave privada en el PEM".to_string())?;

    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| format!("config TLS inválida: {e}"))?;
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}
