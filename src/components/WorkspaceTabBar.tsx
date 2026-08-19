import { Plus, X } from "lucide-react";
import type { ChatSession } from "../types";

interface WorkspaceTabBarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  runningSessionIds?: Set<string>;
}

export default function WorkspaceTabBar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onCloseSession,
  runningSessionIds = new Set(),
}: WorkspaceTabBarProps) {

  return (
    <div className="workspace-tab-bar">
      <div className="workspace-tabs-scroll">
        {sessions.map((sess) => {
          const isActive = sess.id === activeSessionId;
          const isRunning = runningSessionIds.has(sess.id);
          const title = sess.title || "Nueva Sesión";

          return (
            <div
              key={sess.id}
              className={`workspace-tab ${isActive ? "active" : ""}`}
              onClick={() => onSelectSession(sess.id)}
              title={title}
            >
              <div className="workspace-tab-status">
                {isRunning ? (
                  <span className="status-dot running" title="Ejecutando en segundo plano..." />
                ) : (
                  <span className="status-dot idle" />
                )}
              </div>

              <span className="workspace-tab-title">{title}</span>

              {sessions.length > 1 && (
                <button
                  type="button"
                  className="workspace-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseSession(sess.id);
                  }}
                  title="Cerrar sesión"
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
        title="Nueva Sesión Concurrente (+)"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
