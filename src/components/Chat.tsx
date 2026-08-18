import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  chat,
  chatCancel,
  detectProjectRules,
  searchPaths,
  workspaceSummary,
} from "../api";
import Markdown from "./Markdown";
import {
  Zap,
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
  X,
  ChevronDown,
  Search,
  Plus,
} from "lucide-react";
import { useI18n } from "../i18n";



import type {
  AgentMode,
  Attachment,
  ChatConfig,
  ChatMessage,
  ChatUsage,
  ThinkingLevel,
  ToolActivity,
  ToolEnd,
  ToolOutputEvent,
  ToolStart,
  UiMessage,
} from "../types";

function transcriptToUi(transcript: ChatMessage[]): UiMessage[] {
  const out: UiMessage[] = [];
  let id = 0;
  let currentAssistant: UiMessage | null = null;

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
        currentAssistant = {
          id: ++id,
          role: "assistant",
          text: m.content || "",
          activities: [],
        };
      } else if (m.content) {
        currentAssistant.text = m.content;
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
    out.push(currentAssistant);
  }

  return out;
}

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
}: {
  activity: ToolActivity;
  copied: boolean;
  onCopyLog: (log: string) => void;
}) {
  const [open, setOpen] = useState(activity.ok === null);
  const isRunning = activity.ok === null;
  const isErr = activity.ok === false;
  const title = getAntigravityToolTitle(activity);

  useEffect(() => {
    if (isRunning) setOpen(true);
  }, [isRunning]);

  const outputLog = activity.log || (isRunning ? "Ejecutando..." : "Completado sin salida.");

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
              title="Copiar resultado"
            >
              {copied ? (
                <>
                  <Check size={11} className="text-green" />
                  <span>Copiado</span>
                </>
              ) : (
                <>
                  <Copy size={11} />
                  <span>Copiar</span>
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
  const runningTool = activities.find((a) => a.ok === null);
  const isRunning = Boolean(runningTool);
  const hasFailed = activities.some((a) => a.ok === false);
  const [open, setOpen] = useState(isRunning);

  useEffect(() => {
    if (isRunning) {
      setOpen(true);
    }
  }, [isRunning]);

  const count = activities.length;
  const summary = isRunning
    ? `Ejecutando ${runningTool!.name}...`
    : count === 1
      ? getAntigravityToolTitle(activities[0])
      : `${count} herramientas ejecutadas (${summarizeToolNames(activities)})`;

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
          {isStreaming ? "Razonando..." : `Razonamiento interno (${wordCount} palabras)`}
        </span>
        <ChevronDown size={11} className="ag-meta-chevron" />
      </summary>
      <div className="ag-meta-content">
        <pre className="ag-thinking-pre font-mono">{text}</pre>
      </div>
    </details>
  );
}

interface ChatProps {
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
  models?: string[];
  activeModel?: string;
  onSelectModel?: (model: string) => void;
  onUsage: (usage: ChatUsage) => void;
  onApplyArtifact: (path: string, content: string) => void;
  onStatusChange?: (busy: boolean, runningToolName: string | null) => void;
  onClearSessionTrigger?: () => void;
  initialTranscript?: ChatMessage[];
  onTranscriptChange?: (messages: ChatMessage[]) => void;
}

export default function Chat({
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
  models = [],
  activeModel,
  onSelectModel,
  onUsage,
  onApplyArtifact,
  onStatusChange,
  onClearSessionTrigger,
  initialTranscript = [],
  onTranscriptChange,
}: ChatProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<UiMessage[]>(() =>
    transcriptToUi(initialTranscript),
  );
  const [transcript, setTranscript] = useState<ChatMessage[]>(initialTranscript);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnActivities, setTurnActivities] = useState<Record<number, ToolActivity[]>>({});
  const [thinking, setThinking] = useState<{ id: number; text: string } | null>(null);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
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

  const modelMenuRef = useRef<HTMLDivElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const mentionTimer = useRef<number | null>(null);
  const lastAttachmentId = useRef<number>(0);
  const currentAssistantId = useRef<number>(0);
  const isAutoScrollEnabled = useRef<boolean>(true);
  const idCounter = useRef<number>(initialTranscript.length);
  const didHydrate = useRef<boolean>(false);

  const nextId = () => {
    idCounter.current += 1;
    return idCounter.current;
  };

  // Close model menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    if (modelMenuOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [modelMenuOpen]);

  const filteredModels = models.filter((m) =>
    m.toLowerCase().includes(modelSearch.toLowerCase())
  );

  const currentTurnActivities = turnActivities[currentAssistantId.current] ?? [];
  const runningTool = currentTurnActivities.find((a) => a.ok === null);


  useEffect(() => {
    onStatusChange?.(busy, runningTool ? runningTool.name : null);
  }, [busy, runningTool, onStatusChange]);

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

  const scrollToBottom = (smooth = true) => {
    if (!messagesContainerRef.current) return;
    const el = messagesContainerRef.current;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  };

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    isAutoScrollEnabled.current = scrollHeight - (scrollTop + clientHeight) < 60;
  };

  useEffect(() => {
    if (isAutoScrollEnabled.current) {
      scrollToBottom(false);
    }
  }, [messages, turnActivities, thinking]);

  // Persist transcript changes upward once hydration has settled.
  useEffect(() => {
    if (!didHydrate.current) {
      didHydrate.current = true;
      return;
    }
    onTranscriptChange?.(transcript);
  }, [transcript, onTranscriptChange]);

  useEffect(() => {
    let disposed = false;
    const fns: Array<() => void> = [];
    const addListener = <T,>(event: string, handler: (payload: T) => void) => {
      listen<T>(event, (e) => {
        if (!disposed) handler(e.payload);
      }).then((unlisten) => {
        if (disposed) unlisten();
        else fns.push(unlisten);
      });
    };
    addListener<ToolStart>("tool-start", (t) => {
      const targetId = currentAssistantId.current;
      setTurnActivities((map) => ({
        ...map,
        [targetId]: [
          ...(map[targetId] ?? []),
          { id: t.id, name: t.name, arguments: t.arguments, log: "", ok: null },
        ],
      }));
    });
    addListener<ToolOutputEvent>("tool-output", (t) => {
      const targetId = currentAssistantId.current;
      setTurnActivities((map) => ({
        ...map,
        [targetId]: (map[targetId] ?? []).map((x) =>
          x.id === t.id ? { ...x, log: x.log + t.data } : x,
        ),
      }));
    });
    addListener<ToolEnd>("tool-end", (t) => {
      const targetId = currentAssistantId.current;
      setTurnActivities((map) => ({
        ...map,
        [targetId]: (map[targetId] ?? []).map((x) =>
          x.id === t.id ? { ...x, ok: t.ok, log: x.log || t.summary } : x,
        ),
      }));
    });
    addListener<{ text: string }>("thinking-delta", (d) => {
      setThinking((t) => ({
        id: t?.id ?? currentAssistantId.current,
        text: (t?.text ?? "") + d.text,
      }));
    });
    return () => {
      disposed = true;
      fns.forEach((f) => f());
    };
  }, []);

  const buildSystem = async (): Promise<string> => {
    let sys =
      "Eres Makora, un asistente de desarrollo agéntico integrado en MakoraIDE. " +
      "Trabajas sobre los archivos del workspace que se te muestran. " +
      "Cuando necesites varias herramientas, llámalas todas en el mismo turno. " +
      "Si una ruta no existe, inspecciona la raíz del workspace con list_dir. " +
      "Al terminar la tarea responde SIEMPRE con un texto final, aunque hayas usado herramientas. " +
      "Cuando generes archivos de código completos, usa bloques con el formato ```lenguaje:ruta/del/archivo " +
      "para que el usuario pueda aplicarlos al workspace con un clic. " +
      thinkingNudge(thinkingLevel);

    if (agentMode === "plan") {
      sys +=
        "\n\n## MODO DE PLANIFICACIÓN ACTIVO (PLAN MODE):\n" +
        "El usuario ha activado el MODO PLAN. En este modo está ESTRICTAMENTE PROHIBIDO crear, editar o borrar archivos directamente con write_file o apply_patch, o ejecutar comandos bash destructivos. Tu objetivo es:\n" +
        "1. Inspeccionar y analizar el código relevante usando read_file, read_file_range o grep.\n" +
        "2. Formular un Plan de Implementación estructurado con el desglose de cambios, archivos a crear o modificar, y posibles riesgos.\n" +
        "3. Pedir la aprobación explícita del usuario antes de proceder a la ejecución.";
    }

    if (projectRules) {
      sys += "\n\n" + projectRules;
    }

    if (skillsContent.trim()) {
      sys += "\n\n## Skills (instrucciones del usuario)\n" + skillsContent;
    }

    if (includeWorkspace && folders.length > 0) {
      sys += "\n\n## Workspace activo (rutas raíz)\n" + folders.join("\n");
      try {
        const summary = await workspaceSummary(folders);
        sys +=
          "\n\n## Estructura del workspace (directorios y archivos)\n" + summary;
      } catch {
        /* ignore */
      }
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

  const pickMention = (path: string) => {
    if (!mention) return;
    const clean = path.replace(/\\/g, "/");
    const next =
      input.slice(0, mention.start) +
      "@" +
      clean +
      " " +
      input.slice(mention.start + mention.query.length + 1);
    setInput(next);
    setMention(null);
    setTimeout(() => textareaRef.current?.focus(), 20);
  };

  const clearChat = () => {
    if (busy) return;
    if (onClearSessionTrigger) {
      onClearSessionTrigger();
      return;
    }
    setMessages([]);
    setTranscript([]);
    setTurnActivities({});
    setThinking(null);
    setAttachments([]);
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

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy || !ready) return;
    if (blocked) {
      setMessages((m) => [
        ...m,
        { id: Date.now(), role: "assistant", text: `⛔ ${blockReason}` },
      ]);
      return;
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
      setMessages((m) => [
        ...m,
        {
          id: Date.now(),
          role: "assistant",
          text: `🖼 El modelo ${config.model} no soporta imágenes: se guardarán como archivo temporal y el agente verá la ruta de referencia. Activa "Visión" en ⚙ → Modelos si usas un modelo multimodal.`,
        },
      ]);
    }
    const images = imageAtts.map((a) => a.dataUrl ?? "");

    setInput("");
    setMention(null);
    setAttachments([]);

    if (!content.trim() && images.length === 0) {
      return;
    }

    setBusy(true);
    setThinking(null);
    isAutoScrollEnabled.current = true;

    const userMsg: ChatMessage = { role: "user", content, images };
    const newTranscript = [...transcript, userMsg];
    setTranscript(newTranscript);

    const userDisplayId = nextId();
    const assistantId = nextId();
    currentAssistantId.current = assistantId;
    setMessages((m) => [
      ...m,
      { id: userDisplayId, role: "user", text: text || "(adjuntos)" },
      { id: assistantId, role: "assistant", text: "" },
    ]);

    let acc = "";
    const unlistenDelta = await listen<{ text: string }>("chat-delta-event", (e) => {
      acc += e.payload.text;
      setMessages((m) =>
        m.map((x) => (x.id === assistantId ? { ...x, text: acc } : x)),
      );
    });

    try {
      const system = await buildSystem();
      const result = await chat(config, system, newTranscript, folders);
      onUsage(result);
      setTranscript(result.messages);
      const uiMsgs = transcriptToUi(result.messages);
      const finalText =
        result.messages
          .filter((m) => m.role === "assistant")
          .map((m) => m.content)
          .pop() ?? "";
      if (uiMsgs.length > 0 && uiMsgs[uiMsgs.length - 1].role === "assistant") {
        uiMsgs[uiMsgs.length - 1].text = acc || finalText || uiMsgs[uiMsgs.length - 1].text || "(sin respuesta)";
      }
      setMessages(uiMsgs);
    } catch (err) {
      const errText = `Error: ${err}`;
      const finalErr = acc ? `${acc}\n\n⚠️ ${errText}` : errText;
      setTranscript((t) => [...t, { role: "assistant", content: finalErr }]);
      setMessages((m) =>
        m.map((x) => (x.id === assistantId ? { ...x, text: finalErr } : x)),
      );
    } finally {
      unlistenDelta();
      setBusy(false);
    }
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
              {runningTool ? `${t.chat.toolsRunning} ${runningTool.name}` : t.chat.thinkingStreaming}
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
              title="Modo Acción: El agente analiza y aplica ediciones directamente"
            >
              <Zap size={10} />
              <span>{t.chat.actMode}</span>
            </button>
            <button
              className={`mode-pill ${agentMode === "plan" ? "active" : ""}`}
              onClick={() => onToggleMode?.("plan")}
              title="Modo Plan: El agente genera un plan y pide aprobación antes de escribir"
            >
              <ScrollText size={10} />
              <span>{t.chat.planMode}</span>
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
          const isCurrentAssistant = m.role === "assistant" && m.id === currentAssistantId.current;
          const isBusyCurrent = isCurrentAssistant && busy;
          const thinkingText = (isCurrentAssistant && thinking?.text) || m.thinking || "";
          const hasThinking = thinkingText.trim().length > 0;
          const liveActivities = m.role === "assistant" ? turnActivities[m.id] ?? [] : [];
          const allActivities = liveActivities.length > 0 ? liveActivities : (m.activities ?? []);
          const runningToolInMsg = isBusyCurrent ? allActivities.find((a) => a.ok === null) : undefined;

          return (
            <div key={m.id} className={"msg msg-" + m.role}>
              <div className="msg-header">
                <div className="msg-header-left">
                  <span className={`msg-role-badge ${m.role === "user" ? "user-badge" : "makora-badge"}`}>
                    {m.role === "user" ? `👤 ${t.chat.you}` : `⚔️ ${t.chat.assistant}`}
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
                    <div className="msg-text muted font-mono">(sin contenido)</div>
                  )}
                </>
              ) : (
                <div className="msg-text">{m.text}</div>
              )}
            </div>
          );
        })}
      </div>



      {mention && (
        <div className="mention-pop">
          {mention.results.length === 0 && (
            <div className="muted small">Sin coincidencias</div>
          )}
          {mention.results.map((p, idx) => (
            <div
              key={p}
              className={`mention-item ${idx === mentionIndex ? "selected" : ""}`}
              onClick={() => pickMention(p)}
              onMouseEnter={() => setMentionIndex(idx)}
            >
              <FileText size={11} className="mention-icon" />
              <span className="mention-text">{p}</span>
            </div>
          ))}
        </div>
      )}

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
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) =>
            handleInputChange(
              e.currentTarget.value,
              e.currentTarget.selectionStart ?? e.currentTarget.value.length,
            )
          }
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
            ready
              ? (agentMode === "plan" ? t.chat.inputPlaceholderPlan : t.chat.inputPlaceholderAct)
              : t.chat.selectModelFirst
          }
          rows={3}
          disabled={!ready}
          onKeyDown={handleKeyDown}
        />

        {/* Dynamic In-Chat Bottom Toolbar */}
        <div className="chat-input-toolbar">
          <div className="chat-toolbar-left">
            {/* Custom Makora Model Picker Combobox */}
            <div className="custom-model-picker-wrap" ref={modelMenuRef}>
              <button
                type="button"
                className={`model-picker-trigger ${modelMenuOpen ? "active" : ""}`}
                onClick={() => setModelMenuOpen((v) => !v)}
                title={`${t.chat.selectModel} (Click)`}
              >
                <Zap size={11} className="model-picker-icon text-cyan" />
                <span className="model-picker-name font-mono">
                  {activeModel || config.model || t.chat.selectModel}
                </span>
                <ChevronDown size={11} className={`model-chevron ${modelMenuOpen ? "rotated" : ""}`} />
              </button>

              {modelMenuOpen && (
                <div className="model-picker-popover">
                  {models.length > 5 && (
                    <div className="model-search-wrap">
                      <Search size={11} className="model-search-icon" />
                      <input
                        type="text"
                        className="model-search-input"
                        placeholder={t.chat.filterModels}
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}

                  <div className="model-options-list">
                    {filteredModels.length === 0 ? (
                      <div className="model-option-empty">
                        <span>{models.length === 0 ? t.chat.noModels : t.chat.noMatches}</span>
                      </div>
                    ) : (
                      filteredModels.map((m) => {
                        const isSelected = (activeModel || config.model) === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            className={`model-option-item ${isSelected ? "selected" : ""}`}
                            onClick={() => {
                              onSelectModel?.(m);
                              setModelMenuOpen(false);
                            }}
                          >
                            <div className="model-option-left">
                              <Zap size={11} className={isSelected ? "text-cyan" : "opacity-50"} />
                              <span className="model-option-label font-mono">{m}</span>
                            </div>
                            {isSelected && <Check size={12} className="text-cyan" />}
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
                title={agentMode === "plan" ? "Modo Plan: Diseña e investiga" : "Modo Acción: Edita código directamente"}
              >
                {agentMode === "plan" ? <ScrollText size={10} /> : <Zap size={10} />}
                <span>{agentMode === "plan" ? "Plan" : "Act"}</span>
              </button>
            )}

            {/* Thinking Level Switcher Pill */}
            {onSelectThinkingLevel && (
              <button
                type="button"
                className="chat-pill-btn thinking-pill"
                onClick={() => {
                  const levels: ThinkingLevel[] = ["none", "low", "medium", "high"];
                  const nextIdx = (levels.indexOf(thinkingLevel) + 1) % levels.length;
                  onSelectThinkingLevel(levels[nextIdx]);
                }}
                title={`Nivel de pensamiento API: ${thinkingLevel} (Clic para cambiar)`}
              >
                <FlaskConical size={10} className="text-purple" />
                <span style={{ textTransform: "capitalize" }}>{thinkingLevel}</span>
              </button>
            )}
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
                onClick={() => chatCancel()}
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
