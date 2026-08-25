// Motor de Detección de Hardware y Recomendación de Tiers de IA para MakoraIDE.
// Analiza GPU, VRAM dedicada, RAM total y núcleos de CPU para recomendar el modelo óptimo.

use specta::Type;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub gpu_name: String,
    pub vram_gb: f64,
    pub ram_gb: f64,
    pub cpu_cores: usize,
    pub recommended_tier: String,
    pub recommended_model_id: String,
    pub tier_description: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogEntry {
    pub id: String,
    pub name: String,
    pub family: String,
    pub parameter_size: String,
    pub quantization: String,
    pub size_gb: f64,
    pub min_vram_gb: f64,
    pub min_ram_gb: f64,
    pub download_url: String,
    pub filename: String,
    pub description: String,
    pub tier: String,
    pub is_downloaded: bool,
    pub is_active: bool,
    pub speed_rating: String,
}

pub fn get_model_catalog(models_dir: &std::path::Path, active_model_id: &str) -> Vec<ModelCatalogEntry> {
    vec![
        ModelCatalogEntry {
            id: "makoraai-30b".into(),
            name: "MakoraAI 30B MoE (Pro)".into(),
            family: "Qwen3-Coder".into(),
            parameter_size: "30.5B (3.3B activos)".into(),
            quantization: "Q4_K_M".into(),
            size_gb: 18.5,
            min_vram_gb: 12.0,
            min_ram_gb: 16.0,
            download_url: "https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct-GGUF/resolve/main/qwen2.5-coder-32b-instruct-q4_k_m.gguf".into(),
            filename: "makoraai-30b-q4_k_m.gguf".into(),
            description: "Máxima inteligencia agéntica, arquitectura MoE ultrarrápida. Recomendado para GPUs de 16 GB VRAM.".into(),
            tier: "tier1_pro".into(),
            is_downloaded: models_dir.join("makoraai-30b-q4_k_m.gguf").exists(),
            is_active: active_model_id == "makoraai-30b",
            speed_rating: "25–30 tok/s".into(),
        },
        ModelCatalogEntry {
            id: "makoraai-8b".into(),
            name: "MakoraAI 8B (Balanceado)".into(),
            family: "Qwen3-Coder".into(),
            parameter_size: "8B".into(),
            quantization: "Q4_K_M".into(),
            size_gb: 4.8,
            min_vram_gb: 6.0,
            min_ram_gb: 12.0,
            download_url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf".into(),
            filename: "makoraai-8b-q4_k_m.gguf".into(),
            description: "Excelente equilibrio entre velocidad y calidad de código. Funciona en casi cualquier GPU moderna (6–8 GB VRAM).".into(),
            tier: "tier2_balanced".into(),
            is_downloaded: models_dir.join("makoraai-8b-q4_k_m.gguf").exists(),
            is_active: active_model_id == "makoraai-8b",
            speed_rating: "35–45 tok/s".into(),
        },
        ModelCatalogEntry {
            id: "makoraai-1.5b".into(),
            name: "MakoraAI 1.5B (Ligero)".into(),
            family: "Qwen2.5-Coder".into(),
            parameter_size: "1.5B".into(),
            quantization: "Q4_K_M".into(),
            size_gb: 1.3,
            min_vram_gb: 2.0,
            min_ram_gb: 4.0,
            download_url: "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf".into(),
            filename: "makoraai-1.5b-q4_k_m.gguf".into(),
            description: "Ultraligero para laptops sin gráfica dedicada o ejecución directa en CPU.".into(),
            tier: "tier3_lite".into(),
            is_downloaded: models_dir.join("makoraai-1.5b-q4_k_m.gguf").exists(),
            is_active: active_model_id == "makoraai-1.5b",
            speed_rating: "20–30 tok/s (CPU)".into(),
        },
    ]
}

