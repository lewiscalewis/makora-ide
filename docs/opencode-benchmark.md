# MakoraIDE — Benchmark contra opencode + plan de adopción

Fecha: 2026-08-20. Documento vivo. Fuente: análisis completo del repo público de opencode (clon v1.18.19, rama principal: `packages/opencode`, `packages/core`, `packages/llm`, `packages/tui`, `packages/plugin`, `packages/protocol`, `packages/sdk`, `packages/desktop`, `packages/web`, `packages/slack`). Patrones verificados contra el código real de MakoraIDE.

## 1. Resumen ejecutivo

opencode es una arquitectura cliente/servidor en TypeScript/Bun con **Effect** (DI por capas, errores tipados, retry declarativo), **SQLite event-sourced** como única fuente de verdad, SDK generado desde OpenAPI, y una TUI (SolidJS+opentui). MakoraIDE (Tauri+Rust+React) ya tiene cosas que opencode no tiene (editor real, terminal PTY dual, monitor de crédito/balance, estética de escritorio), y su `ContextComposer` de cuotas por componente es un diferenciador real. Pero en **robustez del bucle agéntico, permisos, ecosistema de tools y manejo del contexto a largo plazo** opencode está muy por delante.

Veredicto por área:

| Área | Ganador | Comentario |
|---|---|---|
| Motor de contexto (cuotas/composición) | **Makora** | `ContextComposer` con presupuestos por componente no existe en opencode |
| Medición tokens/coste/balance | **Makora** | Tabla `requests` + balance DeepSeek/OpenRouter vs solo coste por sesión |
| Robutidez del bucle (retry, doom-loop, orphan cleanup) | **opencode** | Makora no tiene ni un reintento (verificado: 0 coincidencias `retry` en `src-tauri/src`) |
| Permisos y seguridad de tools | **opencode** | Makora solo restringe al workspace; opencode tiene ask/allow/deny + patrones + aridad + feedback correctivo |
| Ecosistema de tools | **opencode** | webfetch/websearch/todowrite/question/skill/lsp/plan_enter-plan_exit ausentes en Makora |
| MCP | **opencode** | Makora: stdio + tools/list/call. opencode: remote HTTP, OAuth, resources, prompts |
| Contexto a largo plazo (compactación) | **opencode** | Makora: truncado por tokens + evicción. opencode: resumen LLM jerárquico + prune + auto-continue |
| Deshacer / time-travel | **opencode** | Shadow git-repo por turno. Makora: `write_file` devuelve contenido previo (limitado) |
| Gestión de sesiones | **opencode** | Fork, timeline, resume por checkpoint, títulos LLM. Makora: pestañas + título = 1er mensaje truncado |
| Búsqueda de archivos | **opencode** | ripgrep nativo + respeta `.gitignore`. Makora: walker propio + lista negra hardcodeada |
| UI/UX de escritorio | **Makora** | Editor CM6, PTY, split panes, temas, paleta — opencode es TUI/CLI-first |

## 2. Patrones de diseño de opencode que conviene copiar

