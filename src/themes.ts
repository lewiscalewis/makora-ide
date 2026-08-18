import type { ThemeConfig, ThemeId } from "./types";

export const MAKORA_THEMES: Record<ThemeId, ThemeConfig> = {
  void: {
    id: "void",
    name: "Makora Void",
    badge: "🌌 CYBERPUNK",
    description: "Abismo oscuro clásico con acentos cian neón, púrpura y carmesí.",
    colors: {
      bg: "#0b0d14",
      bgCard: "rgba(18, 22, 34, 0.75)",
      bgSelect: "#121622",
      glassBg: "rgba(255, 255, 255, 0.035)",
      glassBgHover: "rgba(255, 255, 255, 0.07)",
      glassBorder: "rgba(255, 255, 255, 0.09)",
      textMain: "#f0f2f5",
      textMuted: "#8b94a5",
      accentBlue: "#2979ff",
      accentGreen: "#00e676",
      accentRed: "#ff3d00",
      gold: "#ffd700",
      cyan: "#00f0ff",
      purple: "#7000ff",
      crimson: "#ff0055",
    },
  },
  emerald: {
    id: "emerald",
    name: "Makora Obsidian Emerald",
    badge: "⚡ QUANT / MATRIX",
    description: "Inspirado en finanzas cuantitativas y terminales de alto rendimiento en esmeralda.",
    colors: {
      bg: "#080c0a",
      bgCard: "rgba(12, 22, 17, 0.78)",
      bgSelect: "#0e1a14",
      glassBg: "rgba(0, 230, 118, 0.04)",
      glassBgHover: "rgba(0, 230, 118, 0.09)",
      glassBorder: "rgba(0, 230, 118, 0.16)",
      textMain: "#e8f5e9",
      textMuted: "#81c784",
      accentBlue: "#00e5ff",
      accentGreen: "#00e676",
      accentRed: "#ff5252",
      gold: "#a7ffeb",
      cyan: "#00f5a0",
      purple: "#00b0ff",
      crimson: "#ff1744",
    },
  },
  tokyo: {
    id: "tokyo",
    name: "Makora Tokyo Night",
    badge: "🌃 CYBER INDIGO",
    description: "Slate azulado nocturno con tonos lavanda, púrpura pastel y cian ártico.",
    colors: {
      bg: "#101423",
      bgCard: "rgba(22, 27, 46, 0.78)",
      bgSelect: "#181e33",
      glassBg: "rgba(122, 162, 247, 0.05)",
      glassBgHover: "rgba(122, 162, 247, 0.1)",
      glassBorder: "rgba(122, 162, 247, 0.16)",
      textMain: "#c0caf5",
      textMuted: "#7aa2f7",
      accentBlue: "#7aa2f7",
      accentGreen: "#9ece6a",
      accentRed: "#f7768e",
      gold: "#e0af68",
      cyan: "#7dcfff",
      purple: "#bb9af7",
      crimson: "#ff007c",
    },
  },
  solar: {
    id: "solar",
    name: "Makora Solar Flare",
    badge: "🔥 AMBER GOLD",
    description: "Cálido y vibrante con tonos ámbar dorado, naranja supernova y rubí espacial.",
    colors: {
      bg: "#120e0c",
      bgCard: "rgba(28, 20, 16, 0.8)",
      bgSelect: "#1f1612",
      glassBg: "rgba(255, 179, 0, 0.04)",
      glassBgHover: "rgba(255, 179, 0, 0.09)",
      glassBorder: "rgba(255, 179, 0, 0.16)",
      textMain: "#fff3e0",
      textMuted: "#ffb74d",
      accentBlue: "#ff9100",
      accentGreen: "#76ff03",
      accentRed: "#ff3d00",
      gold: "#ffd700",
      cyan: "#ffab00",
      purple: "#e040fb",
      crimson: "#d50000",
    },
  },
  synthwave: {
    id: "synthwave",
    name: "Makora Synthwave 84",
    badge: "🌆 RETRO NEON",
    description: "Estética retro años 80 con magenta neón, violeta intenso y cian eléctrico.",
    colors: {
      bg: "#130924",
      bgCard: "rgba(28, 12, 50, 0.8)",
      bgSelect: "#200d3a",
      glassBg: "rgba(255, 42, 133, 0.05)",
      glassBgHover: "rgba(255, 42, 133, 0.12)",
      glassBorder: "rgba(255, 42, 133, 0.2)",
      textMain: "#fde2ff",
      textMuted: "#d494ea",
      accentBlue: "#00e5ff",
      accentGreen: "#2de2e6",
      accentRed: "#ff3864",
      gold: "#ffe600",
      cyan: "#00f0ff",
      purple: "#b537f2",
      crimson: "#ff2a85",
    },
  },
};

export const THEME_LIST: ThemeConfig[] = Object.values(MAKORA_THEMES);

export function applyTheme(themeId: ThemeId) {
  const theme = MAKORA_THEMES[themeId] || MAKORA_THEMES.void;
  const root = document.documentElement;

  root.style.setProperty("--bg", theme.colors.bg);
  root.style.setProperty("--bg-card", theme.colors.bgCard);
  root.style.setProperty("--bg-select", theme.colors.bgSelect);
  root.style.setProperty("--glass-bg", theme.colors.glassBg);
  root.style.setProperty("--glass-bg-hover", theme.colors.glassBgHover);
  root.style.setProperty("--glass-border", theme.colors.glassBorder);
  root.style.setProperty("--text-main", theme.colors.textMain);
  root.style.setProperty("--text-muted", theme.colors.textMuted);
  root.style.setProperty("--accent-blue", theme.colors.accentBlue);
  root.style.setProperty("--accent-green", theme.colors.accentGreen);
  root.style.setProperty("--accent-red", theme.colors.accentRed);
  root.style.setProperty("--gold", theme.colors.gold);
  root.style.setProperty("--cyan", theme.colors.cyan);
  root.style.setProperty("--purple", theme.colors.purple);
  root.style.setProperty("--crimson", theme.colors.crimson);

  // Set active dataset for any CSS selectors
  root.dataset.theme = themeId;
}

export function loadSavedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem("makora.theme") as ThemeId;
    if (saved && MAKORA_THEMES[saved]) {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return "void";
}
