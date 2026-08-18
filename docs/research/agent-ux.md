# UX de agente: pensamiento y actividad de herramientas (investigación)

Fecha: 2026-08-18. Fuentes consultadas: docs de Cursor Agent (cursor.com/docs/agent) y Anthropic (platform.claude.com/docs/en/build-with-claude/thinking y extended-thinking).

## Patrones de referencia

### 1. Cadenas de pensamiento (thinking)

- **Anthropic:** los bloques `thinking` llegan en el stream y NO deben mostrarse por defecto; se muestran como "thinking summaries" o se ocultan. Hay control explícito de display (p. ej. `display: "hidden"` / `summarized` en ciertos modos). Claude 4.6+ preserva los thinking blocks de turnos previos en el contexto (se facturan como input) — implicación para nosotros: NO reenviar reasoning al transcript (DeepSeek `reasoning_content` no debe guardarse en `messages`).
- **DeepSeek v4-pro (verificado 2026-08-18):** emite `delta.reasoning_content` en el stream (con `content: null` durante el razonamiento). Nuestro gateway ya lo captura como evento `thinking-delta` y la UI lo muestra en un `<details>` colapsado ("🧠 Pensamiento del modelo") dentro de la burbuja del asistente.
- **Regla UI (VS Code/Cursor/Antigravity):** el razonamiento es material secundario: bloque plegado, tipografía muted, sin interrumpir la respuesta. Nunca se mezcla con el texto final.

### 2. Actividad de herramientas

- **Cursor:** muestra un *timeline* en el chat con los pasos del agente (tool calls, edits, comandos), con checkpoints restaurables. NO muestra el log completo por defecto: una línea por paso, expandible.
- **Claude Code:** transiciones "⚙ ejecutando → ✓/✗ hecho" con log en pestaña aparte (o expandible), y `compact_boundary` separando fases.
- **Aplicado en MakoraIDE:** bloque único colapsado "✓ N herramientas usadas" con lista de items (⚙/✓/✗ + nombre + args + log truncado). Abierto automáticamente solo mientras hay una tool en ejecución; después queda plegado.

### 3. Sin límite de tool calls (Cursor)

- Cursor declara explícitamente: "There is no limit on the number of tool calls Agent can make during a task".
- **Aplicado:** `maxToolLoops` por defecto 24 + **turno final sin herramientas** si se alcanza el límite (fuerza una respuesta textual en vez de morir en silencio). El límite existe solo como red de seguridad de coste/latencia; no es un cap funcional.

### 4. Terminal del agente

- Cursor ejecuta comandos del agente usando "the first terminal profile available" del sistema.
- **Aplicado:** `agent.rs::run_bash` usa PTY con el shell del sistema (`%COMSPEC%` / `$SHELL`), salida en vivo, código de salida real y cancelación — el mismo mecanismo que la terminal integrada del usuario.

### 5. Interleaved thinking y caching (implicaciones futuras)

- Anthropic: thinking interleaved entre tool calls (4.6+: automático en modo adaptive). Cambiar el modo de thinking invalida la caché de prompt (el budget/effort se renderiza en el prompt).
- **Implicación para M4:** el `reasoning_effort` debe ser ESTABLE durante una conversación cacheada; cambiar el nivel de pensamiento entre turnos puede invalidar breakpoints de caché. Nuestro selector de pensamiento ya es por modelo (estable por sesión) — correcto por diseño.

### 6. Checkpoints y cola de mensajes (futuro)

- Cursor: checkpoints automáticos antes de cambios significativos (snapshot de archivos modificados, restauración desde el timeline). Cola de mensajes mientras el agente trabaja (Enter encola, Cmd+Enter interrumpe).
- Ya previstos en `docs/architecture.md` §7 (checkpoints por turno en SQLite) — pendientes de implementar (M3+).
