# Runtime Agéntico en Rust — Investigación de diseño

Fecha de investigación: 2026-08-18. Objetivo: definir el runtime propio (loop agente, herramientas, MCP, permisos, checkpoints) sin delegar en SDKs pesados.

## (a) Patrones de agent loop comparados

### OpenAI Agents SDK (openai-agents-python)
- **Primitivas mínimas**: Agent (instrucciones + tools), Handoffs (agentes como herramientas), Guardrails, Sessions, Tracing. Principio: "pocas primitivas, personalizable".
- **Handoffs**: se exponen al LLM como herramientas `transfer_to_<nombre>`. Soportan `input_type` (metadata estructurada que el modelo da al transferir, p. ej. `{reason, priority}`), `input_filter` (reescribir historial que ve el agente destino; p. ej. `remove_all_tools` para quitar tool calls del historial) y `on_handoff` callback. Patrón a copiar: handoff = tool + filtro de historial.
- **Guardrails**: input (sobre entrada del primer agente), output (sobre salida final) y tool-guardrails (por cada tool call, antes/después). Modo *blocking* (chequeo antes de arrancar el modelo, ahorra tokens) vs *parallel* (latencia menor). "Tripwire" = excepción que detiene el run. Copiar: guardrails de tool como capa de permisos adicional (p. ej. bloquear secrets en argumentos).
- **Contexto dual**: (1) contexto local (`RunContextWrapper`: estado/DI/usage, NUNCA se envía al LLM) y (2) contexto del LLM (solo via instrucciones, input, tools, retrieval). Separación clave para un runtime propio.
- **Sessions**: `get_items`/`add_items`/`pop_item`/`clear_session`; `SQLiteSession` file-based es el default recomendado; `session_input_callback` controla cómo se fusiona historial + input nuevo (pruning personalizado); `SessionSettings(limit=N)` para cap de historial recuperado. Compaction como wrapper (`OpenAIResponsesCompactionSession`) con advertencia: auto-compaction bloquea el streaming → compactar entre turnos manualmente.
- **Human-in-the-loop**: runs pausan en "interrupciones" (aprobaciones); `result.to_state()` serializa y se reanuda con `Runner.run(agent, state, session)`.

### Claude Agent SDK / agent loop (code.claude.com)
- **Loop canónico**: recibir prompt → evaluar → 1..N tool calls → ejecutar → resultados vuelven → repetir hasta respuesta sin tool calls. Un "turn" = un round trip con tool calls; el loop no devuelve control entre tool calls dentro del turn.
- **Mensajes de stream**: `SystemMessage` (subtipos: `init`, `compact_boundary`, `worker_shutting_down`), `AssistantMessage` (texto + tool calls del turn), `UserMessage` (resultados de tools), `StreamEvent` (deltas parciales), `ResultMessage` (subtipos: `success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`; lleva `num_turns`, `total_cost_usd`, `session_id`).
- **Límites**: `max_turns` (cuenta solo turns con tool use) y `max_budget_usd`. Patrón a copiar: topes de turnos + presupuesto con subtipo de error específico.
- **Ejecución de tools**: read-only (Read/Glob/Grep) en paralelo; mutadoras (Edit/Write/Bash) secuenciales. Custom tools con `readOnlyHint` en annotations (mismo campo del MCP SDK).
- **Contexto**: se acumula entre turns; prefix estable (system prompt, tool definitions, CLAUDE.md) se cachea (prompt caching). **Compaction automática** al acercarse al límite (emite `compact_boundary`); hook `PreCompact` para archivar transcript completo; CLAUDE.md se re-inyecta en cada request (reglas persistentes fuera del historial). **Subagentes con contexto fresco**: solo la respuesta final vuelve al padre — el patrón más efectivo de aislamiento de contexto.
- **Permisos** (ver b).

### OpenAI Sandbox Agents (beta)
- Separación runtime/entorno: el runner posee aprobaciones, tracing y estado resumible; el "sandbox session" posee comandos, ficheros y aislamiento. `Manifest` = contrato del workspace (archivos, LocalDir, GitRepo, mounts, users, `extra_path_grants` con read_only); `run_as` (usuario que ejecuta tools); snapshot (persistir workspace) vs `session_state` (reconectar a sesión viva). Clientes: UnixLocal (dev macOS/Linux), Docker (Windows/aislamiento).

### Conclusión para el runtime
Loop explícito con: turnos contados + presupuesto; stream tipado de eventos (init/turn/tool_result/result/error); handoffs = tools que cambian agent+instrucciones y filtran historial; compaction manual entre turnos; guardrails de tool como filtro pre/post ejecución.