1. **Session = estado persistente + eventos durables, no store en memoria.** Cada turno publica eventos (`text.delta`, `tool.called`, `step.ended` con coste) y persiste en SQLite; el cliente reconstruye snapshot + delta. La cancelación interrumpe un `Runner` por sesión y hace **cleanup de tools huérfanas** (`interrupted: true`) para no romper el wire de Anthropic. Makora ya tiene ADR-017/019; falta el "replay-safe" cleanup.
2. **Tools dentro del stream (un solo request HTTP multi-step).** Con AI SDK las tools se ejecutan y el resultado se devuelve al modelo dentro del mismo stream (`streamText`), no en requests separados por loop. Menos round-trips = menos latencia y el prefijo cacheable se conserva dentro del turno. Makora hace un request por iteración del bucle.
3. **Permiso granular con "última regla gana"**: `evaluate(permission, pattern, rulesets)` con wildcards (`*.env`, `bash:*`), acciones ask/allow/deny, "always" que auto-resuelve pendientes, **feedback correctivo** (`CorrectedError`: el texto de rechazo del usuario vuelve al modelo), y detención del turno por defecto ante denegación. Bash parseado con **tree-sitter** para extraer rutas (permiso `external_directory`) y aridad de comandos.
4. **Detección de doom-loop**: 3 tool calls idénticas seguidas (misma tool+input) → pide permiso `doom_loop` en vez de gastar turnos. Complementa (no sustituye) el circuit breaker semántico de Makora (ADR-023).
5. **Retry con backoff + jitter + `retry-after`** en cada stream, con timeout de chunks SSE (aborta si no llega chunk en N ms) y clasificación de errores tipados (auth/rate-limit/quota/context-overflow). Makora no reintenta nada.
6. **Modelos pequeños para tareas utilitarias**: agentes ocultos `title`/`summary`/`compaction` con `getSmallModel` (haiku/nano/flash) — títulos, resúmenes y compactaciones nunca gastan el modelo grande.
7. **Shadow git-dir para snapshots**: repo git espejo en `~/.local/share/opencode/snapshot/<project>/<hash>` con `git add --sparse`, respeta `.gitignore` vía `check-ignore`, seed de hashes del repo real, prune 7 días. De ahí salen los diffs por turno, revert por mensaje, undo/redo.
8. **Compactación jerárquica con pruning**: `prune` borra outputs de tools viejas (protege ~40k tokens recientes, mínimo 20k para actuar) y `select` preserva cola con presupuesto (25% del contexto útil, 2k-15k). Resumen encadenado + mensaje sintético de auto-continuación.
9. **Skills lazy** (`SKILL.md` con frontmatter, compatibles con Claude Code `~/.claude/skills`): al system prompt solo van nombre+descripción; el contenido se carga con la tool `skill`. Instrucciones por directorio (`AGENTS.md` de subdirectorios se adjuntan solo al leer archivos de ahí, una vez por mensaje).
10. **Truncado con spill a archivo**: outputs largos de shell se guardan completos en un dir de truncado y se le dice al modelo la ruta + hint "delega la inspección al subagente explorer".
11. **Ecosistema de tools** (ver §4): `todowrite`, `question`, `webfetch` (HTML→Markdown con Turndown), `websearch` (Exa/Parallel), `lsp` (9 operaciones), `plan_enter/plan_exit`, `task` con sesión hija + resume (`task_id`) + background.
12. **MCP completo**: local stdio + remote StreamableHTTP + OAuth PKCE con callback; `resources`/`prompts` expuestos como tools/comandos; `ToolListChangedNotification`.
13. **Prompt caching multi-proveedor**: `cache_control` (Anthropic/Bedrock), `prompt_cache_key` (OpenAI/Azure/xAI/Mistral/DeepInfra/Cerebras), caché implícito OpenAI/Gemini; policy "auto" marca system + última tool def + último mensaje.
14. **Tool definition concisa y dinámica**: descripciones en `.txt` externos; la descripción de `task` inyecta la lista de agentes; `tool.definition` hook permite reescribir esquemas. `InvalidArgumentsError` con mensaje "rewrite the input" para que el modelo corrija solo.

## 3. Fortalezas de MakoraIDE — no tocarlas

- **ContextComposer con cuotas por componente** (System 5% / Tools 8% / Memory 4% / Files 45% / History 30% / Repo-map 8%) — opencode no tiene nada equivalente; es el diferenciador.
- **Blindaje agéntico ADR-023**: `MAX_AGENT_TURNS=25`, `MAX_TURN_TOKENS=500k`, circuit breaker semántico (6 lecturas sin mutar → sintetizar). Más fuerte que el doom-loop detector de opencode.
- **Metering**: tabla `requests` con in/cached/out, latencia, coste por matriz de precios local + balance real de DeepSeek/OpenRouter.
- **Multiagente por delegación ADR-020** con briefing condensado — equivalente moderno de la tool `task` de opencode (aunque sin sesión hija ni background).
- **Sesiones concurrentes por chatId** (ADR-017) + workspace por sesión + terminal PTY dual — opencode tiene runner por sesión pero su UX multi-sesión es TUI.
- **Saneamiento de wire ADR-019** (sin `tool` huérfanas, sin asistentes vacíos) — equivalente al orphan-cleanup de opencode.
- **UI de escritorio**: editor CM6 con diff LCS, explorador con iconos, temas, paleta, status bar, cards de herramientas. opencode delega el editor a LSP/terminales externos.

