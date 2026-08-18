# MakoraIDE — Contratos y Tipos (TS)

Fecha: 2026-08-18. Interfaces clave del frontend. Los tipos wire (Rust↔TS) los genera tauri-specta en `src/bindings.ts` al arrancar; este documento fija los contratos de dominio. Espejo Rust: `src-tauri/src/{lib,gateway,agent,mcp,terminal,balance}.rs`.

## 1. Sistema de terminal

```ts
// Comandos IPC (Rust → especta):
// term_spawn(id: string, cols: number, rows: number): void
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
// read_file {path}, list_dir {path}, grep {pattern, path?},
// bash {command} (timeout 60s, eventos "tool-output" en vivo, cancelable),
// write_file {path, content}
// Rutas: restringidas a las carpetas del workspace (resolución relativa + canonicalización).

// Eventos al frontend (no tipados especta):
export interface ToolStart { id: string; name: string; arguments: string; }
export interface ToolOutputEvent { id: string; stream: "stdout" | "stderr" | "exit"; data: string; }
export interface ToolEnd { id: string; ok: boolean; summary: string; }

// Bucle: max_loops por turno (config.context.maxToolLoops, default 8);
// cancelación global vía chat_cancel() (flag atómico + kill del proceso).
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
// ChatDeltaEvent → "chat-delta-event" { text: string }
// StreamEvent   → "stream-event" { seq: number; text: string } (legacy spike)
```
