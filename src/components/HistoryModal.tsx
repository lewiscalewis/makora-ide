import { useMemo, useState } from "react";
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

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(ts).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  const commit = () => {
    const next = draft.trim();
    if (next) onRename(session.id, next);
    else setDraft(session.title);
    setEditing(false);
  };

  return (
    <div
      className={`history-item${active ? " active" : ""}`}
      onClick={() => onOpen(session.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(session.id);
      }}
    >
      <div className="history-item-main">
        {editing ? (
          <input
            className="history-rename-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(session.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className="history-item-title" title={session.title}>
            {session.title || "Sin título"}
          </div>
        )}
        <div className="history-item-meta">
          <span title={new Date(session.updatedAt).toLocaleString()}>
            <Clock size={10} />
            {formatRelative(session.updatedAt)}
          </span>
          <span>
            <MessageSquare size={10} />
            {session.messageCount} msgs
          </span>
          {session.model && (
            <span className="history-model" title={session.model}>
              <Cpu size={10} />
              {session.model}
            </span>
          )}
          <span>
            <DollarSign size={10} />
            {session.totalCostUsd.toFixed(4)}
          </span>
        </div>
      </div>
      <div className="history-item-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="icon-btn-micro"
          title="Renombrar"
          onClick={() => {
            setDraft(session.title);
            setEditing((v) => !v);
          }}
        >
          <Pencil size={11} />
        </button>
        <button
          className="icon-btn-micro danger"
          title="Eliminar"
          onClick={() => onDelete(session.id)}
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
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      if (s.title.toLowerCase().includes(q) || s.model.toLowerCase().includes(q)) return true;
      return s.messages.some(
        (m) => m.content && m.content.toLowerCase().includes(q)
      );
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
        aria-label="Historial de Chats"
      >
        <div className="modal-header">
          <div className="settings-header-left">
            <MessageSquare size={14} className="text-cyan" />
            <h3>Historial de Chats</h3>
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
              Nueva conversación
            </button>
            <button className="icon-btn" onClick={onClose} title="Cerrar">
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="history-toolbar">
          <div className="model-search-wrap history-search">
            <Search size={12} className="model-search-icon" />
            <input
              className="model-search-input"
              placeholder="Buscar por título, modelo o contenido..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="clear-filter-btn" onClick={() => setQuery("")} title="Limpiar">
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        <div className="modal-body history-list">
          {filtered.length === 0 ? (
            <div className="history-empty">
              <MessageSquare size={24} className="text-cyan" />
              <p>{query ? "No hay chats que coincidan con la búsqueda." : "Todavía no hay chats guardados."}</p>
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
          <span className="muted small">Se guarda localmente en este dispositivo.</span>
          <button
            className="btn btn-danger btn-subtle"
            onClick={() => {
              if (window.confirm("¿Borrar todo el historial de chats? Esta acción no se puede deshacer.")) {
                onClearAll();
              }
            }}
          >
            <Trash2 size={11} />
            Vaciar historial
          </button>
        </div>
      </div>
    </div>
  );
}
