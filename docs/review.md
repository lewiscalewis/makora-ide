# MakoraIDE — Revisión de Calidad, Seguridad y Arquitectura

Fecha: 2026-08-19. Revisión técnica sincronizada con el estado real del código.

## 1. Calidad de Código y Principios SOLID

| Principio | Estado | Notas |
|---|---|---|
| **SRP (Responsabilidad Única)** | ✓ Excelente | `gateway` (HTTP/streaming/poda), `agent` (bucle agéntico + tools), `multiagent` (DAG y subagentes especializados), `history` (SQLite WAL + metering), `token_engine` (BPE tiktoken + presupuestos), `terminal` (PTY), `mcp` (cliente stdio), `balance` (créditos). Frontend: modular por sesión (`sessionStore.ts`) y componentes desacoplados (`Chat`, `Explorer`, `TerminalPanel`, `GitModal`, `SettingsModal`, modales lazy-loaded). |
| **OCP (Abierto/Cerrado)** | ✓ Excelente | Añadir un proveedor OpenAI-compatible se realiza vía configuración de presets sin alterar el gateway HTTP. Extender roles multiagente o tools nativas se realiza sin modificar la estructura del bucle central. |
| **LSP (Sustitución)** | ✓ Maduro | Cancelación por chat (`CANCELLED: HashSet<String>`), aislamiento de estado por `sessionId` (ADR-017). Flujos de subagentes ejecutan contratos idénticos retornando briefings condensados. |
| **ISP (Segregación)** | ✓ | Comandos IPC fuertemente tipados con specta (`tauri-specta`); el frontend consume contratos TypeScript generados de forma determinista. |
| **DIP (Inversión)** | ✓ | El núcleo de ejecución desacopla Tauri mediante abstracciones serde y emite eventos desacoplados (`tool-start/output/end`, `thinking-delta`, `multiagent-plan-event`). |

---

## 2. Estado de Seguridad y Vulnerabilidades

| # | Riesgo / Control | Severidad | Estado Actual / Mitigación Implementada |
|---|---|---|---|
| 1 | **Almacenamiento de API Keys** | Alta | ✅ **Mitigado**: Bóveda DPAPI en Windows / OS Keyring (`keyring` crate v3) con fallback a SQLite Vault cifrado en `history.rs`. |
| 2 | **Content Security Policy (CSP)** | Alta | ✅ **Configurada**: CSP estricta en `tauri.conf.json` permitiendo solo orígenes seguros, asset protocol local y dominios API autorizados (OpenAI, Anthropic, DeepSeek, OpenRouter). |
| 3 | **Ejecución `bash` (Sandbox Operativo)** | Alta por diseño | 🟡 **Controlado**: Comandos silenciosos; prevención de comandos interactivos bloqueantes en el Thinking Protocol. |
| 4 | **Path Traversal en Herramientas** | Crítica | ✅ **Mitigado y Verificado por Tests**: `resolve_path` canonicaliza y valida pertenencia a carpetas del workspace (`within()`). Tests unitarios dedicados bloquean escapes con `../` o rutas absolutas fuera del workspace. |
| 5 | **Variables de Entorno Heredadas** | Media | 🟡 **Aceptado**: Mismo comportamiento que una terminal nativa de desarrollador. |
| 6 | **Servidores MCP de Terceros** | Media | ✅ **Acotado**: Descubrimiento dinámico de esquemas por stdio, aislamiento de namespaces (`mcp__server__tool`). |
| 7 | **Prompt Injection desde Archivos** | Media | ✅ **Mitigado**: Sanitización y extracción estricta en `gateway.rs` (DSML / tool calls) y aislamiento efímero en subagentes (*Explorer* no ejecuta comandos destructivos). |
| 8 | **Imágenes y Adjuntos** | Baja | ✅ **Mitigado**: Redimensionamiento y compresión en canvas antes de subida (<1024px, JPEG 85%). |
| 9 | **Terminales PTY** | Baja | ✅ **Aislado**: Terminal del usuario separada de la PTY interna de ejecución del agente. |
| 10 | **Presupuesto y Desborde de Tokens** | Media | ✅ **Mitigado**: Motor BPE local (`token_engine.rs`) con poda inteligente de respuestas de herramientas (`prune_tool_output`), `read_file_range` obligatorio y control de cuotas. |

---

## 3. Arquitectura, Concurrencia y Rendimiento

- **Multi-Agente Inteligente (Auto-Router)**: Heurística en `Chat.tsx` que evalúa cada turno: peticiones complejas/multifichero activan automáticamente el DAG (*Explorer ➔ Coder ➔ Tester ➔ Reviewer*), ahorrando entre un 60% y 80% de tokens en la ventana principal. Peticiones atómicas se resuelven en mono-agente directo (<1.5s).
- **Code-Splitting del Frontend**: Configurado en `vite.config.ts` con `manualChunks` (`vendor-react`, `vendor-codemirror`, `vendor-xterm`, `vendor-markdown`, `vendor-three`) y carga perezosa (`React.lazy`) para modales pesados.
- **Persistencia Relacional SQLite WAL**: `history.rs` registra sesiones, checkpoints de transcript, solicitudes con desglose de coste/latencia (`requests`) y métricas de lectura de caché.
- **Suite de Pruebas Unitarias**: 18 tests unitarios en Rust (`cargo test`) con 100% de éxito, cubriendo seguridad de paths, motor de tokens tiktoken, parsers de gateway, DAG multiagente y persistencia SQLite.
- **Higiene del Repositorio**: Scripts temporales confinados en carpeta `scratch/` ignorada en `.gitignore`.
