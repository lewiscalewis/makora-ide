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
# 1. Instalar dependencias frontend
npm install

# 2. Modo Desarrollo con Hot Reload
npm run tauri dev

# 3. Validación de Calidad
npm test                  # Tests unitarios frontend (Vitest)
npx tsc --noEmit          # Verificación de tipos TypeScript
cargo test --manifest-path src-tauri/Cargo.toml  # Tests unitarios backend Rust
```

## 📦 Compilación de Instaladores (.exe y .msi)

Para empaquetar los instaladores finales de distribución en Windows:

```powershell
npm run tauri build
```

Los artefactos se generan automáticamente en:
* **Instalador NSIS (.exe):** `src-tauri/target/release/bundle/nsis/MakoraIDE_0.1.0_x64-setup.exe`
* **Instalador WiX (.msi):** `src-tauri/target/release/bundle/msi/MakoraIDE_0.1.0_x64_en-US.msi`
* **Binario Standalone (.exe):** `src-tauri/target/release/makora.exe`

Para directrices detalladas de desarrollo para agentes, consulta [AGENTS.md](file:///c:/Users/lewis/Projects/makora-ide/AGENTS.md).


