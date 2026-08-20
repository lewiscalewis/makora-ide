import { describe, it, expect } from "vitest";
import { stripOrphanToolCalls, stripTrailingEmptyAssistants } from "../sessionStore";
import type { ChatMessage } from "../types";

describe("Frontend Wire & Session Sanitization", () => {
  it("stripTrailingEmptyAssistants removes dangling empty assistants", () => {
    const transcript: ChatMessage[] = [
      { role: "user", content: "hola" },
      { role: "assistant", content: "respuesta" },
      { role: "assistant", content: "" },
    ];
    const cleaned = stripTrailingEmptyAssistants(transcript);
    expect(cleaned.length).toBe(2);
    expect(cleaned[cleaned.length - 1].content).toBe("respuesta");
  });

  it("stripOrphanToolCalls synthesizes missing tool responses so wire contract is never broken", () => {
    const transcript: ChatMessage[] = [
      { role: "user", content: "lee dos archivos" },
      {
        role: "assistant",
        content: "Voy a leerlos",
        toolCalls: [
          { id: "call_a", name: "read_file", arguments: '{"path":"a.ts"}' },
          { id: "call_b", name: "read_file", arguments: '{"path":"b.ts"}' },
        ],
      },
      {
        role: "tool",
        content: "contenido de a.ts",
        toolCallId: "call_a",
      },
      // call_b fue interrumpido y no respondido
    ];

    const sanitized = stripOrphanToolCalls(transcript);
    expect(sanitized.length).toBe(4);
    expect(sanitized[0].role).toBe("user");
    expect(sanitized[1].role).toBe("assistant");
    expect(sanitized[2].role).toBe("tool");
    expect(sanitized[2].toolCallId).toBe("call_a");
    expect(sanitized[3].role).toBe("tool");
    expect(sanitized[3].toolCallId).toBe("call_b");
    expect(sanitized[3].content).toContain("interrumpida");
  });

  it("stripOrphanToolCalls drops orphan tool messages with no preceding assistant", () => {
    const transcript: ChatMessage[] = [
      { role: "tool", content: "huérfano", toolCallId: "call_orphan" },
      { role: "user", content: "mensaje de usuario" },
    ];

    const sanitized = stripOrphanToolCalls(transcript);
    expect(sanitized.length).toBe(1);
    expect(sanitized[0].role).toBe("user");
  });
});
