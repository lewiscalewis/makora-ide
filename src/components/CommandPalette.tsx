import { useEffect, useRef, useState } from "react";
import { searchPaths } from "../api";
import { THEME_LIST } from "../themes";
import { useI18n } from "../i18n";
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
  onOpenGit?: () => void;
  onOpenAnalytics?: () => void;
  onAddFolder: () => void;
  onNewWorkspace: () => void;
  onClearChat: () => void;
  onOpenHistory: () => void;
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
  onOpenGit,
  onOpenAnalytics,
  onAddFolder,
  onNewWorkspace,
  onClearChat,
  onOpenHistory,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | null>(null);

  const staticActions: CommandItem[] = [
    {
      id: "action-onboarding",
      title: t.palette.actionOnboarding,
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
      title: t.palette.actionAutoTest,
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
      title: t.palette.actionToggleMode,
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
      title: t.palette.actionTerminal,
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
      title: t.palette.actionExplorer,
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
      id: "action-git",
      title: t.palette.actionGit,
      subtitle: "Inspeccionar cambios, commits, ramas y repositorios remotos",
      icon: "🌿",
      shortcut: "Ctrl+G",
      category: "action",
      action: () => {
        onOpenGit?.();
        onClose();
      },
    },
    {
      id: "action-analytics",
      title: t.palette.actionAnalytics,
      subtitle: "Consultar hit rate de KV-Cache, saldo y costes de inferencia",
      icon: "📊",
      category: "action",
      action: () => {
        onOpenAnalytics?.();
        onClose();
      },
    },
    {
      id: "action-settings",
      title: t.palette.actionSettings,
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
      title: t.palette.actionAddFolder,
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
      title: t.palette.actionNewWs,
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
      title: t.palette.actionClearChat,
      subtitle: "Vaciar el transcript y comenzar un turno limpio",
      icon: "🗑️",
      category: "action",
      action: () => {
        onClearChat();
        onClose();
      },
    },
    {
      id: "action-history",
      title: t.palette.actionHistory,
      subtitle: "Abrir conversaciones guardadas y continuar donde lo dejaste",
      icon: "🕘",
      shortcut: "Ctrl+H",
      category: "action",
      action: () => {
        onOpenHistory();
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
            placeholder={t.palette.searchPlaceholder}
          />
          {searching && <span className="palette-spinner">⟳</span>}
          <span className="palette-hint">ESC ({t.common.close})</span>
        </div>

        <div className="palette-list">
          {combinedItems.length === 0 ? (
            <div className="palette-empty muted small">
              {t.palette.noResults} "{query}"
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
                          ? t.palette.fileCategory
                          : item.category === "theme"
                            ? t.palette.themeCategory
                            : t.palette.actionCategory}
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
