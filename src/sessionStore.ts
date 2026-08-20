import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { approvalReply, chat, chatCancel, questionReply, runMultiagentPlan } from "./api";
import { computeCostUsd } from "./defaults";
import type {
  ApprovalRequiredEvent,
  Attachment,
  ChatConfig,
  ChatDeltaEvent,
  ChatMessage,
  ChatUsage,
  ModelConfig,
  MultiAgentPlanEvent,
  MultiAgentPlanState,
  PendingApproval,
  PendingQuestion,
  QuestionAskEvent,
  ThinkingDeltaEvent,
  TodoItem,
  TodoUpdateEvent,
  ToolActivity,
  ToolEnd,
  ToolOutputEvent,
  ToolStart,
  TurnMetrics,
  UiMessage,
} from "./types";

export function stripOrphanToolCalls(transcript: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const n = transcript.length;
  let i = 0;

  while (i < n) {
    const m = transcript[i];
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const requiredIds = new Set(m.toolCalls.map((tc) => tc.id || ""));
      let j = i + 1;
      const toolMsgs: ChatMessage[] = [];
      while (j < n && transcript[j].role === "tool") {
        toolMsgs.push(transcript[j]);
        j++;
      }

      const answeredIds = new Set(toolMsgs.map((tm) => tm.toolCallId || ""));
      const isCompletelyAnswered = Array.from(requiredIds).every((id) => !id || answeredIds.has(id));

      if (isCompletelyAnswered) {
        out.push(m);
        out.push(...toolMsgs);
      } else {
        const synthesizedToolMsgs = Array.from(requiredIds).map((id) => {
          const found = toolMsgs.find((tm) => tm.toolCallId === id);
          return (
            found || {
              role: "tool" as const,
              content: "[Llamada a herramienta interrumpida o completada previamente]",
              toolCallId: id,
            }
          );
        });
        out.push(m);
        out.push(...synthesizedToolMsgs);
      }
      i = j;
    } else if (m.role === "tool") {
      i++;
    } else {
      out.push(m);
      i++;
    }
  }

  return out;
}

export function stripTrailingEmptyAssistants(transcript: ChatMessage[]): ChatMessage[] {
  const out = [...transcript];
  while (out.length > 0) {
    const last = out[out.length - 1];
    const isDanglingEmptyAssistant =
      last.role === "assistant" &&
      (!last.content || !last.content.trim()) &&
      (!last.toolCalls || last.toolCalls.length === 0);
    if (!isDanglingEmptyAssistant) break;
    out.pop();
  }
  return out;
}

export function transcriptToUi(
  transcript: ChatMessage[],
  existingUi?: UiMessage[],
  idOffset = 1,
): UiMessage[] {
  const out: UiMessage[] = [];
  let id = idOffset - 1;
  let currentAssistant: UiMessage | null = null;
  let assistantCount = 0;

  for (let i = 0; i < transcript.length; i++) {
    const m = transcript[i];
    if (m.role === "user") {
      if (currentAssistant) {
        out.push(currentAssistant);
        currentAssistant = null;
      }
      out.push({
        id: ++id,
        role: "user",
        text: m.content || "(adjuntos)",
      });
    } else if (m.role === "assistant") {
      if (!currentAssistant) {
        const existingMetrics = existingUi
          ? existingUi.filter((x) => x.role === "assistant")[assistantCount]?.metrics
          : undefined;
        assistantCount++;
        currentAssistant = {
          id: ++id,
          role: "assistant",
          text: m.content || "",
          activities: [],
          metrics: m.metrics ?? existingMetrics,
        };
      } else if (m.content) {
        currentAssistant.text = m.content;
        if (m.metrics) currentAssistant.metrics = m.metrics;
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        currentAssistant.activities = currentAssistant.activities || [];
        for (const tc of m.toolCalls) {
          let toolLog = "";
          for (let j = i + 1; j < transcript.length; j++) {
            if (
              transcript[j].role === "tool" &&
              (transcript[j].toolCallId === tc.id || !transcript[j].toolCallId)
            ) {
              toolLog = transcript[j].content || "";
              break;
            }
          }
          if (!currentAssistant.activities.some((a) => a.id === tc.id)) {
            currentAssistant.activities.push({
              id: tc.id || `tc_${id}_${currentAssistant.activities.length}`,
              name: tc.name,
              arguments: tc.arguments,
              log: toolLog,
              ok: true,
            });
          }
        }
      }
    } else if (m.role === "tool") {
      if (currentAssistant && currentAssistant.activities && currentAssistant.activities.length > 0) {
        const lastAct = currentAssistant.activities[currentAssistant.activities.length - 1];
        if (lastAct && !lastAct.log) {
          lastAct.log = m.content || "";
        }
      }
    }
  }

  if (currentAssistant) {
    if (!currentAssistant.text.trim()) {
      const hasActs = currentAssistant.activities && currentAssistant.activities.length > 0;
      currentAssistant.text = hasActs
        ? "✅ Operaciones ejecutadas con éxito según las directivas del turno."
        : "✅ Turno procesado.";
    }
    out.push(currentAssistant);
  }

  return out;
}

