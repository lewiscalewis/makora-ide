import type { ThemeConfig, ThemeId } from "./types";

export const MAKORA_THEMES: Record<ThemeId, ThemeConfig> = {
  void: {
    id: "void",
    name: "Makora Abyss (Default)",
    badge: "🌌 DEEP SPACE",
    description: "Enfoque profundo y calma cerebral. Contraste alto con texto marfil suave y acentos balanceados.",
    colors: {
      bg: "#0b0d14",
      bgCard: "rgba(18, 22, 34, 0.85)",
      bgSelect: "#121622",
      glassBg: "rgba(255, 255, 255, 0.035)",
      glassBgHover: "rgba(255, 255, 255, 0.075)",
      glassBorder: "rgba(255, 255, 255, 0.09)",
      textMain: "#e6edf8",
      textMuted: "#8892a4",
      accentBlue: "#4d82f3",
      accentGreen: "#34c759",
      accentRed: "#f25555",
      gold: "#e5b567",
      cyan: "#00c8d6",
      purple: "#8a3ffc",
      crimson: "#e05375",
    },
  },
  nordic: {
    id: "nordic",
    name: "Nordic Slate",
    badge: "❄️ EQUILIBRIO",
    description: "Equilibrio escandinavo para minimizar la fatiga ocular en sesiones nocturnas prolongadas.",
    colors: {
      bg: "#14171c",
      bgCard: "rgba(29, 33, 40, 0.85)",
      bgSelect: "#1d2128",
      glassBg: "rgba(121, 168, 216, 0.04)",
      glassBgHover: "rgba(121, 168, 216, 0.09)",
      glassBorder: "rgba(121, 168, 216, 0.14)",
      textMain: "#dce2ec",
      textMuted: "#86909e",
      accentBlue: "#79a8d8",
      accentGreen: "#88c0a3",
      accentRed: "#e06c75",
      gold: "#e5b567",
      cyan: "#64b5f6",
      purple: "#a580e2",
      crimson: "#d95b77",
    },
  },
  tokyo: {
    id: "tokyo",
    name: "Tokyo Midnight Muted",
    badge: "🌃 CREATIVIDAD",
    description: "Slate violeta profundo con suaves tonos lavanda y cian que estimulan el flujo de trabajo.",
    colors: {
      bg: "#13141f",
      bgCard: "rgba(28, 30, 45, 0.85)",
      bgSelect: "#1c1e2d",
      glassBg: "rgba(177, 133, 219, 0.04)",
      glassBgHover: "rgba(177, 133, 219, 0.09)",
      glassBorder: "rgba(177, 133, 219, 0.14)",
      textMain: "#dfdefe",
      textMuted: "#888aa3",
      accentBlue: "#5dade2",
      accentGreen: "#58d68d",
      accentRed: "#f1948a",
      gold: "#f5b041",
      cyan: "#7dcfff",
      purple: "#b185db",
      crimson: "#ec7063",
    },
  },
  monokai: {
    id: "monokai",
    name: "Obsidian Monokai",
    badge: "🏛️ CLÁSICO",
    description: "Tradición Monokai suavizada un 35% en calidez oliva oscura y crema suave sin deslumbramiento.",
    colors: {
      bg: "#181816",
      bgCard: "rgba(35, 35, 32, 0.85)",
      bgSelect: "#232320",
      glassBg: "rgba(152, 195, 121, 0.04)",
      glassBgHover: "rgba(152, 195, 121, 0.09)",
      glassBorder: "rgba(152, 195, 121, 0.14)",
      textMain: "#f5f5f0",
      textMuted: "#91918a",
      accentBlue: "#61afef",
      accentGreen: "#98c379",
      accentRed: "#e06c75",
      gold: "#e5c07b",
      cyan: "#56b6c2",
      purple: "#c678dd",
      crimson: "#be5046",
    },
  },
  solar: {
    id: "solar",
    name: "Solarized Obsidian",
    badge: "☀️ ERGONOMÍA",
    description: "Máxima absorción lumínica para desarrolladores con fotosensibilidad en tonos teal y ámbar.",
    colors: {
      bg: "#08161b",
      bgCard: "rgba(15, 34, 40, 0.85)",
      bgSelect: "#0f2228",
      glassBg: "rgba(42, 161, 152, 0.04)",
      glassBgHover: "rgba(42, 161, 152, 0.09)",
      glassBorder: "rgba(42, 161, 152, 0.14)",
      textMain: "#d1dede",
      textMuted: "#7a8f94",
      accentBlue: "#268bd2",
      accentGreen: "#859900",
      accentRed: "#dc322f",
      gold: "#b58900",
      cyan: "#2aa198",
      purple: "#6c71c4",
      crimson: "#d33682",
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
