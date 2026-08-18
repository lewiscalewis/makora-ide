import type { ChatMessage, ChatSession } from "./types";

const STORAGE_KEY = "makora.sessions.v1";
const ACTIVE_KEY = "makora.activeSession";

const MAX_SESSIONS = 60;
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

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function sanitizeMessage(raw: ChatMessage): ChatMessage {
  const role = safeString((raw as { role?: unknown })?.role, "unknown");
  return {
    role,
    content: safeString(raw.content).slice(0, MAX_CONTENT_CHARS),
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
        }))
      : undefined,
    toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : null,
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
  };
}

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeSession)
      .filter((s): s is ChatSession => s !== null)
      .slice(0, MAX_SESSIONS)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function shrinkSessions(sessions: ChatSession[]): string {
  const pruned = sessions.map((s) => ({
    ...s,
    messages: s.messages.slice(-60).map((m) => ({
      ...sanitizeMessage(m),
      images: undefined,
      content: m.content.slice(0, 20_000),
      toolCalls: Array.isArray(m.toolCalls)
        ? m.toolCalls.map((tc) => ({
            id: safeString(tc.id),
            name: safeString(tc.name),
            arguments: safeString(tc.arguments).slice(0, 10_000),
          }))
        : undefined,
    })),
  }));
  const prunedJson = JSON.stringify(pruned);
  if (prunedJson.length <= MAX_STORAGE_BYTES) return prunedJson;
  const metadata = sessions.slice(0, 10).map((s) => ({ ...s, messages: [] as ChatMessage[] }));
  return JSON.stringify(metadata);
}

export function saveSessions(sessions: ChatSession[]): void {
  const ordered = [...sessions]
    .slice(0, MAX_SESSIONS)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const json = JSON.stringify(ordered);
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, shrinkSessions(ordered));
    } catch {
      /* sin espacio: se mantiene el estado anterior en disco */
    }
  }
}

export function getActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveSessionId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* el estado en memoria sigue siendo la fuente de verdad */
  }
}

export function makeSession(model: string): ChatSession {
  const now = Date.now();
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
  };
}

export function initSessions(): { sessions: ChatSession[]; activeId: string } {
  const sessions = loadSessions();
  const storedActive = getActiveSessionId();
  const existing = storedActive ? sessions.find((s) => s.id === storedActive) : undefined;
  if (existing) {
    return { sessions, activeId: existing.id };
  }
  const fresh = makeSession("");
  const next = [fresh, ...sessions];
  saveSessions(next);
  setActiveSessionId(fresh.id);
  return { sessions: next, activeId: fresh.id };
}
