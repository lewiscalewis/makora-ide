import { MAKORA_THEMES } from "../themes";
import type { ThemeId, Usage } from "../types";

interface StatusBarProps {
  workspaceName: string;
  folderCount: number;
  activeModel: string;
  agentBusy: boolean;
  runningToolName?: string | null;
  usage: Usage;
  costUsd: number;
  currentTheme: ThemeId;
  onCycleTheme: () => void;
  onToggleTerminal: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}

export default function StatusBar({
  workspaceName,
  folderCount,
  activeModel,
  agentBusy,
  runningToolName,
  usage,
  costUsd,
  currentTheme,
  onCycleTheme,
  onToggleTerminal,
  onOpenPalette,
  onOpenSettings,
}: StatusBarProps) {
  const theme = MAKORA_THEMES[currentTheme] || MAKORA_THEMES.void;
  const totalTokens = usage.inputTokens + usage.outputTokens;

  return (
    <footer className="status-bar">
      <div className="status-left">
        <button
          className="status-item status-clickable"
          onClick={onOpenPalette}
          title="Abrir Command Palette (Ctrl+P)"
        >
          <span className="status-icon">📁</span>
          <span className="status-text font-semibold">{workspaceName}</span>
          <span className="status-dim">({folderCount})</span>
        </button>

        <div className="status-divider" />

        <div className="status-item">
          {agentBusy ? (
            <span className="status-badge status-badge-busy">
              <span className="pulse-dot" />
              {runningToolName ? `⚙ ${runningToolName}` : "🧠 Razonando..."}
            </span>
          ) : (
            <span className="status-badge status-badge-idle">
              <span className="idle-dot" />
              Makora Listo
            </span>
          )}
        </div>
      </div>

      <div className="status-right">
        {activeModel && (
          <div className="status-item" title="Modelo activo">
            <span className="status-icon">⚡</span>
            <span className="status-text font-mono">{activeModel}</span>
          </div>
        )}

        <div className="status-divider" />

        <div
          className="status-item"
          title={`Entrada: ${usage.inputTokens.toLocaleString()} | Salida: ${usage.outputTokens.toLocaleString()} | Caché: ${usage.cachedTokens.toLocaleString()}`}
        >
          <span className="status-icon">📊</span>
          <span className="status-text font-mono">
            {totalTokens.toLocaleString()} tok
          </span>
          <span className="status-cost accent-green font-mono">
            ${costUsd.toFixed(4)}
          </span>
        </div>

        <div className="status-divider" />

        <button
          className="status-item status-clickable"
          onClick={onToggleTerminal}
          title="Alternar Terminal (Ctrl+J)"
        >
          <span className="status-icon">💻</span>
          <span className="status-text">Terminal</span>
          <kbd className="status-kbd">Ctrl+J</kbd>
        </button>

        <div className="status-divider" />

        <button
          className="status-item status-clickable"
          onClick={onCycleTheme}
          title={`Tema activo: ${theme.name} (Clic para cambiar)`}
        >
          <span className="status-icon">🎨</span>
          <span className="status-text">{theme.name}</span>
        </button>

        <div className="status-divider" />

        <button
          className="status-item status-clickable"
          onClick={onOpenSettings}
          title="Configuración (Ctrl+,)"
        >
          <span className="status-icon">⚙️</span>
        </button>
      </div>
    </footer>
  );
}
