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

## ADR-030 — Vigilante anti-bucles v2: nudge→forzar en vez de topes duros + presupuesto de coste que pregunta (2026-08-20)

- **Problema:** el vigilante anterior cortaba trabajo legítimo (breaker de 6 lecturas consecutivas, techo de 25 turnos, 500k tokens por turno) — en una sesión real el usuario perdió ~10$ con turnos truncados sin resultados. La filosofía de opencode es la contraria: señales precisas (doom-loop con umbral 3 y PREGUNTA al usuario, `maxSteps` con prompt suave de "responde ya", compactación en overflow) y control del usuario (coste visible + cancelación), sin topes duros.
- **Decisión (nudge → forzar, sin limitar potencia):**
  1. **Señales de bucle con alta precisión, respuesta en 2 niveles:**
     - **Nudge** (mensaje `user` sintético inyectado; el modelo puede corregir el rumbo y seguir) y **Force** (turno final sin tools con motivo explícito, vía `forced_final_turn`).
     - Repetición exacta del lote de herramientas (misma firma ordenada): nudge en la 1ª, force en la 2ª.
     - **Estancamiento por novedad nula** (nuevo): FNV-1a de los resultados de cada ronda; si una ronda no aporta NINGÚN resultado nuevo (ya visto), se acumula señal — nudge en 2 rondas, force en 3. Detecta bucles de "llamadas distintas, información repetida".
     - **Exploración excesiva SOLO en modo plan** (donde el objetivo es el plan, no la tarea): nudge a las 8 rondas de solo lectura, force a las 12. **En modo Act no hay límite de lecturas** (potencia total).
  2. **Fusibles extremos de último recurso:** 100 turnos / 2M tokens por turno (solo se alcanzan ante anomalías reales).
  3. **Presupuesto de coste OPCIONAL por turno** (config `maxCostPerTurn` en Ajustes, default 0 = sin límite): al alcanzarlo el agente PREGUNTA al usuario (reutiliza el mecanismo de `question`) si continuar sin límite o detener y sintetizar — nunca corta solo. Extraído `ask_user_question` como helper compartido (tool `question` + presupuesto).
  4. Subagentes: 8 pasos y 250k tokens (antes 6/150k).
- **Consecuencias:** en modo Act el agente puede explorar tanto como necesite; el vigilante solo interviene ante bucles reales (repetición exacta o resultados redundantes) y el usuario mantiene el control del gasto con una pregunta en vez de una parada silenciosa. 47 tests Rust + 33 vitest pasan.

## ADR-031 — Vigilante transparente (estilo opencode) + fix de "Confiar sesión" (2026-08-20)

- **Problema (reportado en uso real):** (1) el nudge se inyectaba como mensaje `role: "user"` sintético: el modelo lo interpretaba como intervención del usuario, contaminaba el transcript persistido y confundía la conversación ("El comando bash fue rechazado; usaré las herramientas nativas"); (2) "Confiar sesión" añadía la regla global PERO `gate_permission` rechazaba la llamada actual (solo aceptaba `allow_once`/`allow_always`) y además `clear_session_perms` al inicio de cada turno borraba las reglas de confianza (la confianza duraba solo el turno actual).
- **Decisión:**
  1. **Nudge transparente:** el aviso al modelo viaja como NOTA DE SISTEMA (se añade a `system_extra` y se envía como parte del system prompt del siguiente turno — el modelo lo recibe como instrucción de sistema, no como usuario) y el transcript no se contamina. En paralelo se emite el evento `agent-notice` que la UI muestra como banner ámbar "Vigilante Makora" (visible para el usuario, no persistido).
  2. **Force pregunta al usuario (estilo opencode doom_loop):** cuando se alcanza una señal de fuerza (repetición exacta, novedad nula, plan extenso), el agente PREGUNTA vía panel de pregunta: "Detener y sintetizar" o "Continuar sin límite". Continuar → se resetean las señales y se avisa al modelo vía nota de sistema. Solo los fusibles extremos (100 turnos/2M tokens) fuerzan directamente. Cooldown de 6 turnos entre preguntas (si se repite, se fuerza).
  3. **Fix "Confiar sesión":** `gate_permission` acepta `trust_session` como éxito (la llamada actual se ejecuta) y las reglas de permisos YA NO se resetean por turno (persisten por sesión/chatId durante la vida de la app, como la memoria de aprobaciones de opencode).
- **Consecuencias:** el usuario ve SIEMPRE cuándo interviene el vigilante y decide; el modelo no confunde avisos del sistema con palabras del usuario; "Confiar sesión" funciona como se espera (sin preguntas repetidas entre turnos). 47 tests Rust + 33 vitest pasan.

