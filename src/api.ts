import { invoke } from "@tauri-apps/api/core";
import type {
  BalanceInfo,
  ChatConfig,
  ChatMessage,
  ChatResult,
  DirEntry,
  McpSpec,
} from "./types";

export const homeDir = () => invoke<string>("home_dir");
export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });
export const readTextFile = (path: string) =>
  invoke<string>("read_text_file", { path });
export const readBinaryFile = (path: string) =>
  invoke<number[]>("read_file_binary", { path });
export const pickFolder = () => invoke<string | null>("pick_folder");
export const pickFiles = () => invoke<string[]>("pick_files");
export const countTokens = (text: string) =>
  invoke<number>("count_tokens", { text });
export const listModels = (config: ChatConfig) =>
  invoke<string[]>("list_models", { config });
export const chat = (
  config: ChatConfig,
  system: string,
  messages: ChatMessage[],
  folders: string[],
  chatId: string,
  planMode: boolean,
  budgetUsd: number | null,
) => invoke<ChatResult>("chat", { config, system, messages, folders, chatId, planMode, budgetUsd });
export const chatCancel = (chatId: string) =>
  invoke<void>("chat_cancel", { chatId });
export const questionReply = (questionId: string, answer: string) =>
  invoke<void>("question_reply", { questionId, answer });
export const approvalReply = (approvalId: string, decision: string, feedback: string) =>
  invoke<void>("approval_reply", { approvalId, decision, feedback });
export const revertLastTurn = (chatId: string) =>
  invoke<string>("revert_last_turn", { chatId });
export const generateTitle = (config: ChatConfig, content: string) =>
  invoke<string>("generate_title", { config, content });
export const runMultiagentPlan = (
  config: ChatConfig,
  system: string,
  messages: ChatMessage[],
  folders: string[],
  chatId: string,
  objective: string,
  planMode: boolean,
  budgetUsd: number | null,
) =>
  invoke<ChatResult>("run_multiagent_plan", {
    config,
    system,
    messages,
    folders,
    chatId,
    objective,
    planMode,
    budgetUsd,
  });
export const workspaceSummary = (folders: string[]) =>
  invoke<string>("workspace_summary", { folders });
export const searchPaths = (folders: string[], query: string) =>
  invoke<string[]>("search_paths", { folders, query });
export const mcpConfigure = (specs: McpSpec[]) =>
  invoke<string[]>("mcp_configure", { specs });
export const fetchBalance = (provider: string, baseUrl: string, apiKey: string) =>
  invoke<BalanceInfo | null>("fetch_balance", { provider, baseUrl, apiKey });
export const writeFile = (folders: string[], path: string, content: string) =>
  invoke<string | null>("write_file", { folders, path, content });
export const renamePath = (folders: string[], oldPath: string, newPath: string) =>
  invoke<void>("rename_path", { folders, oldPath, newPath });
export const createFile = (folders: string[], path: string) =>
  invoke<void>("create_file", { folders, path });
export const createDir = (folders: string[], path: string) =>
  invoke<void>("create_dir", { folders, path });
export const deletePath = (folders: string[], path: string) =>
  invoke<void>("delete_path", { folders, path });
export const revealInExplorer = (path: string) =>
  invoke<void>("reveal_in_explorer", { path });

export const termSpawn = (id: string, cols: number, rows: number, cwd?: string | null) =>
  invoke<void>("term_spawn", { id, cols, rows, cwd: cwd || null });
export const termWrite = (id: string, data: string) =>
  invoke<void>("term_write", { id, data });
export const termResize = (id: string, cols: number, rows: number) =>
  invoke<void>("term_resize", { id, cols, rows });
export const termKill = (id: string) => invoke<void>("term_kill", { id });

export const keyringGet = (providerId: string) =>
  invoke<string | null>("keyring_get", { providerId });
export const keyringSet = (providerId: string, secret: string) =>
  invoke<void>("keyring_set", { providerId, secret });
export const keyringDelete = (providerId: string) =>
  invoke<void>("keyring_delete", { providerId });

export const detectProjectRules = (folders: string[]) =>
  invoke<string | null>("detect_project_rules", { folders });
export const detectOllama = () =>
  invoke<boolean>("detect_ollama");

export const gitStatus = (folder: string) =>
  invoke<import("./types").GitStatusInfo | null>("git_status", { folder });
export const gitDiff = (folder: string, path?: string | null, staged = false) =>
  invoke<string>("git_diff", { folder, path: path || null, staged });
export const gitLog = (folder: string, limit?: number) =>
  invoke<import("./types").GitCommitInfo[]>("git_log", { folder, limit: limit ?? 25 });
export const gitFiles = (folder: string) =>
  invoke<import("./types").GitFileItem[]>("git_files", { folder });
export const gitStage = (folder: string, path: string) =>
  invoke<void>("git_stage", { folder, path });
export const gitUnstage = (folder: string, path: string) =>
  invoke<void>("git_unstage", { folder, path });
export const gitStageAll = (folder: string) =>
  invoke<void>("git_stage_all", { folder });
export const gitCommit = (folder: string, message: string) =>
  invoke<string>("git_commit", { folder, message });
export const gitPush = (folder: string) =>
  invoke<string>("git_push", { folder });
export const gitPull = (folder: string) =>
  invoke<string>("git_pull", { folder });
export const gitBranches = (folder: string) =>
  invoke<string[]>("git_branches", { folder });
export const gitCheckout = (folder: string, branch: string) =>
  invoke<string>("git_checkout", { folder, branch });
export const gitBranchCreate = (folder: string, branch: string) =>
  invoke<string>("git_branch_create", { folder, branch });
export const gitDiscard = (folder: string, path: string) =>
  invoke<void>("git_discard", { folder, path });
export const gitRemoteGet = (folder: string) =>
  invoke<import("./types").GitRemoteInfo[]>("git_remote_get", { folder });
export const gitRemoteSet = (folder: string, name: string, url: string) =>
  invoke<string>("git_remote_set", { folder, name, url });
export const gitFetch = (folder: string) =>
  invoke<string>("git_fetch", { folder });
export const gitInit = (folder: string) =>
  invoke<string>("git_init", { folder });
export const getInitialFile = () =>
  invoke<string | null>("get_initial_file");
export const checkBetaValidity = () =>
  invoke<void>("check_beta_validity");
export const saveSessionsStore = (json: string) =>
  invoke<void>("save_sessions_store", { json });
export const loadSessionsStore = () =>
  invoke<string | null>("load_sessions_store");
