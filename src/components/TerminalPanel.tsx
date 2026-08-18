import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { termKill, termResize, termSpawn, termWrite } from "../api";
import { MAKORA_THEMES } from "../themes";
import type { ThemeId } from "../types";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  cwd?: string | null;
  currentTheme?: ThemeId;
  onCollapse: () => void;
}

export default function TerminalPanel({
  cwd,
  currentTheme = "void",
  onCollapse,
}: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [id, setId] = useState(() => `term-${Math.random().toString(36).slice(2)}`);

  const themeConfig = MAKORA_THEMES[currentTheme] || MAKORA_THEMES.void;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: "Cascadia Code, Consolas, Fira Code, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "block",
      theme: {
        background: themeConfig.colors.bg,
        foreground: themeConfig.colors.textMain,
        cursor: themeConfig.colors.cyan,
        selectionBackground: "rgba(41,121,255,0.35)",
        black: "#1e222d",
        red: themeConfig.colors.accentRed,
        green: themeConfig.colors.accentGreen,
        yellow: themeConfig.colors.gold,
        blue: themeConfig.colors.accentBlue,
        magenta: themeConfig.colors.purple,
        cyan: themeConfig.colors.cyan,
        white: themeConfig.colors.textMain,
      },
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* ignore */
    }

    term.onData((data) => {
      termWrite(id, data).catch(() => undefined);
    });

    let unlisten: (() => void) | undefined;
    listen<{ data: string }>(`term-data-${id}`, (e) => {
      term.write(e.payload.data);
    }).then((f) => {
      unlisten = f;
    });

    termSpawn(id, term.cols, term.rows, cwd).catch(() => undefined);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      termResize(id, term.cols, term.rows).catch(() => undefined);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      unlisten?.();
      term.dispose();
      termRef.current = null;
      termKill(id).catch(() => undefined);
    };
  }, [id, cwd]);

  // Dynamically update terminal theme on theme change
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = {
        background: themeConfig.colors.bg,
        foreground: themeConfig.colors.textMain,
        cursor: themeConfig.colors.cyan,
        selectionBackground: "rgba(41,121,255,0.35)",
        black: "#1e222d",
        red: themeConfig.colors.accentRed,
        green: themeConfig.colors.accentGreen,
        yellow: themeConfig.colors.gold,
        blue: themeConfig.colors.accentBlue,
        magenta: themeConfig.colors.purple,
        cyan: themeConfig.colors.cyan,
        white: themeConfig.colors.textMain,
      };
    }
  }, [currentTheme, themeConfig]);

  const restartTerminal = () => {
    termKill(id).catch(() => undefined);
    setId(`term-${Math.random().toString(36).slice(2)}`);
  };

  const clearTerminal = () => {
    termRef.current?.clear();
  };

  return (
    <div className="terminal-wrap">
      <div className="panel-head">
        <div className="panel-head-left">
          <span className="panel-title-text">Terminal PTY</span>
          {cwd && <span className="term-cwd" title={cwd}>{cwd.split(/[\\/]/).pop()}</span>}
        </div>
        <div className="panel-head-actions">
          <button
            className="icon-btn"
            title="Limpiar pantalla"
            onClick={clearTerminal}
          >
            🧹
          </button>
          <button
            className="icon-btn"
            title="Reiniciar sesión de terminal"
            onClick={restartTerminal}
          >
            🔄
          </button>
          <button
            className="icon-btn"
            title="Colapsar panel (Ctrl+J)"
            onClick={onCollapse}
          >
            ▾
          </button>
        </div>
      </div>
      <div ref={hostRef} className="terminal-host" />
    </div>
  );
}