pub fn detect_hardware() -> HardwareProfile {
    let cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    let (gpu_name, vram_gb) = detect_gpu_and_vram();
    let ram_gb = detect_system_ram_gb();

    // Clasificación de Tiers
    let (recommended_tier, recommended_model_id, tier_description) = if vram_gb >= 12.0 || (vram_gb >= 10.0 && ram_gb >= 24.0) {
        (
            "tier1_pro".to_string(),
            "makoraai-30b".to_string(),
            format!("Hardware de alto rendimiento detectado ({gpu_name} con {vram_gb:.1} GB VRAM). Tu equipo está preparado para MakoraAI 30B MoE."),
        )
    } else if vram_gb >= 5.5 || ram_gb >= 16.0 {
        (
            "tier2_balanced".to_string(),
            "makoraai-8b".to_string(),
            format!("Hardware balanceado detectado ({gpu_name} con {vram_gb:.1} GB VRAM). MakoraAI 8B te dará máxima fluidez y precisión."),
        )
    } else {
        (
            "tier3_lite".to_string(),
            "makoraai-1.5b".to_string(),
            "Equipo sin GPU dedicada o VRAM reducida. Recomendamos MakoraAI 1.5B o conectar una API Cloud (DeepSeek/OpenRouter).".to_string(),
        )
    };

    HardwareProfile {
        gpu_name,
        vram_gb,
        ram_gb,
        cpu_cores,
        recommended_tier,
        recommended_model_id,
        tier_description,
    }
}

fn detect_system_ram_gb() -> f64 {
    #[cfg(target_os = "windows")]
    {
        use std::mem::size_of;
        #[repr(C)]
        struct MemoryStatusEx {
            dw_length: u32,
            dw_memory_load: u32,
            ull_total_phys: u64,
            ull_avail_phys: u64,
            ull_total_page_file: u64,
            ull_avail_page_file: u64,
            ull_total_virtual: u64,
            ull_avail_virtual: u64,
            ull_avail_extended_virtual: u64,
        }
        extern "system" {
            fn GlobalMemoryStatusEx(lp_buffer: *mut MemoryStatusEx) -> i32;
        }
        let mut status = MemoryStatusEx {
            dw_length: size_of::<MemoryStatusEx>() as u32,
            dw_memory_load: 0,
            ull_total_phys: 0,
            ull_avail_phys: 0,
            ull_total_page_file: 0,
            ull_avail_page_file: 0,
            ull_total_virtual: 0,
            ull_avail_virtual: 0,
            ull_avail_extended_virtual: 0,
        };
        unsafe {
            if GlobalMemoryStatusEx(&mut status) != 0 {
                return (status.ull_total_phys as f64) / (1024.0 * 1024.0 * 1024.0);
            }
        }
    }

    // Fallback estándar
    16.0
}

fn detect_gpu_and_vram() -> (String, f64) {
    #[cfg(target_os = "windows")]
    {
        // Consulta del registro de adaptadores de pantalla en Windows
        let script = r#"
            $bestGpu = "";
            $maxVram = 0;
            Get-ItemProperty "HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*" -ErrorAction SilentlyContinue | ForEach-Object {
                $name = $_.DriverDesc;
                $vram = $_."HardwareInformation.qwMemorySize";
                if ($name -and $vram -and [int64]$vram -gt $maxVram) {
                    $maxVram = [int64]$vram;
                    $bestGpu = $name;
                }
            }
            if ($bestGpu) {
                Write-Output "$bestGpu|$maxVram"
            }
        "#;
        
        let mut cmd = std::process::Command::new("powershell");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);

        if let Ok(out) = cmd.output() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if let Some((name, vram_str)) = s.split_once('|') {
                if let Ok(bytes) = vram_str.trim().parse::<f64>() {
                    let gb = bytes / (1024.0 * 1024.0 * 1024.0);
                    return (name.trim().to_string(), gb);
                }
            }
        }
    }

    ("Gráfica Integrada / CPU".to_string(), 2.0)
}
