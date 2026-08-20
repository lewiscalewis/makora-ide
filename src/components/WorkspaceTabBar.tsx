import { Plus, X, ExternalLink } from "lucide-react";
import { openSessionWindow } from "../api";
import type { ChatSession } from "../types";
import { useI18n } from "../i18n";

interface WorkspaceTabBarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  runningSessionIds?: Set<string>;
}

const DEFAULT_SESSION_TITLES = new Set([
  "Nueva Conversación",
  "Nueva Sesión",
  "New Chat",
  "New Conversation",
  "新建会话",
  "新建对话",
  "Neues Gespräch",
  "Neuer Chat",
  "Nouvelle Discussion",
  "Nouveau Chat",
  "Nuova Conversazione",
  "Nuova chat",
  "Nova Conversa",
  "Novo Chat",
]);

export default function WorkspaceTabBar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onCloseSession,
  runningSessionIds = new Set(),
}: WorkspaceTabBarProps) {
  const { t } = useI18n();

  return (
    <div className="workspace-tab-bar">
      <div className="workspace-tabs-scroll">
        {sessions.map((sess) => {
          const isActive = sess.id === activeSessionId;
          const isRunning = runningSessionIds.has(sess.id);
          const isDefault = !sess.title || DEFAULT_SESSION_TITLES.has(sess.title);
          const title = isDefault ? t.chat.newConversation : sess.title;

          return (
            <div
              key={sess.id}
              className={`workspace-tab ${isActive ? "active" : ""}`}
              onClick={() => onSelectSession(sess.id)}
              title={title}
            >
              <div className="workspace-tab-status">
                {isRunning ? (
                  <span className="status-dot running" title={t.workspace.runningBackground} />
                ) : (
                  <span className="status-dot idle" />
                )}
              </div>

              <span className="workspace-tab-title">{title}</span>

                            <button
                type="button"
                className="workspace-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  openSessionWindow(sess.id, title).catch(console.error);
                }}
                title="Desacoplar a ventana independiente"
              >
                <ExternalLink size={11} />
              </button>
              {sessions.length > 1 && (
                <button
                  type="button"
                  className="workspace-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseSession(sess.id);
                  }}
                  title={t.workspace.closeSession}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="workspace-tab-add"
        onClick={onNewSession}
        title={t.workspace.newSessionTooltip}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
