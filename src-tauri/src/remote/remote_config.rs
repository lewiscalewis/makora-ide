//! Configuración remota: proveedor/modelo activos cuando el control
//! se ejerce desde el móvil (SPA web). Se persiste en appdata y se
//! sincroniza bidireccionalmente con el frontend del IDE.
//!
//! La API key NUNCA se guarda aquí ni viaja por HTTP: el `ChatConfig`
//! se construye en el proceso leyendo el keyring del sistema.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConfig {
    pub provider_id: String,
    pub model: String,
    pub base_url: String,
    /// kind del proveedor: "openai" | "anthropic" | "openai-compatible"
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
}

impl RemoteConfig {
    pub fn is_configured(&self) -> bool {
        !self.provider_id.is_empty() && !self.model.is_empty()
    }

    /// Construye un ChatConfig válido leyendo la API key del keyring
    /// del sistema en el proceso (nunca por la red).
    pub fn build_chat_config(&self) -> Result<crate::ChatConfig, String> {
        let api_key = crate::keyring_get_impl(&self.provider_id)
            .map_err(|e| format!("error al leer la API key del llavero: {e}"))?
            .ok_or_else(|| format!("API key no guardada en el llavero para '{}'", self.provider_id))?;
        let kind = if self.kind.is_empty() {
            "openai".into()
        } else {
            self.kind.clone()
        };
        Ok(crate::ChatConfig {
            kind: kind.clone(),
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            api_key,
            reasoning_effort: self.reasoning_effort.clone(),
            max_output_tokens: self.max_output_tokens,
            temperature: self.temperature,
            vision_enabled: false,
            context_window: None,
            fallback_kind: kind,
            fallback_base_url: String::new(),
            fallback_model: String::new(),
            fallback_api_key: String::new(),
            input_price_per_1m: 0.0,
            output_price_per_1m: 0.0,
            cached_price_per_1m: 0.0,
        })
    }
}

fn config_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("remote_config.json")
}

pub fn load(app_data_dir: &PathBuf) -> RemoteConfig {
    std::fs::read_to_string(config_path(app_data_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app_data_dir: &PathBuf, config: &RemoteConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(config_path(app_data_dir), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_config() {
        let dir = std::env::temp_dir().join("makora_remote_cfg_test");
        let _ = std::fs::create_dir_all(&dir);
        let cfg = RemoteConfig {
            provider_id: "openai".into(),
            model: "gpt-4o".into(),
            base_url: "https://api.openai.com/v1".into(),
            kind: "openai".into(),
            reasoning_effort: None,
            temperature: Some(0.7),
            max_output_tokens: Some(8192),
        };
        save(&dir, &cfg).unwrap();
        let loaded = load(&dir);
        assert_eq!(loaded, cfg);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
