# MakoraIDE — Contratos y Tipos (TS)

Fecha: 2026-08-19. Interfaces clave del frontend. Los tipos wire (Rust↔TS) los genera tauri-specta en `src/bindings.ts` al arrancar; este documento fija los contratos de dominio. Espejo Rust: `src-tauri/src/{lib,gateway,agent,mcp,terminal,balance,multiagent}.rs`.

## 0. Sesiones concurrentes (ADR-017, 2026-08-19)

```ts
// Comandos:
// chat(config, system, messages, folders, chatId) → ChatResult
// chat_cancel(chatId)                          → void   (cancelación POR chat, no global)
// run_multiagent_plan(config, system, messages, folders, chatId, objective) → ChatResult

// chatId = id de sesión del FRONTEND (crypto.randomUUID). Es la clave de:
//  - cancelación backend (CANCELLED: HashSet<String> en agent.rs)
//  - session_id de SQLite (FNV-1a del chatId)
//  - enrutado de eventos en el frontend (sessionStore.ts filtra por chatId)

// Sesiones:
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model: string;
  messages: ChatMessage[];
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  workspace?: SessionWorkspaceState; // Fase 2: workspace POR sesión
}

export interface SessionWorkspaceState {
  folders: string[];
  openFiles: OpenFile[];
  activeFilePath: string | null;
  agentMode?: "act" | "plan";
  status: "idle" | "running" | "completed" | "error";
  diff?: DiffInfo | null;
}
// Persistido dentro de "makora.sessions.v1". Las sesiones nuevas heredan las
// carpetas de la sesión activa. El orden del array es el orden de pestañas
// (sin reordenar por updatedAt).

// Multiagente (Fase 3):
// create_multiagent_plan(sessionId, objective) → MultiAgentPlanState (tool de ayuda)
// run_multiagent_plan ejecuta el plan Explorer → Coder → Tester → Reviewer con
// toolset por rol y briefing condensado entre pasos.
export interface MultiAgentPlanState {
  planId: string;
  sessionId: string;
  objective: string;
  steps: MultiAgentPlanStep[];
  activeStepIndex: number | null;
  isCompleted: boolean;
  totalTokens: number;
  totalCostUsd: number;
}
```

## 1. Sistema de terminal

```ts
// Comandos IPC (Rust → especta):
// term_spawn(id: string, cols: number, rows: number, cwd?: string | null): void
// term_write(id: string, data: string): void
// term_resize(id: string, cols: number, rows: number): void
// term_kill(id: string): void
// Eventos (no tipados especta, por id):
// "term-data-<id>"  → { data: string }
// "term-exit-<id>"  → ()

interface TerminalHandle {
  id: string;
  // ciclo de vida gestionado por el componente TerminalPanel (xterm.js + FitAddon)
}
// El cwd se fija al ABRIR el terminal (workspace de la sesión activa en ese
// momento); cambiar de pestaña no regenera el PTY.
```

## 2. Adapters de proveedores (gateway)

```ts
export interface ChatConfig {
  kind: "openai" | "anthropic" | "ollama"; // "openai" cubre OpenAI/DeepSeek/OpenRouter/Custom
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | null;
  maxOutputTokens: number | null;
  temperature: number | null;
  visionEnabled?: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];            // data URLs para multimodal (solo user)
  toolCalls?: ToolCall[] | null; // assistant con llamadas
  toolCallId?: string | null;   // role "tool"
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface ChatResult extends ChatUsage {
  messages: ChatMessage[]; // transcript completo (incluye tool calls) para el siguiente turno
}

export interface BalanceInfo {
  provider: string;
  currency: string;
  amount: number;
}
// fetch_balance(provider, baseUrl, apiKey) → BalanceInfo | null
// Soportado: DeepSeek (GET /user/balance), OpenRouter (GET /api/v1/credits).
// Sin endpoint → null → estimador local: coste = Σ tokens × precio del modelo (ModelConfig.inputPrice/outputPrice, $/M).
```

## 3. Herramientas del agente (function-calling)

```ts
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

// Núcleo (Rust, agent.rs):
// read_file {path}, list_dir {path}, grep {pattern, path?, include?},
// read_file_range {path, start_line, end_line}, apply_patch {path, patch},
// edit {path, old_string, new_string},
// bash {command} (timeout 600s, eventos "tool-output" en vivo, cancelable por chat),
// write_file {path, content}, webfetch {url}, todowrite {todos}, question {question, options?},
// skill {name}, repo_map_query {query, top?}
// Rutas: restringidas a las carpetas del workspace (resolución relativa + canonicalización).

// Eventos al frontend (no tipados especta) — TODOS scoped por chatId:
export interface ToolStart { id: string; name: string; arguments: string; chatId: string; }
export interface ToolOutputEvent { id: string; stream: "stdout" | "stderr" | "exit"; data: string; chatId: string; }
export interface ToolEnd { id: string; ok: boolean; summary: string; chatId: string; }
export interface ThinkingDelta { chatId: string; text: string; } // "thinking-delta"

// Bucle: simple (stream → ejecutar tools → añadir resultados → repetir) hasta
// respuesta final o fusibles de seguridad (100 turnos / 2M tokens); cancelación
// POR CHAT vía chat_cancel(chatId) (flag por chat + kill del proceso bash hijo
// de esa sesión).
```

## 4. Cliente MCP

```ts
export interface McpSpec {
  name: string;
  command: string;   // ejecutable del servidor
  args: string[];    // argumentos
  enabled: boolean;
}

// mcp_configure(specs: McpSpec[]) → string[] (nombres de tools registradas)
// - Transporte stdio (newline-delimited JSON-RPC 2.0, protocolVersion 2025-06-18)
// - Handshake: initialize → notifications/initialized → tools/list
// - Naming: mcp__<server>__<tool>
// - Tool Adapter: inputSchema MCP (JSON Schema) → parameters function-calling (passthrough con type:object)
// - tools/call con timeout 20s; resultado → texto de content blocks
// - Recarga: cada mcp_configure mata servidores previos y re-registra
```

## 5. Workspace / menciones

```ts
// workspace_summary(folders: string[]) → string  (árbol compacto, depth 5, 400 entradas, sin ocultos)
// search_paths(folders: string[], query: string) → string[] (hasta 50, para @mentions)
// write_file(folders: string[], path: string, content: string) → void (aplicar artifacts)
// Las carpetas pasadas por el frontend son las del workspace de la SESIÓN activa.
```

## 6. Layout / UI

```ts
export interface LayoutState {
  explorer: number;
  right: number;
  term: number;
  explorerCollapsed: boolean;
  rightCollapsed: boolean;
  termCollapsed: boolean;
}
// Persistido en localStorage "makora.layout"; SplitPane (src/core/SplitPane.tsx):
// dirección horizontal/vertical, arrastre por pointer capture, doble clic colapsa, flexIndex configura el panel flexible.
```

## 7. Eventos tipados especta

```ts
// ChatDeltaEvent      → "chat-delta-event"      { chatId: string; text: string }
// MultiAgentPlanEvent → "multiagent-plan-event" { chatId: string; plan: MultiAgentPlanState }
// StreamEvent         → "stream-event"          { seq: number; text: string } (legacy spike)
// Enrutado frontend: sessionStore.ts registra los listeners una sola vez a
// nivel de módulo y actualiza el runtime de la sesión cuyo chatId coincide.
```