## (b) Diseño de sandbox / permisos recomendado

### Lo que usan los referentes
- **Anthropic Computer Use** (beta `computer-use-2025-11-24`): advierte explícitamente: VM/contenedor dedicado con mínimos privilegios; no exponer datos sensibles; **allowlist de dominios** para internet; confirmación humana para acciones con consecuencias reales; defensa anti prompt-injection (clasificador + pedir confirmación cuando detecta instrucciones inyectadas en screenshots). El loop corre DENTRO del contenedor (reference impl en Docker).
- **Claude Code permissions** (orden de evaluación fijo, a copiar tal cual):
  1. Hooks (`PreToolUse` puede denegar/bloquear — corre fuera del contexto del LLM, no consume tokens)
  2. Reglas **deny** (`disallowed_tools`: `Bash` quita la tool del request; `Bash(rm *)` bloquea solo el patrón, incluso en bypassPermissions)
  3. Reglas **ask** (forzar aprobación)
  4. **Modo de permiso**: `default` (callback), `dontAsk` (deny por defecto, headless), `acceptEdits` (auto-aprobar ediciones + `mkdir/touch/mv/cp` dentro del working dir), `plan` (solo lectura; las escrituras nunca se auto-aprueban), `bypassPermissions` (solo CI/contenedores; prohibido como root), `auto` (clasificador de modelo)
  5. Reglas **allow** con patrones: `Bash(npm *)`, `Edit(//secrets/**)` (anchors de path), `mcp__server__tool`
  6. Callback `canUseTool` (UI de aprobación) → si no resuelve, deny.
  Detalles clave: "critical paths" (`rm`/`rmdir` sobre rutas protegidas) NUNCA se auto-aprueban; los subagentes heredan el modo del padre.
- **Cursor**: lecturas libres, ediciones de workspace libres (excepto ficheros de configuración), comandos de terminal requieren aprobación por defecto; MCP requiere aprobación por conexión Y por tool call (con allowlist); red restringida (GitHub + search); Run Modes desde allowlist hasta clasificador "auto-review"; declaran que sus guardrails son "best-effort, no una frontera de seguridad dura".

### Recomendación para el runtime Rust
1. **Pipeline de permisos con orden fijo**: deny → ask → allow → callback de aprobación (UI). Reglas con patrones de comando (`Bash(cargo *)`) y de path (`Write(//C:/Users/.../**)`), estilo Claude Code.
2. **Ejecución**: subprocess directo con: working dir confinado, timeout por comando, tamaño máximo de stdout (truncar + marcar), env vars sanitizadas, y kill tree al cancelar. Allowlist opcional de binarios.
3. **Niveles progresivos**: (i) prototipo = subprocess + permisos + timeout + confirmación; (ii) medio = contenedor Docker opcional para tareas de red (patrón Computer Use: el trabajo con internet va a contenedor con allowlist de dominios); (iii) futuro = sandbox por workspace estilo OpenAI Sandbox Agents (manifest + snapshot), o WASM/Deno para extensiones de terceros.
4. **Human-in-the-loop**: runs pausables y resumibles (aprobación = interrupción serializable, no bloqueo de UI).

## (c) MCP: qué adoptar y qué omitir en el prototipo

### Estado del spec (modelcontextprotocol.io, versión de spec 2026-07-28)
- JSON-RPC 2.0 en dos capas: **data layer** (primitivas + descubrimiento) y **transport layer** (stdio / Streamable HTTP).
- **Stateless**: cada request lleva `_meta` con `protocolVersion`, `clientInfo`, `clientCapabilities`. `server/discover` obligatorio en servidores (versiones soportadas, capabilities, `serverInfo`, cacheable con `ttlMs`/`cacheScope`).
- **Primitivas de servidor**: `tools` (list/call con `inputSchema` JSON-Schema), `resources` (list/read), `prompts` (list/get). Listados dinámicos.
- **Primitivas de cliente**: `elicitation` (pedir input/confirmación al usuario — útil para permisos). **Deprecadas** (2026-07-28): `sampling` (el servidor pidiendo completions — integrar LLM directamente) y `logging` (usar stderr/OTel).
- **Notificaciones**: opt-in via `subscriptions/listen` (`toolsListChanged` etc.). **Extensiones**: Tasks (handles durables para operaciones largas), caching.
- **Transportes**: stdio (local, un cliente; óptimo sin overhead de red) y Streamable HTTP (POST + SSE opcional, OAuth para auth remota). Host crea 1 cliente por servidor; VS Code/Cursor/Claude Code como hosts de referencia.
- En apps con muchos servidores: **progressive tool discovery** (no cargar todos los esquemas upfront — los esquemas de tools consumen contexto en cada request).

