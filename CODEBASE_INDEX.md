# 🗺️ Makora IDE — Codebase Index & Architectural Reference

> **Documento Maestro de Enrutamiento y Referencia Técnica para Agentes IA (Antigravity / Gemini) y Desarrolladores.**  
> *Proporciona el mapa completo del sistema, topología Rust Tauri 2 + React 19, esquemas IPC, base de datos SQLite WAL, motor de tokens con poda inteligente y catálogo de componentes en una sola lectura de alta densidad.*

---

## 🏛️ 1. Topología del Sistema y Arquitectura Híbrida

Makora IDE es un entorno de desarrollo agéntico nativo de alto rendimiento construido sobre **Tauri v2 (Rust Backend)** y **React 19 + TypeScript (Frontend)**:

```
                                  +-------------------------------------------------------------+
                                  |                     FRONTEND (React 19)                     |
                                  | App.tsx · UnifiedWorkspace · Chat · Terminal · Explorer     |
                                  +-------------------------------------------------------------+
                                                                 │  ▲
                                  IPC Tauri Commands (Specta)    │  │  SSE Streams & PTY Events
                                  (JSON-RPC bidireccional tipado)│  │  (ChatDeltaEvent, term:data)
                                                                 ▼  │
                                  +-------------------------------------------------------------+
                                  |                      TAURI 2 CORE (Rust)                    |
                                  |                         src-tauri/src/                      |
                                  +-------------------------------------------------------------+
                                         │              │              │              │
                    ┌────────────────────┼──────────────┼──────────────┼──────────────┘
                    ▼                    ▼              ▼              ▼
           +────────────────+   +────────────────+   +────────────────+   +────────────────+
           | Agent & Loop   |   | Gateway Engine |   | PTY Terminal   |   | History SQLite |
           |   agent.rs     |   |   gateway.rs   |   |  terminal.rs   |   |   history.rs   |
           | (Tools + MCPs) |   |(Pruning + SSE) |   |(portable-pty)  |   | (WAL Sessions) |
           +────────────────+   +────────────────+   +────────────────+   +────────────────+
                    │                    │                                        │
                    ▼                    ▼                                        ▼
           +────────────────+   +────────────────+                       +────────────────+
           | Token Engine   |   | OS DPAPI Vault |                       | history.db     |
           |token_engine.rs |   | keyring-rs (v3)|                       | (SQLite WAL)   |
           +────────────────+   +────────────────+                       +────────────────+
```

---

## 📁 2. Mapa Rápido de Módulos (Fast-Routing Map)

### 🦀 Backend Rust (`src-tauri/src/`)