## 4. Ineficiencias concretas de MakoraIDE (verificadas en código)

| # | Problema | Evidencia en Makora | En opencode |
|---|---|---|---|
| 1 | **Sin reintentos** en llamadas al modelo | 0 coincidencias de `retry` en `src-tauri/src` | `SessionRetry` con backoff+jitter+retry-after |
| 2 | **grep propio lento y ciego a `.gitignore`** | `agent.rs:1052,1381` (`read_dir` + filtro manual) | ripgrep nativo, respeta `.gitignore` |
| 3 | **`list_dir` con lista negra hardcodeada** (no `.gitignore`) | `agent.rs:474` `is_ignored_path` (node_modules, target, .git…) | `git check-ignore` + lista negra + whitelist |
| 4 | **Título de sesión = 1er mensaje truncado** | `sessions.ts:84` `slice(0, 80)` | Agente `title` con modelo pequeño |
| 5 | **MCP solo stdio, sin resources/prompts/remoto/OAuth** | `mcp.rs` (~7 KB, initialize+tools/list/call) | 4 transports + OAuth + resources + prompts |
| 6 | **Sin permisos ask/allow/deny** para tools (solo restricción al workspace) | tools en `agent.rs` sin flujo de aprobación | `Permission.Next` + wildcards + feedback correctivo |
| 7 | **Prompt caching solo Anthropic** | `gateway.rs:848-915` solo `cache_control` | Multi-proveedor + policy "auto" |
| 8 | **Sin compactación LLM** (M4 pendiente) | truncado por tokens + evicción ADR-014 | Resumen jerárquico + prune + auto-continue |
| 9 | **Sin undo/revert por turno** | `write_file` devuelve contenido previo; DiffReviewModal parcial | Shadow git-dir, revert por mensaje, undo/redo |
| 10 | **bash del agente = PTY real con marcador** (frágil, pesado) | `agent.rs:551` spawn PTY + `__MAKORA_DONE_x__` | Proceso plano, `TERM=dumb`, timeout + forceKill 3s, kill-tree |
| 11 | **Sin tools webfetch/websearch/todowrite/question/skill/lsp** | ausentes en `agent.rs` | Todas nativas |
| 12 | **Sesiones en localStorage** (riesgo de pérdida/tamaño) | `sessions.ts` `makora.sessions.v1` | SQLite total |
| 13 | **Sin fork/timeline de sesiones** | pestañas planas | fork, árbol padre/hijo, timeline, quick-switch |
| 14 | **Subagentes sin sesión hija, sin resume, sin background** | `delegate_subagent` inline en `agent.rs` | `task` crea sesión hija + `task_id` + background + límite de profundidad |
| 15 | **Skill hardcodeada** en Rust (`MAKORA_BASE_SKILL`) | `agent.rs` | Skills descubribles `.opencode/skills` + compat Claude Code |

## 5. Plan de adopción (por olas)

