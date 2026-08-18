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
  explorerOpen?: boolean;
  onToggleExplorer?: () => void;
  panelOpen?: boolean;
  onTogglePanel?: () => void;
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
  explorerOpen = true,
  onToggleExplorer,
  panelOpen = true,
  onTogglePanel,
  currentTheme,
  onSelectTheme,
}: HeaderProps) {
  return (
    <header className="header">
      {/* Brand & Left Actions */}
      <div className="header-left">
        {onToggleExplorer && (
          <button
            className={`icon-btn toggle-sidebar-btn ${explorerOpen ? "active" : ""}`}
            onClick={onToggleExplorer}
            title={`${explorerOpen ? "Ocultar" : "Mostrar"} Explorador de Archivos (Ctrl+B)`}
          >
            📁
          </button>
        )}

        <div className="brand">
          <img src="/makora.svg" alt="Makora Logo" className="logo" />
          <div className="brand-text">
            <span className="brand-name">MakoraIDE</span>
            <span className="brand-sub">v3.0 Master</span>
          </div>
        </div>
      </div>

      {/* Center Spotlight Search */}
      <div className="header-center">
        <button
          className="header-search-btn"
          onClick={onOpenPalette}
          title="Buscar archivos y comandos (Ctrl+P / Ctrl+K)"
        >
          <span className="search-icon">🔍</span>
          <span className="search-placeholder">
            Buscar archivo o comando...
          </span>
          <kbd className="search-kbd">Ctrl+P</kbd>
        </button>
      </div>

      {/* Right Actions & Workspace Controls */}
      <div className="header-right">
        <div className="ws-input-wrap" title="Nombre del workspace">
          <input
            className="ws-name"
            value={workspaceName}
            onChange={(e) => onWorkspaceName(e.currentTarget.value)}
            placeholder="Workspace"
          />
          <span className="folder-count-badge">
            {folderCount} {folderCount === 1 ? "dir" : "dirs"}
          </span>
        </div>

        <button
          className="btn btn-subtle"
          onClick={onAddFolder}
          title="Añadir carpeta de proyecto al workspace"
        >
          + Carpeta
        </button>

        <button
          className="btn btn-subtle"
          onClick={onNewWorkspace}
          title="Reiniciar espacio de trabajo"
        >
          Limpiar
        </button>

        {onOpenOnboarding && (
          <button
            className="btn btn-subtle btn-onboarding"
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
            title="Seleccionar tema visual ergonómico"
          >
            {THEME_LIST.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {onTogglePanel && (
          <button
            className={`icon-btn toggle-panel-btn ${panelOpen ? "active" : ""}`}
            onClick={onTogglePanel}
            title={`${panelOpen ? "Ocultar" : "Mostrar"} Panel de Parámetros y Consumo`}
          >
            📊
          </button>
        )}

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
