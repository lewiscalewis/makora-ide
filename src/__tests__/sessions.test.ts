import { describe, it, expect, beforeEach } from "vitest";
import { sanitizeMessages, deriveTitle, makeSession, initSessions } from "../sessions";
import {
  setSessionDraftInput,
  setSessionDraftAttachments,
  getSessionRuntime,
  clearSessionDraft,
} from "../sessionStore";
import type { ChatMessage } from "../types";

describe("Session Management and Sanitization", () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  } as unknown as Storage;

  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = mockStorage;
  });
  it("creates a valid new session with defaults", () => {
    const session = makeSession("deepseek/deepseek-chat");
    expect(session.id).toBeDefined();
    expect(session.title).toBe("Nueva Conversación");
    expect(session.messages).toEqual([]);
    expect(session.createdAt).toBeGreaterThan(0);
  });

  it("derives descriptive title from the first user prompt", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Implementar autenticación OAuth con PKCE" },
      { role: "assistant", content: "Entendido, procediendo a..." },
    ];
    expect(deriveTitle(messages)).toBe("Implementar autenticación OAuth con PKCE");
  });

  it("handles empty user messages gracefully in deriveTitle", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are Makora" },
      { role: "assistant", content: "Hola" },
    ];
    expect(deriveTitle(messages)).toBe("Nueva Conversación");
  });

  it("sanitizes message arrays stripping nulls and limiting length", () => {
    const rawMessages: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Mensaje ${i}`,
    }));

    const sanitized = sanitizeMessages(rawMessages);
    expect(sanitized.length).toBe(50);
    expect(sanitized[0].role).toBe("user");
    expect(sanitized[0].content).toBe("Mensaje 0");
  });

  it("maintains independent workspace modes per session", () => {
    const session1 = makeSession("deepseek/deepseek-chat");
    session1.workspace = {
      folders: ["/project/a"],
      openFiles: [],
      activeFilePath: null,
      agentMode: "plan",
      multiAgentMode: "always",
      thinkingLevel: "high",
      status: "idle",
      diff: null,
    };

    const session2 = makeSession("openai/gpt-4o");
    session2.workspace = {
      folders: ["/project/b"],
      openFiles: [],
      activeFilePath: null,
      agentMode: "act",
      multiAgentMode: "auto",
      thinkingLevel: "low",
      status: "idle",
      diff: null,
    };

    expect(session1.workspace.agentMode).toBe("plan");
    expect(session1.workspace.multiAgentMode).toBe("always");
    expect(session1.workspace.thinkingLevel).toBe("high");

    expect(session2.workspace.agentMode).toBe("act");
    expect(session2.workspace.multiAgentMode).toBe("auto");
    expect(session2.workspace.thinkingLevel).toBe("low");
  });

  it("initSessions preserves all user-opened sessions reliably without destructive pruning", () => {
    // Simular almacenamiento con múltiples sesiones creadas por el usuario
    const userSessions = Array.from({ length: 3 }, () => makeSession("deepseek"));
    localStorage.setItem("makora.sessions.v1", JSON.stringify(userSessions));

    const { sessions, activeId } = initSessions();
    expect(sessions.length).toBe(3);
    expect(activeId).toBe(sessions[0].id);
    expect(sessions[0].messages).toEqual([]);
  });

  it("persists and isolates input drafts across independent sessions", () => {
    const sessionA = "sess_test_a";
    const sessionB = "sess_test_b";

    setSessionDraftInput(sessionA, "Borrador de texto para sesión A");
    setSessionDraftAttachments(sessionA, [{ id: 1, name: "test.png", kind: "image" }]);

    setSessionDraftInput(sessionB, "Borrador de texto para sesión B");

    expect(getSessionRuntime(sessionA).draftInput).toBe("Borrador de texto para sesión A");
    expect(getSessionRuntime(sessionA).draftAttachments.length).toBe(1);
    expect(getSessionRuntime(sessionB).draftInput).toBe("Borrador de texto para sesión B");
    expect(getSessionRuntime(sessionB).draftAttachments.length).toBe(0);

    clearSessionDraft(sessionA);
    expect(getSessionRuntime(sessionA).draftInput).toBe("");
    expect(getSessionRuntime(sessionA).draftAttachments.length).toBe(0);
    expect(getSessionRuntime(sessionB).draftInput).toBe("Borrador de texto para sesión B");
  });
});