> Estado de implementación (actualizado conforme se implementa; el agente es el director técnico del plan):
> - [x] P0.1 Retry con backoff+jitter en gateway — `gateway.rs::send_with_retry` (3 intentos, Retry-After, 429 de saldo no se reintenta, cancelación por chat) + `is_retryable_status`
> - [x] P0.2 Detección de doom-loop — ya existente (`run_loop` `prev_sig`/`repeats>=2` + breaker ADR-023); verificado, sin cambios
> - [x] P0.3 Truncado con spill a archivo — `spill_output`/`truncate_tool_output` en `agent.rs` (bash/read_file/read_file_range/grep guardan la salida completa en `%TEMP%/makora_truncated/`)
> - [x] P0.4 list_dir/grep `.gitignore`-aware — crate `ignore` (WalkBuilder con git_ignore/hidden/global/exclude) en `grep_dir` + `list_dir_entries`
> - [x] P0.5 bash del agente a proceso plano — ya existente (`tokio::process::Command`, kill en cancelación, timeout 600s); verificado, sin cambios
> - [x] P0.6 Repair de tool calls fallidas — `repair_tool_name` (colapso case/guiones/espacios, MCP `mcp_git_status`→`mcp__git__status`) en `execute_tool` y `execute_subagent_tool`
> - [x] P1.7 Permisos ask/allow/deny — motor de reglas por sesión (`SESSION_PERMS`: última regla gana, patrones wildcard/prefijo/aridad bash), gate en `execute_tool`/`execute_subagent_tool` (write_file/apply_patch/bash/MCP → ask por defecto; lecturas sensibles `.env`/keys → ask), evento `approval-required` + comando `approval_reply` (allow_once/allow_always/deny+feedback correctivo), panel de aprobación en Chat, timeout 600s con cancelación. `clear_session_perms` por turno nuevo.
> - [x] P1.8 Títulos de sesión con modelo pequeño — comando `generate_title` (turno utilitario de 24 tokens max, chat_id `__title_` para no contaminar la UI, timeout 25s) + fire-and-forget deduplicado en `App.tsx`; fallback al truncado actual si falla
> - [x] P1.9 Tools todowrite + question — `todowrite` (evento `todo-update`, lista persistida por chat, UI de chips/pestaña en Chat) + `question` (evento `question-ask`, espera oneshot con timeout 600s y cancelación, comando IPC `question_reply`, panel de opciones + respuesta libre en Chat). Test `test_normalize_todos`.
> - [x] P1.10 webfetch — tool `webfetch` (solo http/https, timeout 25s, cap 5MB, UA navegador, HTML→Markdown con `html2md` + limpieza de script/style/head, spill del output); permiso ask por URL; permitida en modo plan y en rol explorer; clasificada ReadOnly para el breaker.
> - [x] P1.11 Snapshots/revert por turno — `TurnSnapshot`/`SnapshotGuard` (copia del original antes de cada write/apply_patch, `manifest.json`, commit por Drop al salir del loop, últimos 5 turnos por sesión), comando `revert_last_turn` + botón "↩" en el chat.
> - [x] P1.12 Tools dentro del stream (multi-step) — RE-EVALUADO y descartado como tal (2026-08-20): el multi-step del AI SDK de opencode también emite N requests HTTP por N rondas de tools (verificado en `ai-sdk.ts`/`streamText`); la única diferencia es sintáctica. El bucle explícito de Makora no genera más requests y da mejor control de cancelación/metring. Las optimizaciones reales de esa área (batching paralelo de lecturas, caching de prefijo, retry) ya están implementadas. Ver ADR-027 para el fix del breaker relacionado.
> - [x] P1.13 MCP prompts + resources — pseudo-tools `list_resources`/`read_resource`/`list_prompts`/`get_prompt` por servidor cuando declara capabilities (ADR-029). Remoto/OAuth queda para v2.
> - [x] P1.14 Skills SKILL.md — discovery en `.makora/skills`, `.opencode/skills`, `~/.makora/skills`, `~/.claude/skills` (compat Claude Code); frontmatter name/description; el system prompt solo lista nombre+descripción; tool `skill` carga contenido bajo demanda (lazy, cache por chat); `MAKORA_BASE_SKILL` se mantiene como núcleo universal.
> - [x] P1.15 Compactación jerárquica (M4 completo) — `compact_history_llm`: disparo a >60% del contexto (16k-64k) con enfriamiento de 6 turnos; split en el último assistant con tools (cola wire-válida), head serializado `[Usuario]/[Asistente]/[Resultado de herramienta]` ≤12k chars, resumen LLM sin tools (1200 tokens max, chat_id `__compact`), sustitución por par user+assistant resumen estable (prefijo cacheable) + metering en tabla `requests`.
> - [x] P1.16 Prompt caching multi-proveedor — verificado: Anthropic explícito (`cache_control` system+tools+penúltimo user, `gateway.rs`), OpenAI/DeepSeek/Gemini automático por prefijo estable; `prompt_cache_hit_tokens` ya se parsea y se mide en `requests`. Sin cambios necesarios.
> - [ ] P2.17 Fork/branch + timeline
> - [ ] P2.18 Subagentes con sesión hija + background
> - [ ] P2.19 Comandos custom
> - [ ] P2.20 Sesiones a SQLite (parcial 2026-08-21: el blob de sesiones ya se persiste en SQLite como fuente de verdad — tabla `kv` — con localStorage como caché de arranque; falta modelar sesiones relacionalmente en las tablas `sessions`/`items`)
> - [ ] P2.21 @-mentions fuzzy + rangos de línea
> - [ ] P2.22 LSP tool para el agente

