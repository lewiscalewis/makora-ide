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
} from "lucide-react";


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

interface ChatProps {
  config: ChatConfig;
  ready: boolean;
  folders: string[];
  skillsContent: string;
  thinkingLevel: ThinkingLevel;
  includeWorkspace: boolean;
  visionEnabled: boolean;
  blocked: boolean;
  blockReason: string;
  agentMode?: AgentMode;
  onToggleMode?: (mode: AgentMode) => void;
  onUsage: (usage: ChatUsage) => void;
  onApplyArtifact: (path: string, content: string) => void;
  onStatusChange?: (busy: boolean, runningToolName: string | null) => void;
  onClearSessionTrigger?: () => void;
}

export default function Chat({
  config,
  ready,
  folders,
  skillsContent,
  thinkingLevel,
  includeWorkspace,
  visionEnabled,
  blocked,
  blockReason,
  agentMode = "act",
  onToggleMode,
  onUsage,
  onApplyArtifact,
  onStatusChange,
}: ChatProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [thinking, setThinking] = useState<{ id: number; text: string } | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mention, setMention] = useState<{
    query: string;
    start: number;
    results: string[];
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [projectRules, setProjectRules] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const mentionTimer = useRef<number | null>(null);
  const lastAttachmentId = useRef<number>(0);
  const currentAssistantId = useRef<number>(0);
  const isAutoScrollEnabled = useRef<boolean>(true);

  const runningTool = activities.find((a) => a.ok === null);

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
  }, [messages, activities, thinking]);

  useEffect(() => {
    const fns: Array<() => void> = [];
    listen<ToolStart>("tool-start", (e) => {
      const t = e.payload;
      setActivities((a) => [
        ...a,
        { id: t.id, name: t.name, arguments: t.arguments, log: "", ok: null },
      ]);
    }).then((f) => fns.push(f));
    listen<ToolOutputEvent>("tool-output", (e) => {
      const t = e.payload;
      setActivities((a) =>
        a.map((x) => (x.id === t.id ? { ...x, log: x.log + t.data } : x)),
      );
    }).then((f) => fns.push(f));
    listen<ToolEnd>("tool-end", (e) => {
      const t = e.payload;
      setActivities((a) =>
        a.map((x) =>
          x.id === t.id ? { ...x, ok: t.ok, log: x.log || t.summary } : x,
        ),
      );
    }).then((f) => fns.push(f));
    listen<{ text: string }>("thinking-delta", (e) => {
      setThinking((t) => ({
        id: t?.id ?? currentAssistantId.current,
        text: (t?.text ?? "") + e.payload.text,
      }));
    }).then((f) => fns.push(f));
    return () => fns.forEach((f) => f());
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

  const addFiles = (files: File[]) => {
    files.forEach((f) => {
      const id = ++lastAttachmentId.current + Date.now();
      if (f.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((a) => [
            ...a,
            { id, name: f.name, kind: "image", dataUrl: String(reader.result ?? "") },
          ]);
        };
        reader.readAsDataURL(f);
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
    setMessages([]);
    setTranscript([]);
    setActivities([]);
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
    setActivities([]);
    setThinking(null);
    isAutoScrollEnabled.current = true;

    const userMsg: ChatMessage = { role: "user", content, images };
    const newTranscript = [...transcript, userMsg];
    setTranscript(newTranscript);

    const userDisplayId = Date.now();
    const assistantId = userDisplayId + 1;
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
      const finalText =
        result.messages
          .filter((m) => m.role === "assistant")
          .map((m) => m.content)
          .pop() ?? "";
      setMessages((m) =>
        m.map((x) =>
          x.id === assistantId ? { ...x, text: acc || finalText || "(sin respuesta)" } : x,
        ),
      );
    } catch (err) {
      const errText = `Error: ${err}`;
      setMessages((m) =>
        m.map((x) =>
          x.id === assistantId
            ? { ...x, text: acc ? `${acc}\n\n⚠️ ${errText}` : errText }
            : x,
        ),
      );
    } finally {
      unlistenDelta();
      setBusy(false);
    }
  };

  const applyArtifact = (path: string, content: string) => {
    onApplyArtifact(path, content);
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
              {runningTool ? `Ejecutando ${runningTool.name}` : "Pensando..."}
            </span>
          ) : (
            <span className="chat-badge-ready">
              <span className="idle-dot" />
              {ready ? "Sesión activa" : "Sin conexión"}
            </span>
          )}

          {projectRules && (
            <span className="rules-active-badge" title="Reglas del repositorio detectadas e inyectadas">
              <ScrollText size={10} />
              <span>Reglas Activas</span>
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
              <span>Acción</span>
            </button>
            <button
              className={`mode-pill ${agentMode === "plan" ? "active" : ""}`}
              onClick={() => onToggleMode?.("plan")}
              title="Modo Plan: El agente genera un plan y pide aprobación antes de escribir"
            >
              <ScrollText size={10} />
              <span>Plan</span>
            </button>
          </div>
        </div>

        <div className="chat-top-actions">
          <button
            className="chat-header-btn"
            onClick={triggerAutoTestAndRepair}
            title="Lanza la suite de tests del proyecto y auto-corrige fallos"
          >
            <FlaskConical size={11} />
            <span>Auto-Test</span>
          </button>
          {messages.length > 0 && (
            <>
              <button
                className="chat-header-btn"
                onClick={copyTranscript}
                title="Copiar toda la conversación"
              >
                {copiedTranscript ? <Check size={11} /> : <Copy size={11} />}
                <span>{copiedTranscript ? "Copiado" : "Copiar"}</span>
              </button>
              <button
                className="chat-header-btn"
                onClick={exportMarkdown}
                title="Descargar conversación en formato Markdown"
              >
                <Download size={11} />
                <span>Exportar</span>
              </button>
              <button
                className="chat-header-btn"
                onClick={clearChat}
                disabled={busy}
                title="Vaciar chat y comenzar un nuevo turno"
              >
                <Trash2 size={11} />
                <span>Limpiar</span>
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
            <p className="chat-empty-title">MakoraIDE · Desarrollo Agéntico</p>
            <p className="chat-empty-sub">
              {ready
                ? `Modo actual: ${agentMode === "plan" ? "📋 Planificación (Pide aprobación)" : "⚡ Acción directa"}. Usa @ para archivos o Ctrl+P para comandos.`
                : "Conecta un proveedor en el panel derecho o abre el Asistente de Inicio para comenzar."}
            </p>
            <div className="chat-quickstart-actions">
              <button className="btn btn-subtle" onClick={triggerAutoTestAndRepair}>
                🧪 Ejecutar Auto-Tests y Reparar
              </button>
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={"msg msg-" + m.role}>
            <div className="msg-role">{m.role === "user" ? "Tú" : "Makora"}</div>
            {m.role === "assistant" && m.text ? (
              <>
                {thinking && thinking.id === m.id && (
                  <details className="thinking">
                    <summary>🧠 Pensamiento del modelo</summary>
                    <div className="thinking-body">{thinking.text}</div>
                  </details>
                )}
                <Markdown text={m.text} onApplyArtifact={applyArtifact} />
              </>
            ) : (
              <div className="msg-text">
                {m.text || (m.role === "assistant" ? "…" : "")}
              </div>
            )}
          </div>
        ))}
        {activities.length > 0 && (
          <details
            className="agent-activity"
            open={busy && runningTool !== undefined}
          >
            <summary>
              <span className="activity-icon">{runningTool ? "⚙" : "✓"}</span>
              <span className="activity-title">
                {runningTool
                  ? `Ejecutando ${runningTool.name}…`
                  : `${activities.length} herramienta${activities.length === 1 ? "" : "s"} usada${activities.length === 1 ? "" : "s"}`}
              </span>
              {runningTool && (
                <span className="activity-args">
                  {runningTool.arguments.slice(0, 80)}
                </span>
              )}
            </summary>
            <div className="activity-list">
              {activities.map((a) => (
                <div key={a.id} className="activity-item">
                  <div className="activity-item-header">
                    <span
                      className={
                        "activity-item-icon " +
                        (a.ok === null ? "run" : a.ok ? "ok" : "err")
                      }
                    >
                      {a.ok === null ? "⚙" : a.ok ? "✓" : "✗"}
                    </span>
                    <code className="activity-item-name">{a.name}</code>
                    <span className="activity-item-args">
                      {a.arguments.slice(0, 100)}
                    </span>
                  </div>
                  {a.log && (
                    <div className="activity-log-wrap">
                      <pre className="activity-log">{a.log.slice(-3000)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
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
              ? `[Modo ${agentMode === "plan" ? "Plan" : "Acción"}] Instrucción para Makora… (@ para archivos)`
              : "Conecta un proveedor en el panel derecho primero"
          }
          rows={3}
          disabled={!ready}
          onKeyDown={handleKeyDown}
        />
        <div className="chat-actions">
          {busy && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => chatCancel()}
              title="Detener el turno actual"
            >
              <Square size={11} />
              <span>Detener</span>
            </button>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !ready}
            title="Enviar mensaje (Enter)"
          >
            <Send size={11} />
            <span>{busy ? "Pensando…" : "Enviar"}</span>
          </button>
        </div>
      </form>

    </section>
  );
}