## ADR-032 — Vigilante invisible: cero ruido para el usuario (2026-08-20)

- **Problema (feedback del usuario):** los avisos del vigilante (banners ámbar y preguntas "Detener/Continuar") interrumpían la experiencia. En opencode real, el doom_loop casi nunca pregunta porque el modelo se autocorrige con las notas de sistema (`maxSteps` inyecta "responde ya" sin preguntar); el comportamiento percibido es "hace lo que tiene que hacer sin fallar". Se busca eso: intervención silenciosa.
- **Decisión (todo invisible):**
  1. **Nudge = SOLO nota de sistema silenciosa** (`system_extra` en el system prompt del siguiente turno). Sin banners de UI, sin evento `agent-notice`, sin mensajes user falsos: el usuario no ve nada y el modelo recibe la corrección como instrucción de sistema (se autocorrige como en opencode).
  2. **Force = síntesis final silenciosa:** cuando una señal de fuerza se confirma, `forced_final_turn` termina el turno con la respuesta sintetizada del modelo SIN prefijos "⚠️" ni avisos (motivo solo en log `[TOKEN_ENGINE] vigilante`). Sin preguntas al usuario.
  3. **Medida extrema permanece:** fusibles de 100 turnos / 2M tokens (invisibles, última defensa real).
  4. El presupuesto de coste (`maxCostPerTurn`, off por defecto) es la ÚNICA pregunta posible y solo existe porque el usuario la configuró explícitamente.
- **Consecuencias:** para el usuario el agente "solo funciona"; ante un bucle real el modelo es corregido en silencio y, si persiste, el turno concluye con una respuesta normal. 47 tests Rust + 33 vitest pasan.

## ADR-033 — Echo de `reasoning_content` para DeepSeek thinking (2026-08-20)

- **Problema:** DeepSeek en modo thinking exige que el `reasoning_content` de los mensajes assistant se DEVUELVA a la API en las peticiones siguientes; Makora lo descartaba (decisión ADR-era pensada para Anthropic, que factura los thinking blocks si se preservan) → `HTTP 400: The reasoning_content in the thinking mode must be passed back to the API` a partir del segundo turno.
- **Decisión:**
  1. `ChatMessage.reasoning: Option<String>` (serde default + skip si none): `gateway.rs::openai_turn` acumula `delta.reasoning_content` y lo devuelve en `TurnOutcome.reasoning`; TODOS los assistant que se persisten (finales, con tool_calls, subagentes, síntesis forzada) llevan su reasoning.
  2. `to_wire` añade `reasoning_content` SOLO cuando el proveedor lo requiere (`requires_reasoning_echo`: modelo/base_url con deepseek/reasoner/openrouter). OpenAI/Gemini/Ollama no reciben el campo.
  3. Persistencia: el transcript del frontend (`sessions.ts`) conserva `reasoning` (cap 100k chars) para que las sesiones restauradas no fallen. Nota: sesiones antiguas (sin reasoning persistido) pueden seguir dando 400 con deepseek thinking → abrir sesión nueva.
- **Consecuencias:** multi-turno con deepseek-v4-pro/reasoner funciona sin 400; Anthropic sigue sin almacenar thinking (no se le envía). 47 tests Rust + 33 vitest pasan.

## ADR-034 — Reglas de wire por proveedor portadas de `opencode/provider/transform.ts` (2026-08-20)

- **Problema:** Makora mantenía reglas de comunicación por proveedor a mano y dispersas (cada 400 de proveedor era un fix puntual). opencode centraliza TODO en `ProviderTransform.message()`: normalización por proveedor, caching, unsupported parts y requisitos especiales de wire.
- **Decisión (port de los patrones verificados en el repo de opencode, adaptados a los proveedores de Makora):**
  1. **DeepSeek (transform.ts:304-320):** TODOS los assistant de deepseek/reasoner/openrouter llevan `reasoning_content` — si no hay reasoning guardado se envía VACÍO. Esto además arregla sesiones antiguas (ADR-033 cubría solo las nuevas).
  2. **Claude (transform.ts:225-252):** scrub de `toolCallId` a `[a-zA-Z0-9_-]` (antes solo `:`→`_`), aplicado consistente en `tool_use` y `tool_result`.
  3. **Mistral (transform.ts:254-302):** toolCallId reducido a 9 alfanuméricos rellenados con ceros + puente `assistant "Done."` entre `tool`→`user` (secuencia ilegal en Mistral).
  4. **Schemas OpenAI (transform.ts:1428-1509):** `ensure_schema_types`: infiere `type` (object/array/string/number), convierte schemas booleanos a `{"type":"string"}` y desciende por properties/items/combiners/defs — solo para modelos gpt/o1/o3/openai.com (protege MCP tools).
  5. Estos patrones se aplican en `gateway.rs` tras el saneamiento del wire (equivalente funcional al pipeline de `transform.ts` para nuestro set de proveedores).
