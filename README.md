# ⚔️ MakoraIDE

Entorno de desarrollo agéntico nativo de alto rendimiento (Tauri v2 + Rust + React 19) optimizado para pairing autónomo con LLMs.

## 🚀 Características Principales

- **Bucle Agéntico Autónomo con Circuit Breaker:** Límite máximo de 25 turnos y disyuntor semántico para evitar bucles o consumo innecesario de tokens.
- **Concurrencia Multisesión Segura:** Pestañas de trabajo paralelas con aislamiento de streaming, drafts y persistencia no destructiva en `localStorage`.
- **Gateway Multi-Proveedor:** Integración con OpenAI, Anthropic, Gemini 3.x, DeepSeek, OpenRouter y Ollama (local).
- **Herramientas Nativas y MCP:** `read_file`, `write_file`, `apply_patch`, `grep`, `list_dir`, PTY Terminal xterm.js y servidores Model Context Protocol.
- **Soporte Windows-First:** Normalización automática de comandos y compatibilidad completa con `cmd.exe` y PowerShell.

## 🛠️ Compilación y Desarrollo

```bash
# Instalar dependencias frontend
npm install

# Compilar frontend
npm run build

# Compilar backend Rust
cargo build --manifest-path src-tauri/Cargo.toml

# Modo Desarrollo
npm run tauri dev
```

