import { MAKORA_THEMES } from "../themes";
import { useI18n } from "../i18n";
import { playClick, playToggle } from "../sounds";
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
  onOpenGit?: () => void;
  onOpenAnalytics?: () => void;
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
  onOpenGit,
  onOpenAnalytics,
}: StatusBarProps) {
  const { t } = useI18n();
  const theme = MAKORA_THEMES[currentTheme] || MAKORA_THEMES.void;
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const totalGitChanges = (gitInfo?.staged ?? 0) + (gitInfo?.modified ?? 0) + (gitInfo?.untracked ?? 0);

  return (
    <footer className="status-bar">
      <div className="status-left">
        <button
          className="status-item status-clickable"
          onClick={() => { playClick(); onOpenPalette(); }}
          title={t.statusbar.openPalette}
        >
          <Folder size={12} className="status-icon" />
          <span className="status-text font-semibold">{workspaceName}</span>
          <span className="status-dim">({folderCount})</span>
        </button>

        {gitInfo && (
          <>
            <div className="status-divider" />
            <button
              className="status-item status-clickable git-status-item"
              onClick={() => { playClick(); onOpenGit?.(); }}
              title={`Git: ${t.statusbar.branch} ${gitInfo.branch} | ${totalGitChanges} ${t.statusbar.changesPending} (${gitInfo.staged} staged, ${gitInfo.modified} modified, ${gitInfo.untracked} untracked)`}
            >
              <GitBranch size={12} className="status-icon" />
              <span className="status-text font-mono">{gitInfo.branch}</span>
              {totalGitChanges > 0 && (
                <span
                  className="git-changes-badge"
                  title={`${totalGitChanges} ${t.statusbar.changesPending} (${gitInfo.staged} staged, ${gitInfo.modified} modified, ${gitInfo.untracked} untracked)`}
                >
                  ● {totalGitChanges}
                </span>
              )}
            </button>
          </>
        )}

        <div className="status-divider" />

        <div className="status-item">
          {agentBusy ? (
            <span className="status-badge status-badge-busy">
              <span className="pulse-dot" />
              <span>{runningToolName ? `${t.statusbar.executingTool} ${runningToolName}` : t.statusbar.reasoning}</span>
            </span>
          ) : (
            <span className="status-badge status-badge-idle">
              <span className="idle-dot" />
              <span>{t.statusbar.ready}</span>
            </span>
          )}
        </div>
      </div>

      <div className="status-right">
        {activeModel && (
          <div className="status-item" title={t.chat.selectModel}>
            <Zap size={11} className="status-icon text-cyan" />
            <span className="status-text font-mono">{activeModel}</span>
          </div>
        )}

        <div className="status-divider" />

        <button
          className="status-item status-clickable"
          onClick={() => { playClick(); onOpenAnalytics?.(); }}
          title={t.statusbar.openAnalytics}
        >
          <BarChart2 size={11} className="status-icon text-gold" />
          <span className="status-text font-mono">
            {totalTokens.toLocaleString()} tok
          </span>
          <span className="status-cost accent-green font-mono">
            ${costUsd.toFixed(4)}
          </span>
        </button>

        <div className="status-divider" />

        <button
          className="status-item status-clickable"
          onClick={() => { playToggle(); onToggleTerminal(); }}
          title={`${t.statusbar.toggleTerminal} (Ctrl+J)`}
        >
          <Terminal size={11} className="status-icon" />
          <span className="status-text">{t.statusbar.toggleTerminal}</span>
          <kbd className="status-kbd">Ctrl+J</kbd>
        </button>

        <div className="status-divider" />

        <button
          className="status-item status-clickable"
          onClick={() => { playClick(); onCycleTheme(); }}
          title={t.statusbar.cycleTheme}
        >
          <Palette size={11} className="status-icon" />
          <span className="status-text">{theme.name}</span>
        </button>

        <div className="status-divider" />

        <button
          className="status-item status-clickable"
          onClick={() => { playClick(); onOpenSettings(); }}
          title={t.statusbar.openSettings}
        >
          <Settings size={12} className="status-icon" />
        </button>
      </div>
    </footer>
  );
}
