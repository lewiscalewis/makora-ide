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
export const pickFolder = () => invoke<string | null>("pick_folder");
export const countTokens = (text: string) =>
  invoke<number>("count_tokens", { text });
export const listModels = (config: ChatConfig) =>
  invoke<string[]>("list_models", { config });
export const chat = (
  config: ChatConfig,
  system: string,
  messages: ChatMessage[],
  folders: string[],
) => invoke<ChatResult>("chat", { config, system, messages, folders });
export const chatCancel = () => invoke<void>("chat_cancel");
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
