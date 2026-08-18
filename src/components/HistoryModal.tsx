import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import {
  Clock,
  Cpu,
  DollarSign,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { ChatSession } from "../types";

interface HistoryModalProps {
  isOpen: boolean;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

function HistoryRow({
  session,
  active,
  onOpen,
  onDelete,
  onRename,
}: {
  session: ChatSession;
  active: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== session.title) {
      onRename(session.id, next);
    } else {
      setDraft(session.title);
    }
    setEditing(false);
  };

  const totalTokens = session.totalTokens || ((session.inputTokens ?? 0) + (session.outputTokens ?? 0));
  const diff = Date.now() - session.updatedAt;
  const min = Math.floor(diff / 60_000);
  let timeStr = t.history.now;
  if (min >= 1 && min < 60) timeStr = t.history.minsAgo.replace("{m}", String(min));
  else if (min >= 60 && min < 1440) timeStr = t.history.hoursAgo.replace("{h}", String(Math.floor(min / 60)));
  else if (min >= 1440) timeStr = t.history.daysAgo.replace("{d}", String(Math.floor(min / 1440)));

  return (
    <div
      className={`history-row ${active ? "active" : ""}`}
      onClick={() => !editing && onOpen(session.id)}
    >
      <div className="history-row-left">
        <MessageSquare size={13} className={active ? "text-cyan" : "text-muted"} />
        <div className="history-row-main">
          {editing ? (
            <input
              autoFocus
              className="history-rename-input font-mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(session.title);
                  setEditing(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="history-row-title" title={session.title}>
              {session.title || "Conversación sin título"}
            </div>
          )}

          <div className="history-row-meta">
            <span className="meta-pill font-mono">
              <Clock size={10} />
              {timeStr}
            </span>
            {session.model && (
              <span className="meta-pill font-mono model-pill">
                <Zap size={10} className="text-cyan" />
                {session.model}
              </span>
            )}
            {totalTokens > 0 && (
              <span className="meta-pill font-mono">
                <Cpu size={10} />
                {totalTokens.toLocaleString()} tok
              </span>
            )}
            {(session.totalCostUsd ?? 0) > 0 && (
              <span className="meta-pill font-mono cost-pill accent-green">
                <DollarSign size={10} />
                {(session.totalCostUsd ?? 0).toFixed(4)}
              </span>
            )}
            <span className="meta-pill messages-pill">
              {session.messages.length} msgs
            </span>
          </div>
        </div>
      </div>

      <div className="history-row-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="icon-btn-micro"
          onClick={() => setEditing((v) => !v)}
          title={t.common.rename}
        >
          <Pencil size={11} />
        </button>
        <button
          className="icon-btn-micro danger"
          onClick={() => onDelete(session.id)}
          title={t.common.delete}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

export default function HistoryModal({
  isOpen,
  sessions,
  activeSessionId,
  onOpen,
  onNew,
  onDelete,
  onRename,
  onClearAll,
  onClose,
}: HistoryModalProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      if (s.model.toLowerCase().includes(q)) return true;
      return s.messages.some((m) => m.content.toLowerCase().includes(q));
    });
  }, [sessions, query]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal history-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.history.title}
      >
        <div className="modal-header">
          <div className="settings-header-left">
            <MessageSquare size={14} className="text-cyan" />
            <h3>{t.history.title}</h3>
            <span className="badge-pill">{sessions.length}</span>
          </div>
          <div className="git-header-actions">
            <button
              className="btn btn-primary btn-subtle"
              onClick={() => {
                onNew();
                onClose();
              }}
            >
              <Plus size={12} />
              {t.history.newChat}
            </button>
            <button className="icon-btn" onClick={onClose} title={t.common.close}>
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="history-toolbar">
          <div className="model-search-wrap history-search">
            <Search size={12} className="model-search-icon" />
            <input
              className="model-search-input"
              placeholder={t.history.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="clear-filter-btn" onClick={() => setQuery("")} title={t.common.clean}>
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        <div className="modal-body history-list">
          {filtered.length === 0 ? (
            <div className="history-empty">
              <MessageSquare size={24} className="text-cyan" />
              <p>{query ? t.history.emptyQuery : t.history.emptyNoChats}</p>
            </div>
          ) : (
            filtered.map((s) => (
              <HistoryRow
                key={s.id}
                session={s}
                active={s.id === activeSessionId}
                onOpen={onOpen}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))
          )}
        </div>

        <div className="history-footer">
          <span className="muted small">{t.history.savedLocally}</span>
          <button
            className="btn btn-danger btn-subtle"
            onClick={() => {
              if (window.confirm(t.history.clearConfirm)) {
                onClearAll();
              }
            }}
          >
            <Trash2 size={11} />
            {t.history.clearAll}
          </button>
        </div>
      </div>
    </div>
  );
}
