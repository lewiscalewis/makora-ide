# Decisiones de arquitectura (ADR) — MakoraIDE

Fecha: 2026-08-18. Evidencia cacheada en `docs/research/*.md` (no re-fetchear; política de caché en CONTEXT.md).

## ADR-001 — Shell de escritorio: Tauri 2

- **Decisión:** Tauri 2 (core Rust + WebView del SO; WebView2 en Windows).
- **Justificación:** el core agéntico (contexto/tokens/herramientas) vive en Rust dentro del mismo binario, sin doble runtime JS; plugins oficiales cubren todo (fs, shell, process, store, updater, dialog, window-state); ACL de capacidades por comando, crítico para un agente que ejecuta herramientas; distribución ~3 MB vs ~364 MB de Electron; maduro (v2 estable, ~110k stars).
- **Rechazado:** Electron (peso/RAM, doble runtime, seguridad más débil); gpui/Zed (GPL-3.0; reimplementar el editor en Rust = años); egui (immediate mode, inadecuado para editor de código); Flutter (sin motores de edición maduros, aísla el frontend del core).
- **Riesgos aceptados:** (1) en Windows la RAM no siempre es menor que Electron (benchmark CI: 313 vs 260 MB) → benchmark propio en spike M0; (2) arranque en frío más lento (~732 ms) → aceptable; (3) consistencia de WebView2 entre máquinas → fijar versión mínima y probar workers; (4) builds Rust lentos (~256 s CI) → sccache + release profiles (`lto`, `strip`, `opt-level="s"`).

## ADR-002 — Frontend y motor de edición: React + TypeScript + CodeMirror 6

- **Decisión:** React 19 + TypeScript + Vite. Editor principal: CodeMirror 6 (Lezer). Plan B: Monaco + monaco-languageclient.
- **Justificación CM6:** virtualización superior con archivos grandes/líneas largas; parsing real con Lezer; bundle modular (menos peso en WebView); ecosistema web completo para diffs/dashboards.
- **Trigger del plan B:** si la integración LSP en CM6 se atasca >1 semana (no hay equivalente oficial a monaco-languageclient; se adapta con vscode-languageserver-protocol o el core Rust reparte los resultados).
- **Riesgo verificado en M0:** web workers bajo el asset protocol de Tauri + CSP.

## ADR-003 — Core en Rust + Tokio; IPC tipado con tauri-specta

- **Decisión:** todo el runtime agéntico y el motor de tokens viven en el proceso Rust (Tokio). El frontend es SOLO vista. IPC: comandos/eventos tipados con tauri-specta (tipos Rust → TS generados).
- **Consecuencia:** prohibido meter lógica de tokens/herramientas en el frontend.

## ADR-004 — Gateway de modelos: cliente fino propio (reqwest)

- **Decisión:** cliente HTTP propio con reqwest (SSE vía reqwest-eventsource) para OpenAI Responses API, Anthropic Messages API y Ollama (REST :11434).
- **Justificación:** control total de headers de caché (`prompt_cache_key`, `cache_control`), streaming, cancelación y métricas; cero dependencia de SDKs pesados.
- **Rechazado:** async-openai / SDKs oficiales dentro del loop (solo como referencia de formatos de wire).

## ADR-005 — Conteo de tokens: tiktoken-rs + HF tokenizers

- **Decisión:** conteo local con tiktoken-rs (o200k_base, cl100k_base) para modelos OpenAI; HF tokenizers para Llama/Gemini/Mistral. Fuente de verdad: campo `usage` del API, persistido por request.
- **Fallback:** modelos sin tokenizador conocido → heurística chars/4 con recalibración continua (regresión contra usage real).

## ADR-006 — Persistencia: SQLite (rusqlite, bundled, WAL)

- **Decisión:** una conexión SQLite (WAL, feature `bundled`) para sesiones, items de transcript, checkpoints por turno, memorias KV, métricas y caché.
- **Rechazado:** JSON en disco (sin transacciones/consultas), Redb/RocksDB (innecesario a escala escritorio).

