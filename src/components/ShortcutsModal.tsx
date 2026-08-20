import { useState } from "react";
import { Command, Keyboard, Search, X } from "lucide-react";

export interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  category: "chat" | "nav" | "editor" | "system";
}

const SHORTCUTS: ShortcutItem[] = [
  // Chat y Agente
  { keys: ["Ctrl", "Enter"], description: "Enviar prompt / Iniciar turno con el Agente", category: "chat" },
  { keys: ["Shift", "Enter"], description: "Insertar salto de línea en el campo de texto", category: "chat" },
  { keys: ["@"], description: "Mencionar archivo o carpeta del proyecto para adjuntar al contexto", category: "chat" },
  { keys: ["Esc"], description: "Cerrar menús desplegables / Cancelar selector activo", category: "chat" },
  
  // Navegación
  { keys: ["Ctrl", "K"], description: "Abrir Paleta de Comandos rápida", category: "nav" },
  { keys: ["Ctrl", "B"], description: "Mostrar / Ocultar Explorador de Archivos", category: "nav" },
  { keys: ["Ctrl", "J"], description: "Mostrar / Ocultar Terminal Integrada", category: "nav" },
  { keys: ["Ctrl", "\\"], description: "Alternar vista dividida (Split View / Canvas 3D)", category: "nav" },
  
  // Sesiones y Ventanas
  { keys: ["Ctrl", "Shift", "N"], description: "Crear una nueva sesión de conversación", category: "editor" },
  { keys: ["F1"], description: "Abrir esta guía de atajos de teclado", category: "system" },
  { keys: ["Ctrl", "?"], description: "Abrir guía de atajos de teclado", category: "system" },
];

export default function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const [search, setSearch] = useState("");

  if (!isOpen) return null;

  const filtered = SHORTCUTS.filter(
    (s) =>
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.keys.some((k) => k.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="diff-modal-backdrop" onClick={onClose} aria-modal="true" role="dialog">
      <div className="shortcuts-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-modal-header">
          <div className="shortcuts-title-wrap">
            <Keyboard size={18} className="text-cyan" />
            <h2>Atajos de Teclado y Productividad (MakoraIDE v1.0)</h2>
          </div>
          <button type="button" className="btn btn-subtle" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="shortcuts-search-wrap">
          <Search size={14} className="muted" />
          <input
            type="text"
            className="shortcuts-search-input font-mono"
            placeholder="Buscar atajo o acción rápida..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="shortcuts-list-body">
          {filtered.length === 0 ? (
            <div className="shortcuts-empty muted text-center p-6 text-xs font-mono">
              Sin atajos para "{search}"
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div key={idx} className="shortcut-row">
                <span className="shortcut-desc">{item.description}</span>
                <div className="shortcut-keys-group">
                  {item.keys.map((k, kIdx) => (
                    <kbd key={kIdx} className="shortcut-kbd font-mono">
                      {k === "Ctrl" ? (navigator.platform.includes("Mac") ? "⌘" : "Ctrl") : k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="shortcuts-modal-footer">
          <div className="shortcuts-footer-tip muted text-xs">
            <Command size={11} className="inline text-cyan mr-1" />
            <span>Presiona <strong>F1</strong> en cualquier momento para invocar esta referencia rápida.</span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
