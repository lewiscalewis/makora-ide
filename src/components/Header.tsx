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
  Eye,
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
  glassMode?: "normal" | "vivid" | "solid";
  onToggleGlassMode?: () => void;
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
  glassMode = "normal",
  onToggleGlassMode,
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
            aria-label={t.header.toggleExplorer}
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
            <span className="theme-current-name">
              {currentTheme === "void"
                ? t.themes.voidName
                : currentTheme === "nordic"
                  ? t.themes.nordicName
                  : currentTheme === "tokyo"
                    ? t.themes.tokyoName
                    : currentTheme === "monokai"
                      ? t.themes.monokaiName
                      : currentTheme === "solar"
                        ? t.themes.solarName
                        : currentTheme === "cyberpunk"
                          ? t.themes.cyberpunkName
                          : currentTheme === "matrix"
                            ? t.themes.matrixName
                            : currentTheme === "outrun"
                              ? t.themes.outrunName
                              : currentTheme === "makora"
                                ? t.themes.makoraName
                                : currentTheme === "skyrim"
                                  ? t.themes.skyrimName
                                  : currentTheme === "dragons_dogma"
                                    ? t.themes.dragonsDogmaName
                                    : activeThemeObj?.name || "Theme"}
            </span>
            <ChevronDown size={11} className={`theme-chevron ${themeDropdownOpen ? "open" : ""}`} />
          </button>
          {themeDropdownOpen && (
            <div className="theme-dropdown-menu">
              <div className="theme-dropdown-header">{t.header.selectTheme}</div>
              {THEME_LIST.map((th) => {
                let thName = th.name;
                let thDesc = th.description;
                if (th.id === "void") {
                  thName = t.themes.voidName;
                  thDesc = t.themes.voidDesc;
                } else if (th.id === "nordic") {
                  thName = t.themes.nordicName;
                  thDesc = t.themes.nordicDesc;
                } else if (th.id === "tokyo") {
                  thName = t.themes.tokyoName;
                  thDesc = t.themes.tokyoDesc;
                } else if (th.id === "monokai") {
                  thName = t.themes.monokaiName;
                  thDesc = t.themes.monokaiDesc;
                } else if (th.id === "solar") {
                  thName = t.themes.solarName;
                  thDesc = t.themes.solarDesc;
                } else if (th.id === "cyberpunk") {
                  thName = t.themes.cyberpunkName;
                  thDesc = t.themes.cyberpunkDesc;
                } else if (th.id === "matrix") {
                  thName = t.themes.matrixName;
                  thDesc = t.themes.matrixDesc;
                } else if (th.id === "outrun") {
                  thName = t.themes.outrunName;
                  thDesc = t.themes.outrunDesc;
                } else if (th.id === "makora") {
                  thName = t.themes.makoraName;
                  thDesc = t.themes.makoraDesc;
                } else if (th.id === "skyrim") {
                  thName = t.themes.skyrimName;
                  thDesc = t.themes.skyrimDesc;
                } else if (th.id === "dragons_dogma") {
                  thName = t.themes.dragonsDogmaName;
                  thDesc = t.themes.dragonsDogmaDesc;
                }

                return (
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
                      <span className="theme-item-name">{thName}</span>
                      <span className="theme-item-desc">{thDesc}</span>
                    </div>
                    {th.id === currentTheme && <Check size={12} className="text-cyan" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 3D Backdrop Glass Clarity Toggle (Only for compatible animated 3D themes) */}
        {(currentTheme === "cyberpunk" ||
          currentTheme === "matrix" ||
          currentTheme === "outrun" ||
          currentTheme === "makora" ||
          currentTheme === "skyrim" ||
          currentTheme === "dragons_dogma") &&
          onToggleGlassMode && (
            <button
              type="button"
              className={`theme-picker-trigger glass-mode-toggle ${glassMode === "vivid" ? "active" : ""}`}
              onClick={onToggleGlassMode}
              title={
                glassMode === "vivid"
                  ? "Transparencia 3D: Vívida (Fondo ultra-visible) - Clic para cambiar"
                  : glassMode === "solid"
                    ? "Transparencia 3D: Sólida (Opaca) - Clic para cambiar"
                    : "Transparencia 3D: Cristal Equilibrado - Clic para cambiar"
              }
            >
              <Eye size={13} className="theme-icon-indicator" />
              <span className="theme-current-name">
                {glassMode === "vivid" ? "3D Vívido" : glassMode === "solid" ? "3D Sólido" : "3D Cristal"}
              </span>
            </button>
          )}

        {onTogglePanel && (
          <button
            className={`icon-btn toggle-panel-btn ${panelOpen ? "active" : ""}`}
            onClick={onTogglePanel}
            title={t.header.togglePanel}
            aria-label={t.header.togglePanel}
          >
            <PanelRight size={14} />
          </button>
        )}

        <button
          className="icon-btn"
          title={t.header.chatHistory}
          aria-label={t.header.chatHistory}
          onClick={onOpenHistory}
        >
          <History size={14} />
        </button>

        <button
          className="icon-btn"
          title={t.header.settings}
          aria-label={t.header.settings}
          onClick={onOpenSettings}
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
}

