//! Emparejamiento y sesión única para el acceso remoto.
//!
//! Flujo de seguridad:
//! 1. El IDE genera un código de emparejamiento (8 chars, alfabeto sin ambigüedades)
//!    con TTL corto (3 min). El usuario lo teclea en el móvil (o escanea el QR).
//! 2. Al validar el código (con rate-limit anti fuerza bruta), el servidor emite
//!    un token opaco de 256 bits.
//! 3. El token se guarda hasheado (SHA-256) en memoria con TTL (12 h renovable).
//! 4. SESIÓN ÚNICA: al emparejar un nuevo dispositivo, el token anterior se invalida.
//! 5. Revocación desde el IDE o desde el móvil cierra la sesión al instante.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use rand::Rng;
use sha2::{Digest, Sha256};

/// Duración de validez del código de emparejamiento.
pub const PAIR_CODE_TTL: Duration = Duration::from_secs(3 * 60);
/// Intentos fallidos permitidos antes de aplicar cooldown.
pub const MAX_FAILED_ATTEMPTS: u32 = 5;
/// Cooldown tras exceder intentos.
pub const FAIL_COOLDOWN: Duration = Duration::from_secs(60);
/// TTL del token de sesión (12 h, renovable con actividad).
pub const TOKEN_TTL: Duration = Duration::from_secs(12 * 60 * 60);
/// Longitud del token en bytes (256 bits).
const TOKEN_BYTES: usize = 32;
/// Alfabeto sin caracteres ambiguos (0/O/1/I/L).
const PAIR_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIR_CODE_LEN: usize = 8;

#[derive(Clone, Debug)]
pub struct PairingCode {
    pub code: String,
    pub created_at: Instant,
}

impl PairingCode {
    pub fn is_expired(&self) -> bool {
        self.created_at.elapsed() > PAIR_CODE_TTL
    }
}

#[derive(Clone, Debug)]
pub struct TokenRecord {
    /// Hash SHA-256 del token (nunca guardamos el token plano).
    pub hash: [u8; 32],
    pub created_at: Instant,
    /// Última actividad (renueva el TTL).
    pub last_active: Instant,
    /// Nombre del dispositivo (lo envía el cliente al emparejar).
    pub device_label: String,
    pub revoked: bool,
}

impl TokenRecord {
    pub fn is_expired(&self) -> bool {
        self.last_active.elapsed() > TOKEN_TTL
    }

    pub fn touch(&mut self) {
        self.last_active = Instant::now();
    }
}

/// Genera un código de emparejamiento aleatorio.
pub fn generate_pair_code() -> String {
    let mut rng = rand::thread_rng();
    (0..PAIR_CODE_LEN)
        .map(|_| {
            let idx = rng.gen_range(0..PAIR_ALPHABET.len());
            PAIR_ALPHABET[idx] as char
        })
        .collect()
}

pub fn hash_token(token: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher.finalize().into()
}

/// Genera un token opaco de 256 bits (base64url sin padding, seguro en URLs).
pub fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let mut bytes = [0u8; TOKEN_BYTES];
    rng.fill(&mut bytes);
    base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        bytes,
    )
}

/// Limita intentos fallidos de emparejamiento por IP.
#[derive(Default)]
pub struct RateLimiter {
    attempts: HashMap<IpAddr, (Instant, u32)>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// `true` si la IP está bloqueada por cooldown.
    pub fn is_blocked(&self, ip: &IpAddr) -> bool {
        if let Some((since, count)) = self.attempts.get(ip) {
            if *count >= MAX_FAILED_ATTEMPTS {
                if since.elapsed() < FAIL_COOLDOWN {
                    return true;
                }
            }
        }
        false
    }

    pub fn register_failure(&mut self, ip: &IpAddr) {
        let entry = self.attempts.entry(*ip).or_insert((Instant::now(), 0));
        if entry.0.elapsed() > FAIL_COOLDOWN {
            *entry = (Instant::now(), 0);
        }
        entry.1 += 1;
    }

    pub fn reset(&mut self, ip: &IpAddr) {
        self.attempts.remove(ip);
    }

    /// Limpia entradas antiguas para evitar crecimiento infinito.
    pub fn gc(&mut self) {
        self.attempts.retain(|_, (since, _)| since.elapsed() < FAIL_COOLDOWN);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_generates_valid_alphabet() {
        let code = generate_pair_code();
        assert_eq!(code.len(), 8);
        assert!(code.chars().all(|c| PAIR_ALPHABET.contains(&(c as u8))));
    }

    #[test]
    fn token_hashes_and_never_stores_plain() {
        let token = generate_token();
        let h1 = hash_token(&token);
        let h2 = hash_token(&token);
        assert_eq!(h1, h2);
        assert_ne!(token, format!("{:?}", h1));
        assert!(token.len() >= 40);
    }

    #[test]
    fn pair_code_expires() {
        let code = PairingCode {
            code: "ABCDEFGH".into(),
            created_at: Instant::now() - PAIR_CODE_TTL - Duration::from_secs(1),
        };
        assert!(code.is_expired());
    }

    #[test]
    fn token_expires_and_touch_renews() {
        let mut rec = TokenRecord {
            hash: [0u8; 32],
            created_at: Instant::now() - TOKEN_TTL - Duration::from_secs(1),
            last_active: Instant::now() - TOKEN_TTL - Duration::from_secs(1),
            device_label: "test".into(),
            revoked: false,
        };
        assert!(rec.is_expired());
        rec.touch();
        assert!(!rec.is_expired());
    }

    #[test]
    fn rate_limiter_blocks_after_max_failures() {
        let mut rl = RateLimiter::new();
        let ip: IpAddr = "192.168.1.10".parse().unwrap();
        for _ in 0..MAX_FAILED_ATTEMPTS {
            assert!(!rl.is_blocked(&ip));
            rl.register_failure(&ip);
        }
        assert!(rl.is_blocked(&ip));
        rl.reset(&ip);
        assert!(!rl.is_blocked(&ip));
    }
}
