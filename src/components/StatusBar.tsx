import { MAKORA_THEMES } from "../themes";
import {
  Folder,
  GitBranch,
  Zap,
  BarChart2,
  Terminal,
  Palette,
  Settings,
} from "lucide-react";
import type { GitStatusInfo, ThemeId, Usage } from "../types";

interface StatusBarProps {
  workspaceName: string;
  folderCount: number;
  gitInfo?: GitStatusInfo | null;
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
  gitInfo,
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
  const totalGitChanges = (gitInfo?.staged ?? 0) + (gitInfo?.modified ?? 0) + (gitInfo?.untracked ?? 0);

  return (
    <footer className="status-bar">
      <div className="status-left">
        <button
          className="status-item status-clickable"
          onClick={onOpenPalette}
          title="Abrir Command Palette (Ctrl+P)"
        >
          <Folder size={12} className="status-icon" />
          <span className="status-text font-semibold">{workspaceName}</span>
          <span className="status-dim">({folderCount})</span>
        </button>

        {gitInfo && (
          <>
            <div className="status-divider" />
            <div
              className="status-item git-status-item"
              title={`Rama Git: ${gitInfo.branch} | Staged: ${gitInfo.staged} | Modificados: ${gitInfo.modified} | Sin seguimiento: ${gitInfo.untracked}`}
            >
              <GitBranch size={12} className="status-icon" />
              <span className="status-text font-mono">{gitInfo.branch}</span>
              {totalGitChanges > 0 && (
                <span className="git-changes-badge" title={`${totalGitChanges} archivos con cambios`}>
                  ● {totalGitChanges}
                </span>
              )}
            </div>
          </>
        )}

        <div className="status-divider" />

        <div className="status-item">
          {agentBusy ? (
            <span className="status-badge status-badge-busy">
              <span className="pulse-dot" />
              <span>{runningToolName ? `Ejecutando ${runningToolName}` : "Razonando..."}</span>
            </span>
          ) : (
            <span className="status-badge status-badge-idle">
              <span className="idle-dot" />
              <span>Makora Listo</span>
            </span>
          )}
        </div>
      </div>

      <div className="status-right">
        {activeModel && (
          <div className="status-item" title="Modelo de IA activo">
            <Zap size={11} className="status-icon text-cyan" />
            <span className="status-text font-mono">{activeModel}</span>
          </div>
        )}

        <div className="status-divider" />

        <div
          className="status-item"
          title={`Entrada: ${usage.inputTokens.toLocaleString()} | Salida: ${usage.outputTokens.toLocaleString()} | Caché: ${usage.cachedTokens.toLocaleString()}`}
        >
          <BarChart2 size={11} className="status-icon" />
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
          title="Alternar Terminal Integrada (Ctrl+J)"
        >
          <Terminal size={11} className="status-icon" />
          <span className="status-text">Terminal</span>
          <kbd className="status-kbd">Ctrl+J</kbd>
        </button>

        <div className="status-divider" />

        <button
          className="status-item status-clickable"
          onClick={onCycleTheme}
          title={`Tema activo: ${theme.name} (Clic para conmutar)`}
        >
          <Palette size={11} className="status-icon" />
          <span className="status-text">{theme.name}</span>
        </button>

        <div className="status-divider" />

        <button
          className="status-item status-clickable"
          onClick={onOpenSettings}
          title="Configuración (Ctrl+,)"
        >
          <Settings size={12} className="status-icon" />
        </button>
      </div>
    </footer>
  );
}