- **Consecuencias:** menos 400s por particularidades de proveedor; reglas en un único punto auditable; 50 tests Rust + 33 vitest pasan.

## ADR-035 — Formateador robusto de respuestas `responseFormat.ts` (2026-08-20)

- **Problema (feedback del usuario):** al pedir un plan, el agente respondió con sintaxis XML de tool-calls SIN procesar en el contenido (`<function_calls> <invoke name="webfetch"> <parameter ...>...`). El `cleanLeakedTags` inline de `Markdown.tsx` solo cubría DSML/tool_call/thinking: el XML de DeepSeek se mostraba crudo y rompía la respuesta.
- **Decisión:**
  1. Nuevo módulo puro `src/responseFormat.ts` con `formatResponse(raw: unknown): string`, pipeline: guard de tipos → `cleanUnicode` → protección de fences de código → `stripToolSyntax` (loop hasta punto fijo, máx. 15) → restauración de fences → limpieza final.
  2. **`cleanUnicode`:** CRLF→LF, strip de secuencias ANSI/OSC (salida de terminal copiada por el modelo), controles C0 (salvo `\n`/`\t`), `\u2028/\u2029`→`\n`, BOM, controles bidi U+202A–202E/U+2066–2069/U+061C (anti Trojan-Source), invisibles ZWSP/word-joiner/soft-hyphen, surrogates solitarios→U+FFFD, normalización NFC. Se PRESERVAN ZWJ/ZWNJ (emoji/escrituras índicas-árabes) y CJK/rtl intactos.
  3. **`stripToolSyntax`:** pares cerrados (DSML `tool_calls`/`invoke`, `<function_calls>`, `<invoke>/<parameter>/<tool_call>/<tool_use>`, `<thinking>/<reasoning>/<search>...`, `<|tool_call|>`, variante HTML-escaped), self-closing, cierres huérfanos, tokens (`[toolu_bdrk_*]`, `<|python_tag|>`...), y **corte de etiquetas sin cerrar** (streaming interrumpido): si el último open no tiene close, se corta desde ahí (la prosa previa se conserva). Si el bloque ocupaba su línea entera, se traga también la línea (sin dejar huecos); si no, se sustituye por espacio.
  4. **Protección de fences:** bloques ``` / ~~~ (cerrados O sin cerrar por streaming) se sacan con placeholders antes de strippear y se restauran después → XML legítimo dentro de bloques de código nunca se toca.
  5. Si tras limpiar queda vacío pero había contenido visible → nota discreta (`TOOL_ONLY_NOTE`); whitespace-only o no-string → `""`.
  6. Integración: `Markdown` añade prop `sanitize` (default false; `MarkdownViewer` de archivos NO sanea). Chat activa `sanitize` en las respuestas del assistant, y `copyMessage`/`copyTranscript`/`exportMarkdown` copian/exportan el texto ya formateado.
- **Consecuencias:** respuestas con tool-calls filtrados en contenido ya no muestran XML crudo (ni en streaming ni al copiar/exportar); blindaje unicode contra caracteres que rompen el render. 61 tests vitest pasan (28 nuevos en `responseFormat.test.ts`); `npm run build` OK. El histórico enviado al modelo conserva el texto crudo (el wire lo sanean `sanitize_history`/transform en Rust); limpiar el contenido persistido es decisión futura si molesta el gasto de tokens.

## ADR-036 — Auditoría y endurecimiento del módulo de herramientas (2026-08-20)

- **Problema (encargo del usuario):** revisión completa del módulo de tools garantizando que todas funcionen; se auditaron ejecutores (main + subagente), helpers y permisos contra los patrones de opencode.
- **Hallazgos y fixes aplicados (`agent.rs`):**
  1. **Escape de workspace por colisión de prefijo:** `within()` usaba `starts_with` sin límite de componente → una carpeta hermana (`C:\proj2`) se consideraba dentro de `C:\proj`. Ahora exige igualdad o prefijo seguido de separador. (Security)
  2. **SSRF en `webfetch`:** solo validaba el esquema. Ahora `is_public_url()` bloquea localhost/`.localhost`, IPs loopback/privadas/link-local/unspecified/multicast, CGNAT 100.64/10, IPv4-mapped IPv6; y un `FETCH_CLIENT` con `redirect::Policy::custom` re-valida CADA salto (máx. 5 redirecciones). El timeout de 25s ahora cubre también la lectura del body (antes un servidor lento podía colgar el turno).
  3. **`webfetch` faltaba en el ejecutor del subagente** aunque `role_tools(Explorer)` lo anunciaba → el subagente siempre fallaba al usarlo ("no permitida en subagente"). Se comparte el helper `fetch_url_markdown()` entre ambos ejecutores.
  4. **`run_bash` corrompía comandos:** la normalización `/c/...→C:/...` reescribía la PRIMERA aparición en cualquier posición (p. ej. `git clone https://host/a/b` → `a:/b`). Ahora `normalize_bash_command()` solo reescribe tokens de ruta (inicio o tras espacio/comilla/`=`).
  5. **Cancelación/timeout de bash dejaba huérfanos en Windows:** `child.kill()` solo mata `cmd.exe`. Ahora `kill_process_tree()` ejecuta `taskkill /T /F` sobre el árbol.
  6. **Guards de lectura:** `read_file_guarded()` (error claro si >8 MB o directorio, sugiere `read_file_range`) y `read_file_range_lines()` con `BufReader` (ya no carga el archivo entero; fuera de rango → mensaje informativo, no vacío silencioso).
  7. **`grep` con `pattern` vacío devolvía 200 líneas arbitrarias** → ahora error explícito. `grep` principal ahora spillea igual que el subagente (`truncate_tool_output`).
  8. **`list_dir`:** sobre un archivo o ruta inexistente daba salida vacía silenciosa → ahora error claro; directorio vacío → "(directorio vacío)".
  9. **Paridad subagente:** `write_file` ahora chequea sintaxis (como `apply_patch`) y ambos rechazan rutas que resuelvan a directorio.
  10. **`tool_kind("explore_subagent")` era Mutating** → en modo plan se contaba como mutación y reseteaba el contador del vigilante (un subagente de solo lectura "legalizaba" exploración infinita). Ahora ReadOnly.
  11. **Fallo en modo plan (feedback del usuario):** el modelo emitió `<function_calls><invoke name="read_file_range">` con parámetros `string="true"`; el gateway extraía los invokes pero (a) insertaba TODOS los parámetros como String → `start_line`/`end_line` `"764"` no pasaban el `as_u64()` del ejecutor → leía la línea 1 en vez del rango pedido, y (b) el wrapper `<function_calls>` no se limpiaba del texto (los regex solo cubrían `tool_calls?`/DSML) → el XML sobraba en `outcome.text` y se colaba en historial/UI. Fix: parseo tipado de valores de parámetro XML (número/bool si JSON válido, si no String) + `function_calls` añadido a `RE_CLEAN_TOOL_CALLS`/`RE_CLEAN_STRAY_TAGS`; defensa en profundidad en el agente: `arg_number()` acepta números que lleguen como string en `read_file_range` (ambos ejecutores). Tests con el snippet exacto reportado (wrapper cerrado y stream cortado sin cierre).