| Archivo | Responsabilidad Principal | Símbolos / Funciones Clave | Dependencias |
|---|---|---|---|
| [`src-tauri/src/lib.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/lib.rs) | Punto de entrada del backend, registro de 38 comandos IPC con Specta y exportación de TypeScript bindings. | `run()`, `list_dir()`, `read_text_file()`, `write_file()`, `chat()`, `term_spawn()`, `git_status()` | `tauri`, `tauri-specta`, `serde_json` |
| [`src-tauri/src/agent.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/agent.rs) | Bucle de ejecución autónoma del agente con salvaguardas anti-bucles (`MAX_AGENT_TURNS = 25`, `MAX_TURN_TOKENS = 500k`), Circuit Breaker semántico (6 lecturas máx), normalización Windows en `run_bash` y delegación multiagente. | `run_loop()`, `core_tools()`, `execute_tool()`, `delegate_subagent()`, `is_read_only_tool()` | `gateway`, `history`, `mcp`, `token_engine` |
| [`src-tauri/src/gateway.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/gateway.rs) | Gateway universal multi-proveedor (OpenAI, Anthropic, Gemini 3.x con retención de `thought_signature`, DeepSeek, Ollama) con **poda inteligente de tokens (`prune_tool_output`)**. | `openai_turn()`, `anthropic_turn()`, `ollama_turn()`, `prune_tool_output()`, `fetch_models()` | `reqwest`, `serde_json`, `futures-util` |
| [`src-tauri/src/token_engine.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/token_engine.rs) | Motor de conteo y presupuestación de tokens BPE local vía tiktoken-rs y compositor de contexto. | `TokenCounter::count()`, `truncate_to_budget()`, `ContextComposer` | `tiktoken-rs` |
| [`src-tauri/src/history.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/history.rs) | Persistencia relacional SQLite WAL para sesiones, checkpoints de transcript, solicitudes de modelos y metering. | `HistoryManager::new()`, `save_session()`, `save_request()`, `RequestMeter` | `rusqlite` |
| [`src-tauri/src/terminal.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/terminal.rs) | Emulador de terminal PTY nativo con streaming bidireccional concurrente hacia xterm.js. | `Terminals::spawn()`, `Terminals::write()`, `Terminals::resize()`, `Terminals::kill()` | `portable-pty`, `tokio` |
| [`src-tauri/src/mcp.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/mcp.rs) | Cliente nativo Model Context Protocol (MCP) sobre stdio con descubrimiento dinámico de herramientas. | `McpRegistry::configure()`, `list_tools()`, `call_tool()` | `serde_json`, `tokio::process` |
| [`src-tauri/src/balance.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/balance.rs) | Consultor en vivo de saldo y cuotas de facturación para DeepSeek y OpenRouter API. | `fetch_balance()`, `BalanceInfo` | `reqwest` |
| [`src-tauri/src/main.rs`](file:///c:/Users/lewis/Projects/makora-ide/src-tauri/src/main.rs) | Binario ejecutable de arranque. Llama a `makora_lib::run()`. | `main()` | `makora_lib` |

---

### ⚛️ Frontend React (`src/`)

| Archivo | Responsabilidad Principal | Componentes / Funciones | Dependencias |
|---|---|---|---|
| [`src/App.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/App.tsx) | Estado maestro, atajos globales de teclado, persistencia de proveedor en Keyring/localStorage y layouts responsivos. | `App()`, `loadSettings()`, `addUsage()`, `persistTranscript()`, `openFile()` | React, `api.ts`, `types.ts`, `sessions.ts` |
| [`src/sessions.ts`](file:///c:/Users/lewis/Projects/makora-ide/src/sessions.ts) | Gestor de sesiones concurrentes con aislamiento de draft, pestañas independientes y persistencia no destructiva en localStorage (`shrinkSessions` / `initSessions`). | `makeSession()`, `saveSessions()`, `shrinkSessions()`, `initSessions()`, `getSessionRuntime()` | `types.ts` |
| [`src/sessionStore.ts`](file:///c:/Users/lewis/Projects/makora-ide/src/sessionStore.ts) | Store reactivo por sesión (`useSyncExternalStore`) con enrutado de eventos y aislamiento de streaming. | `subscribeSessionStream()`, `emitSessionChunk()`, `clearSessionStream()` | React |
| [`src/components/Chat.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/Chat.tsx) | Panel de chat agéntico con desplegables sutiles (`GroupedToolsDropdown`, `ThinkingDropdown`), @ mentions y Markdown. | `Chat()`, `GroupedToolsDropdown()`, `ThinkingDropdown()`, `AntigravityToolItem()` | `lucide-react`, `Markdown.tsx` |
| [`src/components/UnifiedWorkspace.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/UnifiedWorkspace.tsx) | Área de trabajo central multisesión con soporte dividido (Split View) e integración del editor y visor de diffs. | `UnifiedWorkspace()` | `CodeEditor.tsx`, `DiffViewer.tsx` |
| [`src/components/CodeEditor.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/CodeEditor.tsx) | Editor de código nativo sobre CodeMirror 6 con resaltado sintáctico, folding, minimapa y atajos de guardado. | `CodeEditor()` | `@codemirror/*` |
| [`src/components/TerminalPanel.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/TerminalPanel.tsx) | Terminal embebida xterm.js conectada en tiempo real al PTY del backend Rust. | `TerminalPanel()` | `@xterm/xterm`, `@xterm/addon-fit` |
| [`src/components/Explorer.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/Explorer.tsx) | Explorador de árbol de archivos interactivo (crear, renombrar, eliminar, arrastrar, abrir). | `Explorer()`, `FileTreeItem()` | `lucide-react`, `api.ts` |
| [`src/components/HistoryModal.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/HistoryModal.tsx) | Modal de historial de conversaciones con búsqueda, renombrado, coste en USD y **métricas de tokens (`⚡ tok`)**. | `HistoryModal()`, `HistoryRow()` | `lucide-react` |
| [`src/components/SettingsModal.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/SettingsModal.tsx) | Configuración integral: proveedores, API keys en Keyring, precios de modelos, MCPs, contexto y temas. | `SettingsModal()` | `lucide-react`, `providers.ts` |
| [`src/components/UsagePanel.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/UsagePanel.tsx) | Panel lateral derecho de parámetros: selector de proveedor con autorestauración de key, thinking level y balance. | `UsagePanel()` | `lucide-react`, `providers.ts` |
| [`src/components/GitModal.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/GitModal.tsx) | Cliente visual de Git integrado: staging/unstaging por archivo, diffs en vivo, commit, push y pull. | `GitModal()` | `lucide-react`, `api.ts` |
| [`src/components/AnalyticsModal.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/AnalyticsModal.tsx) | Métricas y gráficos de telemetría de tokens, velocidad de generación y distribución de costes. | `AnalyticsModal()` | `lucide-react` |
| [`src/components/CommandPalette.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/CommandPalette.tsx) | Omnibox de comandos rápidos estilo VS Code (`Ctrl+P` / `Ctrl+K`). | `CommandPalette()` | `lucide-react` |
| [`src/components/Header.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/Header.tsx) | Barra superior con selector de workspace, añadir carpetas, toggles de paneles y acceso a ajustes. | `Header()` | `lucide-react` |
| [`src/components/StatusBar.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/StatusBar.tsx) | Barra de estado inferior: rama git, modelo activo, indicador de agente ocupado, tokens y coste de sesión. | `StatusBar()` | `lucide-react` |
| [`src/components/Markdown.tsx`](file:///c:/Users/lewis/Projects/makora-ide/src/components/Markdown.tsx) | Renderizador Markdown enriquecido con soporte de bloques de código interactivos y botón "Aplicar al proyecto". | `Markdown()` | `marked`, `prismjs` |
| [`src/api.ts`](file:///c:/Users/lewis/Projects/makora-ide/src/api.ts) | Capa de abstracción sobre `invoke()` y eventos Tauri. | `chat()`, `listDir()`, `readTextFile()`, `keyringGet()` | `@tauri-apps/api` |
| [`src/sessions.ts`](file:///c:/Users/lewis/Projects/makora-ide/src/sessions.ts) | Gestor de persistencia en localStorage para sesiones de chat con sanitización y métricas de tokens. | `initSessions()`, `saveSessions()`, `makeSession()` | `types.ts` |
| [`src/providers.ts`](file:///c:/Users/lewis/Projects/makora-ide/src/providers.ts) | Catálogo de presets de proveedores preconfigurados (DeepSeek, OpenRouter, OpenAI, Anthropic, Gemini, Ollama). | `PROVIDERS`, `presetById()` | `types.ts` |
| [`src/types.ts`](file:///c:/Users/lewis/Projects/makora-ide/src/types.ts) | Definición maestro de interfaces TypeScript (UI, Agent, Config, ChatSession, ToolActivity, Themes). | `UiMessage`, `ChatSession`, `ModelConfig` | TypeScript |

---

## ⚡ 3. Motor de Eficiencia de Tokens y Poda Inteligente

El núcleo de optimización de tokens opera en tres niveles complementarios:

### A. Poda Inteligente de Herramientas Históricas (`prune_tool_output` en `gateway.rs`)
Para evitar que las lecturas de archivos y salidas de terminal anteriores se reenvíen indefinidamente multiplicando el coste:
* **Turnos Recientes (últimos 2 turnos / 6 mensajes):** Se envían al **100% de detalle** para preservar la capacidad de diagnóstico y edición exacta del código.
* **Turnos Históricos Anteriores:** Las salidas de herramientas mayores a 350 caracteres se compactan preservando cabecera y pie con el resumen de ahorro:
  ```
  [Líneas iniciales...]
  ... [180 líneas / 6.420 bytes de salida previa omitidos para ahorro de tokens] ...
  [Líneas finales...]
  ```
* **Ahorro promedio medido:** **60%–80%** de tokens de entrada en sesiones multi-turno.

### B. Prefijo Estable y Caché Efímera de Proveedor
* En Anthropic (`anthropic_turn`), el system prompt y las definiciones de herramientas se estructuran con bloques `cache_control: { type: "ephemeral" }`, activando prompt caching institucional.
* En DeepSeek / OpenRouter, la ordenación inmutable de mensajes permite alcanzar tasas de `cached_tokens` superiores al 70%.

### C. Conteo y Presupuestación Local (`token_engine.rs`)
* Tokenizador local BPE vía `tiktoken-rs` con cuotas por componente (`system_prompt`, `workspace_rules`, `history_budget`).

---

## 🔒 4. Seguridad y Gestión de Credenciales

```
                    ┌────────────────────────────────────────────────────────┐
                    │                   CREDENTIAL PIPELINE                  │
                    └────────────────────────────────────────────────────────┘
                                                 │
                        ┌────────────────────────┴────────────────────────┐
                        ▼                                                 ▼
             +──────────────────────+                          +──────────────────────+
             | OS Keyring (Nativo)  |                          | LocalStorage Vault   |
             | Windows DPAPI Vault  |                          | makora.provider_keys |
             | (keyring-rs v3)      |                          | (Caché por Provider) |
             +──────────────────────+                          +──────────────────────+
```

1. **Almacenamiento Cifrado:** Las API Keys se almacenan en el almacén seguro nativo del sistema operativo (**Windows DPAPI / Credential Manager**) mediante `keyring_get` y `keyring_set`.
2. **Aislamiento Multi-Proveedor:** Cada proveedor (`deepseek`, `openrouter`, `openai`, `anthropic`, `gemini`) mantiene su propia clave aislada. Al cambiar de proveedor en el UI, la clave correcta se restaura automáticamente.
3. **Fallback Resiliente:** Si el servicio Keyring del SO no está disponible en entornos restringidos, se utiliza el mapa seguro per-proveedor en `localStorage`.

---

## 🗄️ 5. Esquema de Base de Datos SQLite (`history.rs`)

Makora IDE utiliza SQLite en modo WAL (`history.db`) en el directorio de datos de la app:

```sql
-- Sesiones de desarrollo agéntico
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    total_cost_usd REAL NOT NULL DEFAULT 0.0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0
);

-- Turnos e intercambios del chat
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_call_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Checkpoints para rollback/undo de turnos
CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    workspace_state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Telemetría y auditoría de peticiones
CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cached_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
```

---

## 🛠️ 6. Catálogo de Herramientas Agénticas Nativas

Las herramientas son ejecutadas por el agente de forma autónoma con visualización sutil en el frontend:

| Herramienta | Parámetros | Descripción y Comportamiento |
|---|---|---|
| `read_file` | `path: string` | Lee el contenido completo de un archivo (con truncado de seguridad a 120 KB). |
| `read_file_range` | `path: string, start: number, end: number` | Lee un rango específico de líneas 1-indexed (ideal para inspecciones quirúrgicas). |
| `write_file` | `path: string, content: string` | Escribe o sobreescribe un archivo completo en el workspace. |
| `apply_patch` | `path: string, patch: string` | Aplica una edición quirúrgica con formato diff `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE`. |
| `list_dir` | `path: string` | Lista archivos y subdirectorios de una ruta con metadatos. |
| `grep` | `pattern: string, path?: string` | Búsqueda recursiva de expresiones regulares o texto plano en el workspace. |
| `bash` | `command: string` | Ejecuta un comando en PowerShell / cmd de forma síncrona con captura de stdout/stderr. |

---

## 🚀 7. Protocolo Operativo y Comandos de Compilación

### Desarrollo Local Interactivo
```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npm run tauri dev
```

### Compilación y Verificación de Tipos Frontend
```powershell
npm run build
```

### Compilación de Release e Instaladores de Producción
```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npm run tauri build
```

**Artefactos Generados en Release:**
* **Ejecutable:** `src-tauri/target/release/makora.exe`
* **Instalador NSIS:** `src-tauri/target/release/bundle/nsis/MakoraIDE_0.1.0_x64-setup.exe`
* **Instalador MSI:** `src-tauri/target/release/bundle/msi/MakoraIDE_0.1.0_x64_en-US.msi`
