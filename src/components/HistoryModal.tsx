import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { playClick } from "../sounds";
import ContextMenu, { type ContextMenuState } from "./ContextMenu";
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
  Sparkles,
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
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

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
      className={`history-card ${active ? "active" : ""}`}
      onClick={() => !editing && onOpen(session.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            {
              label: t.common.rename,
              onSelect: () => {
                setDraft(session.title);
                setEditing(true);
              },
            },
            {
              label: t.common.delete,
              danger: true,
              onSelect: () => onDelete(session.id),
            },
          ],
        });
      }}
    >
      <div className="history-card-left">
        <div className={`history-card-icon ${active ? "active" : ""}`}>
          <MessageSquare size={14} className={active ? "text-cyan" : "text-muted"} />
        </div>
        <div className="history-card-body">
          <div className="history-card-header">
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
              <span className="history-card-title" title={session.title}>
                {session.title || "Conversación sin título"}
              </span>
            )}
            {active && (
              <span className="history-active-tag">
                <span className="pulse-dot-cyan" />
                {t.chat.activeSession}
              </span>
            )}
          </div>

          <div className="history-card-meta">
            <span className="history-meta-pill">
              <Clock size={11} className="text-muted" />
              <span>{timeStr}</span>
            </span>
            {session.model && (
              <span className="history-meta-pill model-pill">
                <Zap size={11} className="text-cyan" />
                <span className="font-mono">{session.model}</span>
              </span>
            )}
            {totalTokens > 0 && (
              <span className="history-meta-pill">
                <Cpu size={11} className="text-purple" />
                <span className="font-mono">{totalTokens.toLocaleString()} tok</span>
              </span>
            )}
            {(session.totalCostUsd ?? 0) > 0 && (
              <span className="history-meta-pill cost-pill">
                <DollarSign size={11} className="text-green" />
                <span className="font-mono">${(session.totalCostUsd ?? 0).toFixed(4)}</span>
              </span>
            )}
            <span className="history-meta-pill count-pill">
              <Sparkles size={11} className="text-gold" />
              <span>{session.messages.length} msgs</span>
            </span>
          </div>
        </div>
      </div>

      <div className="history-card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="history-action-btn"
          onClick={() => setEditing((v) => !v)}
          title={t.common.rename}
        >
          <Pencil size={12} />
        </button>
        <button
          className="history-action-btn danger"
          onClick={() => onDelete(session.id)}
          title={t.common.delete}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
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
            <MessageSquare size={16} className="text-cyan" />
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
              <Plus size={13} />
              <span>{t.history.newChat}</span>
            </button>
            <button className="icon-btn" onClick={() => { playClick(); onClose(); }} title={t.common.close}>
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="history-toolbar">
          <div className="history-search-wrap">
            <Search size={13} className="history-search-icon" />
            <input
              className="history-search-input"
              placeholder={t.history.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button className="clear-filter-btn" onClick={() => setQuery("")} title={t.common.clean}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="modal-body history-list">
          {filtered.length === 0 ? (
            <div className="history-empty">
              <MessageSquare size={28} className="text-muted opacity-50" />
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
          {sessions.length > 0 && (
            <button
              className="btn btn-danger btn-subtle"
              onClick={() => {
                if (window.confirm(t.history.clearConfirm)) {
                  onClearAll();
                }
              }}
            >
              <Trash2 size={12} />
              <span>{t.history.clearAll}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