### P0 — Robustez del bucle (semanas 1-2, impacto inmediato, riesgo bajo) — COMPLETADA (2026-08-20)

1. **Retry con backoff + jitter en gateway** para 429/5xx/errores de red, respetando `retry-after`/`x-ratelimit-*` y con abort por cancelación de sesión. *Criterio:* un 429 transitorio nunca rompe un turno; test unitario con mock HTTP.
2. **Detección de doom-loop** (3 tool calls idénticas → abortar el turno con mensaje claro) sumada al breaker ADR-023. *Criterio:* test con loop simulado de tool idéntica.
3. **Truncado con spill a archivo**: outputs de bash/read > presupuesto se guardan en `%TEMP%/makora_truncated/` y el hint al modelo incluye la ruta + sugerencia de delegar a explorer. *Criterio:* bash con 10 MB de salida no excede el presupuesto de tokens del turno.
4. **`.gitignore`-aware list_dir/grep**: usar el crate `ignore` (de ripgrep) en Rust en vez del filtro hardcodeado; conservar la lista negra como fallback para repos sin git. *Criterio:* `node_modules` ignorado por `.gitignore` custom también se ignora; test unitario.
5. **bash del agente a proceso plano**: ejecutar con `Command` (no PTY), `TERM=dumb`, timeout actual (600 s) + kill-tree; la PTY queda solo para el terminal del usuario. *Criterio:* un comando que imprime el marcador no puede engañar al parser (el marcador desaparece).
6. **Repair de tool calls fallidas**: si la primera decodificación de una tool call falla (JSON inválido/args mal), reintentar una vez con nombre normalizado antes de devolver error al modelo.

### P1 — Paridad de funcionalidad de alto valor (semanas 3-8)

