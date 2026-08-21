# MakoraIDE — Roadmap del prototipo

Estimaciones para 1 desarrollador (o IA + humano revisor). Fechas relativas desde M0.

## Estado real (actualizado 2026-08-19)

| Milestone | Estado | Notas |
|---|---|---|
| M0 Fundamentos y spike | ✅ Done | Spike sustituido por IDE real; decisión de editor documentada (CM6, ADR-002) |
| M1 Base IDE + conexión de modelos | ✅ Done | Chat streaming, coste real visible por turno, tabla `requests` en SQLite WAL (`history.rs`) y DPAPI Keyring. |
| M2 Motor de contexto v1 | 🟡 Parcial | `token_engine.rs`: TokenCounter (tiktoken + fallback), truncado por presupuesto con límites de línea, ContextComposer con cuotas por componente. **Pendiente:** repo-index con tree-sitter, BM25/fastembed. |
| M3 Agent runtime v1 | ✅ Done | Loop autónomo + tools quirúrgicas (`apply_patch`, `read_file_range`, etc.) + MCP stdio + DAG Multi-Agente con Auto-Router inteligente (`Chat.tsx` / `multiagent.rs`) + SQLite sesiones/checkpoints. |
| M4 Caché de prefijo + compactación | 🟡 Parcial | `history.rs`: SQLite (sessions/items/checkpoints/requests) con metering por turno, resume por checkpoint, archivo de transcript. `cache_control` ephemeral en system+tools (Anthropic). **Pendiente:** compactación jerárquica con resumen LLM. |
| M5 Caché semántica + offload local | ⬜ No empezado | — |
| M6 Laboratorio de optimización | 🟡 Parcial | Perfiles Eco/Balanced/Deep activos (ADR-015). Tabla `requests` con coste/caché/latencia disponible para el dashboard. **Pendiente:** baseline naive, eval suite, optimizer. |
| M7 Empaquetado y pulido | ⬜ No empezado | — |

## M0 — Fundamentos y spike técnico (semana 1–2)

- Instalar Rust (rustup, toolchain stable-msvc). MSVC y WebView2 ya presentes.
- Scaffold Tauri 2 + React 19 + TS + Vite + tauri-specta; build CI de Windows.
- Spike: CM6 y Monaco cargando archivo de 10 MB en WebView2 → medir RAM, arranque, latencia de tipeo, web workers bajo asset protocol (riesgo ADR-002).
- Spike: streaming SSE desde Rust a React con cancelación (base del gateway).
- Elegir editor definitivo (CM6 vs Monaco) con datos del spike.

**Estado:** ✅ Done (el spike se sustituyó por el IDE real; CM6 elegido, ver ADR-002).

## M1 — Base IDE + conexión de modelos (semana 3–4)

- Editor con árbol de ficheros, pestañas, diffs básicos.
- Settings: API keys (DPAPI / keyring), selección de modelo OpenAI/Anthropic/DeepSeek/Ollama.
- Chat simple: prompt → streaming al panel, sin herramientas.
- `token-counter` integrado: conteo en vivo del contexto; tabla `requests` en SQLite; desglose de tokens/coste por turno (usage real del API).

**Estado:** ✅ Done (Chat streaming con coste real, DPAPI keyring y tabla `requests` SQLite activa).

## M2 — Motor de contexto v1 (semana 5–6)

- `repo-index`: watcher (notify-debouncer) + tree-sitter (TS/JS/Rust/Python) → repo-map estilo Aider con ranking.
- Composer con presupuestos por componente y truncado con validez sintáctica.
- Retrieval BM25 + embeddings (fastembed) de chunks por símbolo.
- Tool "leer archivo por rango" con cuotas (`read_file_range`).

**Criterios de aceptación:** el agente responde sobre el código del repo enviando solo fragmentos relevantes; conteo local ≈ conteo real del API.

**Estado:** 🟡 Parcial. TokenCounter + truncado por presupuesto + ContextComposer implementados en `src-tauri/src/token_engine.rs` (tests incluidos); el conteo local se registra por turno (`[TOKEN_ENGINE] turn=… local=… api_in=…`). Pendiente: repo-index tree-sitter, BM25/fastembed.

## M3 — Agent runtime v1 (semana 7–9)