- **Consecuencias:** 55 tests Rust pasan (8 nuevos: `within` sibling-prefix, `is_public_url` SSRF, normalización bash, helpers de lectura, `tool_kind`, extracción XML `function_calls` con números tipados); 63 vitest pasan. `cargo test` y `npm run build` OK. Instaladores NSIS+MSI regenerados.

## ADR-038 — bash fiable en Windows (script .bat) + compactación wire-only (2026-08-21)

- **Problema A (feedback del usuario):** el agente reportaba "bash no devuelve salidas" en Windows. Diagnóstico forense sobre `makora_history.db` (transcripts reales): los comandos SÍ se ejecutaban con `exit: 0`, pero la salida era el TEXTO del comando, no su ejecución. Causa raíz verificada empíricamente: `cmd.exe /C "<comando con comillas internas>"` — Rust escapa las comillas internas como `\"`, que cmd NO entiende; cmd entrega a `powershell -Command` el script como literal `\"..."` y PowerShell lo evalúa como EXPRESIÓN STRING e imprime el comando sin ejecutarlo (p. ej. `powershell -Command "Get-Content 'x' -Tail 20"` → stdout = el propio comando). Además `tokio::BufRead::lines()` aborta silenciosamente ante bytes no-UTF8 (salida OEM cp850 con acentos) → salida vacía.
- **Decisión A:** en Windows, `run_bash` ya NO pasa el comando como argumento. `write_bat_script()` escribe `@echo off` + `chcp 65001 >nul` + comando + `exit /b %errorlevel%` a un `.bat` temporal en `%TEMP%\makora_cmds\` y ejecuta `cmd /C "<ruta .bat>"` (sin comillas internas en la línea de comandos → cero mangling). El .bat parsea el comando EXACTAMENTE como si se tecleara (comillas perfectas), `chcp 65001` garantiza salida UTF-8 válida (los readers no se detienen) y `exit /b %errorlevel%` propaga el código de salida real. El .bat se borra al terminar (también en cancelación/timeout). Linux/macOS siguen con `sh -c`.
- **Problema B (feedback del usuario):** la compactación LLM sustituía los mensajes REALES del historial (`msgs = compacted`) → el usuario veía en el chat el mensaje artificial "[Historial compactado para ahorrar contexto...]" y PERDÍA sus mensajes anteriores (funcionalidad arrebatada).
- **Decisión B (wire-only, estilo opencode):** la compactación ya NO toca `msgs` (UI, persistencia, checkpoints y `ChatResult.messages` conservan SIEMPRE el historial completo). El resumen vive solo en la vista del wire: `wire_prefix` (par user/assistant con el resumen) + `msgs[wire_tail_start..]`; `apply_compaction_mapping()` mapea el split de la vista al índice real de `msgs`. El texto del par indica al modelo que el resumen es interno y NO visible para el usuario (no debe citarlo). El log `[TOKEN_ENGINE] compactación LLM` permanece.
- **Consecuencias:** bash ejecuta cualquier comando Windows (powershell, findstr, cargo, git) con comillas, salida UTF-8 y código de salida correcto; la UI nunca pierde mensajes. 62 tests Rust pasan (nuevos: `test_bat_script_preserves_inner_quotes`, `test_bat_script_propagates_exit_code`, `test_apply_compaction_mapping`).

## ADR-039 — Sanitización en streaming: los fallos de herramientas nunca rompen la respuesta (2026-08-21)

- **Problema (feedback del usuario):** cuando el modelo emite sintaxis de tool-calls como texto (XML `<function_calls>/<invoke>/<parameter>`, DSML, `<|tool_call|>`) — típico cuando las herramientas fallan y el modelo insiste — la UI mostraba el XML crudo en STREAMING: el gateway emitía los deltas de texto SIN sanear al frontend (la limpieza solo se hacía al final del turno para el wire; el frontend re-construía la UI final con el texto saneado, pero el usuario veía la basura mientras el stream corría y el transcript intermedio quedaba sucio).
- **Decisión (defensa en el gateway, no en la UI):**
  1. **`StreamSanitizer` en `gateway.rs`** (ambos caminos, OpenAI-compat y Anthropic): bufferea los deltas y emite SOLO texto limpio — elimina bloques cerrados de tool-syntax al instante, retiene desde el primer tag abierto sin cerrar (hasta que cierre o se descarte al final) y retiene colas parciales de tag (`<inv`, `<|`) para no dejar escapar mitades. Los marcadores (`[toolu_bdrk_*]`, `<|python_tag|>`) se eliminan al instante. El texto CRUDO solo existe internamente para el wire y la extracción de tool-calls.
  2. **Evento `chat-text-final`:** al cerrar el turno final (sin tool_calls), el gateway emite el texto COMPLETO ya saneado; `sessionStore` lo usa como texto autoritativo del mensaje (corrige el acumulado de streaming y el transcript). Los fallos de herramientas intermedios ya no dejan rastro visual.
  3. **Anthropic ganó la misma extracción/saneado final** de tool-syntax embebida que OpenAI-compat (antes no la tenía).
  4. **Directiva 9 en `MAKORA_BASE_SKILL`:** gestión de errores de herramientas — interpretar el error, corregir y reintentar; nunca mostrar sintaxis de llamadas al usuario; si el fallo es definitivo, explicarlo brevemente en la respuesta final.
- **Endurecimiento (misma ronda):** la extracción/limpieza final (`sanitize_and_extract_embedded_tool_calls`) pasó a ser insensible a mayúsculas (regexes `(?i)`, guarda de fast-path sobre `to_lowercase()`) para no perder XML emitido en mayúsculas (`<FUNCTION_CALLS>/<INVOKE>/<PARAMETER>`), y además elimina bloques cerrados de `thought|thinking|reasoning|scratchpad|analysis` y marcadores `[toolu_bdrk_*]`/`<|python_tag|>` en el texto final (antes solo en streaming). Con esto el transcript persistido queda limpio también ante variantes de caso y thinking embebido.
- **Consecuencias:** la sintaxis de tool-calls jamás llega a la UI (ni en streaming ni en el estado final), con independencia de que las herramientas fallen; doble blindaje con `responseFormat.ts` (ADR-035) en el frontend. 68 tests Rust pasan (5 nuevos del sanitizador) + 64 vitest.

## ADR-037 — Jerarquía y deduplicación de reglas de proyecto (2026-08-21)

- **Problema:** con 2+ workspaces abiertos, `detect_project_rules` concatenaba TODOS los candidatos existentes de cada carpeta: inyectaba hasta 2× el mismo `MAKORA.md` universal (el de makora-ide y el de ai_quant_trading eran virtualmente idénticos), duplicando tokens en el system prompt de cada turno. Además no existía precedencia entre `.makora/rules.md` y `MAKORA.md` dentro de un mismo proyecto.
- **Decisión:**
  1. **Precedencia estricta por workspace:** `detect_project_rules` recorre los candidatos en orden (`.makora/rules.md` → `.makora/RULES.md` → `.makorarules` → `MAKORA.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`) y `break` en la primera coincidencia encontrada: un solo archivo de reglas por proyecto.
  2. **Deduplicación entre workspaces:** se normaliza el contenido (minúsculas + colapso de whitespace) en un `HashSet`; el mismo archivo presente en varios workspaces se inyecta una única vez.
  3. **MAKORA.md específicos por repositorio:** `makora-ide/MAKORA.md` quedó específico del IDE (reglas Rust/Tauri, contratos IPC, bindings specta) y `ai_quant_trading/MAKORA.md` específico del pipeline de trading (determinismo, invariantes numéricas, tests de estrategias). Se elimina el contenido universal duplicado en origen.
- **Consecuencias:** el prompt de sistema ya no repite las reglas universales (ahorro de tokens por turno); se añadieron 4 tests unitarios (`rules_precedence_within_workspace`, `rules_empty_when_no_files`, `rules_deduplicated_across_workspaces`, `rules_distinct_across_workspaces`) en `lib.rs`. El contrato IPC (`Result<Option<String>, String>`) se mantiene intacto: sin cambios en frontend ni bindings.

## ADR-040 — Consolidación del system prompt + fix del wire `CompactBoundary` (2026-08-21)

- **Problema A (feedback del usuario: "el IDE es inestable en sus respuestas"):** el prompt de sistema tenía las directivas del motor **duplicadas**: `MAKORA_BASE_SKILL` (Rust, `agent.rs`) con su "Thinking Protocol" + "Token Economy Guard" + "Salida", y a la vez `buildSystem` (frontend, `Chat.tsx`) inyectaba de nuevo un "Thinking Protocol" + "Token Economy" + "Salida" casi idénticos. Además la directiva de modo plan estaba **dos veces** (frontend + `PLAN_MODE_DIRECTIVE` de Rust). Resultado: ~300-400 tokens redundantes por turno y directivas solapadas/contradictorias que diluyen la atención del modelo y degradan la calidad/estabilidad (patrón anti-`fx`: vercel-labs/fx prioriza el *minimalismo del system prompt* como palanca de estabilidad).
- **Decisión A (una sola fuente de verdad):** `MAKORA_BASE_SKILL` (Rust) queda como ÚNICA fuente de las directivas universales del motor. `buildSystem` ahora solo aporta lo que es específico y no duplicado: intro + "obligación de respuesta" + `thinkingNudge` + reglas de proyecto + skills + rutas de workspace. La directiva de modo plan vive SOLO en `PLAN_MODE_DIRECTIVE` (Rust), que ahora incluye la estructura Markdown del plan (heredada del frontend). `buildSystem` pierde el parámetro `effectiveMode` (ya no lo usa).
- **Problema B:** `token_engine::fit_history` insertaba el marcador `CompactBoundary` como mensaje `role: "system"` en **medio** de la lista de mensajes (no como primer mensaje). En OpenAI/DeepSeek el rol `system` solo es válido como primer mensaje → en sesiones largas el proveedor podía rechazar o malinterpretar el turno (fuente de inestabilidad latente).
- **Decisión B:** el `CompactBoundary` se emite como `role: "user"` (mensaje sintético válido en cualquier posición): `[CompactBoundary: N mensajes anteriores omitidos por presupuesto de historia]`.
- **Consecuencias:** prompt de sistema más corto, coherente y sin duplicados; menos tokens por turno y menos ambigüedad para el modelo; wire válido en sesiones largas. 68 tests Rust + 64 vitest pasan; `npm run build` OK. (Inspirado en el análisis de `vercel-labs/fx` — minimalismo — y en `opencode` — validación estricta del wire.)

## ADR-041 — Cota dura del wire + poda de checkpoints (fin de la DB de 1.1 GB y del wire de 178k tokens) (2026-08-21)

- **Problema A (forense sobre `makora_history.db` real):** la tabla `checkpoints` pesaba **1.09 GB** porque `create_checkpoint` guardaba el transcript COMPLETO (JSON de hasta 2.8 MB) en CADA iteración del bucle (`agent.rs::run_loop`), con `turn` creciendo hasta 466 → crecimiento O(n²). Además el wire al modelo llegaba a **178.482 tokens de entrada** (sesión `deepseek-v4-pro`): la cuota de historia de `fit_history` era proporcional a la ventana de contexto y, si el `context_window` era grande (1M), permitía ~225k tokens de historia; sumado a que el tokenizer local (cl100k) infra-cuenta frente al del proveedor, el historial no se acotaba y el modelo degradaba/encarecía cada turno.
- **Decisión A (cota dura en `token_engine::fit_history`):** la cuota de historia se limita a **`min(cuota, 48_000)` tokens** sea cual sea la ventana, con un backstop por caracteres de **160k chars** (~40k tokens) como segunda red. El bloque más reciente siempre se conserva (atomicidad del turno). Resultado: el wire nunca supera ~50k tokens de historia aunque el `context_window` sea gigante.
- **Decisión B (poda de checkpoints en `history.rs`):** `create_checkpoint` conserva solo los **3 últimos checkpoints por sesión** (el resume por checkpoint solo necesita el más reciente). En `init()` se ejecuta una poda única de los checkpoints viejos (window function `ROW_NUMBER() OVER (PARTITION BY session_id …)`) + `wal_checkpoint(TRUNCATE)`, y si el fichero sigue >200 MB se lanza un `VACUUM` en un hilo en segundo plano para devolver el espacio al disco sin bloquear el arranque. Verificado: 1598 → 94 checkpoints y 1.126 GB → 54 MB tras VACUUM.
- **Decisión C (estabilidad de escritura):** `with_conn` pasó de abrir una conexión SQLite **por cada escritura** (caro y propenso a chocar con el `busy_timeout` bajo WAL + sesiones concurrentes) a una **única conexión compartida** (`Mutex<Option<Connection>>`, abierta lazy). El checkpoint de progreso del bucle (`run_loop`) se guarda ahora **cada 5 turnos** en vez de en cada iteración (la serialización completa del transcript por iteración era O(n²) de CPU); el checkpoint final del turno siempre se guarda.
- **Consecuencias:** la base deja de crecer sin límite (y se compacta sola); el contexto enviado al modelo queda acotado a un tamaño sano (mejor calidad y coste estable por turno); las escrituras de historia dejan de bloquear el bucle. 69 tests Rust + 64 vitest pasan.

## ADR-042 — Sesiones a SQLite (blob durable + localStorage como caché) (2026-08-21)

- **Problema:** las sesiones (`makora.history.v1`/`makora.sessions.v1`) vivían SOLO en `localStorage` del WebView: límite de ~5 MB (por eso `sessions.ts` truncaba a 200 mensajes/sesión y 4,5 MB totales), y riesgo de pérdida si el WebView/OS limpia el almacenamiento. Era la única fuente de verdad y se perdía/truncaba silenciosamente.
- **Decisión (fuente de verdad durable sin refactor relacional completo):** añadida una tabla `kv` (key/value) en `history.rs` y dos comandos IPC — `save_sessions_store(json)` y `load_sessions_store()`. `saveSessions` escribe el blob JSON completo en SQLite (fire-and-forget) y mantiene `localStorage` como **caché de arranque rápida**. Al arrancar, `App.tsx` hidrata desde SQLite y restaura el historial si `localStorage` está vacío o truncado (menos sesiones). La migración es incremental (localStorage → SQLite); la modelización relacional completa en `sessions`/`items` queda para una fase posterior.
- **Consecuencias:** sin límite práctico de tamaño ni pérdida por limpieza del WebView; arranque sigue siendo síncrono (caché) y la restauración durable es asíncrona sin bloqueo. 69 tests Rust + 64 vitest; `npm run build` OK.

## ADR-043 — Resiliencia del bucle y eficiencia de tokens (2026-08-21)

- **Degradación controlada ante error del proveedor (estabilidad):** antes, un único error no-reintentable del proveedor a mitad del bucle (p. ej. un 400) abortaba el turno ENTERO con `?`, perdiendo todo el trabajo ya realizado por las herramientas. Ahora `run_loop` captura el error: si ya hay progreso (mensajes de herramienta), llama a `forced_final_turn` para **sintetizar una respuesta final con lo ya hecho** en lugar de abortar; si no hay progreso, devuelve el error. Un fallo puntual del proveedor ya no tira a la basura el turno.
- **`archive_transcript` incremental (rendimiento):** insertaba el transcript COMPLETO en cada turno final (O(n²) de filas en `items`, tabla de solo escritura). Ahora un watermark por sesión (`ARCHIVE_WATERMARK`) hace que solo se inserten los mensajes nuevos desde la última archivación.
- **Tope de nudges (eficiencia de tokens):** `system_extra` (notas del vigilante anti-bucles) crecía sin límite en loops largos. Ahora solo se conservan los **últimos 3 nudges** en el prompt de sistema.
- **Descripciones de tools concisas (eficiencia de tokens):** se recortaron las descripciones de `apply_patch`, `bash`, `todowrite`, `question`, `webfetch`, `skill`, `explore_subagent` y `delegate_subagent` (menos verborrea, misma semántica) — ahorro de tokens en el catálogo que se envía en cada turno y menos ruido para el modelo.
- **Consecuencias:** un error transitorio del proveedor ya no pierde el trabajo del turno; menos filas muertas y menos tokens por turno. 69 tests Rust + 64 vitest; `npm run build` OK.

## ADR-044 — Repo-map ligero inyectado en el prompt (M2 parcial) (2026-08-21)

- **Problema:** en cada tarea el modelo gastaba turnos y tokens en `list_dir`/`grep` para reconstruir el mapa mental del workspace, y aun así a veces buscaba en los lugares equivocados. Era el `@codebase` de Continue/Cline y el componente "repo-map" de opencode que Makora no tenía (la cuota `repo_map` del `ContextComposer` estaba sin implementar).
- **Decisión (versión ligera, sin tree-sitter):** nuevo módulo `repo_map.rs` que genera un **árbol de directorios conciso** del workspace (profundidad ≤3, máx 260 entradas, máx 6000 chars, respetando `.gitignore`/`.git`/hidden vía el crate `ignore`) y lo **cachea por workspace con TTL de 120 s**. Se inyecta en el `full_system` de `run()` y `run_multiagent()` como sección `## Mapa del workspace` (dentro de un bloque ``` para que no se interprete como instrucción). Al vivir en el prefijo del prompt, queda cacheado por el proveedor y no añade coste por turno tras el primero.
- **Consecuencias:** el modelo navega y planifica sin gastar tantas lecturas exploratorias (menos tokens y menos latencia); el mapa refresca cada 2 minutos. 71 tests Rust + 64 vitest. Pendiente (M2 completo): extracción de símbolos con tree-sitter + BM25 para el índice semántico.