export interface SessionRuntimeSnapshot {
  busy: boolean;
  runningTool: string | null;
  thinking: { id: number; text: string } | null;
  turnActivities: Record<number, ToolActivity[]>;
  messages: UiMessage[];
  transcript: ChatMessage[];
  currentAssistantId: number;
  plan: MultiAgentPlanState | null;
  error: string | null;
  draftInput: string;
  draftAttachments: Attachment[];
  todos: TodoItem[];
  pendingQuestion: PendingQuestion | null;
  pendingApproval: PendingApproval | null;
}

interface SessionRuntime extends SessionRuntimeSnapshot {
  nextUiId: number;
  abortRequested: boolean;
  seeded: boolean;
}

const runtimes = new Map<string, SessionRuntime>();
const sessionListeners = new Map<string, Set<() => void>>();
const globalListeners = new Set<() => void>();
let busySet: Set<string> = new Set();

const EMPTY_RUNTIME: SessionRuntime = Object.freeze({
  busy: false,
  runningTool: null,
  thinking: null,
  turnActivities: {},
  messages: [],
  transcript: [],
  currentAssistantId: 0,
  plan: null,
  error: null,
  draftInput: "",
  draftAttachments: [],
  todos: [],
  pendingQuestion: null,
  pendingApproval: null,
  nextUiId: 0,
  abortRequested: false,
  seeded: false,
}) as unknown as SessionRuntime;

function notify(sessionId: string): void {
  recomputeBusySet();
  sessionListeners.get(sessionId)?.forEach((f) => f());
  globalListeners.forEach((f) => f());
}

function recomputeBusySet(): void {
  const next = new Set<string>();
  runtimes.forEach((r, id) => {
    if (r.busy) next.add(id);
  });
  const same =
    busySet.size === next.size && Array.from(next).every((id) => busySet.has(id));
  if (!same) busySet = next;
}

function createRuntime(transcript: ChatMessage[] = []): SessionRuntime {
  const clean = stripOrphanToolCalls(stripTrailingEmptyAssistants(transcript));
  const messages = transcriptToUi(clean);
  const nextUiId = messages.reduce((max, m) => Math.max(max, m.id), 0);
  return {
    busy: false,
    runningTool: null,
    thinking: null,
    turnActivities: {},
    messages,
    transcript: clean,
    currentAssistantId: 0,
    plan: null,
    error: null,
    draftInput: "",
    draftAttachments: [],
    todos: [],
    pendingQuestion: null,
    pendingApproval: null,
    nextUiId,
    abortRequested: false,
    seeded: transcript.length > 0,
  };
}

function update(sessionId: string, produce: (rt: SessionRuntime) => Partial<SessionRuntime>): void {
  const rt = runtimes.get(sessionId);
  if (!rt) return;
  const next = { ...rt, ...produce(rt) };
  runtimes.set(sessionId, next);
  notify(sessionId);
}

export function ensureSessionRuntime(sessionId: string, transcript?: ChatMessage[]): void {
  if (!sessionId) return;
  if (runtimes.has(sessionId)) return;
  runtimes.set(sessionId, createRuntime(transcript));
  notify(sessionId);
}

