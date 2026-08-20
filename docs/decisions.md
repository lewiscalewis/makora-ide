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

## ADR-017 — Concurrencia por sesión: chatId end-to-end + SessionRuntimeStore + workspace por sesión + orquestación multiagente (2026-08-19)

- **Problema:** `agentBusy` booleano global (App.tsx) y `CANCEL: AtomicBool` global (agent.rs) impedían cambiar de sesión con un stream en curso; los eventos (`chat-delta-event`, `tool-*`, `thinking-delta`) se emitían sin id y dos sesiones concurrentes se contaminaban; `persistTranscript`/`addUsage` escribían en la sesión activa *en el momento de terminar* (corrupción); el `session_id` de historial derivaba del path del workspace (colisiones); el workspace (folders/editor/diff) era global.
- **Decisión:**
  1. **`chatId` end-to-end:** el id de sesión del frontend viaja en `chat`, `run_multiagent_plan`, `chat_cancel(chatId)` y en TODOS los payloads de eventos (`ChatDeltaEvent.chat_id`, `ThinkingDelta.chat_id`, `ToolStart/ToolOutput/ToolEnd.chat_id`, `MultiAgentPlanEvent.chat_id`). El frontend filtra todo por `chatId`.
  2. **Cancelación por chat en backend:** `agent.rs` sustituye el `AtomicBool` global por `CANCELLED: HashSet<String>` (`cancel_chat`/`clear_cancel`/`is_chat_cancelled`); `run()` y `run_multiagent()` limpian su bandera al inicio. `run_bash` espera el hijo con polling de 300 ms y **mata el proceso bash al cancelar** (además del timeout de 60 s).
  3. **SessionRuntimeStore (frontend):** `src/sessionStore.ts` — store externo por sesión (`useSyncExternalStore`) que posee transcript/UI/busy/activities/thinking/plan; el enrutado de eventos es módulo-nivel (sobrevive al cambio de pestaña); `Chat` pasa a ser **vista pura** (input/adjuntos/menús locales, todo lo demás del store). Sin `globalStreamActive`, sin "safety net" de desmontaje.
  4. **Persistencia correcta:** `addUsage(id, usage)` y `persistTranscript(id, messages)` reciben el id explícito y actualizan la sesión **in-place** (las pestañas no se reordenan; `saveSessions` conserva el orden del array).
  5. **Workspace por sesión (Fase 2):** `ChatSession.workspace?: SessionWorkspaceState` (folders, openFiles, activeFilePath, status, diff) sanitizado y persistido en `makora.sessions.v1`; explorador/editor/diff/terminal y git operan sobre la rebanada de la sesión activa; las sesiones nuevas heredan las carpetas de la activa. El cwd del terminal se fija al abrirlo (no se regenera al cambiar de pestaña).
  6. **Multiagente dinámico (Fase 3):** comando `run_multiagent_plan(chatId, objective)` ejecuta `MultiAgentPlanState` (Explorer → Coder → Tester → Reviewer) con toolset restringido por rol, briefing condensado entre pasos (≤600 chars), eventos `multiagent-plan-event` scoped por chatId y panel de supervisión en el Chat (toggle "Multi").
  7. **Sesión nueva por defecto:** `initSessions()` ya no restaura la última activa; crea una sesión nueva (migrando las carpetas globales previas) y las pestañas conservan su orden entre recargas.
  8. **Historial:** `session_id` de SQLite deriva del `chatId` (FNV-1a); `with_conn` usa `busy_timeout` de 2 s para escrituras concurrentes (WAL).
- **Riesgos aceptados:** la concurrencia real multiplica llamadas/tokens simultáneos (vigilar límites del proveedor); SQLite sigue tolerando errores silenciosos en checkpoints si dos turnos coinciden al ms.

## ADR-018 — Robustecimiento del motor Multi-Agente y Aislamiento Concurrente Multisesión (2026-08-19)

- **Problema:**
  1. En `run_multiagent`, los 4 subagentes emitían eventos de streaming directamente al `chat_id` principal, concatenando de forma caótica las reflexiones intermedias en el chat del usuario; la respuesta final descartaba la labor del Coder y solo guardaba la frase final del Revisor.
  2. En ejecución multisesión concurrente, al cambiar de pestaña mientras una sesión trabajaba, `persistTranscript` y `addUsage` leían `settings.model` de la pestaña activa en pantalla, sobreescribiendo el modelo de la sesión en segundo plano. El detector de ocupación solo evaluaba `activeSessionId`, congelando las sesiones en segundo plano en estado `running` permanente.
