import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  detectProjectRules,
  searchPaths,
  pickFiles,
  readTextFile,
} from "../api";
import Markdown from "./Markdown";
import { isModelReasoningSupported } from "../defaults";
import {
  Zap,
  Cpu,
  ScrollText,
  FlaskConical,
  Copy,
  Download,
  Trash2,
  Send,
  Square,
  Check,
  Image as ImageIcon,
  FileText,
  FileCode,
  Code2,
  Table,
  UploadCloud,
  Folder,
  Paperclip,
  X,
  ChevronDown,
  Search,
  Plus,
  Coins,
  Clock,
  Rocket,
  Workflow,
} from "lucide-react";
import { useI18n } from "../i18n";
import { shouldAutoUseMultiAgent } from "../autoRouter";
import {
  appendAssistantMessage,
  cancelTurn,
  clearSessionDraft,
  sendTurn,
  setSessionDraftAttachments,
  setSessionDraftInput,
  useSessionRuntime,
} from "../sessionStore";

function formatPathDisplay(fullPath: string) {
  const normalized = fullPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const fileName = parts.pop() || normalized;
  const dir = parts.slice(-3).join("/");
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return { fileName, dir, ext, fullPath: normalized };
}

function getMentionIcon(ext: string) {
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return <FileCode size={13} className="text-cyan" />;
    case "rs":
      return <Code2 size={13} className="text-purple" />;
    case "py":
      return <Code2 size={13} className="text-blue" />;
    case "json":
    case "toml":
    case "yaml":
    case "yml":
      return <Code2 size={13} className="text-gold" />;
    case "md":
    case "txt":
      return <FileText size={13} className="text-blue" />;
    case "pdf":
      return <FileText size={13} className="text-purple" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
    case "svg":
      return <ImageIcon size={13} className="text-green" />;
    case "csv":
      return <Table size={13} className="text-cyan" />;
    default:
      return <FileText size={13} className="opacity-70" />;
  }
}

import type {
  AgentMode,
  Attachment,
  ChatConfig,
  ChatMessage,
  ChatUsage,
  ModelConfig,
  MultiAgentPlanState,
  SubagentRole,
  ThinkingLevel,
  ToolActivity,
} from "../types";

function thinkingNudge(level: ThinkingLevel): string {
  switch (level) {
    case "none":
      return "Responde de forma directa y concisa, sin razonamiento extenso.";
    case "minimal":
      return "Razona lo mínimo imprescindible antes de responder.";
    case "low":
      return "Razona brevemente antes de responder.";
    case "medium":
      return "Razona con detalle moderado y justifica lo importante.";
    case "high":
      return "Razona a fondo, paso a paso, y justifica tus decisiones.";
  }
}

function getAntigravityToolTitle(activity: ToolActivity): string {
  const name = activity.name.replace(/^mcp__[^_]+__/, "");
  let detail = "";
  try {
    const parsed = JSON.parse(activity.arguments);
    if (parsed.command) detail = `"${parsed.command.slice(0, 50)}"`;
    else if (parsed.path) detail = `"${parsed.path.slice(0, 45)}"`;
    else if (parsed.pattern) detail = `"${parsed.pattern.slice(0, 35)}"`;
    else if (parsed.query) detail = `"${parsed.query.slice(0, 35)}"`;
  } catch {
    detail = activity.arguments ? activity.arguments.replace(/\s+/g, " ").slice(0, 40) : "";
  }

  const isRunning = activity.ok === null;
  const isErr = activity.ok === false;

  let action = name;
  if (name === "bash" || name === "run" || name === "exec") {
    action = `Run ${detail || "command"}`;
  } else if (name === "read_file" || name === "read_file_range") {
    action = `Read file ${detail}`;
  } else if (name === "write_file") {
    action = `Write file ${detail}`;
  } else if (name === "apply_patch") {
    action = `Apply patch to ${detail}`;
  } else if (name === "grep" || name === "search") {
    action = `Search ${detail}`;
  } else if (name === "list_dir") {
    action = `List dir ${detail || "."}`;
  } else {
    action = `${name} ${detail}`;
  }

  if (isRunning) return `${action} running...`;
  if (isErr) return `${action} failed`;
  return `${action} finished`;
}