7. **Sistema de permisos ask/allow/deny** (ADR nuevo): reglas wildcard por (tool, patrón), reglas `always` por sesión, feedback correctivo al rechazar, detención del turno por defecto; UI en Makora (reutilizar patrón de `DiffReviewModal`). Empezar por `bash`, `write_file`, `apply_patch`, lectura de `*.env`. *Criterio:* el usuario puede aprobar/rechazar una edición sin cancelar el turno; "rechazar con mensaje" vuelve al modelo.
8. **Títulos de sesión con modelo pequeño**: comando async al primer turno usando un modelo utilitario (gpt-nano/claude-haiku/deepseek) con store off; fallback al truncado actual. *Criterio:* títulos descriptivos en <2 s tras el primer prompt.
9. **Tools `todowrite` + `question`** (esfuerzo bajo, ganancia alta de UX y de visibilidad del plan del agente). *Criterio:* lista de tareas visible en la card de tools; pregunta con opciones bloquea solo esa sesión.
10. **`webfetch`** (HTML→Markdown, límite 5 MB, UA navegador) con permiso web explícito y timeout. *Criterio:* el agente puede leer una URL de documentación y citar el contenido.
11. **Snapshots/revert por turno**: opción ligera primero (copias de archivos tocados en dir de estado por turno, con diff) y después shadow git-dir completo si el prototipo lo justifica. *Criterio:* botón "Deshacer turno" restaura archivos y transcript; test de revert.
12. **Tools dentro del stream (1 request multi-step)** en `gateway.rs`+`agent.rs`: ejecutar tools y reinyectar resultados en el mismo stream SSE cuando el proveedor lo permita, manteniendo el loop explícito como fallback. *Criterio:* un turno con 3 rondas de tools hace 1 request HTTP (medible en la tabla `requests`); cancelación por sesión intacta.
13. **MCP: prompts como comandos + resources (read/list)**, y remote StreamableHTTP (OAuth queda para v2). *Criterio:* un servidor MCP con resources expone sus tools de lectura; prompt de servidor aparece como comando `/`.
14. **Skills SKILL.md**: sustituir la constante `MAKORA_BASE_SKILL` por discovery de `.opencode/skills`, `~/.claude/skills` y `MAKORA.md` sections; system prompt solo con nombre+descripción, carga con tool `skill`. *Criterio:* un SKILL.md nuevo se descubre sin recompilar.
15. **Compactación jerárquica (M4 completo)**: agente de compactación con modelo pequeño + prune de outputs viejos + auto-continue; preservar decisiones (eval corto de 5 tareas). *Criterio:* sesión de 20+ turnos mantiene coste por turno decreciente y `cache_read_ratio` > 0.6.
16. **Prompt caching multi-proveedor**: `prompt_cache_key` para OpenAI-compat que lo soporte; verificar DeepSeek (su caché es automático por prefijo — documentarlo). *Criterio:* usage `cache_read` > 0 en segundo turno OpenAI-compat.

### P2 — Plataforma y UX diferencial (semanas 9-14)

17. **Fork/branch de sesiones + timeline**: fork desde mensaje (reutiliza transcript hasta N), árbol padre/hijo en las pestañas. *Criterio:* fork desde el mensaje 5 reproduce contexto hasta ahí con workspace del checkpoint.
18. **Subagentes con sesión hija real**: `delegate_subagent` crea sesión hija (SQLite, visibilidad opcional), admite `resume` y profundidad máx; background con notificación al terminar. *Criterio:* explorer en background termina y su briefing aparece en el chat padre.
19. **Comandos custom** (`MAKORA.md` o carpeta `commands/*.md` con interpolación de shell) + slash en el input. *Criterio:* `!/commit` ejecuta el comando definido en el proyecto.
20. **Persistencia de sesiones a SQLite**: migrar `makora.sessions.v1` a `history.rs` (tablas ya existentes) con localStorage solo como caché de arranque. *Criterio:* cerrar y abrir la app conserva pestañas, workspace y transcripts idénticos.
21. **Autocompletado @-mentions con ranking fuzzy + frecencia + rangos de línea** (`archivo#10-40`) y AGENTS.md por subdirectorio al leer archivos. *Criterio:* escribir `@mak` ofrece los archivos más frecuentes primero.
22. **LSP tool para el agente**: `documentSymbol`, `references`, `hover` vía sidecars auto-instalados (rust-analyzer, typescript-ls) — reutiliza CM6 para mostrar definiciones. *Criterio:* el agente localiza definiciones sin grep ciego.

### Fuera de alcance (v2, ya decidido)

Plugins JS hot-load, sharing web de sesiones, MCP OAuth, TUI, proveedores OAuth extensivos, ACP. (Si en v2 se retoma: el patrón de opencode a copiar es plugin = módulo JS con hooks sobre el SDK HTTP del server — en Makora sería hook sobre IPC tipado.)

## 5.5 Lecciones de vercel-labs/fx (2026-08-21)

`fx` (Zig, ~7.8 MiB) es un agente de código nativo minimalista. Su tesis central, verificada contra el código de Makora y aplicada en ADR-040: **la estabilidad y la economía de tokens empiezan en el system prompt y en el tamaño del conjunto de tools**, no en añadir más directivas.