- **Decisión:**
  1. **Aislamiento de flujo de subagentes:** Los subagentes intermedios operan con ID con prefijo (`{chat_id}__sub_{step_index}`) para no contaminar el stream del usuario, mientras que sus herramientas (`tool-start`/`tool-end`) siguen asociadas al `chat_id` base para visualización interactiva en tiempo real.
  2. **Fase 5 de Síntesis del Orquestador:** Se añadió una fase maestra final donde el Orquestador toma el briefing consolidado de todos los subagentes y genera una respuesta completa, estructurada y en streaming limpio hacia la ventana de chat.
  3. **Aislamiento multisesión en `App.tsx`:** `updateActiveWorkspace` admite `targetSessionId` explícito; el hook de supervisión monitoriza el estado de cada sesión individualmente; `persistTranscript` y `addUsage` vinculan el modelo inmutable de cada sesión.
  4. **Corrección visual de selector de modelos:** Unificación y estilización del dropdown popover (`bottom-up`, glassmorphic dark theme, buscador con iconos e interactividad fluida).

## ADR-019 — Formato de wire universal por proveedor + saneamiento de historial (2026-08-20)

- **Problema:** historiales inválidos para la API al cruzar proveedores o al podar historia (mensajes `tool` huérfanos, usuarios consecutivos en Anthropic, asistentes vacíos `content: []`, `tool_result` con id desconocido), y parámetros rechazados por endpoints estrictos/locales (`reasoning_effort` inválido, `stream_options` en Ollama/LM Studio). Resultado: errores 400 frecuentes y "errores al cambiar de proveedor".
- **Decisión:**
  1. `gateway.rs` sanitiza el wire SIEMPRE antes de enviar: `sanitize_openai_wire` (descarta `tool` sin id conocido/asistentes vacíos) y reconstrucción completa de mensajes en `anthropic_turn` (elimina leading non-user, fusiona usuarios consecutivos, descarta `tool_result` huérfanos, ids de `tool_use` con fallback).
  2. `agent.rs::sanitize_history` + `prepare_wire` aplican el mismo saneamiento al transcript en memoria (post evicción/fit_history).
  3. Normalización de `reasoning_effort` por proveedor (`norm_effort_openai`/`norm_effort_anthropic`; Anthropic: `minimal`→`low`, thinking `adaptive` solo en modelos 4.x, `enabled`+budget en anteriores). Endpoints locales (localhost/127.0.0.1) omiten `stream_options`/`reasoning_effort`.
  4. Tool results vacíos se envían como `[sin salida]`.

## ADR-020 — Multi-Agente por delegación (sustituye al pipeline de 5 fases, 2026-08-20)

- **Problema:** el DAG fijo Explorer→Coder→Tester→Reviewer→Síntesis duplicaba el historial completo y el system prompt en cada fase (explosión de tokens), no estaba conectado al hilo principal (sin eventos de herramientas, formato final distinto) y ejecutaba todas las fases aunque la tarea no lo requiriese.
- **Decisión:** el modo Multi activa la herramienta `delegate_subagent` (roles explorer/coder/tester/reviewer) en el MISMO bucle agéntico principal. El agente decide qué delegar y cuándo; cada subagente recibe contexto mínimo (skill base + rol + tarea + `context` aportado por el principal + raíces del workspace), devuelve solo un briefing condensado (≤400 palabras) y sus herramientas emiten `tool-start`/`tool-end` con prefijo `sub:{rol}:` asociados al chat principal (semi-transparente, como cualquier herramienta). El formato final de respuesta no se altera. `explore_subagent` se mantiene como alias del rol explorer.
- **Consecuencias:** `run_multiagent` = `run_loop` con directiva de delegación + tool extra (bucle, checkpoints, metering y detección de bucles unificados); el evento `multiagent-plan-event` y el panel quedan sin uso (la interfaz muestra la actividad vía cards de herramientas).

## ADR-021 — Estabilidad: locks poison-safe, MCP no bloqueante y defensas anti-cierre (2026-08-20)

