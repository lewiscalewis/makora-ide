# MakoraIDE — Revisión de calidad, seguridad y arquitectura

Fecha: 2026-08-18. Revisión interna (código actual, sin auditoría externa).

## 1. Calidad de código y SOLID

| Principio | Estado | Notas |
|---|---|---|
| SRP (responsabilidad única) | ✓ Bueno | `gateway` (HTTP/proveedores), `agent` (bucle+tools), `mcp` (cliente MCP), `terminal` (PTY), `balance` (créditos) — módulos acotados. Frontend: componentes por panel (`Chat`, `Explorer`, `UsagePanel`, `TerminalPanel`, `SettingsModal`, `Markdown`, `SplitPane`). |
| OCP (abierto/cerrado) | ✓ Razonable | Añadir proveedor OpenAI-compatible = añadir preset en `providers.ts` sin tocar el gateway. Añadir tool = 1 entrada en `core_tools()` + 1 match en `execute_tool`. |
| LSP (sustitución) | ⚠ A mejorar | `chat`/`chat_cancel` son funciones globales; el estado (`TERMINALS`, `MCP`) son `LazyLock` estáticos. Funciona en app de escritorio, pero conviene un trait `Provider`/`ToolRunner` para testabilidad. |
| ISP (segregación) | ✓ | Comandos IPC pequeños y tipados (specta); el frontend solo ve contratos. |
| DIP (inversión) | ✓/⚠ | El core no depende de Tauri más que en los comandos; `agent.rs` recibe `AppHandle` para eventos. Aceptable; extraer `EventBus` como trait mejoraría el test. |

**Hallazgos menores:** (1) `cargo check` sin warnings (tras limpieza); (2) `npm run build` sin errores TS strict; (3) bundle 717 KB — xterm + react-markdown sin code-splitting (mejora pendiente: `manualChunks`/lazy load de xterm); (4) el flujo de errores del chat quedaba oculto cuando había texto parcial acumulado (corregido 2026-08-18: ahora se añade "⚠️ Error" al final); (5) al agotar `maxToolLoops` el turno moría en silencio (corregido: turno final sin tools).

## 2. Vulnerabilidades identificadas

| # | Riesgo | Severidad | Estado / Mitigación |
|---|---|---|---|
| 1 | **API key en localStorage** (texto plano en perfil WebView) | Alta | Aceptado en prototipo. Mitigación planificada: DPAPI (Windows) / Keychain (macOS) / libsecret (Linux) detrás de un trait (ADR-008). Mientras: documentar que la key solo vive localmente. |
| 2 | **CSP nula** (`tauri.conf.json`: `"csp": null`) | Alta (producción) | En dev permite HMR. Antes de empaquetar: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost` (ajustar en `tauri.conf.json` de producción). |
| 3 | **`bash` sin sandbox**: el agente ejecuta comandos arbitrarios como el usuario (paths, red, `rm`) | Alta por diseño | Es la semántica de un IDE agéntico (VS Code/Cursor igual). Pendiente (ADR-008): pipeline deny→ask→allow con aprobación UI para comandos destructivos; allowlist de red. |
| 4 | **Path traversal** en tools | Mitigada | `resolve_path` canonicaliza y verifica `starts_with(workspace)`; fallback por nombre limitado a profundidad 2 y excluye ocultos/AppData/node_modules/target. `write_file` restringido igual. |
| 5 | **Variables de entorno heredadas** por procesos del agente (secrets en env llegan a los comandos) | Media | Aceptado (mismo comportamiento que una terminal). Mitigación futura: sanitizar env para el sandbox nivel 2. |
| 6 | **Servidores MCP de terceros sin sandbox** (procesos con permisos del usuario, se registran al vuelo) | Media | El usuario los configura explícitamente en UI; los namespaces `mcp__server__tool` evitan colisiones. Pendiente: advertencia al añadir un MCP + permitir solo stdio local. |
| 7 | **Prompt injection** desde archivos del workspace (el agente lee contenido potencialmente hostil) | Media | Pendiente: guardrails de tool (bloquear instrucciones inyectadas, patrón OpenAI Agents SDK) y no auto-aprobar acciones de alto impacto. |
| 8 | **Imágenes/adjuntos sin límite** (data URLs grandes en el transcript) | Baja | `FileReader` sin cap en imágenes; texto limitado a 200 KB. Mejora: cap de tamaño/MB por imagen y aviso. |
| 9 | **Terminal compartida**: la PTY del usuario no está expuesta al agente (separadas) | Baja | Correcto por diseño; el agente usa su propia PTY. |
| 10 | **Sin rate-limiting ni presupuesto duro** de coste por turno (solo `maxToolLoops`) | Media | Previsto en `docs/token-engine.md` (budgets por componente + `max_budget_usd`). |

## 3. Arquitectura limpia — evaluación

- **Desacoplamiento núcleo/adaptadores:** ✓ — el gateway acepta `ChatConfig` (kind/base/model/key); los proveedores OpenAI-compatibles son datos, no código. Anthropic tiene su propio path (`anthropic_turn`).
- **Contratos:** ✓ — `docs/contracts.md` + bindings tipados especta; eventos de dominio (`tool-start/output/end`, `thinking-delta`, `chat-delta-event`) con payloads serde.
- **Persistencia:** ⚠ — config/workspace en localStorage (UI) y sin capa SQLite aún (prevista: sesiones, checkpoints por turno, memorias, métricas). El transcript vive en el frontend (se reenvía completo) — funciona, pero SQLite permitirá poda/compaction reales (M2/M4).
- **Testing:** ⚠ — sin tests aún. Próximos: tests de `resolve_path` (traversal), parser SSE, MCP JSON-RPC con servidor fake, y evals del bucle (bug-fixing) para no degradar calidad al optimizar tokens.
- **Observabilidad:** ✓ parcial — tokens/coste/saldo en UI; faltan logs estructurados del core (tracing).

## 4. Plan de acción priorizado

1. **P0** — DPAPI/Keychain para API keys; CSP de producción; presupuesto duro por turno (tokens/USD).
2. **P1** — Checkpoints por turno en SQLite + restore (ya diseñado); pipeline de permisos deny→ask→allow; sanitizar env del agente.
3. **P2** — Tests unitarios (resolve_path, SSE, MCP) + evals; code-splitting del bundle; LSP vía language servers.
4. **P3** — M2/M4: motor de contexto con presupuestos reales y prompt caching con prefijo estable (ver `docs/token-engine.md`). _Estado 2026-08-18: parcialmente implementado — TokenCounter/ContextComposer (`token_engine.rs`), HistoryManager SQLite + metering + resume por checkpoint (`history.rs`), `cache_control` ephemeral en Anthropic. Pendiente: repo-index tree-sitter, BM25, compactación jerárquica con resumen LLM._