### Adoptar en prototipo
- Cliente stdio + JSON-RPC mínimo (el spec es pequeño; no hace falta SDK completo): handshake `initialize`/`discover`, `tools/list`, `tools/call`. Content blocks (text, image, resource) de respuesta.
- Namespacing `mcp__<server>__<tool>` en el registro de tools del agente (patrón universal en clientes).
- Aprobación por conexión de servidor + por tool call (patrón Cursor).
- Transporte HTTP solo si hace falta un servidor remoto concreto; de lo contrario omitir.

### Omitir en prototipo
- `resources`/`prompts` en la primera iteración (opcional después; `prompts` compite con nuestro sistema de skills/instrucciones).
- `elicitation` (sustituible por nuestro propio mecanismo de aprobación), `subscriptions/listen` (revalidar con polling `tools/list`), OAuth, extensión Tasks, sampling/logging (deprecadas).

## (d) Estrategia de checkpoints / historial

### Referentes
- **OpenAI SDK sessions**: historial = lista de items en SQLite (file-backed); `pop_item` para corregir/deshacer; `AdvancedSQLiteSession` añade **branching** (`create_branch_from_turn(n)`) y analytics de usage; `EncryptedSession` como wrapper; compaction como wrapper con "clear-and-rewrite" recuperable.
- **LangGraph persistence** (docs.langchain.com): dos capas — **checkpointer** (snapshots del estado por thread; sirve para continuidad, human-in-the-loop, *time travel*, fault tolerance; `SqliteSaver` para dev) y **store** (KV cross-thread para memoria de largo plazo). Advertencias: podar checkpoints viejos (crecimiento ilimitado), `thread_id` ≤ 255 chars.
- **Claude SDK**: `session_id` para resume/fork; `session_store` adapter que replica el transcript a tu backend (dual-write: local primero); `PreCompact` hook para archivar el transcript completo antes de resumir.

### Recomendación (SQLite vía rusqlite)
- **rusqlite 0.40.2** es viable y ergonómico: wrapper de SQLite con `Transaction`, `Savepoint`, `InterruptHandle`, features `bundled` (compila libsqlite3, sin dependencias de sistema), `chrono`/`serde_json`/`uuid` opcionales. Modelo single-writer: para una app de escritorio basta 1 conexión con WAL + serialización vía Mutex (o `r2d2_sqlite` si hay concurrencia real).
- **Esquema mínimo**:
  - `sessions(id, title, cwd, created_at, model, metadata)`
  - `items(id, session_id, seq, role, kind(text|tool_call|tool_result|system|summary|checkpoint_marker), content_json, parent_checkpoint_id, usage_json, created_at)`
  - `checkpoints(session_id, item_seq, label, filesystem_state_json)` — snapshot por TURNO (no por token).
- **Checkpoint por turno**: tras cada ejecución de tools, guardar (transcript seq, estado de archivos tocados). Permite undo ("deshacer este turno" = restaurar archivos + truncar items), branch (nuevo `parent_checkpoint_id`), resume tras crash y time travel estilo LangGraph.
- **Operaciones**: append-only + `pop_item` (corrección del usuario); `session_input_callback` propio = pruning configurable (últimos N items / presupuesto de tokens); compaction manual entre turnos (resumen LLM → item `summary` + `compact_boundary`, archivo del transcript completo antes de resumir).
- **Memoria largo plazo**: tabla KV `memories(namespace, key, value_json, embedding?)` estilo LangMem/Store, con tools de manage/search para el agente (patrón hot-path de LangMem); extracción de memorias semánticas en background, no en el loop.

## (e) Streaming, cancelación y file watching en Rust

### Streaming SSE + cancelación (tokio)
- **reqwest-eventsource 0.6.0**: EventSource sobre reqwest, `Stream` de `Event::Open/Message/Error`, `close()`, helpers de retry. Base: reqwest 0.12.
- **Patrón tokio** (`tokio::select!`, tutorial oficial): la cancelación en Rust = **dropear el future**; un task spawnado se aborta con `JoinHandle::abort()`. Para abortar trabajo en background desde otro task, usar `oneshot` y seleccionar sobre `tx.closed()` (el `Drop` del Receiver notifica). `tokio::pin!` para una operación resumible entre iteraciones del loop (`operation.set(nueva)` para reiniciar con nuevo input — útil para "interrumpir turno y re-emitir").
- **Diseño recomendado**: por turno, spawn `tokio::task` con el stream SSE; el loop hace `select!` sobre {evento SSE, canal de cancelación (tecla/user/approval), timeout}; al cancelar: `JoinHandle::abort()`, matar procesos hijo (Job Objects en Windows / kill tree en Unix), marcar el turno como cancelado y persistir estado parcial en SQLite (resumible). Stream de eventos al frontend vía canal `tokio::sync::broadcast` + eventos tipados (TurnStarted, ToolCallStarted, ToolOutputDelta, ApprovalRequired, TurnFinished, TurnCancelled).