- **Problema:** `panic = "abort"` en release convierte cualquier panic en cierre de la app; todos los `.lock().unwrap()` en `agent/mcp/terminal/token_engine/history` propagaban poisoning; `mcp_configure` (comando síncrono) bloqueaba el hilo principal hasta 20s por servidor; el export de bindings usaba `.expect()` en arranque.
 - **Decisión:** helper `guard()` (lock con `into_inner` en caso de poison) en todos los módulos; `mcp_configure` pasa a `spawn_blocking`; `mcp::call` se ejecuta en `spawn_blocking` desde `execute_tool`; el export de `bindings.ts` registra error sin panic; `run_bash` sube a 600s (alineado con el diseño documentado). En frontend: al cambiar de proveedor se selecciona síncronamente el modelo recomendado del nuevo proveedor (evita 404/400 al chatear antes de cargar modelos) y `reasoningEffort` solo se envía si es válido.

## ADR-022 — Pestañas de sesión siempre disponibles para trabajo en paralelo (2026-08-21)

- **Problema:** el botón **+** de pestañas reutilizaba la sesión activa cuando esta estaba vacía (sin mensajes, sin transcript y no ocupada), por lo que al arrancar con una sesión limpia el clic era un no-op. Además, `initSessions()` descartaba toda sesión sin mensajes, perdiendo pestañas vacías recién abiertas al recargar.
- **Decisión:** `handleNewSession` elimina la heurística de reutilización y crea SIEMPRE una pestaña nueva (heredando las carpetas del workspace activo), de modo que el usuario puede abrir desde el inicio un proyecto distinto por sesión y trabajar en paralelo. `initSessions()` conserva las sesiones con `workspace.folders`/`workspace.openFiles`/`workspace.activeFilePath` asignados aunque aún no tengan mensajes, y solo poda las completamente vacías (sin mensajes y sin workspace).
- **Consecuencias:** el botón **+** permanece renderizado de forma incondicional en `WorkspaceTabBar` (ya lo estaba); cada pestaña mantiene workspace y chat independientes; las pestañas vacías con proyecto abierto sobreviven a la recarga.

## ADR-023 — Blindaje Integral Anti-Bucles, Circuit Breaker Semántico y Persistencia No Destructiva (2026-08-20)

- **Problema:**
  1. Consultas analíticas complejas o fallos de comandos en Windows causaban bucles infinitos de herramientas sin límite en `run_loop` (`loop {}`), acumulando más de 400 iteraciones, 28 millones de tokens y costes descontrolados de API.
  2. El detector de bucles degenerados (`sig == prev_sig`) fallaba si el modelo variaba ligeramente un argumento o leía un rango diferente de líneas.
  3. `run_bash` en Windows (`cmd.exe /C`) fallaba ante rutas Unix (`/c/Users/...`), provocando reintentos infinitos del LLM.
  4. La saturación de memoria por transcripts masivos forzaba a `shrinkSessions` a vaciar los mensajes de todas las pestañas (`messages: []`), provocando que `initSessions` eliminara pestañas sanas al reiniciar.
- **Decisión:**
  1. **Techo de Seguridad (`MAX_AGENT_TURNS = 25`):** Ninguna consulta puede extenderse más allá de 25 turnos en `run_loop`.
  2. **Presupuesto Máximo (`MAX_TURN_TOKENS = 500_000`):** Parada de seguridad automática ante consumos anómalos masivos de tokens.
  3. **Circuit Breaker Semántico (`MAX_CONSECUTIVE_READ_ONLY = 6`):** Si se encadenan 6 lecturas de solo lectura (`read_file`, `grep`, `list_dir`) sin mutar código, se fuerza la síntesis y conclusión final.
  4. **Normalización Windows en `run_bash`:** Las rutas Unix se convierten automáticamente a formato Windows (`C:/Users/...`).
   5. **Persistencia No Destructiva en `sessions.ts`:** `shrinkSessions` trunca únicamente mensajes antiguos y outputs gigantes de la sesión pesada sin borrar jamás los mensajes de las demás pestañas. `initSessions()` preserva todas las pestañas abiertas por el usuario. `handleNewSession` guarda inmediatamente de forma síncrona en `localStorage`.

## ADR-024 — Ola P0 de robustez: retry, filesystem `.gitignore`-aware, spill y repair de tools (2026-08-20)

