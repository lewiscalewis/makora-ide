import type { AgentMode, ChatMessage, ChatSession, OpenFile, SessionWorkspaceState } from "./types";
import { loadSessionsStore, saveSessionsStore } from "./api";

const STORAGE_KEY = "makora.history.v1";
const LEGACY_STORAGE_KEY = "makora.sessions.v1";
const OPEN_TABS_KEY = "makora.openTabs.v1";
const ACTIVE_KEY = "makora.activeSession";

const MAX_SESSIONS = 100;
const MAX_OPEN_TABS = 25;
const MAX_MESSAGES_PER_SESSION = 200;
const MAX_CONTENT_CHARS = 200_000;
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGE_CHARS = 400_000;
const MAX_TOOL_CALLS_PER_MESSAGE = 50;
const MAX_STORAGE_BYTES = 4_500_000;

export function makeSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
    if (typeof globalThis !== "undefined" && (globalThis as unknown as { localStorage?: Storage }).localStorage) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function sanitizeMessage(raw: ChatMessage): ChatMessage {
  const role = safeString((raw as { role?: unknown })?.role, "unknown");
  const rawMetrics = (raw as { metrics?: Record<string, unknown> })?.metrics;
  const metrics =
    rawMetrics && typeof rawMetrics === "object"
      ? {
          inputTokens: Number(rawMetrics.inputTokens) || 0,
          outputTokens: Number(rawMetrics.outputTokens) || 0,
          cachedTokens: Number(rawMetrics.cachedTokens) || 0,
          totalTokens: Number(rawMetrics.totalTokens) || 0,
          durationMs: Number(rawMetrics.durationMs) || 0,
          costUsd: Number(rawMetrics.costUsd) || 0,
        }
      : undefined;

  return {
    role,
    content: safeString(raw.content).slice(0, MAX_CONTENT_CHARS),
    thinking: typeof raw.thinking === "string" ? raw.thinking.slice(0, 100_000) : undefined,
    metrics,
    images: Array.isArray(raw.images)
      ? raw.images
          .slice(0, MAX_IMAGES_PER_MESSAGE)
          .filter((i): i is string => typeof i === "string" && i.length <= MAX_IMAGE_CHARS)
      : undefined,
    toolCalls: Array.isArray(raw.toolCalls)
      ? raw.toolCalls.slice(0, MAX_TOOL_CALLS_PER_MESSAGE).map((tc) => ({
          id: safeString((tc as { id?: unknown })?.id),
          name: safeString((tc as { name?: unknown })?.name),
          arguments: safeString((tc as { arguments?: unknown })?.arguments).slice(0, 100_000),
          extraContent: (tc as { extraContent?: Record<string, unknown> | null })?.extraContent ?? undefined,
        }))
      : undefined,
    toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : null,
    reasoning:
      typeof raw.reasoning === "string" ? raw.reasoning.slice(0, 100_000) : undefined,
  };
}

export function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(0, MAX_MESSAGES_PER_SESSION).map(sanitizeMessage);
}

export function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return "Nueva Conversación";
  const title = firstUser.content.trim().replace(/\s+/g, " ").slice(0, 80);
  return title || "Nueva Conversación";
}

function sanitizeWorkspace(raw: unknown): SessionWorkspaceState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const w = raw as Partial<SessionWorkspaceState>;
  const folders = Array.isArray(w.folders)
    ? w.folders.filter((f): f is string => typeof f === "string").slice(0, 20)
    : [];
  const openFiles: OpenFile[] = Array.isArray(w.openFiles)
    ? w.openFiles
        .filter((f): f is OpenFile => Boolean(f) && typeof f.path === "string")
        .slice(0, 20)
        .map((f) => ({
          path: f.path,
          content: safeString(f.content).slice(0, 100_000),
          originalContent:
            typeof f.originalContent === "string"
              ? f.originalContent.slice(0, 100_000)
              : undefined,
          isDirty: Boolean(f.isDirty),
        }))
    : [];
  const status =
    w.status === "running" || w.status === "completed" || w.status === "error"
      ? w.status
      : "idle";
  const agentMode: AgentMode = w.agentMode === "plan" ? "plan" : "act";
  const multiAgentMode: "auto" | "always" | "off" =
    w.multiAgentMode === "always" || w.multiAgentMode === "off" ? w.multiAgentMode : "auto";
  const thinkingLevel =
    w.thinkingLevel === "none" ||
    w.thinkingLevel === "minimal" ||
    w.thinkingLevel === "low" ||
    w.thinkingLevel === "medium" ||
    w.thinkingLevel === "high"
      ? w.thinkingLevel
      : undefined;

  return {
    folders,
    openFiles,
    activeFilePath: typeof w.activeFilePath === "string" ? w.activeFilePath : null,
    agentMode,
    multiAgentMode,
    thinkingLevel,
    status,
    diff:
      w.diff && typeof w.diff.before === "string" && typeof w.diff.after === "string"
        ? { before: w.diff.before.slice(0, 100_000), after: w.diff.after.slice(0, 100_000) }
        : null,
  };
}

function sanitizeSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<ChatSession>;
  if (typeof s.id !== "string" || !s.id) return null;
  const inTok = typeof s.inputTokens === "number" && Number.isFinite(s.inputTokens) ? s.inputTokens : 0;
  const outTok = typeof s.outputTokens === "number" && Number.isFinite(s.outputTokens) ? s.outputTokens : 0;
  const cacheTok = typeof s.cachedTokens === "number" && Number.isFinite(s.cachedTokens) ? s.cachedTokens : 0;
  const totTok =
    typeof s.totalTokens === "number" && Number.isFinite(s.totalTokens)
      ? s.totalTokens
      : inTok + outTok;
  return {
    id: s.id,
    title: safeString(s.title, "Nueva Conversación").slice(0, 120),
    createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
    messageCount: typeof s.messageCount === "number" ? s.messageCount : 0,
    model: safeString(s.model),
    messages: sanitizeMessages(Array.isArray(s.messages) ? s.messages : []),
    totalCostUsd:
      typeof s.totalCostUsd === "number" && Number.isFinite(s.totalCostUsd)
        ? s.totalCostUsd
        : 0,
    inputTokens: inTok,
    outputTokens: outTok,
    cachedTokens: cacheTok,
    totalTokens: totTok,
    workspace: sanitizeWorkspace(s.workspace),
  };
}

export function loadSessions(): ChatSession[] {
  try {
    const storage = getStorage();
    if (!storage) return [];
    let raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      // Fallback a almacenamiento anterior si no existe aún el historial v1
      raw = storage.getItem(LEGACY_STORAGE_KEY);
    }
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeSession)
      .filter((s): s is ChatSession => s !== null)
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

export async function loadSessionsFromStore(): Promise<ChatSession[]> {
  try {
    const raw = await loadSessionsStore();
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeSession)
      .filter((s): s is ChatSession => s !== null)
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

export function loadOpenTabIds(availableSessions: ChatSession[]): string[] {
  try {
    const storage = getStorage();
    if (!storage) return availableSessions.map((s) => s.id).slice(0, MAX_OPEN_TABS);
    const raw = storage.getItem(OPEN_TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sessionIds = new Set(availableSessions.map((s) => s.id));
        const valid = parsed.filter((id): id is string => typeof id === "string" && sessionIds.has(id));
        if (valid.length > 0) return valid.slice(0, MAX_OPEN_TABS);
      }
    }
  } catch {
    /* ignore */
  }
  // Si no hay pestañas abiertas guardadas, abrir las sesiones más recientes disponibles
  return availableSessions.map((s) => s.id).slice(0, 3);
}

export function saveOpenTabIds(ids: string[]): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.setItem(OPEN_TABS_KEY, JSON.stringify(ids.slice(0, MAX_OPEN_TABS)));
  } catch {
    /* ignore */
  }
}

function shrinkSessions(sessions: ChatSession[]): string {
  // Poda no destructiva: Trunca outputs gigantes de herramientas y mensajes antiguos
  // pero conserva siempre los mensajes recientes y metadatos de TODAS las sesiones.
  const pruned = sessions.map((s) => ({
    ...s,
    messages: s.messages.slice(-30).map((m) => ({
      ...sanitizeMessage(m),
      images: undefined,
      content: m.content.slice(0, 10_000),
      toolCalls: Array.isArray(m.toolCalls)
        ? m.toolCalls.map((tc) => ({
            id: safeString(tc.id),
            name: safeString(tc.name),
            arguments: safeString(tc.arguments).slice(0, 2_000),
            extraContent: tc.extraContent,
          }))
        : undefined,
    })),
  }));
  const prunedJson = JSON.stringify(pruned);
  if (prunedJson.length <= MAX_STORAGE_BYTES) return prunedJson;

  // Si aún supera el límite de localStorage, conservar los últimos 10 mensajes por sesión
  const compact = sessions.map((s) => ({
    ...s,
    messages: s.messages.slice(-10).map((m) => ({
      ...m,
      content: m.content.slice(0, 2_000),
      toolCalls: Array.isArray(m.toolCalls)
        ? m.toolCalls.map((tc) => ({
            id: safeString(tc.id),
            name: safeString(tc.name),
            arguments: safeString(tc.arguments).slice(0, 500),
          }))
        : undefined,
    })),
  }));
  return JSON.stringify(compact);
}