## ADR-045 — Índice semántico de símbolos + BM25 (M2 completo) (2026-08-21)

- **Problema:** localizar "dónde se define X" obligaba al modelo a `grep` ciego (y a leer archivos a ciegas). Faltaba el equivalente al "find definitions" de un IDE / al `@codebase` semántico de Continue/Cline.
- **Decisión:** nuevo módulo `symbol_index.rs` que extrae **símbolos por lenguaje** (Rust: `fn`/`struct`/`enum`/`trait`/`impl`/`mod`/`type`; TS/JS: `function`/`class`/`interface`/`type`/`const`; Python: `def`/`class`) y los indexa para consulta con **BM25** (k1=1.5, b=0.75) + bonus por coincidencia de nombre. La extracción usa **regex por lenguaje** en lugar de gramáticas C de tree-sitter para no añadir dependencias de compilación pesadas al build MSVC de Windows (mismo valor práctico de "find definitions", menor riesgo de build). Se cachea por workspace (TTL 180 s) y se expone como tool **`repo_map_query`** (solo lectura, disponible en modo plan y en el subagente explorer). Devuelve `kind nombre — ruta:línea` ordenados por relevancia.
- **Consecuencias:** el agente localiza definiciones sin grep ciego (menos tokens, menos lecturas). 75 tests Rust + 64 vitest. Si en el futuro se necesita precisión AST exacta, se puede cambiar la capa de extracción por tree-sitter sin tocar la API (BM25 + caché + tool ya están).