## ADR-007 — Runtime agéntico propio (sin SDK pesado)

- **Decisión:** loop explícito turno = LLM → tools → resultados, con `max_turns`, presupuesto en tokens/USD, stream tipado de eventos, handoffs como tools, guardrails de tool pre/post ejecución.
- **MCP:** cliente mínimo stdio (`discover`, `tools/list`, `tools/call`) con namespacing `mcp__server__tool`. Se omiten en prototipo: resources, prompts, elicitation, OAuth, subscriptions (se revalida con polling).

## ADR-008 — Seguridad: pipeline de permisos + sandbox nivel 1

- **Decisión:** orden fijo deny → ask → allow → callback UI (estilo Claude Code); reglas con patrones (`Bash(cargo *)`, `Write(path)`); ejecución en subprocess con cwd confinado, timeout, límite de stdout (truncar + etiquetar), env sanitizado, kill-tree al cancelar. Aprobación = interrupción serializable (HITL resumible). Rutas críticas nunca auto-aprobadas.
- **Nivel 2 (post-prototipo):** contenedor Docker opcional con allowlist de dominios para tareas de red (patrón Computer Use).

## ADR-009 — Caché semántica local: fastembed-rs

- **Decisión:** embeddings ONNX locales (bge-small / jina-code) + índice en memoria; TTL corto; invalidación por hash de archivos referenciados; simhash para dedup. Un hit = 100% de ahorro de la llamada. Solo respuestas de tareas de SOLO LECTURA (nunca mutadoras).

## ADR-010 — Mapa de repositorio estilo Aider + Tree-sitter

- **Decisión:** repo-map de símbolos (clases/funciones/firmas) con tree-sitter, ranking tipo PageRank sobre grafo de dependencias, presupuesto de tokens dinámico; regeneración con notify-debouncer. Embeddings del codebase = fase 2 (fastembed).

## ADR-011 — Pines de tauri-specta y entorno M0

- **Decisión:** tauri-specta `=2.0.0-rc.25` (sin estable aún) con features `derive,typescript` y dependencias directas `specta = "=2.0.0-rc.25"`, `specta-typescript = "0.0.12"`. Comandos con `#[specta::specta]`; eventos con derive `Event` (nombre = kebab-case del tipo). Cuando exista versión estable, migrar y quitar los pines exactos.
- **Entorno M0 instalado:** Rust 1.97.1 (stable-msvc) vía rustup; VS Build Tools 2022 17.14 con workload VCTools (MSVC 14.44). Gotchas en CONTEXT.md §"Notas técnicas de M0".

## ADR-016 — Motor de Temas Makora, Command Palette y Elevación de Usabilidad IDE

- **Decisión:**
  1. **Motor de Temas CSS Dinámico:** 5 temas Makora (`Makora Void`, `Makora Obsidian Emerald`, `Makora Tokyo Night`, `Makora Solar Flare`, `Makora Synthwave 84`) mediante CSS Custom Properties reactivas inyectadas en `document.documentElement` y sincronizadas en xterm.js, CodeMirror, markdown y menús con persistencia en `localStorage`.
  2. **Command Palette (`Ctrl+P` / `Ctrl+K`):** Spotlight flotante con búsqueda difusa en archivos de todos los workspaces (`searchPaths`) y catálogo de comandos de navegación y configuración.
  3. **Status Bar Inferior:** Barra de estado permanente que ancla la interfaz, mostrando el estado del workspace, estado de actividad del agente (Listo / Ejecutando / Pensando), badge de modelo, métricas de tokens y coste en vivo, toggle de terminal y selector de tema.
  4. **Editor CodeMirror con Guardado (`Ctrl+S`):** Modo editable con detección de cambios no guardados (`isDirty` dot) y guardado directo en disco con `writeFile`.
  5. **Terminal PTY Conectada a Workspace:** `term_spawn` hereda el directorio raíz del workspace activo del usuario.