| Principio de fx | Estado en Makora |
|---|---|
| System prompt mínimo (una sola fuente de verdad, sin directivas duplicadas) | ⚠️ Tenía duplicación (`MAKORA_BASE_SKILL` + `buildSystem`); **corregido en ADR-040** |
| Conjunto de tools reducido y conciso | ⚠️ 11 tools + descripciones verbosas; aceptable pero revisable |
| Permisos con "auto" + una sola revisión acotada para acciones sensibles | ✅ motor de permisos ADR/P1.7 |
| Skills lazy (`SKILL.md`) + subagentes + MCP | ✅ ADR-029/P1.14/ADR-020 |
| Binario nativo / WASM embebible | N/A (Makora es IDE de escritorio, no embebible) |
| `fx ask` no-interactivo + JSON parseable | N/A (Makora es GUI-first) |

Conclusión: Makora no necesita copiar la arquitectura de fx (binario nativo), pero sí su disciplina de **minimalismo en el prompt** y de **una única fuente de verdad para las directivas**, que es lo que el ADR-040 consolida.

## 5.6 Revisión de 7 IDEs/agentes (2026-08-21) — ideas accionables para Makora

Fuente: lectura de los README/docs públicos de cada repo. Lo que ya tiene Makora (bucle autónomo, plan/act, terminal, permisos, MCP, diffs, subagentes) se omite; solo se listan las ideas trasladables.

| Repo | Idea extraíble | Estado en Makora |
|---|---|---|
| **Void** (deprecated/archivado) | Visualización de diffs en streaming token-a-token; gramáticas propias para `<thinking>`/tags de tools | ⚠️ diffs ya existen (LCS) pero no en streaming; sanitización de tags ya implementada (ADR-039). Referencia solo. |
| **Roo Code** | Modos customizables (Architect/Code/Debug) + control de diffs | ⚠️ plan/act existen; falta un **modo Debug** (diagnóstico/ejecución de tests iterativa) |
| **Cline** | Permisos paso-a-paso con revisión humana + feedback correctivo | ✅ motor de permisos (P1.7) con feedback correctivo; UX mejorable |
| **OpenHands** | Workspace autónomo en **sandbox Docker** | N/A (Makora opera sobre el workspace real); un "bash aislado" sería opcional |
| **Goose** | **Subagentes paralelos** + recetas YAML (config-as-code) | ⚠️ delegación secuencial; paralelizar exploración ahorra latencia. Recetas = P2.19 comandos custom |
| **Zed** | Rendimiento nativo Rust + panel agéntico | ✅ Makora ya es Rust/Tauri |
| **Continue** | Contexto `@codebase` (índice del repo) + ecosistema modular de tools | ✅ repo-map ligero (ADR-044) + índice semántico de símbolos con BM25 (ADR-045) implementados |

**Decisiones tomadas (esta ronda):** se implementó el **repo-map ligero** (árbol de directorios `.gitignore`-aware, cacheado, inyectado en el prompt) y el **índice semántico de símbolos + BM25** (tool `repo_map_query`) — equivale al `@codebase` de Continue/Cline y al componente "repo-map" de opencode, completando M2 con extracción por regex por lenguaje (intercambiable por tree-sitter sin tocar la API). **Pospuesto con justificación:** subagentes paralelos (riesgo de carrera en el SnapshotGuard de revert), modo Debug (se puede cubrir con el prompt en modo Act) y sandbox Docker (fuera del modelo de confianza de Makora).

## 6. Métricas de éxito (propuesta, medibles en la tabla `requests`)

- P0: 0 turnos rotos por 429/red en 100 turnos de prueba; tiempo medio de grep en repo grande < 2 s.
- P1: coste por turno decreciente en sesiones largas (compactación); `cache_read_ratio` > 0.6 a partir del turno 3; 1 request HTTP por turno con tools (stream multi-step).
- P2: fork/revert usados sin pérdida de estado; subagente background con briefing < 10% de tokens del turno padre.