- Loop turno = LLM → tools → resultados; `max_turns` + presupuesto en $.
- Tools núcleo: `edit`, `apply_patch` (diffs quirúrgicos), `read_file_range`, `list_dir`, `grep`, `bash`, `write_file`, `webfetch`, `todowrite`, `question`.
- Auto-Router Multi-Agente inteligente con orquestación DAG (*Explorer ➔ Coder ➔ Tester ➔ Reviewer*).
- SQLite: sesiones, items, checkpoints por turno, resume.
- Timeline del agente en el frontend (eventos tipados).

**Criterios de aceptación:** el agente completa tareas end-to-end con parches quirúrgicos mínimos; multi-agente automático para tareas complejas.

**Estado:** ✅ Done. Loop autónomo estilo opencode (ADR-056), tools, MCP y persistencia SQLite checkpoints activos.

## M4 — Caché de prefijo + compactación (semana 10–11)

- Prefijo estable + breakpoints explícitos (`prompt_cache_key` OpenAI / `cache_control` Anthropic).
- Compactación jerárquica con preservación de decisiones + `CompactBoundary` + archivo de transcript.
- `previous_response_id` / budgets de razonamiento; limpieza de tool results viejas.
- Resume por checkpoint con estado resumido.

**Criterios de aceptación:** `cache_read_ratio` > 0.6 en sesiones de 20+ turnos; coste por turno decreciente; la compactación no pierde decisiones (eval).

**Estado:** 🟡 Parcial. HistoryManager SQLite (`history.rs`: sessions/items/checkpoints/requests + metering por turno + resume por checkpoint), prefijo estable con `cache_control` ephemeral en system y tools (Anthropic). Pendiente: compactación jerárquica con resumen LLM (CompactBoundary completo), medición de `cache_read_ratio` en sesiones largas y limpieza de la tabla `requests`.

## M5 — Caché semántica + offload local (semana 12–13)

- Caché semántica fastembed + invalidación por hash de archivos + simhash.
- Routing por clase de tarea → modelo local (Ollama) para tareas baratas.
- Sub-agente explorador con contexto propio.
- Batch API para tareas nocturnas (resúmenes, embeddings, evals).

**Criterios de aceptación:** hit ratio > 30% en sesiones reales; ahorro $ medible vs sin caché; cero falsos positivos reportados.

**Estado:** ⬜ No empezado.

## M6 — Laboratorio de optimización (semana 14–15)

- Dashboard de tokens/costes con línea base "ingenua" vs motor (ahorro visualizado).
- Perfiles: Máxima eficiencia / Equilibrado / Máxima calidad.
- Eval suite de tareas + regresión de calidad.
- Optimizer: sugerencias automáticas de policy con proyección de ahorro.

**Criterios de aceptación:** informe A/B de perfiles; pass rate de evals estable entre perfiles; ahorro total del motor ≥ 60% vs línea base.

**Estado:** 🟡 Parcial. Perfiles Eco/Balanced/Deep activos (ADR-015). Pendiente: baseline naive, eval suite, optimizer.

## M7 — Empaquetado y pulido (semana 16)

- Instalador NSIS/MSI + updater Tauri; branding provisional.
- UX: aprobaciones rápidas, atajos, estados de error.
- Documentación de uso (conectar keys, permisos, perfiles).
- Revisión de seguridad (keys, subprocess, CSP).

**Criterios de aceptación:** instalador funcionando en Windows limpio; demo end-to-end grabada.

**Estado:** ⬜ No empezado.

## Riesgos globales

1. **WebView2** (workers/CSP): lo decide el spike M0; plan B Monaco o fallback nativo.
2. **Bugs de invalidación de caché** (los peores en UX): tests de invalidación dedicados en M5.
3. **Deriva de costes:** si el ahorro no llega al 60%, revisar políticas antes de prometer.
4. **LSP en CM6:** si >1 semana, cambiar a Monaco (plan B, ADR-002).
5. **Alcance:** MCP se limita a tools/list/call; nada de features de terceros hasta v2.

## v2 (post-prototipo)

MCP completo (resources/prompts/HTTP), sandbox Docker con allowlist, LSP completions por sidecars, multi-workspace, packaging macOS/Linux, plugins.
