import { THEME_LIST } from "../themes";
import type { ThemeId } from "../types";

interface HeaderProps {
  workspaceName: string;
  onWorkspaceName: (name: string) => void;
  folderCount: number;
  onAddFolder: () => void;
  onNewWorkspace: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onOpenOnboarding?: () => void;
  currentTheme: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
}

export default function Header({
  workspaceName,
  onWorkspaceName,
  folderCount,
  onAddFolder,
  onNewWorkspace,
  onOpenSettings,
  onOpenPalette,
  onOpenOnboarding,
  currentTheme,
  onSelectTheme,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <img src="/makora.svg" alt="Makora" className="logo" />
        <div className="brand-text">
          <span className="brand-name">MakoraIDE</span>
          <span className="brand-sub">agentic development</span>
        </div>
      </div>

      <div className="header-center">
        <button
          className="header-search-btn"
          onClick={onOpenPalette}
          title="Buscar archivos y comandos (Ctrl+P)"
        >
          <span className="search-icon">🔍</span>
          <span className="search-placeholder">
            Buscar archivo o comando...
          </span>
          <kbd className="search-kbd">Ctrl+P</kbd>
        </button>
      </div>

      <div className="header-actions">
        <div className="ws-input-wrap" title="Nombre del workspace actual">
          <input
            className="ws-name"
            value={workspaceName}
            onChange={(e) => onWorkspaceName(e.currentTarget.value)}
            placeholder="Nombre del workspace"
          />
          <span className="folder-count-badge">
            {folderCount} {folderCount === 1 ? "dir" : "dirs"}
          </span>
        </div>

        <button className="btn btn-subtle" onClick={onAddFolder} title="Añadir carpeta de proyecto al workspace">
          + Carpeta
        </button>
        <button className="btn btn-subtle" onClick={onNewWorkspace} title="Reiniciar espacio de trabajo">
          Limpiar
        </button>

        {onOpenOnboarding && (
          <button
            className="btn btn-subtle"
            onClick={onOpenOnboarding}
            title="Asistente de configuración inicial y bienvenida"
          >
            🚀 Asistente
          </button>
        )}

        <div className="theme-picker-wrap">
          <select
            className="theme-select"
            value={currentTheme}
            onChange={(e) => onSelectTheme(e.target.value as ThemeId)}
            title="Seleccionar tema visual Makora"
          >
            {THEME_LIST.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <button
          className="icon-btn"
          title="Configuración de Modelos, Tokens, Skills y MCPs (Ctrl+,)"
          onClick={onOpenSettings}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