export function destroySessionRuntime(sessionId: string): void {
  if (runtimes.delete(sessionId)) {
    notify(sessionId);
  }
}

export function getSessionRuntime(sessionId: string): SessionRuntimeSnapshot {
  return runtimes.get(sessionId) ?? EMPTY_RUNTIME;
}

export function setSessionDraftInput(sessionId: string, draftInput: string): void {
  if (!sessionId) return;
  if (!runtimes.has(sessionId)) ensureSessionRuntime(sessionId);
  update(sessionId, () => ({ draftInput }));
}

export function setSessionDraftAttachments(
  sessionId: string,
  draftAttachments: Attachment[],
): void {
  if (!sessionId) return;
  if (!runtimes.has(sessionId)) ensureSessionRuntime(sessionId);
  update(sessionId, () => ({ draftAttachments }));
}

export function clearSessionDraft(sessionId: string): void {
  if (!sessionId) return;
  if (!runtimes.has(sessionId)) return;
  update(sessionId, () => ({ draftInput: "", draftAttachments: [] }));
}

export function isSessionBusy(sessionId: string): boolean {
  return runtimes.get(sessionId)?.busy ?? false;
}

function subscribeSession(sessionId: string, cb: () => void): () => void {
  let set = sessionListeners.get(sessionId);
  if (!set) {
    set = new Set();
    sessionListeners.set(sessionId, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

function subscribeGlobal(cb: () => void): () => void {
  globalListeners.add(cb);
  return () => {
    globalListeners.delete(cb);
  };
}

export function useSessionRuntime(sessionId: string | null): SessionRuntimeSnapshot {
  const id = sessionId ?? "";
  return useSyncExternalStore(
    (cb) => subscribeSession(id, cb),
    () => getSessionRuntime(id),
    () => EMPTY_RUNTIME,
  );
}

export function useBusySessionIds(): Set<string> {
  return useSyncExternalStore(subscribeGlobal, () => busySet);
}

let routingInstalled = false;
function installEventRouting(): void {
  if (routingInstalled) return;
  routingInstalled = true;
  const on = <T,>(event: string, handler: (p: T) => void) => {
    listen<T>(event, (e) => handler(e.payload)).catch(() => undefined);
  };
  on<ToolStart>("tool-start", (t) =>
    update(t.chatId, (rt) => ({
      turnActivities: {
        ...rt.turnActivities,
        [rt.currentAssistantId]: [
          ...(rt.turnActivities[rt.currentAssistantId] ?? []),
          { id: t.id, name: t.name, arguments: t.arguments, log: "", ok: null },
        ],
      },
      runningTool: t.name,
    })),
  );
  const MAX_LOG_SIZE = 65_536;
  const appendLogSafely = (currentLog: string, incoming: string): string => {
    const total = currentLog + incoming;
    if (total.length > MAX_LOG_SIZE) {
      return "...[salida truncada por límite de memoria]\n" + total.slice(-(MAX_LOG_SIZE - 100));
    }
    return total;
  };

  let pendingOutputs: { chatId: string; id: string; data: string }[] = [];
  let outputRafScheduled = false;

  const flushOutputs = () => {
    outputRafScheduled = false;
    if (pendingOutputs.length === 0) return;
    const batch = pendingOutputs;
    pendingOutputs = [];

    // Agrupar por chat y id de herramienta
    const byChat = new Map<string, Map<string, string>>();
    for (const item of batch) {
      if (!byChat.has(item.chatId)) byChat.set(item.chatId, new Map());
      const map = byChat.get(item.chatId)!;
      map.set(item.id, (map.get(item.id) ?? "") + item.data);
    }

    for (const [chatId, toolDeltas] of byChat) {
      update(chatId, (rt) => ({
        turnActivities: {
          ...rt.turnActivities,
          [rt.currentAssistantId]: (rt.turnActivities[rt.currentAssistantId] ?? []).map((x) => {
            const extra = toolDeltas.get(x.id);
            return extra ? { ...x, log: appendLogSafely(x.log, extra) } : x;
          }),
        },
      }));
    }
  };

  on<ToolOutputEvent>("tool-output", (t) => {
    pendingOutputs.push(t);
    if (!outputRafScheduled) {
      outputRafScheduled = true;
      requestAnimationFrame(flushOutputs);
    }
  });

  on<ToolEnd>("tool-end", (t) => {
    flushOutputs();
    update(t.chatId, (rt) => {
      const nextActivities = {
        ...rt.turnActivities,
        [rt.currentAssistantId]: (rt.turnActivities[rt.currentAssistantId] ?? []).map((x) =>
          x.id === t.id ? { ...x, ok: t.ok, log: x.log || t.summary } : x,
        ),
      };
      const stillRunning = (nextActivities[rt.currentAssistantId] ?? []).find(
        (a) => a.ok === null,
      );
      return {
        turnActivities: nextActivities,
        runningTool: stillRunning ? stillRunning.name : null,
      };
    });
  });

  let pendingThinking: { chatId: string; text: string }[] = [];
  let thinkingRafScheduled = false;

  const flushThinking = () => {
    thinkingRafScheduled = false;
    if (pendingThinking.length === 0) return;
    const batch = pendingThinking;
    pendingThinking = [];

    const byChat = new Map<string, string>();
    for (const item of batch) {
      const baseChatId = item.chatId.split("__sub_")[0];
      byChat.set(baseChatId, (byChat.get(baseChatId) ?? "") + item.text);
    }

    for (const [chatId, deltaText] of byChat) {
      if (!runtimes.has(chatId)) continue;
      update(chatId, (rt) => ({
        thinking: {
          id: rt.thinking?.id ?? rt.currentAssistantId,
          text: (rt.thinking?.text ?? "") + deltaText,
        },
      }));
    }
  };

  on<ThinkingDeltaEvent>("thinking-delta", (d) => {
    pendingThinking.push(d);
    if (!thinkingRafScheduled) {
      thinkingRafScheduled = true;
      requestAnimationFrame(flushThinking);
    }
  });
  on<MultiAgentPlanEvent>("multiagent-plan-event", (p) =>
    update(p.chatId, () => ({ plan: p.plan })),
  );
  on<TodoUpdateEvent>("todo-update", (t) =>
    update(t.chatId, () => ({ todos: t.todos ?? [] })),
  );
  on<QuestionAskEvent>("question-ask", (q) =>
    update(q.chatId, () => ({
      pendingQuestion: {
        id: q.id,
        question: q.question,
        options: q.options ?? [],
        header: q.header ?? "",
      },
    })),
  );
  on<ApprovalRequiredEvent>("approval-required", (a) =>
    update(a.chatId, () => ({
      pendingApproval: {
        id: a.id,
        tool: a.tool,
        arguments: a.arguments ?? "",
        summary: a.summary ?? "",
      },
    })),
  );
}

installEventRouting();

export interface SendTurnOptions {
  config: ChatConfig;
  system: string;
  folders: string[];
  modelConfig?: ModelConfig;
  providerId?: string;
  content: string;
  images: string[];
  displayText: string;
  useMultiAgent?: boolean;
  planMode?: boolean;
  budgetUsd?: number | null;
  onUsage: (u: ChatUsage) => void;
  onTranscriptChange: (m: ChatMessage[]) => void;
}

export async function sendTurn(sessionId: string, opts: SendTurnOptions): Promise<void> {
  if (!runtimes.has(sessionId)) ensureSessionRuntime(sessionId);
  const rt = runtimes.get(sessionId);
  if (!rt || rt.busy) return;

  const cleanBase = stripOrphanToolCalls(stripTrailingEmptyAssistants(rt.transcript));
  const userMsg: ChatMessage = { role: "user", content: opts.content, images: opts.images };
  const initialAssistantMsg: ChatMessage = { role: "assistant", content: "" };
  const newTranscript = [...cleanBase, userMsg, initialAssistantMsg];

  update(sessionId, (r) => ({
    busy: true,
    thinking: null,
    error: null,
    abortRequested: false,
    plan: null,
    draftInput: "",
    draftAttachments: [],
    transcript: newTranscript,
    nextUiId: r.nextUiId + 2,
    currentAssistantId: r.nextUiId + 2,
    messages: [
      ...r.messages,
      { id: r.nextUiId + 1, role: "user", text: opts.displayText || "(adjuntos)" },
      { id: r.nextUiId + 2, role: "assistant", text: "" },
    ],
  }));

  const assistantId = rt.nextUiId + 2;

  let acc = "";
  let lastSync = 0;
  let rafPending = false;
  let isDisposed = false;
  let done = false;
  let unlistenDelta: (() => void) | null = null;

  const flushUi = () => {
    if (isDisposed) return;
    rafPending = false;
    update(sessionId, (r) => ({
      messages: r.messages.map((x) => (x.id === assistantId ? { ...x, text: acc } : x)),
    }));
  };

  const startTime = Date.now();
  try {
    unlistenDelta = await listen<ChatDeltaEvent>("chat-delta-event", (e) => {
      if (e.payload.chatId !== sessionId) return;
      acc += e.payload.text;
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(flushUi);
      }
      const now = Date.now();
      if (now - lastSync > 300) {
        lastSync = now;
        const snapshot = runtimes.get(sessionId);
        if (!done && snapshot && snapshot.transcript.length > 0) {
          const copy = [...snapshot.transcript];
          const lastIdx = copy.length - 1;
          if (copy[lastIdx]?.role === "assistant") {
            copy[lastIdx] = { ...copy[lastIdx], content: acc };
          }
          update(sessionId, () => ({ transcript: copy }));
          opts.onTranscriptChange(copy);
        }
      }
    });

    const requestTranscript = newTranscript.slice(0, -1);
    const objective =
      opts.displayText && opts.displayText.trim()
        ? opts.displayText
        : opts.content.slice(0, 600);
    const result = opts.useMultiAgent
      ? await runMultiagentPlan(
          opts.config,
          opts.system,
          requestTranscript,
          opts.folders,
          sessionId,
          objective,
          Boolean(opts.planMode),
          opts.budgetUsd ?? null,
        )
      : await chat(
          opts.config,
          opts.system,
          requestTranscript,
          opts.folders,
          sessionId,
          Boolean(opts.planMode),
          opts.budgetUsd ?? null,
        );
    const durationMs = Math.max(50, Date.now() - startTime);
    opts.onUsage(result);

    const turnCostUsd = computeCostUsd(
      {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedTokens: result.cachedTokens,
      },
      opts.modelConfig,
      opts.config.model,
      opts.providerId,
    );

    const metrics: TurnMetrics = {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedTokens: result.cachedTokens,
      totalTokens: result.inputTokens + result.outputTokens,
      durationMs,
      costUsd: turnCostUsd,
    };

    const messagesWithMetrics = [...result.messages];
    const lastAssistIdx = messagesWithMetrics.map((m) => m.role).lastIndexOf("assistant");
    if (lastAssistIdx >= 0) {
      messagesWithMetrics[lastAssistIdx] = {
        ...messagesWithMetrics[lastAssistIdx],
        metrics,
      };
    }

    done = true;
    const snapshot = runtimes.get(sessionId);
    const existingUi = snapshot ? snapshot.messages : undefined;
    const uiMsgs = transcriptToUi(messagesWithMetrics, existingUi);
    const finalText =
      messagesWithMetrics
        .filter((m) => m.role === "assistant")
        .map((m) => m.content)
        .filter((c) => Boolean(c && c.trim()))
        .pop() ?? "";

    if (uiMsgs.length > 0 && uiMsgs[uiMsgs.length - 1].role === "assistant") {
      const currentUi = uiMsgs[uiMsgs.length - 1];
      const hasActivities = Boolean(currentUi.activities && currentUi.activities.length > 0);
      const effectiveText = finalText.trim() || acc.trim() || currentUi.text.trim();
      currentUi.text =
        effectiveText ||
        (hasActivities
          ? "✅ Operaciones ejecutadas con éxito según las directivas del turno."
          : "✅ Turno completado.");
      currentUi.metrics = metrics;
    }

    if (opts.useMultiAgent && uiMsgs.length > 0 && uiMsgs[uiMsgs.length - 1].role === "assistant") {
      const liveActivities = snapshot?.turnActivities[assistantId] ?? [];
      if (liveActivities.length > 0) {
        uiMsgs[uiMsgs.length - 1].activities = liveActivities;
      }
    }

    update(sessionId, () => ({
      messages: uiMsgs,
      transcript: messagesWithMetrics,
      nextUiId: uiMsgs.reduce((max, m) => Math.max(max, m.id), 0),
    }));
    opts.onTranscriptChange(messagesWithMetrics);

    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      const wsName = opts.folders[0]?.split(/[\\/]/).pop() || "Workspace";
      new Notification("Makora IDE", {
        body: `✅ Tarea completada con éxito en ${wsName}`,
        silent: false,
      });
    }
  } catch (err) {
    const current = runtimes.get(sessionId);
    const errStr = String(err);
    const isCancelled =
      (current?.abortRequested ?? false) ||
      errStr.toLowerCase().includes("cancel") ||
      errStr.toLowerCase().includes("abort");
    const finalMsg = isCancelled
      ? acc
        ? `${acc}\n\n*(⏹️ Generación detenida por el usuario)*`
        : `*(⏹️ Generación detenida por el usuario)*`
      : acc
        ? `${acc}\n\n⚠️ Error: ${errStr}`
        : `⚠️ Error: ${errStr}`;
    update(sessionId, (r) => {
      // Remove the provisional empty assistant message from persistent transcript on error
      const copy = [...r.transcript];
      const lastIdx = copy.length - 1;
      const last = copy[lastIdx];
      const replacesEmptyAssistant =
        last &&
        last.role === "assistant" &&
        (!last.content || !last.content.trim()) &&
        (!last.toolCalls || last.toolCalls.length === 0);
      
      const transcript = replacesEmptyAssistant ? copy.slice(0, -1) : copy;
      return {
        transcript,
        messages: r.messages.map((x) => (x.id === assistantId ? { ...x, text: finalMsg } : x)),
        error: isCancelled ? null : errStr,
      };
    });
    const snapshot = runtimes.get(sessionId);
    if (snapshot) opts.onTranscriptChange(snapshot.transcript);

    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      document.hidden &&
      !isCancelled
    ) {
      const wsName = opts.folders[0]?.split(/[\\/]/).pop() || "Workspace";
      new Notification("Makora IDE", {
        body: `⚠️ Fallo en tarea de ${wsName}`,
        silent: false,
      });
    }
  } finally {
    isDisposed = true;
    done = true;
    unlistenDelta?.();
    update(sessionId, () => ({ busy: false, abortRequested: false }));
  }
}