function summarizeToolNames(activities: ToolActivity[]): string {
  const names = Array.from(new Set(activities.map((a) => a.name.replace(/^mcp__[^_]+__/, ""))));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

function AntigravityToolItem({
  activity,
  copied,
  onCopyLog,
  t,
}: {
  activity: ToolActivity;
  copied: boolean;
  onCopyLog: (log: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const [open, setOpen] = useState(false);
  const isRunning = activity.ok === null;
  const isErr = activity.ok === false;
  const title = getAntigravityToolTitle(activity);

  const outputLog = activity.log || (isRunning ? t.chat.toolsRunning : "Completado sin salida.");

  return (
    <details
      className={`ag-tool-item ${isRunning ? "running" : isErr ? "failed" : "success"}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="ag-tool-summary">
        <span className="ag-tool-status-dot" />
        <span className="ag-tool-title">{title}</span>
        <ChevronDown size={11} className="ag-tool-chevron" />
      </summary>
      <div className="ag-tool-content">
        <div className="ag-tool-terminal">
          <div className="ag-tool-terminal-header">
            <span className="ag-tool-terminal-label font-mono">{activity.name}</span>
            <button
              type="button"
              className="ag-tool-copy-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCopyLog(activity.log || activity.arguments);
              }}
              title={t.chat.copyResult}
            >
              {copied ? (
                <>
                  <Check size={11} className="text-green" />
                  <span>{t.chat.copiedResult}</span>
                </>
              ) : (
                <>
                  <Copy size={11} />
                  <span>{t.chat.copyResult}</span>
                </>
              )}
            </button>
          </div>
          {activity.arguments && (
            <div className="ag-tool-args font-mono">
              <span className="ag-tool-args-prefix">$ </span>
              {activity.arguments}
            </div>
          )}
          <pre className="ag-tool-log font-mono">{outputLog}</pre>
        </div>
      </div>
    </details>
  );
}

function GroupedToolsDropdown({
  activities,
  copiedLogId,
  onCopyLog,
}: {
  activities: ToolActivity[];
  copiedLogId: string | null;
  onCopyLog: (id: string, log: string) => void;
}) {
  const { t } = useI18n();
  const runningTool = activities.find((a) => a.ok === null);
  const isRunning = Boolean(runningTool);
  const hasFailed = activities.some((a) => a.ok === false);
  const [open, setOpen] = useState(false);

  const count = activities.length;
  const summary = isRunning
    ? `${t.chat.toolsRunning} (${runningTool!.name})`
    : count === 1
      ? getAntigravityToolTitle(activities[0])
      : `${count} ${t.chat.toolsExecuted.toLowerCase()} (${summarizeToolNames(activities)})`;

  return (
    <details
      className={`ag-meta-item ${isRunning ? "running" : hasFailed ? "failed" : "success"}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="ag-meta-summary">
        <span className={`ag-meta-dot ${isRunning ? "running" : hasFailed ? "failed" : "success"}`} />
        <span className="ag-meta-title">{summary}</span>
        <ChevronDown size={11} className="ag-meta-chevron" />
      </summary>
      <div className="ag-meta-content">
        <div className="ag-tools-stack">
          {activities.map((a) => (
            <AntigravityToolItem
              key={a.id}
              activity={a}
              copied={copiedLogId === a.id}
              onCopyLog={(log) => onCopyLog(a.id, log)}
              t={t}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function ThinkingDropdown({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <details
      className={`ag-meta-item thinking ${isStreaming ? "running" : ""}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="ag-meta-summary">
        <span className={`ag-meta-dot thinking ${isStreaming ? "running" : ""}`} />
        <span className="ag-meta-title">
          {isStreaming ? t.chat.thinkingStreaming : `${t.chat.thinking} (${wordCount} ${t.chat.thinkingWords})`}
        </span>
        <ChevronDown size={11} className="ag-meta-chevron" />
      </summary>
      <div className="ag-meta-content">
        <pre className="ag-thinking-pre font-mono">{text}</pre>
      </div>
    </details>
  );
}

const ROLE_ICONS: Record<SubagentRole, ReactNode> = {
  explorer: <Search size={11} className="text-cyan" />,
  coder: <FileCode size={11} className="text-purple" />,
  tester: <FlaskConical size={11} className="text-gold" />,
  reviewer: <ScrollText size={11} className="text-blue" />,
};

function MultiAgentPanel({ plan, busy }: { plan: MultiAgentPlanState; busy: boolean }) {
  const { t } = useI18n();
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const doneCount = plan.steps.filter((s) => s.status === "completed").length;

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className={`ma-plan-card ${busy ? "running" : ""}`}>
      <div className="ma-plan-header">
        <Workflow size={13} className="text-cyan" />
        <span className="ma-plan-title">{t.multiagent.planTitle}</span>
        <span className="ma-plan-progress">
          {doneCount}/{plan.steps.length}
        </span>
      </div>
      <div className="ma-plan-objective font-mono">{plan.objective}</div>
      <div className="ma-plan-steps">
        {plan.steps.map((step) => {
          const isExpanded = Boolean(expandedSteps[step.stepIndex]);
          const hasDetails = Boolean(step.resultSummary && step.resultSummary.trim().length > 0);

          return (
            <div
              key={step.stepIndex}
              className={`ma-plan-step ${step.status} ${hasDetails ? "clickable" : ""}`}
              onClick={() => hasDetails && toggleStep(step.stepIndex)}
              title={hasDetails ? (isExpanded ? "Clic para contraer" : "Clic para ver detalle y diagnóstico") : ""}
            >
              <span className={`ma-plan-dot ${step.status}`} />
              <span className="ma-plan-step-icon">{ROLE_ICONS[step.role]}</span>
              <div className="ma-plan-step-body">
                <div className="ma-plan-step-head-row">
                  <span className="ma-plan-step-title">{step.title}</span>
                  {hasDetails && (
                    <span className="ma-plan-step-chevron">
                      <ChevronDown size={11} className={isExpanded ? "chevron-open" : ""} />
                    </span>
                  )}
                </div>
                {step.status === "running" && (
                  <span className="ma-plan-step-running">{t.multiagent.running}…</span>
                )}
                {step.status === "completed" && step.resultSummary && (
                  <div className={`ma-plan-step-summary ${isExpanded ? "expanded" : ""}`}>
                    {isExpanded ? step.resultSummary : (step.resultSummary.slice(0, 160) + (step.resultSummary.length > 160 ? "…" : ""))}
                  </div>
                )}
                {step.status === "failed" && (
                  <div className={`ma-plan-step-summary error ${isExpanded ? "expanded" : ""}`}>
                    {step.resultSummary || t.multiagent.failed}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {plan.isCompleted && (
        <div className="ma-plan-footer">
          <Zap size={10} className="text-cyan" />
          <span>{plan.totalTokens.toLocaleString()} tok</span>
        </div>
      )}
    </div>
  );
}

interface ChatProps {
  sessionId: string;
  config: ChatConfig;
  ready: boolean;
  folders: string[];
  skillsContent: string;
  thinkingLevel: ThinkingLevel;
  onSelectThinkingLevel?: (level: ThinkingLevel) => void;
  includeWorkspace: boolean;
  visionEnabled: boolean;
  blocked: boolean;
  blockReason: string;
  agentMode?: AgentMode;
  onToggleMode?: (mode: AgentMode) => void;
  multiAgentMode?: "auto" | "always" | "off";
  onToggleMultiAgentMode?: (mode: "auto" | "always" | "off") => void;
  models?: string[];
  activeModel?: string;
  onSelectModel?: (model: string) => void;
  modelConfig?: ModelConfig;
  providerId?: string;
  onUsage: (usage: ChatUsage) => void;
  onApplyArtifact: (path: string, content: string) => void;
  onClearSessionTrigger?: () => void;
  onTranscriptChange: (messages: ChatMessage[]) => void;
  injectedPrompt?: string | null;
  onClearInjectedPrompt?: () => void;
}

export default function Chat({
  sessionId,
  config,
  ready,
  folders,
  skillsContent,
  thinkingLevel,
  onSelectThinkingLevel,
  includeWorkspace,
  visionEnabled,
  blocked,
  blockReason,
  agentMode = "act",
  onToggleMode,
  multiAgentMode: multiAgentModeProp,
  onToggleMultiAgentMode,
  models = [],
  activeModel,
  onSelectModel,
  modelConfig,
  providerId,
  onUsage,
  onApplyArtifact,
  onClearSessionTrigger,
  onTranscriptChange,
  injectedPrompt,
  onClearInjectedPrompt,
}: ChatProps) {
  const { t } = useI18n();
  const rt = useSessionRuntime(sessionId);
  const { busy, messages, turnActivities, thinking, plan, currentAssistantId, runningTool, draftInput, draftAttachments } = rt;
  const [input, setInputState] = useState(() => draftInput ?? "");
  const [attachments, setAttachmentsState] = useState<Attachment[]>(() => draftAttachments ?? []);

  // Sync draft state if session changes or store is updated
  const prevSessionIdRef = useRef(sessionId);
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      setInputState(draftInput ?? "");
      setAttachmentsState(draftAttachments ?? []);
    }
  }, [sessionId, draftInput, draftAttachments]);

  const setInput = useCallback(
    (val: string | ((prev: string) => string)) => {
      setInputState((prev) => {
        const next = typeof val === "function" ? val(prev) : val;
        setSessionDraftInput(sessionId, next);
        return next;
      });
    },
    [sessionId],
  );

  const setAttachments = useCallback(
    (val: Attachment[] | ((prev: Attachment[]) => Attachment[])) => {
      setAttachmentsState((prev) => {
        const next = typeof val === "function" ? val(prev) : val;
        setSessionDraftAttachments(sessionId, next);
        return next;
      });
    },
    [sessionId],
  );

  const [localMultiAgentMode, setLocalMultiAgentMode] = useState<"auto" | "always" | "off">("auto");
  const multiAgentMode = multiAgentModeProp ?? localMultiAgentMode;
  const setMultiAgentMode = (mam: "auto" | "always" | "off") => {
    setLocalMultiAgentMode(mam);
    onToggleMultiAgentMode?.(mam);
  };

  // Handle injected prompt from viewers (e.g. PDF viewer "Analizar con Makora")
  useEffect(() => {
    if (injectedPrompt) {
      setInput(injectedPrompt);
      onClearInjectedPrompt?.();
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [injectedPrompt, onClearInjectedPrompt, setInput]);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const [mention, setMention] = useState<{
    query: string;
    start: number;
    results: string[];
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);
  const [projectRules, setProjectRules] = useState<string | null>(null);

  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  const modelMenuRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mentionTimer = useRef<number | null>(null);
  const lastAttachmentId = useRef<number>(0);
  const isAutoScrollEnabled = useRef<boolean>(true);

  // Auto-scroll selected mention item into view
  useEffect(() => {
    if (mention && mentionListRef.current) {
      const activeEl = mentionListRef.current.children[mentionIndex] as HTMLElement | undefined;
      activeEl?.scrollIntoView({ block: "nearest" });
    }
  }, [mention, mentionIndex]);

  // Close menus on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    if (modelMenuOpen || attachMenuOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [modelMenuOpen, attachMenuOpen]);

  const filteredModels = models.filter((m) =>
    m.toLowerCase().includes(modelSearch.toLowerCase())
  );

  // Detect project rules in workspace
  useEffect(() => {
    if (folders.length > 0) {
      detectProjectRules(folders)
        .then(setProjectRules)
        .catch(() => setProjectRules(null));
    } else {
      setProjectRules(null);
    }
  }, [folders]);

  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    } else if (messagesContainerRef.current) {
      const el = messagesContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    // Allow generous tolerance for user scroll detection
    const isNearBottom = scrollHeight - (scrollTop + clientHeight) < 140;
    isAutoScrollEnabled.current = isNearBottom;
    setShowScrollBottom(!isNearBottom);
  };

  useEffect(() => {
    if (isAutoScrollEnabled.current) {
      scrollToBottom(false);
    }
  }, [messages, turnActivities, thinking, scrollToBottom]);

  const buildSystem = async (effectiveMode: AgentMode = agentMode): Promise<string> => {
    let sys =
      "Eres Makora, un asistente de desarrollo agéntico de élite integrado en MakoraIDE.\n" +
      "Trabajas directamente sobre los archivos del workspace que se te muestran.\n\n" +
      "### I. Protocolo de Razonamiento Quirúrgico (Thinking Protocol)\n" +
      "1. Respeta Contratos e Invariantes: Identifica tipos, firmas públicas y no rompas código existente.\n" +
      "2. Mapeo Preciso: Localiza el archivo y líneas exactas con `grep` o `read_file_range` antes de proponer cambios.\n" +
      "3. Validación Previa: Verifica imports, tipos y balance de llaves antes de aplicar parches.\n\n" +
      "### II. Economía Extrema de Tokens (Token Economy Guard)\n" +
      "1. Anti-Bloat: PROHIBIDO usar `read_file` en archivos de más de 150 líneas. Usa obligatoriamente `read_file_range`.\n" +
      "2. Cirugía con `apply_patch`: Modifica archivos existentes EXCLUSIVAMENTE con `apply_patch` (3-5 líneas de anclaje). NUNCA reescribas archivos completos con `write_file`.\n" +
      "3. Batching: Agrupa múltiples lecturas o búsquedas independientes en una única llamada.\n" +
      "4. Aislamiento Efímero: Usa `explore_subagent` cuando debas examinar múltiples archivos o logs extensos para mantener el historial principal limpio.\n" +
      "5. Cero Duplicación: No reimprimas el código completo en la respuesta final de texto cuando ya lo aplicaste con `apply_patch`.\n\n" +
      "### III. Salida Técnica y Regla de Oro de Cierre\n" +
      "1. Al terminar la tarea técnica, emite SIEMPRE un resumen estructurado y claro: `- ruta/al/archivo:línea — acción realizada` + estado de verificación.\n" +
      "2. OBLIGACIÓN DE RESPUESTA: NUNCA finalices en silencio ni con texto vacío tras ejecutar herramientas. Confirma siempre las operaciones efectuadas al usuario.\n" +
      thinkingNudge(thinkingLevel);

    if (effectiveMode === "plan") {
      sys +=
        "\n\n## MODO DE PLANIFICACIÓN ACTIVO (PLAN MODE):\n" +
        "El usuario ha activado el MODO PLAN. En este modo está ESTRICTAMENTE PROHIBIDO crear, editar o borrar archivos directamente con write_file o apply_patch, o ejecutar comandos bash destructivos.\n" +
        "Tu objetivo es explorar el workspace usando herramientas de solo lectura (`read_file_range`, `grep`, `list_dir`) y generar un Plan de Implementación estructurado en Markdown que contenga:\n" +
        "1. `# Implementation Plan: [Título]`\n" +
        "2. `## 1. Análisis y Diagnóstico`\n" +
        "3. `## 2. Cambios Propuestos (Archivo por Archivo con rutas exactas y desglose)`\n" +
        "4. `## 3. Plan de Verificación y Pruebas`\n" +
        "5. Preguntas abiertas o decisiones críticas que requieran validación previa.\n" +
        "Presenta el plan completo de forma clara y directa en tu respuesta para que el usuario pueda revisarlo y pulsar 'Proceder a Implementar'.";
    }

    if (projectRules) {
      sys += "\n\n" + projectRules;
    }

    if (skillsContent.trim()) {
      sys += "\n\n## Skills (instrucciones del usuario)\n" + skillsContent;
    }

    if (includeWorkspace && folders.length > 0) {
      sys += "\n\n## Workspace activo (rutas raíz)\n" + folders.map((f) => `- ${f}`).join("\n");
      sys += "\n(Utiliza las herramientas nativas 'list_dir', 'read_file_range' y 'grep' para navegar e inspeccionar el código del workspace según lo requieras).";
    }
    return sys;
  };

  const compressAndResizeImage = async (file: File, maxDim = 1024, quality = 0.85): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const rawUrl = String(reader.result ?? "");
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(rawUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL("image/jpeg", quality);
          resolve(compressed);
        };
        img.onerror = () => resolve(rawUrl);
        img.src = rawUrl;
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  };

  const addLocalFilePath = async (filePath: string) => {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const name = filePath.split(/[\\/]/).pop() || filePath;
    const id = ++lastAttachmentId.current + Date.now();
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
      setAttachments((a) => [
        ...a,
        { id, name, kind: "image", dataUrl: `https://asset.localhost/${encodeURIComponent(filePath)}` },
      ]);
    } else {
      try {
        const content = await readTextFile(filePath);
        setAttachments((a) => [
          ...a,
          { id, name, kind: "text", text: content.slice(0, 200000) },
        ]);
      } catch {
        setAttachments((a) => [
          ...a,
          { id, name, kind: "text", text: `[Archivo: ${filePath}]` },
        ]);
      }
    }
  };

  const addFiles = (files: File[]) => {
    files.forEach(async (f) => {
      const id = ++lastAttachmentId.current + Date.now();
      if (f.type.startsWith("image/")) {
        const dataUrl = await compressAndResizeImage(f);
        if (dataUrl) {
          setAttachments((a) => [
            ...a,
            { id, name: f.name, kind: "image", dataUrl },
          ]);
        }
      } else if (
        f.type.startsWith("text/") ||
        /\.(ts|tsx|js|jsx|json|rs|py|md|txt|log|html|css|csv|toml|yaml|yml)$/i.test(f.name)
      ) {
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result ?? "").slice(0, 200000);
          setAttachments((a) => [...a, { id, name: f.name, kind: "text", text }]);
        };
        reader.readAsText(f);
      }
    });
  };


  const handleInputChange = (value: string, caret: number) => {
    setInput(value);
    const before = value.slice(0, caret);
    const m = /@([\w./\\-]*)$/.exec(before);
    if (m) {
      const query = m[1];
      const start = caret - m[0].length;
      if (mentionTimer.current) window.clearTimeout(mentionTimer.current);
      mentionTimer.current = window.setTimeout(async () => {
        try {
          const results = await searchPaths(folders, query);
          setMention({ query, start, results });
          setMentionIndex(0);
        } catch {
          setMention(null);
        }
      }, 150);
    } else {
      setMention(null);
    }
  };

  const pickMention = (fullPath: string) => {
    if (!mention) return;
    const clean = fullPath.replace(/\\/g, "/");
    let relPath = clean;
    for (const f of folders) {
      const cleanF = f.replace(/\\/g, "/");
      if (clean.startsWith(cleanF)) {
        relPath = clean.slice(cleanF.length).replace(/^\//, "");
        break;
      }
    }
    const next =
      input.slice(0, mention.start) +
      "@" +
      relPath +
      " " +
      input.slice(mention.start + mention.query.length + 1);
    setInput(next);
    setMention(null);
    setTimeout(() => textareaRef.current?.focus(), 20);
  };

  const clearChat = () => {
    if (busy) return;
    clearSessionDraft(sessionId);
    setInput("");
    setAttachments([]);
    if (onClearSessionTrigger) {
      onClearSessionTrigger();
      return;
    }
  };

  const copyTranscript = () => {
    if (messages.length === 0) return;
    const text = messages
      .map((m) => `### ${m.role === "user" ? "Usuario" : "Makora"}\n\n${m.text}`)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 1500);
    });
  };

  const exportMarkdown = () => {
    if (messages.length === 0) return;
    const content = `# MakoraIDE Transcript - ${new Date().toLocaleString()}\n\n` +
      messages
        .map((m) => `### ${m.role === "user" ? "Usuario" : "Makora"}\n\n${m.text}`)
        .join("\n\n---\n\n");
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `makora_chat_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const triggerAutoTestAndRepair = () => {
    setInput(
      "Ejecuta la suite de pruebas del proyecto (cargo test, npm test, pytest o equivalente según el lenguaje del workspace), analiza cualquier fallo o error en los logs, y aplica las correcciones quirúrgicas necesarias hasta que todos los tests pasen exitosamente.",
    );
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  const send = async (overrideText?: string, targetMode?: AgentMode) => {
    const text = (overrideText ?? input).trim();
    if ((!text && attachments.length === 0) || busy || !ready) return;
    if (blocked) {
      appendAssistantMessage(sessionId, `⛔ ${blockReason}`);
      return;
    }

    const effectiveMode = targetMode || agentMode;
    if (targetMode && targetMode !== agentMode) {
      onToggleMode?.(targetMode);
    }

    let content = text;
    const atts = attachments;
    const textAtts = atts.filter((a) => a.kind === "text");
    if (textAtts.length > 0) {
      const blocks = textAtts
        .map((a) => `### Archivo adjunto: ${a.name}\n\`\`\`\n${a.text}\n\`\`\``)
        .join("\n\n");
      content = blocks + (text ? "\n\n" + text : "");
    }
    const imageAtts = atts.filter((a) => a.kind === "image");
    if (imageAtts.length > 0 && !visionEnabled) {
      appendAssistantMessage(
        sessionId,
        `🖼 El modelo ${config.model} no soporta imágenes: se guardarán como archivo temporal y el agente verá la ruta de referencia. Activa "Visión" en ⚙ → Modelos si usas un modelo multimodal.`,
      );
    }
    const images = imageAtts.map((a) => a.dataUrl ?? "");

    setInput("");
    setMention(null);
    setAttachments([]);

    if (!content.trim() && images.length === 0) {
      return;
    }

    isAutoScrollEnabled.current = true;

    const system = await buildSystem(effectiveMode);
    let useMultiAgent = false;
    if (effectiveMode === "act") {
      if (multiAgentMode === "always") {
        useMultiAgent = true;
      } else if (multiAgentMode === "auto") {
        const decision = shouldAutoUseMultiAgent(content, folders, messages.length);
        useMultiAgent = decision.useMultiAgent;
      }
    }
    void sendTurn(sessionId, {
      config,
      system,
      folders,
      modelConfig,
      providerId,
      content,
      images,
      displayText: text,
      useMultiAgent,
      onUsage,
      onTranscriptChange,
    });
  };

  const applyArtifact = (path: string, content: string) => {
    onApplyArtifact(path, content);
  };

  const copyMessage = (id: number, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId(null), 1400);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {

    if (mention && mention.results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((idx) => (idx + 1) % mention.results.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((idx) =>
          idx <= 0 ? mention.results.length - 1 : idx - 1,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = mention.results[mentionIndex] || mention.results[0];
        if (selected) {
          pickMention(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <section className="chat">
      <div className="chat-top-bar">
        <div className="chat-status-indicator">
          {busy ? (
            <span className="chat-badge-busy">
              <span className="pulse-dot" />
              {runningTool ? `${t.chat.toolsRunning} ${runningTool}` : t.chat.thinkingStreaming}
            </span>
          ) : (
            <span className="chat-badge-ready">
              <span className="idle-dot" />
              {ready ? t.chat.activeSession : t.common.inactive}
            </span>
          )}

          {projectRules && (
            <span className="rules-active-badge" title={t.chat.rulesTooltip}>
              <ScrollText size={10} />
              <span>{t.chat.rulesActive}</span>
            </span>
          )}

          {/* Mode Switcher */}
          <div className="agent-mode-selector">
            <button
              className={`mode-pill ${agentMode === "act" ? "active" : ""}`}
              onClick={() => onToggleMode?.("act")}
              title={t.chat.actModeHint}
            >
              <Zap size={10} />
              <span>{t.chat.actMode}</span>
            </button>
            <button
              className={`mode-pill ${agentMode === "plan" ? "active" : ""}`}
              onClick={() => onToggleMode?.("plan")}
              title={t.chat.planModeHint}
            >
              <ScrollText size={10} />
              <span>{t.chat.planMode}</span>
            </button>
            <button
              className={`mode-pill ma-pill ${multiAgentMode !== "off" ? "active" : ""} ${multiAgentMode === "auto" ? "ma-auto" : ""}`}
              onClick={() => {
                const next: "auto" | "always" | "off" =
                  multiAgentMode === "auto" ? "always" : multiAgentMode === "always" ? "off" : "auto";
                setMultiAgentMode(next);
              }}
              title={
                multiAgentMode === "auto"
                  ? t.multiagent.autoHint
                  : multiAgentMode === "always"
                  ? t.multiagent.alwaysHint
                  : t.multiagent.offHint
              }
            >
              <Workflow size={10} />
              <span>
                {multiAgentMode === "auto" ? t.multiagent.auto : multiAgentMode === "always" ? t.multiagent.always : t.multiagent.off}
              </span>
            </button>
          </div>
        </div>

        <div className="chat-top-actions">
          <button
            className="chat-header-btn"
            onClick={triggerAutoTestAndRepair}
            title={t.palette.actionAutoTest}
          >
            <FlaskConical size={11} />
            <span>{t.chat.autoTest}</span>
          </button>
          {messages.length > 0 && (
            <>
              <button
                className="chat-header-btn"
                onClick={copyTranscript}
                title={t.chat.copyChat}
              >
                {copiedTranscript ? <Check size={11} /> : <Copy size={11} />}
                <span>{copiedTranscript ? t.common.copied : t.common.copy}</span>
              </button>
              <button
                className="chat-header-btn"
                onClick={exportMarkdown}
                title={t.chat.exportChat}
              >
                <Download size={11} />
                <span>{t.chat.exportChat}</span>
              </button>
              <button
                className="chat-header-btn"
                onClick={clearChat}
                disabled={busy}
                title={t.chat.clearChat}
              >
                <Trash2 size={11} />
                <span>{t.chat.clearChat}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {plan && <MultiAgentPanel plan={plan} busy={busy} />}

      <div
        className="chat-messages"
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {messages.length === 0 && (
          <div className="chat-empty muted">
            <img src="/makora.svg" alt="" className="chat-empty-logo" />
            <p className="chat-empty-title">{t.chat.title}</p>
            <p className="chat-empty-sub">
              {ready
                ? t.chat.readyHint
                : t.chat.notReadyHint}
            </p>
            <div className="chat-quickstart-actions">
              <button className="btn btn-subtle" onClick={clearChat} title={t.chat.newConversation}>
                <Plus size={12} />
                <span>{t.chat.newConversation}</span>
              </button>
              <button className="btn btn-subtle" onClick={triggerAutoTestAndRepair}>
                <FlaskConical size={12} />
                <span>{t.chat.autoTest}</span>
              </button>
            </div>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="msg msg-user">
                <div className="msg-user-inner">
                  <div className="msg-text">{m.text}</div>
                  {m.text && (
                    <button
                      className="msg-copy-btn user-copy-btn"
                      onClick={() => copyMessage(m.id, m.text)}
                      title={t.chat.copyMessage}
                    >
                      {copiedMsgId === m.id ? (
                        <Check size={11} className="text-green" />
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          }

          const isCurrentAssistant = m.role === "assistant" && m.id === currentAssistantId;
          const isBusyCurrent = isCurrentAssistant && busy;
          const thinkingText = (isCurrentAssistant && thinking?.text) || m.thinking || "";
          const hasThinking = thinkingText.trim().length > 0;
          const liveActivities = m.role === "assistant" ? turnActivities[m.id] ?? [] : [];
          const allActivities = liveActivities.length > 0 ? liveActivities : (m.activities ?? []);
          const runningToolInMsg = isBusyCurrent ? allActivities.find((a) => a.ok === null) : undefined;

          return (
            <div key={m.id} className="msg msg-assistant">
              <div className="msg-header">
                <div className="msg-header-left">
                  <span className="msg-role-badge makora-badge">
                    ⚔️ {t.chat.assistant}
                  </span>
                  {isBusyCurrent && (
                    <span className="msg-streaming-indicator">
                      <span className="pulse-dot" />
                      <span>{runningToolInMsg ? `${t.statusbar.executingTool} ${runningToolInMsg.name}...` : hasThinking ? t.chat.thinkingStreaming : t.chat.generating}</span>
                    </span>
                  )}
                </div>
                {m.text && (
                  <button
                    className="msg-copy-btn"
                    onClick={() => copyMessage(m.id, m.text)}
                    title={t.chat.copyMessage}
                  >
                    {copiedMsgId === m.id ? (
                      <>
                        <Check size={11} className="text-green" />
                        <span>{t.common.copied}</span>
                      </>
                    ) : (
                      <>
                        <Copy size={11} />
                        <span>{t.common.copy}</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {m.role === "assistant" ? (
                <>
                  {/* Meta Pills (Grouped Tools & Thinking - collapsed by default) */}
                  {(allActivities.length > 0 || hasThinking) && (
                    <div className="ag-meta-pills-row">
                      {allActivities.length > 0 && (
                        <GroupedToolsDropdown
                          activities={allActivities}
                          copiedLogId={copiedLogId}
                          onCopyLog={(id, log) => {
                            navigator.clipboard.writeText(log).then(() => {
                              setCopiedLogId(id);
                              setTimeout(() => setCopiedLogId(null), 1400);
                            });
                          }}
                        />
                      )}

                      {hasThinking && (
                        <ThinkingDropdown
                          text={thinkingText}
                          isStreaming={isBusyCurrent && !m.text}
                        />
                      )}
                    </div>
                  )}

                  {/* 3. Assistant Response Markdown Text or Reassuring Working State */}
                  {m.text ? (
                    <div className="msg-content">
                      <Markdown text={m.text} onApplyArtifact={applyArtifact} />
                    </div>
                  ) : isBusyCurrent ? (
                    <div className="ai-working-indicator">
                      <div className="ai-working-top">
                        <div className="ai-working-spinner-wrap">
                          <div className="ai-working-spinner" />
                          <Zap size={11} className="ai-working-icon text-cyan" />
                        </div>
                        <div className="ai-working-text-col">
                          <span className="ai-working-title">
                            {runningToolInMsg
                              ? `Ejecutando ${runningToolInMsg.name}...`
                              : hasThinking
                                ? "Razonando solución técnica..."
                                : "Analizando proyecto y preparando respuesta..."}
                          </span>
                          <span className="ai-working-detail font-mono">
                            {runningToolInMsg
                              ? runningToolInMsg.arguments.slice(0, 75)
                              : `${allActivities.length} operaciones realizadas`}
                          </span>
                        </div>
                      </div>
                      <div className="ai-working-shimmer-track">
                        <div className="ai-working-shimmer-bar" />
                      </div>
                    </div>
                  ) : (
                    <div className="msg-content">
                      <div className="msg-text">
                        {allActivities.length > 0
                          ? "✅ Modificaciones y operaciones completadas con éxito mediante herramientas."
                          : "✅ Operación procesada con éxito."}
                      </div>
                    </div>
                  )}

                  {/* 4. Subtle Turn Metrics Footer (Tokens, Duration, Cost in USD) */}
                  {m.metrics && !isBusyCurrent && (
                    <div className="msg-footer">
                      <div
                        className="msg-metrics-badge"
                        title={`Entrada: ${m.metrics.inputTokens.toLocaleString()} tok (${m.metrics.cachedTokens.toLocaleString()} en caché) | Salida: ${m.metrics.outputTokens.toLocaleString()} tok | Tiempo: ${(m.metrics.durationMs / 1000).toFixed(1)}s | Coste: $${m.metrics.costUsd.toFixed(5)}`}
                      >
                        <span className="metric-item metric-tokens">
                          <Zap size={10} className="text-cyan" />
                          <span>
                            {m.metrics.totalTokens >= 1000
                              ? `${(m.metrics.totalTokens / 1000).toFixed(1)}k`
                              : m.metrics.totalTokens}{" "}
                            tok
                          </span>
                        </span>
                        <span className="metric-dot">•</span>
                        <span className="metric-item metric-time">
                          <Clock size={10} />
                          <span>{(m.metrics.durationMs / 1000).toFixed(1)}s</span>
                        </span>
                        <span className="metric-dot">•</span>
                        <span className="metric-item metric-cost">
                          <Coins size={10} className="text-gold" />
                          <span>
                            ${m.metrics.costUsd < 0.0001
                              ? m.metrics.costUsd.toFixed(5)
                              : m.metrics.costUsd.toFixed(4)}
                          </span>
                        </span>
                      </div>
                    </div>
                  )}

                  {/* 5. Plan mode: proceed-to-implement action on the last answer */}
                  {agentMode === "plan" &&
                    !isBusyCurrent &&
                    m.text &&
                    m.id === messages[messages.length - 1]?.id && (
                      <div className="plan-proceed-wrap">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm plan-proceed-btn"
                          onClick={() => {
                            send(t.chat.planProceedPrompt, "act");
                          }}
                          title={t.chat.planProceedHint}
                        >
                          <Rocket size={12} />
                          <span>{t.chat.planProceed}</span>
                        </button>
                        <span className="small muted">{t.chat.planProceedHint}</span>
                      </div>
                    )}
                </>
              ) : (
                <div className="msg-text">{m.text}</div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} className="chat-scroll-anchor" style={{ height: 1, minHeight: 1, flexShrink: 0 }} />
      </div>

      {attachments.length > 0 && (
        <div className="attachment-bar">
          {attachments.map((a) => (
            <span key={a.id} className="attachment-chip" title={a.name}>
              {a.kind === "image" ? <ImageIcon size={11} /> : <FileText size={11} />}
              <span>{a.name}</span>
              <button
                className="chip-remove"
                onClick={() =>
                  setAttachments((x) => x.filter((y) => y.id !== a.id))
                }
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {showScrollBottom && (
        <button
          type="button"
          className="chat-scroll-bottom-pill"
          onClick={() => {
            isAutoScrollEnabled.current = true;
            scrollToBottom(true);
            setShowScrollBottom(false);
          }}
          title={t.chat.scrollToBottom}
        >
          <ChevronDown size={13} />
          <span>{t.chat.lastMessage}</span>
          {busy && <span className="scroll-btn-pulse-dot" />}
        </button>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {mention && (
          <div className="mention-pop" ref={mentionListRef}>
            {mention.results.length === 0 ? (
              <div className="mention-empty font-mono">Sin coincidencias para "@{mention.query}"</div>
            ) : (
              mention.results.map((p, idx) => {
                const { fileName, dir, ext } = formatPathDisplay(p);
                return (
                  <div
                    key={p}
                    className={`mention-item ${idx === mentionIndex ? "selected" : ""}`}
                    onClick={() => pickMention(p)}
                    onMouseEnter={() => setMentionIndex(idx)}
                  >
                    <div className="mention-icon-wrap">{getMentionIcon(ext)}</div>
                    <div className="mention-info">
                      <span className="mention-filename font-mono">{fileName}</span>
                      {dir && <span className="mention-dir font-mono">{dir}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            handleInputChange(
              e.target.value,
              e.target.selectionStart ?? e.target.value.length,
            );
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.items)
              .filter((i) => i.kind === "file")
              .map((i) => i.getAsFile())
              .filter((f): f is File => f !== null);
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          placeholder={
            !config.model
              ? t.chat.selectModelFirst
              : agentMode === "plan"
              ? t.chat.inputPlaceholderPlan
              : t.chat.inputPlaceholderAct
          }
          rows={3}
          disabled={!config.model || busy}
          onKeyDown={handleKeyDown}
        />

        {/* Bottom Toolbar inside the chat input container */}
        <div className="chat-input-toolbar">
          <div className="chat-toolbar-left">
            {/* Model Selector Dropdown Button */}
            <div className="chat-model-btn-wrap" ref={modelMenuRef}>
              <button
                type="button"
                className={`chat-pill-btn model-pill ${modelMenuOpen ? "active" : ""}`}
                onClick={() => setModelMenuOpen((v) => !v)}
                title={(activeModel || config.model) ? `${t.chat.selectModel}: ${activeModel || config.model}` : t.chat.selectModelFirst}
              >
                <Cpu size={11} className="text-cyan" />
                <span className="chat-model-name font-mono">{(activeModel || config.model)?.replace(/^models\//, "") || t.chat.selectModel}</span>
                <ChevronDown size={10} className={`text-muted chat-model-chevron ${modelMenuOpen ? "rotated" : ""}`} />
              </button>

              {/* Enhanced Model Dropdown Popover */}
              {modelMenuOpen && (
                <div className="chat-model-popover">
                  <div className="chat-model-search-wrap">
                    <Search size={12} className="chat-model-search-icon" />
                    <input
                      type="text"
                      className="chat-model-search font-mono"
                      placeholder={t.chat.filterModels}
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="chat-model-list">
                    {models.length === 0 ? (
                      <div className="chat-model-empty font-mono">{t.chat.noModels}</div>
                    ) : filteredModels.length === 0 ? (
                      <div className="chat-model-empty font-mono">{t.chat.noMatches}</div>
                    ) : (
                      filteredModels.map((m) => {
                        const isCurrent = m === (activeModel || config.model);
                        return (
                          <button
                            key={m}
                            type="button"
                            className={`chat-model-item ${isCurrent ? "selected" : ""}`}
                            onClick={() => {
                              onSelectModel?.(m);
                              setModelMenuOpen(false);
                              setModelSearch("");
                            }}
                          >
                            <div className="chat-model-item-main">
                              <Cpu size={11} className={isCurrent ? "text-cyan" : "text-muted"} />
                              <span className="chat-model-item-name font-mono">{m.replace(/^models\//, "")}</span>
                            </div>
                            {isCurrent && <Check size={12} className="text-cyan" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Mode Switcher Pill */}
            {onToggleMode && (
              <button
                type="button"
                className={`chat-pill-btn mode-pill ${agentMode === "plan" ? "plan-active" : "act-active"}`}
                onClick={() => onToggleMode(agentMode === "plan" ? "act" : "plan")}
                title={agentMode === "plan" ? t.chat.planModeHint : t.chat.actModeHint}
              >
                {agentMode === "plan" ? <ScrollText size={10} /> : <Zap size={10} />}
                <span>{agentMode === "plan" ? t.chat.planMode : t.chat.actMode}</span>
              </button>
            )}

            {/* Thinking Level Switcher Pill (Only for models supporting reasoning) */}
            {onSelectThinkingLevel && isModelReasoningSupported(config.model) && (
              <button
                type="button"
                className="chat-pill-btn thinking-pill"
                onClick={() => {
                  const levels: ThinkingLevel[] = ["low", "medium", "high"];
                  const nextIdx = (levels.indexOf(thinkingLevel) + 1) % levels.length;
                  onSelectThinkingLevel(levels[nextIdx]);
                }}
                title={`${t.chat.thinkingLevelHint}: ${thinkingLevel}`}
              >
                <FlaskConical size={10} className="text-purple" />
                <span style={{ textTransform: "capitalize" }}>{thinkingLevel}</span>
              </button>
            )}

            {/* Attach File Button & Dropdown */}
            <div className="chat-attach-btn-wrap" ref={attachMenuRef}>
              <button
                type="button"
                className={`chat-pill-btn ${attachMenuOpen ? "active" : ""}`}
                onClick={() => setAttachMenuOpen((v) => !v)}
                title={t.chat.attachHint}
              >
                <Paperclip size={10} className="text-cyan" />
                <span>{t.chat.attach}</span>
              </button>

              {attachMenuOpen && (
                <div className="chat-attach-popover">
                  <button
                    type="button"
                    className="chat-attach-item"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      setInput((prev) => prev + (prev.endsWith(" ") || !prev ? "@" : " @"));
                      handleInputChange(
                        input + (input.endsWith(" ") || !input ? "@" : " @"),
                        (input + (input.endsWith(" ") || !input ? "@" : " @")).length,
                      );
                      setTimeout(() => textareaRef.current?.focus(), 50);
                    }}
                  >
                    <Folder size={14} className="text-cyan" />
                    <div className="chat-attach-text">
                      <span className="attach-item-title">{t.chat.attachWorkspaceTitle}</span>
                      <span className="attach-item-sub">{t.chat.attachWorkspaceSub}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="chat-attach-item"
                    onClick={async () => {
                      setAttachMenuOpen(false);
                      try {
                        const picked = await pickFiles();
                        if (picked && picked.length > 0) {
                          for (const p of picked) {
                            await addLocalFilePath(p);
                          }
                        }
                      } catch (e) {
                        console.warn("pick files:", e);
                      }
                    }}
                  >
                    <UploadCloud size={14} className="text-purple" />
                    <div className="chat-attach-text">
                      <span className="attach-item-title">{t.chat.attachSystemTitle}</span>
                      <span className="attach-item-sub">{t.chat.attachSystemSub}</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="chat-toolbar-right">
            {messages.length > 0 && (
              <button
                type="button"
                className="icon-btn-micro"
                onClick={clearChat}
                disabled={busy}
                title={t.chat.clearChat}
              >
                <Trash2 size={11} />
              </button>
            )}

            {busy ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => cancelTurn(sessionId)}
                title={t.chat.stop}
              >
                <Square size={11} />
                <span>{t.chat.stop}</span>
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                type="submit"
                disabled={busy || !ready}
                title={`${t.chat.send} (Enter)`}
              >
                <Send size={11} />
                <span>{t.chat.send}</span>
              </button>
            )}
          </div>
        </div>
      </form>


    </section>
  );
}
