import { useEffect, useRef, useState } from "react";
import { searchPaths } from "../api";
import { THEME_LIST } from "../themes";
import type { CommandItem, ThemeId } from "../types";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  folders: string[];
  onOpenFile: (path: string) => void;
  onSelectTheme: (themeId: ThemeId) => void;
  onToggleTerminal: () => void;
  onToggleExplorer: () => void;
  onOpenSettings: () => void;
  onOpenOnboarding?: () => void;
  onToggleMode?: () => void;
  onAutoTest?: () => void;
  onAddFolder: () => void;
  onNewWorkspace: () => void;
  onClearChat: () => void;
}

export default function CommandPalette({
  isOpen,
  onClose,
  folders,
  onOpenFile,
  onSelectTheme,
  onToggleTerminal,
  onToggleExplorer,
  onOpenSettings,
  onOpenOnboarding,
  onToggleMode,
  onAutoTest,
  onAddFolder,
  onNewWorkspace,
  onClearChat,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | null>(null);

  const staticActions: CommandItem[] = [
    {
      id: "action-onboarding",
      title: "Abrir Asistente de Inicio / Bienvenida",
      subtitle: "Configurar proveedores, API Keys seguras, workspace y temas",
      icon: "🚀",
      category: "action",
      action: () => {
        onOpenOnboarding?.();
        onClose();
      },
    },
    {
      id: "action-auto-test",
      title: "Ejecutar Auto-Tests y Reparar Código",
      subtitle: "Lanza la suite de pruebas del proyecto y corrige fallos automáticamente",
      icon: "🧪",
      category: "action",
      action: () => {
        onAutoTest?.();
        onClose();
      },
    },
    {
      id: "action-toggle-mode",
      title: "Alternar Modo Planificación / Acción",
      subtitle: "Cambiar entre Modo Plan (diseña primero) y Modo Acción (aplica directo)",
      icon: "📋",
      category: "action",
      action: () => {
        onToggleMode?.();
        onClose();
      },
    },
    {
      id: "action-terminal",
      title: "Alternar Terminal Integrada",
      subtitle: "Abrir o cerrar la terminal PTY interactiva",
      icon: "💻",
      shortcut: "Ctrl+J",
      category: "action",
      action: () => {
        onToggleTerminal();
        onClose();
      },
    },
    {
      id: "action-explorer",
      title: "Alternar Explorador de Archivos",
      subtitle: "Mostrar u ocultar el árbol de directorios",
      icon: "📁",
      shortcut: "Ctrl+B",
      category: "action",
      action: () => {
        onToggleExplorer();
        onClose();
      },
    },
    {
      id: "action-settings",
      title: "Abrir Configuración",
      subtitle: "Gestionar modelos, tokens, skills y MCPs",
      icon: "⚙️",
      shortcut: "Ctrl+,",
      category: "action",
      action: () => {
        onOpenSettings();
        onClose();
      },
    },
    {
      id: "action-add-folder",
      title: "Añadir Carpeta al Workspace",
      subtitle: "Seleccionar un nuevo directorio para el espacio de trabajo",
      icon: "➕",
      category: "action",
      action: () => {
        onAddFolder();
        onClose();
      },
    },
    {
      id: "action-new-ws",
      title: "Nuevo Workspace Limpio",
      subtitle: "Reiniciar el espacio de trabajo actual",
      icon: "🔄",
      category: "action",
      action: () => {
        onNewWorkspace();
        onClose();
      },
    },
    {
      id: "action-clear-chat",
      title: "Limpiar Conversación / Nuevo Chat",
      subtitle: "Vaciar el transcript y comenzar un turno limpio",
      icon: "🗑️",
      category: "action",
      action: () => {
        onClearChat();
        onClose();
      },
    },
    ...THEME_LIST.map((theme) => ({
      id: `theme-${theme.id}`,
      title: `Tema: ${theme.name}`,
      subtitle: theme.description,
      icon: "🎨",
      category: "theme" as const,
      action: () => {
        onSelectTheme(theme.id);
        onClose();
      },
    })),
  ];

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setFileResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFileResults([]);
      setSearching(false);
      return;
    }

    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = window.setTimeout(async () => {
      try {
        const results = await searchPaths(folders, q);
        setFileResults(results.slice(0, 15));
      } catch {
        setFileResults([]);
      } finally {
        setSearching(false);
      }
    }, 120);
  }, [query, folders]);

  if (!isOpen) return null;

  const filteredActions = query.trim()
    ? staticActions.filter(
        (a) =>
          a.title.toLowerCase().includes(query.toLowerCase()) ||
          (a.subtitle && a.subtitle.toLowerCase().includes(query.toLowerCase())),
      )
    : staticActions;

  const fileCommands: CommandItem[] = fileResults.map((path) => {
    const name = path.split(/[\\/]/).pop() || path;
    return {
      id: `file-${path}`,
      title: name,
      subtitle: path,
      icon: "📄",
      category: "file",
      action: () => {
        onOpenFile(path);
        onClose();
      },
    };
  });

  const combinedItems: CommandItem[] = [...fileCommands, ...filteredActions];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((idx) => (idx + 1) % Math.max(1, combinedItems.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((idx) =>
        idx <= 0 ? combinedItems.length - 1 : idx - 1,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (combinedItems[selectedIndex]) {
        combinedItems[selectedIndex].action();
      }
    }
  };

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="palette-input-wrap">
          <span className="palette-search-icon">🔍</span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Buscar archivos por nombre o acciones (Ctrl+P / Ctrl+K)..."
          />
          {searching && <span className="palette-spinner">⟳</span>}
          <span className="palette-hint">ESC para cerrar</span>
        </div>

        <div className="palette-list">
          {combinedItems.length === 0 ? (
            <div className="palette-empty muted small">
              No se encontraron coincidencias para "{query}"
            </div>
          ) : (
            combinedItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  className={`palette-item ${isSelected ? "selected" : ""}`}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className="palette-item-icon">{item.icon}</span>
                  <div className="palette-item-content">
                    <div className="palette-item-title-row">
                      <span className="palette-item-title">{item.title}</span>
                      <span className={`palette-badge badge-${item.category}`}>
                        {item.category === "file"
                          ? "ARCHIVO"
                          : item.category === "theme"
                            ? "TEMA"
                            : "ACCIÓN"}
                      </span>
                    </div>
                    {item.subtitle && (
                      <span className="palette-item-subtitle" title={item.subtitle}>
                        {item.subtitle}
                      </span>
                    )}
                  </div>
                  {item.shortcut && (
                    <kbd className="palette-shortcut">{item.shortcut}</kbd>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