- **Problema:** benchmark contra opencode (`docs/opencode-benchmark.md`) detectó en MakoraIDE: cero reintentos ante 429/5xx/errores de red (un turno se rompía ante un fallo transitorio del proveedor); `grep`/`list_dir` usaban walkers propios con lista negra hardcodeada (ciegos a `.gitignore`, lentos, el agente veía `node_modules`/build artifacts de repos ajenos); los outputs truncados de bash/read/grep perdían el contenido sobrante (sin acceso al resto); y un nombre de tool ligeramente mal formado por el modelo (mayúsculas, guiones, `mcp_git_status` vs `mcp__git__status`) terminaba en "herramienta desconocida" sin recuperación.
- **Decisión:**
  1. **Retry (`gateway.rs::send_with_retry`):** hasta 3 intentos con backoff exponencial (base 750ms) + jitter + `Retry-After` (cap 30s) para errores de red, 408, 5xx y 429 de rate-limit. Los 429 por saldo/quotas (`Insufficient Balance`, `quota`, `billing`…) NO se reintentan (no tiene sentido). La cancelación por chat aborta la espera entre reintentos. El retry es solo para la conexión inicial del stream (no reintenta a mitad de stream para no duplicar texto ya emitido).
  2. **Filesystem `.gitignore`-aware (crate `ignore`):** `grep_dir` y `list_dir_entries` usan `WalkBuilder` con `git_ignore/git_global/git_exclude/ignore/hidden` (misma semántica que ripgrep en opencode), manteniendo `is_ignored_path` como filtro extra (`.lock`, `.min.js`, `.map`…). `list_dir` pasa a ser gitignore-aware y determinista (carpetas primero, alfabético).
  3. **Spill de truncados (`spill_output`/`truncate_tool_output`):** cuando bash/read_file/read_file_range/grep superan su presupuesto, la salida COMPLETA se guarda en `%TEMP%/makora_truncated/<tool>_<pid>_<n>.txt` y el resultado truncado incluye la ruta para que el agente pueda leerla con `read_file_range` si necesita más.
  4. **Repair de tools (`repair_tool_name`):** antes de ejecutar, se normaliza el nombre colapsando case/guiones/espacios/dos-puntos y se busca coincidencia contra tools core y MCP registradas; si hay match se usa el nombre canónico. Subagentes incluidos (sin MCP).
- **Consecuencias:** 32 tests unitarios pasan (8 nuevos); el bucle no muere por fallos transitorios de proveedor; grep/lista respetan las reglas de ignorado del proyecto real; los presupuestos de tokens ya no destruyen información (spill accesible); los errores de tool por nombre mal formado caen a casi cero.

## ADR-025 — Tools todowrite/question, títulos LLM y compactación jerárquica (P1.9/P1.8/P1.15, 2026-08-20)

- **Problema:** el agente no tenía visibilidad del plan ante el usuario ni forma de preguntar decisiones bloqueantes; los títulos de sesión eran el primer mensaje truncado; y el contexto solo se podaba por presupuesto de tokens (pérdida de decisiones en sesiones largas).
- **Decisión:**
  1. **`todowrite`:** estado por chat en `agent.rs` (`TODOS`), evento `todo-update` al frontend, normalización de estados (una sola `in_progress`, inválidos→`pending`) en función pura testeable; UI de chip resumen + lista expandible encima del input.
  2. **`question`:** evento `question-ask` + `tokio::oneshot` por pregunta (`PENDING_QUESTIONS`), timeout 600s, cancelación por chat, comando IPC `question_reply`; UI con opciones y respuesta libre. El modelo solo debe usarla para decisiones bloqueantes (directiva en la skill).
  3. **Títulos LLM (`generate_title`):** turno utilitario async fire-and-forget (max 24 tokens, temperature 0.2, reasoning off, timeout 25s) con `chat_id` sintético `__title_` para que los deltas no contaminen la UI; deduplicación por sesión en `App.tsx`; fallback silencioso al título truncado.
  4. **Compactación jerárquica (`compact_history_llm`):** disparo cuando el historial >60% del contexto (clamp 16k-64k tokens) y han pasado ≥6 turnos desde la última compactación; split en el último assistant con tool calls (cola wire-válida con sus resultados); head serializado (`[Usuario]/[Asistente]/[Resultado de herramienta]`, ≤12k chars, del más reciente al más antiguo); resumen LLM sin tools (≤1200 tokens) que sustituye el head por par user+assistant estable (prefijo cacheable); el uso de la compactación se acumula y se registra en `requests`.
