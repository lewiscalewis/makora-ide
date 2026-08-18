import { useEffect, useRef, useState } from "react";
import { THEME_LIST } from "../themes";
import { useI18n, LANGUAGE_LIST } from "../i18n";
import {
  FolderPlus,
  Trash2,
  Settings,
  Search,
  PanelLeft,
  PanelRight,
  Palette,
  History,
  ChevronDown,
  Check,
  Globe,
} from "lucide-react";
import type { ThemeId } from "../types";

interface HeaderProps {
  workspaceName: string;
  onWorkspaceName: (name: string) => void;
  folderCount: number;
  onAddFolder: () => void;
  onNewWorkspace: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onOpenHistory: () => void;
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
  onOpenHistory,
  explorerOpen = true,
  onToggleExplorer,
  panelOpen = true,
  onTogglePanel,
  currentTheme,
  onSelectTheme,
}: HeaderProps) {
  const { language, setLanguage, t } = useI18n();
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeDropdownOpen(false);
      }
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangDropdownOpen(false);
      }
    }
    if (themeDropdownOpen || langDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [themeDropdownOpen, langDropdownOpen]);

  const activeThemeObj = THEME_LIST.find((t) => t.id === currentTheme);
  const activeLangObj = LANGUAGE_LIST.find((l) => l.id === language);

  return (
    <header className="header">
      {/* Brand & Left Actions */}
      <div className="header-left">
        {onToggleExplorer && (
          <button
            className={`icon-btn toggle-sidebar-btn ${explorerOpen ? "active" : ""}`}
            onClick={onToggleExplorer}
            title={t.header.toggleExplorer}
          >
            <PanelLeft size={14} />
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
          title={`${t.header.searchPlaceholder} (${t.header.searchKbd})`}
        >
          <Search size={13} className="search-icon" />
          <span className="search-placeholder">
            {t.header.searchPlaceholder}
          </span>
          <kbd className="search-kbd">{t.header.searchKbd}</kbd>
        </button>
      </div>

      {/* Right Actions & Workspace Controls */}
      <div className="header-right">
        <div className="ws-input-wrap" title="Workspace">
          <input
            className="ws-name"
            value={workspaceName}
            onChange={(e) => onWorkspaceName(e.currentTarget.value)}
            placeholder="Workspace"
          />
          <span className="folder-count-badge">
            {folderCount} {t.header.workspaceDirs}
          </span>
        </div>

        <button
          className="btn btn-subtle"
          onClick={onAddFolder}
          title={t.header.addFolder}
        >
          <FolderPlus size={13} />
          <span>{t.header.addFolder}</span>
        </button>

        <button
          className="btn btn-subtle"
          onClick={onNewWorkspace}
          title={t.header.cleanWorkspace}
        >
          <Trash2 size={13} />
          <span>{t.header.cleanWorkspace}</span>
        </button>

        {/* Custom Language Dropdown */}
        <div className="theme-picker-wrap" ref={langRef}>
          <button
            type="button"
            className={`theme-picker-trigger ${langDropdownOpen ? "active" : ""}`}
            onClick={() => setLangDropdownOpen((o) => !o)}
            title={t.header.selectLanguage}
          >
            <Globe size={13} className="theme-icon-indicator" />
            <span className="theme-current-name">{activeLangObj?.flag} {activeLangObj?.nativeName}</span>
            <ChevronDown size={11} className={`theme-chevron ${langDropdownOpen ? "open" : ""}`} />
          </button>
          {langDropdownOpen && (
            <div className="theme-dropdown-menu lang-dropdown-menu">
              <div className="theme-dropdown-header">{t.header.selectLanguage}</div>
              {LANGUAGE_LIST.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`theme-dropdown-item ${l.id === language ? "selected" : ""}`}
                  onClick={() => {
                    setLanguage(l.id);
                    setLangDropdownOpen(false);
                  }}
                >
                  <div className="theme-item-text">
                    <span className="theme-item-name">{l.flag} {l.nativeName}</span>
                    <span className="theme-item-desc">{l.name}</span>
                  </div>
                  {l.id === language && <Check size={12} className="text-cyan" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom Theme Dropdown */}
        <div className="theme-picker-wrap" ref={themeRef}>
          <button
            type="button"
            className={`theme-picker-trigger ${themeDropdownOpen ? "active" : ""}`}
            onClick={() => setThemeDropdownOpen((o) => !o)}
            title={t.header.selectTheme}
          >
            <Palette size={13} className="theme-icon-indicator" />
            <span className="theme-current-name">{activeThemeObj?.name || "Tema"}</span>
            <ChevronDown size={11} className={`theme-chevron ${themeDropdownOpen ? "open" : ""}`} />
          </button>
          {themeDropdownOpen && (
            <div className="theme-dropdown-menu">
              <div className="theme-dropdown-header">{t.header.selectTheme}</div>
              {THEME_LIST.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  className={`theme-dropdown-item ${th.id === currentTheme ? "selected" : ""}`}
                  onClick={() => {
                    onSelectTheme(th.id);
                    setThemeDropdownOpen(false);
                  }}
                >
                  <div className="theme-item-text">
                    <span className="theme-item-name">{th.name}</span>
                    <span className="theme-item-desc">{th.description}</span>
                  </div>
                  {th.id === currentTheme && <Check size={12} className="text-cyan" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {onTogglePanel && (
          <button
            className={`icon-btn toggle-panel-btn ${panelOpen ? "active" : ""}`}
            onClick={onTogglePanel}
            title={t.header.togglePanel}
          >
            <PanelRight size={14} />
          </button>
        )}

        <button
          className="icon-btn"
          title={t.header.chatHistory}
          onClick={onOpenHistory}
        >
          <History size={14} />
        </button>

        <button
          className="icon-btn"
          title={t.header.settings}
          onClick={onOpenSettings}
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
}

