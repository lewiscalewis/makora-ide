import type { ChatMessage, ChatSession } from "./types";

const SESSIONS_STORAGE_KEY = "makora.sessions";
const ACTIVE_SESSION_STORAGE_KEY = "makora.active_session_id";

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn("Failed to load sessions:", e);
  }
  return [];
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn("Failed to save sessions:", e);
  }
}

export function getActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
}

export function setActiveSessionId(id: string): void {
  localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, id);
}

export function createNewSession(model: string, title = "Nueva Conversación"): ChatSession {
  const now = Date.now();
  const session: ChatSession = {
    id: `sess-${now}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    model,
    messages: [],
    totalCostUsd: 0,
  };
  return session;
}

export function upsertSession(
  session: ChatSession,
  messages: ChatMessage[],
  costUsd = 0,
): ChatSession {
  const now = Date.now();
  let title = session.title;

  // Auto-generate title from first user message if default
  if (title === "Nueva Conversación" && messages.length > 0) {
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (firstUserMsg && firstUserMsg.content.trim()) {
      title = firstUserMsg.content.trim().slice(0, 36);
      if (firstUserMsg.content.trim().length > 36) title += "…";
    }
  }

  return {
    ...session,
    title,
    updatedAt: now,
    messageCount: messages.length,
    messages,
    totalCostUsd: session.totalCostUsd + costUsd,
  };
}