- **Consecuencias:** la decisión de compactar es medible en `[TOKEN_ENGINE] compactación LLM: N -> M mensajes`; en fallo del resumen se continúa sin compactar (nunca rompe el turno); `fit_history` sigue como última línea de defensa. 36 tests unitarios pasan.

## ADR-026 — Permisos ask/allow/deny por sesión (P1.7, 2026-08-20)

- **Problema:** el agente ejecutaba `write_file`/`apply_patch`/`bash`/MCP sin intervención del usuario (solo restricción al workspace y bloqueo de comandos peligrosos), y leía archivos sensibles (`.env`, claves) sin aviso. Benchmark opencode: permisos granulares con "última regla gana", patrones wildcard y feedback correctivo.
- **Decisión:**
  1. **Motor de reglas por sesión** (`SESSION_PERMS` en `agent.rs`): lista de `(tool, pattern, action)`; la última regla que matchea gana (`evaluate_rules`); patrones: `*` universal, prefijo con aridad para bash (`git status *`), prefijo de ruta (`C:/.../proyecto/*`) y coincidencia exacta.
  2. **Gate en la ejecución** (`gate_permission`): `write_file`/`apply_patch`/`bash`/MCP → ask por defecto (salvo regla allow/deny); lecturas de archivos sensibles (`.env`, `*.pem`, `id_rsa*`, `credentials`…) → ask; el resto de lecturas y `todowrite`/`question`/subagentes de delegación → sin gate. Los subagentes heredan las mismas reglas de sesión (el display muestra `sub:{rol}:{tool}`).
  3. **Flujo de aprobación:** evento `approval-required` + oneshot (timeout 600s, cancelable); comando IPC `approval_reply(decision, feedback)`; `allow_once` / `allow_always` (añade regla allow con el patrón actual) / `deny` con feedback que se devuelve AL MODELO como parte del error para que corrija el rumbo. Las reglas se reinician al empezar un turno nuevo (`clear_session_perms`).
- **Consecuencias:** el usuario audita cada mutación; "Permitir siempre" convierte el flujo en no-intrusivo por patrón; el rechazo con motivo alimenta el siguiente turno (CorrectedError); sin UI (p. ej. TUI futura) el timeout 600s protege contra bloqueos. 40 tests unitarios pasan.

## ADR-027 — Modo Plan impuesto a nivel de tools + fix del circuit breaker de lecturas (2026-08-20)

- **Problema:** en una sesión real de modo plan el agente alcanzó el techo de 25 turnos leyendo rangos de archivos. Dos causas: (1) el modo plan solo cambiaba el system prompt — las herramientas de escritura/ejecución seguían disponibles; (2) `todowrite`/`question` (nuevas en ADR-025) se clasificaban como "no read-only", lo que marcaba `has_mutated = true` y desactivaba para siempre el circuit breaker semántico de 6 lecturas consecutivas (ADR-023).
- **Decisión:**
  1. **Modo Plan a nivel de catálogo de tools:** `chat`/`run_multiagent_plan` reciben `plan_mode`; `run_loop` filtra el catálogo a `read_file/read_file_range/grep/list_dir/todowrite/question/explore_subagent` y añade la directiva `PLAN_MODE_DIRECTIVE` (el modelo ni siquiera ve tools mutadoras, igual que el agente `plan` de opencode deniega `edit`).
  2. **Clasificación de tools en 3 niveles (`tool_kind`):** `ReadOnly` (incrementa el breaker), `Neutral` (`todowrite`/`question`: no afectan al contador), `Mutating` (resetea el breaker y marca `has_mutated`). `delegate_subagent`/`explore_subagent`/MCP se tratan como `Mutating` (conservador).
- **Consecuencias:** en modo plan la exploración se detiene a las 6 lecturas consecutivas sin mutación y sintetiza el plan; el techo de 25 turnos queda como última defensa real; `todowrite` al inicio de un plan ya no rompe el breaker. 41 tests unitarios pasan.

## ADR-028 — webfetch y skills SKILL.md (P1.10/P1.14, 2026-08-20)

