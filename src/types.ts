export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export type ProviderKind = "openai" | "anthropic" | "ollama";

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  needsKey: boolean;
}

export interface Settings {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatConfig {
  kind: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffort: string | null;
  maxOutputTokens: number | null;
  temperature: number | null;
  visionEnabled: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: string;
  content: string;
  images?: string[];
  toolCalls?: ToolCall[] | null;
  toolCallId?: string | null;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface ChatResult extends ChatUsage {
  messages: ChatMessage[];
}

export interface UiMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
}

export type Usage = ChatUsage;

export interface McpSpec {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

export interface BalanceInfo {
  provider: string;
  currency: string;
  amount: number;
}

export interface ToolStart {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolOutputEvent {
  id: string;
  stream: string;
  data: string;
}

export interface ToolEnd {
  id: string;
  ok: boolean;
  summary: string;
}

export interface ToolActivity {
  id: string;
  name: string;
  arguments: string;
  ok: boolean | null;
  log: string;
}

export interface Attachment {
  id: number;
  name: string;
  kind: "image" | "text";
  dataUrl?: string;
  text?: string;
}

export type ThinkingLevel = "none" | "minimal" | "low" | "medium" | "high";

export interface ModelConfig {
  id: string;
  label: string;
  providerId: string;
  thinkingLevel: ThinkingLevel;
  contextWindow: number;
  maxOutputTokens: number;
  reasoningEnabled: boolean;
  visionEnabled: boolean;
  inputPrice: number;
  outputPrice: number;
}

export interface SkillConfig {
  name: string;
  description: string;
  content: string;
}

export interface McpConfig {
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

export interface ContextConfig {
  maxTokens: number;
  systemShare: number;
  historyShare: number;
  filesShare: number;
  repoMapTokens: number;
  compactionThreshold: number;
  includeWorkspace: boolean;
}

export interface AppConfig {
  models: ModelConfig[];
  skills: SkillConfig[];
  mcps: McpConfig[];
  context: ContextConfig;
}

export interface LayoutState {
  explorer: number;
  right: number;
  term: number;
  editor: number;
  explorerCollapsed: boolean;
  rightCollapsed: boolean;
  termCollapsed: boolean;
  editorCollapsed: boolean;
}

export type ThemeId = "void" | "nordic" | "tokyo" | "monokai" | "solar";

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  badge: string;
  description: string;
  colors: {
    bg: string;
    bgCard: string;
    bgSelect: string;
    glassBg: string;
    glassBgHover: string;
    glassBorder: string;
    textMain: string;
    textMuted: string;
    accentBlue: string;
    accentGreen: string;
    accentRed: string;
    gold: string;
    cyan: string;
    purple: string;
    crimson: string;
  };
}

export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  shortcut?: string;
  category: "file" | "action" | "theme" | "navigation";
  action: () => void;
}

export interface OpenFile {
  path: string;
  content: string;
  originalContent?: string;
  isDirty?: boolean;
  isEditable?: boolean;
}

export interface DiffInfo {
  before: string;
  after: string;
}

export interface DiffLine {
  type: "ctx" | "add" | "del";
  text: string;
}

export type AgentMode = "act" | "plan";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model: string;
  messages: ChatMessage[];
  totalCostUsd: number;
}

export interface GitStatusInfo {
  branch: string;
  staged: number;
  modified: number;
  untracked: number;
}

export type WorkspaceViewMode = "chat" | "split" | "editor";



