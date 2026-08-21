# MakoraIDE — Arquitectura detallada (prototipo)

Fecha: 2026-08-18. Documento vivo. Complementa `docs/decisions.md` (ADR), `docs/token-engine.md` y `docs/contracts.md` (contratos TS).

## 1. Visión y alcance

IDE de escritorio (Windows primero, luego macOS/Linux) para desarrollo agéntico:
- El usuario conecta su modelo vía API key (OpenAI, Anthropic) o modelo local (Ollama).
- El agente opera sobre el workspace: lee, edita, ejecuta y conversa.
- Diferenciador: motor de eficiencia de tokens (máximo ahorro algorítmico sin degradar razonamiento).

Fuera del prototipo (v2+): colaboración multiusuario, plugins de terceros, sandbox fuerte por contenedor, móvil.

## 2. Principios de diseño

1. **Frontend = vista.** Toda lógica de contexto, tokens y herramientas vive en Rust.
2. **Budget-first.** Ninguna request sale sin presupuesto de tokens y coste estimado.
3. **Cache-aware.** Prefijo estable: contenido estático primero, dinámico al final.
4. **Medible.** Toda request deja huella (in/out/cached/write/reasoning, coste, latencia) en SQLite.
5. **Resumible.** Todo turno es cancelable; todo estado es reconstruible (checkpoints).
6. **Seguridad por defecto.** deny → ask → allow → callback.

## 3. Capas

```
┌───────────────────────────────────────────────────────────┐
│ Frontend (WebView2) — React 19 + TS + Vite + CM6          │
│  Editor · Chat · Timeline del agente · Diffs · Dashboard  │
│  de tokens/costes · Aprobaciones · Settings               │
├───────────────────────────────────────────────────────────┤
│ IPC tipado (tauri-specta): comandos + eventos             │
├───────────────────────────────────────────────────────────┤
│ Core Rust (Tokio) — workspace de crates                   │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ context-     │ │ compression  │ │ cache-layer       │  │
│  │ engine       │ │ (sumarios,   │ │ (semántica +      │  │
│  │ (composer,   │ │ pruning,     │ │  respuestas,      │  │
│  │ budget,      │ │ LLMLingua-2*)│ │  invalidación)    │  │
│  │ repo-map,    │ └──────────────┘ └───────────────────┘  │
│  │ retrieval)   │ ┌──────────────┐ ┌───────────────────┐  │
│  └──────────────┘ │ model-       │ │ agent-runtime     │  │
│  ┌──────────────┐ │ gateway      │ │ (loop, tools,     │  │
│  │ token-       │ │ (OpenAI/     │ │ MCP cliente,      │  │
│  │ counter      │ │ Anthropic/   │ │ handoffs,         │  │
│  └──────────────┘ │ Ollama, SSE, │ │ guardrails)       │  │
│  ┌──────────────┐ │ batch)       │ └───────────────────┘  │
│  │ persistence  │ └──────────────┘ ┌───────────────────┐  │
│  │ (SQLite,     │ ┌──────────────┐ │ metering          │  │
│  │ checkpoints) │ │ tool-sandbox │ │ (costes, KPIs,    │  │
│  └──────────────┘ │ (subprocess, │ │ optimizador)      │  │
│  ┌──────────────┐ │ permisos,    │ └───────────────────┘  │
│  │ repo-index   │ │ kill-tree)   │                        │
│  │ (watcher,    │ └──────────────┘                        │
│  │ tree-sitter, │                                         │
│  │ BM25/embed)  │                                         │
│  └──────────────┘                                         │
└───────────────────────────────────────────────────────────┘
  Language servers sidecar (rust-analyzer, typescript-ls…)
```

## 4. Crates (workspace Rust)

| Crate | Responsabilidad | Crates clave |
|---|---|---|
| `makora-core` | tipos, errores, config | serde, thiserror |
| `token-counter` | conteo local + heurística adaptativa | tiktoken-rs, tokenizers |
| `context-engine` | composición, presupuesto, repo-map, retrieval | tree-sitter, fastembed-rs, BM25 |
| `compression` | sumarios jerárquicos, compactación, LLMLingua-2* | gateway local |
| `cache-layer` | caché semántica + respuestas, invalidación | fastembed-rs, simhash |
| `model-gateway` | OpenAI/Anthropic/Ollama, SSE, batch | reqwest, reqwest-eventsource |
| `agent-runtime` | loop, registro de tools, MCP, handoffs, guardrails | tokio, serde_json |
| `tool-sandbox` | subprocess, permisos, timeout, kill-tree | tokio, Job Objects |
| `persistence` | SQLite sesiones/items/checkpoints/memorias | rusqlite (bundled) |
| `metering` | contabilidad, dashboards, políticas | chrono |
| `repo-index` | watcher, índice de símbolos y texto | notify-debouncer, walkdir |

`*` = fases posteriores del prototipo.

### Módulos implementados (estado 2026-08-18)

