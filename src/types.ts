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
  maxCostPerTurn: number;
}

export interface VaultKeyEntry {
  id: string;
  name: string;
  providerId: string;
  createdAt: number;
  lastUsedAt: number;
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
  contextWindow?: number | null;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  extraContent?: Record<string, unknown> | null;
}

export interface ChatMessage {
  role: string;
  content: string;
  images?: string[];
  toolCalls?: ToolCall[] | null;
  toolCallId?: string | null;
  thinking?: string;
  metrics?: TurnMetrics;
  reasoning?: string | null;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface ChatResult extends ChatUsage {
  messages: ChatMessage[];
}

export interface TurnMetrics {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  durationMs: number;
  costUsd: number;
}

export interface UiMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  activities?: ToolActivity[];
  thinking?: string;
  metrics?: TurnMetrics;
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
  chatId: string;
}

export interface ToolOutputEvent {
  id: string;
  stream: string;
  data: string;
  chatId: string;
}

export interface ToolEnd {
  id: string;
  ok: boolean;
  summary: string;
  chatId: string;
}

export interface ChatDeltaEvent {
  chatId: string;
  text: string;
}

export interface ThinkingDeltaEvent {
  chatId: string;
  text: string;
}

export interface MultiAgentPlanEvent {
  chatId: string;
  plan: MultiAgentPlanState;
}

export interface TodoItem {
  content: string;
  status: string;
  priority: string;
}

export interface TodoUpdateEvent {
  chatId: string;
  todos: TodoItem[];
}

export interface QuestionAskEvent {
  chatId: string;
  id: string;
  question: string;
  options: string[];
  header: string;
}

export interface PendingQuestion {
  id: string;
  question: string;
  options: string[];
  header: string;
}

export interface ApprovalRequiredEvent {
  chatId: string;
  id: string;
  tool: string;
  arguments: string;
  summary: string;
}

export interface PendingApproval {
  id: string;
  tool: string;
  arguments: string;
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

export type ThemeId =
  | "void"
  | "nordic"
  | "tokyo"
  | "monokai"
  | "solar"
  | "cyberpunk"
  | "matrix"
  | "outrun"
  | "makora"
  | "skyrim"
  | "dragons_dogma";

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

export interface SessionWorkspaceState {
  folders: string[];
  openFiles: OpenFile[];
  activeFilePath: string | null;
  agentMode?: AgentMode;
  multiAgentMode?: "auto" | "always" | "off";
  thinkingLevel?: ThinkingLevel;
  status: "idle" | "running" | "completed" | "error";
  diff?: DiffInfo | null;
}

export interface EnhancedChatSession extends ChatSession {
  workspace?: SessionWorkspaceState;
}

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
  workspace?: SessionWorkspaceState;
}

export interface GitStatusInfo {
  branch: string;
  staged: number;
  modified: number;
  untracked: number;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitFileItem {
  path: string;
  status: string;
  isStaged: boolean;
}

export interface GitRemoteInfo {
  name: string;
  url: string;
  fetchOrPush: string;
}

export interface UniversalTelemetry {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
  modelUsage: Record<string, { input: number; output: number; cached: number; cost: number; turns: number }>;
}

export type SubagentRole = "explorer" | "coder" | "tester" | "reviewer";

export interface MultiAgentPlanStep {
  stepIndex: number;
  title: string;
  role: SubagentRole;
  status: "pending" | "running" | "completed" | "failed";
  resultSummary?: string | null;
}

export interface MultiAgentPlanState {
  planId: string;
  sessionId: string;
  objective: string;
  steps: MultiAgentPlanStep[];
  activeStepIndex?: number | null;
  isCompleted: boolean;
  totalTokens: number;
  totalCostUsd: number;
}




