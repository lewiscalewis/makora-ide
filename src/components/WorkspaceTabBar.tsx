import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { ChatSession } from "../types";
import { useI18n } from "../i18n";
import { playClick, playToggle } from "../sounds";
import ContextMenu, { type ContextMenuState } from "./ContextMenu";

interface WorkspaceTabBarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
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
  onRenameSession,
  runningSessionIds = new Set(),
}: WorkspaceTabBarProps) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const commitRename = () => {
    const next = editValue.trim();
    if (editingId && next) onRenameSession(editingId, next);
    setEditingId(null);
  };

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
              onClick={() => {
                if (editingId !== sess.id) {
                  playClick();
                  onSelectSession(sess.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setEditingId(null);
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    {
                      label: t.common.rename,
                      onSelect: () => {
                        setEditValue(sess.title || "");
                        setEditingId(sess.id);
                      },
                    },
                    {
                      label: t.common.close,
                      danger: true,
                      onSelect: () => onCloseSession(sess.id),
                    },
                  ],
                });
              }}
              title={editingId === sess.id ? undefined : title}
            >
              <div className="workspace-tab-status">
                {isRunning ? (
                  <span className="status-dot running" title={t.workspace.runningBackground} />
                ) : (
                  <span className="status-dot idle" />
                )}
              </div>

              {editingId === sess.id ? (
                <input
                  autoFocus
                  className="workspace-tab-rename-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="workspace-tab-title">{title}</span>
              )}

              {sessions.length > 1 && (
                <button
                  type="button"
                  className="workspace-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    playClick();
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
        onClick={() => { playToggle(); onNewSession(); }}
        title={t.workspace.newSessionTooltip}
      >
        <Plus size={14} />
      </button>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