- **Problema:** el agente no podía consultar documentación externa (webfetch/websearch de opencode) ni aprovechar skills de proyecto (compatibilidad SKILL.md de Claude Code); Makora solo tenía la skill núcleo hardcodeada.
- **Decisión:**
  1. **`webfetch`:** solo esquemas http/https (`valid_fetch_url`), timeout 25s, cap 5 MB (por `content_length` y por tamaño real), UA de navegador, conversión HTML→Markdown con `html2md` tras limpiar `script/style/noscript/iframe/svg/head` por regex; el output se trunca con spill (`truncate_tool_output`, 6000 tokens). Permiso ask por URL (el patrón de regla `allow_always` es la propia URL). Clasificación `ReadOnly` para el breaker; permitida en modo plan y en el rol explorer; directiva en la skill base (una petición por página).
  2. **Skills SKILL.md:** discovery en `<workspace>/.makora/skills/*/SKILL.md`, `<workspace>/.opencode/skills/*/SKILL.md`, `~/.makora/skills/*/SKILL.md` y `~/.claude/skills/*/SKILL.md` (compat Claude Code). Frontmatter `name`/`description` parseado manualmente; el system prompt solo lista `nombre — descripción` (lazy: el contenido NO se inyecta); la tool `skill` carga el contenido bajo demanda al transcript. `MAKORA_BASE_SKILL` se mantiene como núcleo universal (no se sustituye). Caché por chat en `SKILLS_BY_CHAT`.
- **Consecuencias:** sin dependencias pesadas para el HTML (html2md puro Rust); los skills no pagan tokens si no se cargan; el usuario puede añadir skills sin recompilar. 45 tests unitarios pasan.

## ADR-029 — Snapshots/revert por turno, MCP resources+prompts, explorador `.gitignore`-aware y confianza de sesión (2026-08-20)

- **Problema:** (1) los cambios del agente no eran deshacibles a nivel de turno (opencode los revierte con shadow-git); (2) el cliente MCP solo exponía tools (resources/prompts ignorados); (3) el explorador del IDE y la búsqueda @ usaban lista negra hardcodeada (no `.gitignore`); (4) el panel de permisos carecía de opción global de confianza por sesión; (5) `panic = "abort"` en release impedía compilar `html2md` y convertía cualquier panic en cierre de app.
- **Decisión:**
  1. **Snapshots por turno (`TurnSnapshot`/`SnapshotGuard` en `agent.rs`):** antes de cada `write_file`/`apply_patch` (principal y subagentes) se copia el contenido original del archivo (o se marca `created`) en `%APPDATA%/MakoraIDE/snapshots/{session}/{run}` con `manifest.json`; el guard se registra al salir de `run_loop` (incluso en error/cancelación, patrón Drop); se conservan los últimos 5 turnos por sesión. Comando `revert_last_turn` restaura/elimina y devuelve resumen; botón "↩" en la barra del chat (deshabilitado mientras la sesión está ocupada). `MAKORA_DATA_DIR` permite redirigir en tests.
  2. **MCP resources/prompts (`mcp.rs`):** tras `initialize`, si el servidor declara capabilities, se registran las pseudo-tools `mcp__{s}__list_resources`/`read_resource`/`list_prompts`/`get_prompt` que despachan `resources/list|read` y `prompts/list|get` por JSON-RPC (mismo canal stdio).
  3. **Explorador y @-mentions `.gitignore`-aware:** `list_dir` y `search_walk` de `lib.rs` usan `WalkBuilder` del crate `ignore` (misma semántica que las tools del agente).
  4. **Confianza por sesión:** nuevas decisiones del panel de permisos `trust_session` (regla `tool="*", pattern="*"` allow) y `deny_always` (regla deny por tool+patrón).
  5. **`panic = "unwind"` en release:** los panics de hilos worker desenrollan en vez de tumbar la app (los `guard()` poison-safe de ADR-021 siguen vigentes); habilita dependencias que exigen `panic_unwind` (html2md).
- **Consecuencias:** deshacer el último turno restaura archivos con un clic; los MCP con resources/prompts quedan completamente expuestos al agente; el árbol de archivos de la UI coincide con lo que el agente ve; instaladores NSIS+MSI generados sin errores. 47 tests unitarios Rust + 33 vitest pasan.