### File watching (notify)
- **notify-rs/notify**: estándar de facto en Rust (usado por rust-analyzer, zed, cargo-watch, watchexec). MSRV 1.88. Backends: inotify (Linux), FSEvents (macOS), **ReadDirectoryChangesW (Windows)**, kqueue (BSD), polling (fallback universal).
- Usar **notify-debouncer-full** (consolida ráfagas de eventos en un batch coherente con mapa de eventos por path) o debouncer-mini (solo timeouts). Nota v9: eventos movidos a `notify-types`.
- Aplicación: watch del workspace para invalidar cachés (repo-map, índice de contexto) y alimentar eventos de contexto al agente; NUNCA bloquear el loop — canal de eventos con debounce.

### Gestión de contexto en IDEs existentes (síntesis)
- **Aider repo-map**: mapa de símbolos (clases/funciones/firmas) generado con tree-sitter; ranking tipo PageRank sobre grafo de dependencias entre ficheros; se envía al LLM solo la porción más relevante que cabe en el presupuesto (`--map-tokens` default 1k, dinámico según el estado del chat). Efecto: el modelo infiere APIs y sabe qué ficheros pedir.
- **Cursor**: index de embeddings del codebase (chunks cifrados, sin persistir código en servidores), "Instant Grep" custom; subagente "Explore" que busca en paralelo en su propio contexto y devuelve solo hallazgos resumidos (aislamiento de contexto); auto-attach de ficheros relevantes.
- **LangMem**: memoria "hot path" (tools de manage/search que el agente usa durante la conversación) vs background manager (extrae/consolida memorias fuera del loop); perfiles de usuario y memorias episódicas/semánticas.
- **Recomendación**: repo-map estilo Aider (tree-sitter + ranking con presupuesto de tokens, regenerado por notify) como primera versión; embeddings como fase 2; subagente "explorador" con contexto propio como patrón estándar.

## (f) Fuentes (consultadas 2026-08-18)

| Tema | URL |
|---|---|
| OpenAI Agents SDK intro | https://openai.github.io/openai-agents-python/ |
| OpenAI SDK handoffs | https://openai.github.io/openai-agents-python/handoffs/ |
| OpenAI SDK guardrails | https://openai.github.io/openai-agents-python/guardrails/ |
| OpenAI SDK sessions | https://openai.github.io/openai-agents-python/sessions/ |
| OpenAI SDK context management | https://openai.github.io/openai-agents-python/context/ |
| OpenAI Sandbox Agents (concepts/permissions) | https://openai.github.io/openai-agents-python/sandbox/guide/ |
| Claude Agent SDK overview | https://platform.claude.com/docs/en/agent-sdk/overview |
| Claude agent loop | https://code.claude.com/docs/en/agent-sdk/agent-loop |
| Claude permissions | https://code.claude.com/docs/en/agent-sdk/permissions |
| Anthropic Computer Use | https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool |
| MCP docs / arquitectura (spec 2026-07-28) | https://modelcontextprotocol.io/docs · https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture |
| Aider repo map | https://aider.chat/docs/repomap.html |
| Cursor indexing/context | https://cursor.com/docs/context/codebase-indexing · https://cursor.com/docs/agent/security |
| LangMem | https://langchain-ai.github.io/langmem/ |
| LangGraph persistence | https://docs.langchain.com/oss/python/langgraph/persistence |
| rusqlite 0.40.2 | https://docs.rs/rusqlite/latest/rusqlite/ |
| reqwest-eventsource 0.6.0 | https://docs.rs/reqwest-eventsource/latest/reqwest_eventsource/ |
| Tokio select/cancelación | https://tokio.rs/tokio/tutorial/select |
| notify-rs | https://github.com/notify-rs/notify |

Nota: los enlaces antiguos `docs.anthropic.com/en/docs/build-with-claude/agent-loop` y `langchain-ai.github.io/langgraph/concepts/persistence/` redirigen/404 → sustituidos por los de `code.claude.com` y `docs.langchain.com` respectivamente.