export function saveSessions(sessions: ChatSession[]): void {
  const ordered = sessions.slice(0, MAX_SESSIONS);
  const json = JSON.stringify(ordered);
  // Fuente de verdad durable: escribir el blob completo en SQLite (sin el
  // límite de 4.5 MB de localStorage). Es fire-and-forget; localStorage sigue
  // como caché de arranque rápida.
  void saveSessionsStore(json).catch(() => undefined);

  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, json);
    storage.setItem(LEGACY_STORAGE_KEY, json);
  } catch {
    // Tier 2: Truncate messages within sessions
    try {
      const shrunk = shrinkSessions(ordered);
      storage.setItem(STORAGE_KEY, shrunk);
      storage.setItem(LEGACY_STORAGE_KEY, shrunk);
    } catch {
      // Tier 3: Conservar últimas 15 sesiones con últimos 5 mensajes cada una
      try {
        const minimal = ordered.slice(0, 15).map((s) => ({
          ...s,
          messages: s.messages.slice(-5).map((m) => ({
            ...m,
            content: m.content.slice(0, 1000),
          })),
        }));
        const minJson = JSON.stringify(minimal);
        storage.setItem(STORAGE_KEY, minJson);
        storage.setItem(LEGACY_STORAGE_KEY, minJson);
      } catch {
        /* En caso de saturación extrema, el estado en memoria de React sigue preservado */
      }
    }
  }
}

export function getActiveSessionId(): string | null {
  try {
    return getStorage()?.getItem(ACTIVE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setActiveSessionId(id: string): void {
  try {
    getStorage()?.setItem(ACTIVE_KEY, id);
  } catch {
    /* el estado en memoria sigue siendo la fuente de verdad */
  }
}

export function makeSession(model: string, workspace?: SessionWorkspaceState): ChatSession {
  const now = Date.now();
  const defaultWs: SessionWorkspaceState = {
    folders: [],
    openFiles: [],
    activeFilePath: null,
    agentMode: "act",
    multiAgentMode: "auto",
    thinkingLevel: "medium",
    status: "idle",
    diff: null,
  };
  return {
    id: makeSessionId(),
    title: "Nueva Conversación",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    model,
    messages: [],
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    workspace: workspace ? sanitizeWorkspace(workspace) : defaultWs,
  };
}

export interface InitialSessionState {
  sessions: ChatSession[];
  openTabIds: string[];
  activeId: string;
}

export function initSessions(): InitialSessionState {
  const loaded = loadSessions();

  let folders: string[] = [];
  try {
    const raw = getStorage()?.getItem("makora.folders");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        folders = parsed.filter((f): f is string => typeof f === "string");
      }
    }
  } catch {
    /* ignore */
  }

  // Si no hay sesiones guardadas en absoluto, iniciar exactamente con 1 sesión limpia
  if (loaded.length === 0) {
    const fresh = makeSession("", {
      folders,
      openFiles: [],
      activeFilePath: null,
      status: "idle",
      diff: null,
    });
    saveSessions([fresh]);
    saveOpenTabIds([fresh.id]);
    setActiveSessionId(fresh.id);
    return { sessions: [fresh], openTabIds: [fresh.id], activeId: fresh.id };
  }

  const openTabIds = loadOpenTabIds(loaded);
  const effectiveOpenTabIds = openTabIds.length > 0 ? openTabIds : [loaded[0].id];

  const savedActiveId = getActiveSessionId();
  const activeExists = savedActiveId && effectiveOpenTabIds.includes(savedActiveId);
  const activeId = activeExists ? savedActiveId! : effectiveOpenTabIds[0];

  saveSessions(loaded);
  saveOpenTabIds(effectiveOpenTabIds);
  setActiveSessionId(activeId);
  return { sessions: loaded, openTabIds: effectiveOpenTabIds, activeId };
}