- `src-tauri/src/gateway.rs` — capa provider multi-proveedor (OpenAI-compat: OpenAI/DeepSeek/OpenRouter/Groq/Ollama/Custom · Anthropic), streaming SSE, acumulación de `delta.tool_calls`, retry con backoff, multimodal (images), razonamiento/thinking.
- `src-tauri/src/agent.rs` — bucle agéntico simple (port de opencode): `stream → ejecutar tools → añadir resultados → repetir`. Tools núcleo (`read_file`/`read_file_range`/`edit`/`apply_patch`/`write_file`/`bash`/`grep`/`list_dir`/`webfetch`/`todowrite`/`question`/`skill` + MCP) restringidas al workspace, permisos por sesión, snapshots/revert, fusibles de seguridad (100 turnos / 2M tokens). Confía en el function calling nativo (sin extracción de tool-calls por texto, ADR-056).
- `src-tauri/src/mcp.rs` — cliente MCP stdio (initialize → notifications/initialized → tools/list, tools/call), naming `mcp__<server>__<tool>`, adapter de schemas a function-calling.
- `src-tauri/src/terminal.rs` — PTY (portable-pty, ConPTY en Windows), terminales múltiples por id, eventos `term-data-<id>`/`term-exit-<id>`, resize.
- `src-tauri/src/balance.rs` — saldo de crédito: DeepSeek (`/user/balance`) y OpenRouter (`/api/v1/credits`); el resto usa estimador local por precios del modelo.
- Frontend: SplitPane redimensionable persistente (`src/core/SplitPane.tsx`), terminal xterm.js, renderizado Markdown con diffs/artifacts (`src/components/Markdown.tsx`), @mentions + adjuntos (imágenes/drag&drop), monitor de consumo/crédito.

## 5. Flujo de un turno

1. Usuario envía prompt o aprueba acción → comando IPC `agent.send_prompt`.
2. `agent-runtime` crea/recupera turno; registra checkpoint de entrada.
3. `context-engine` ensambla contexto:
   a. repo-map relevante (símbolos + ranking, presupuesto de tokens);
   b. archivos relevantes (BM25 + embeddings) chunkeados por símbolos tree-sitter;
   c. historial podado (últimos N + sumarios previos);
   d. memoria KV relevante + archivo de reglas (`MAKORA.md`).
4. Composer aplica presupuesto por componente; si excede → comprime o trunca con validez sintáctica.
5. `cache-layer` consulta (solo lectura, TTL válido) → si hit, respuesta directa (paso 10).
6. `model-gateway` emite request con prefijo estable + breakpoints de caché + reasoning effort según clase de tarea + structured output si aplica.
7. Streaming SSE → eventos tipados al frontend (deltas de texto / tool calls).
8. Tool calls: `tool-sandbox` evalúa permisos (deny→ask→allow→callback). Read-only en paralelo; mutadoras secuenciales. Resultados comprimidos (truncado inteligente + formato canónico).
9. Repetir 6–8 hasta respuesta final o límites (`max_turns`, presupuesto).
10. Post-turno: metering persiste usage real; checkpoint; decisión de compactación (SIEMPRE entre turnos, nunca bloqueando streaming); actualización/invalidación de cachés.

## 6. Contrato IPC (resumen, tipado con tauri-specta)

Comandos (frontend → core):
- `config.set_api_keys(provider, key)` — cifrado DPAPI/Keychain/libsecret
- `session.create(cwd, model)` · `session.resume(id)` · `session.branch(checkpoint)`
- `agent.send_prompt(session_id, text, options{effort, budget})`
- `agent.cancel_turn()` · `agent.respond_approval(decision)`
- `repo.status(path)` · `metering.report(scope)`

Eventos (core → frontend, broadcast tipado):
`TurnStarted` · `TextDelta` · `ToolCallStarted` · `ToolOutputDelta` · `ApprovalRequired` · `TurnFinished{usage, cost}` · `TurnCancelled` · `CheckpointCreated` · `CompactBoundary` · `IndexUpdated`

## 7. Esquema SQLite (mínimo)

```
sessions(id, title, cwd, model, provider, created_at)
items(id, session_id, seq, role, kind, content_json, usage_json,
      parent_checkpoint, created_at)
checkpoints(session_id, seq, label, files_state_json, created_at)
memories(namespace, key, value_json, embedding, updated_at)
requests(id, session_id, provider, model, input_tokens, cached_tokens,
         output_tokens, reasoning_tokens, cost_usd, latency_ms, created_at)
cache_entries(key_hash, query_hash, response_json, ttl, file_hashes_json)
```

Checkpoint por TURNO (transcript seq + estado de archivos tocados) → undo, branch, resume, time travel.

## 8. Seguridad

- **API keys:** nunca en texto plano en disco → DPAPI (Windows) / Keychain (macOS) / libsecret (Linux) detrás de un trait.
- **Capacidades Tauri** por ventana (editor vs settings) + CSP estricta.
- **Permisos del agente:** pipeline fijo (ADR-008); rutas críticas nunca auto-aprobadas.
- **Subprocess:** cwd confinado, env sanitizado, timeout, cap de stdout (truncar + etiquetar), kill-tree (Job Objects en Windows / pgid en Unix).
- **Red del agente:** prototipo sin red salvo allowlist configurable (git remotes, package managers).
- **Secrets:** guardrails de tool bloquean patrones de claves en argumentos y salidas.

## 9. Multiplataforma (tras M7 de Windows)

- notify-debouncer ya abstrae FSEvents (macOS) / inotify (Linux) / ReadDirectoryChangesW (Windows).
- kill-tree y almacenamiento seguro detrás de traits por SO.
- Linux: requisito webkit2gtk-4.1 documentado.
- Empaquetado: NSIS/MSI (Windows) → DMG (macOS) → AppImage/deb (Linux).