export function cancelTurn(sessionId: string): void {
  const rt = runtimes.get(sessionId);
  if (!rt || !rt.busy) return;
  update(sessionId, () => ({ abortRequested: true, busy: false }));
  chatCancel(sessionId).catch((e) => console.warn("cancel error:", e));
}

export async function answerQuestion(sessionId: string, answer: string): Promise<void> {
  const rt = runtimes.get(sessionId);
  const q = rt?.pendingQuestion;
  if (!q) return;
  update(sessionId, () => ({ pendingQuestion: null }));
  try {
    await questionReply(q.id, answer);
  } catch (e) {
    console.warn("question reply error:", e);
  }
}

export async function answerApproval(
  sessionId: string,
  decision: "allow_once" | "allow_always" | "deny" | "deny_always" | "trust_session",
  feedback = "",
): Promise<void> {
  const rt = runtimes.get(sessionId);
  const a = rt?.pendingApproval;
  if (!a) return;
  update(sessionId, () => ({ pendingApproval: null }));
  try {
    await approvalReply(a.id, decision, feedback);
  } catch (e) {
    console.warn("approval reply error:", e);
  }
}

export function appendAssistantMessage(sessionId: string, text: string): void {
  if (!runtimes.has(sessionId)) ensureSessionRuntime(sessionId);
  update(sessionId, (r) => ({
    messages: [...r.messages, { id: r.nextUiId + 1, role: "assistant", text }],
    nextUiId: r.nextUiId + 1,
  }));
}
