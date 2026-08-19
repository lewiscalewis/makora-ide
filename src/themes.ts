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
      textMain: "#f0f4fc",
      textMuted: "#8c96a8",
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
    description: "Equilibrio escandinavo estilo Arc/Linear para minimizar la fatiga ocular en sesiones prolongadas.",
    colors: {
      bg: "#0e1117",
      bgCard: "rgba(22, 27, 34, 0.88)",
      bgSelect: "#1a202c",
      glassBg: "rgba(96, 165, 250, 0.04)",
      glassBgHover: "rgba(96, 165, 250, 0.08)",
      glassBorder: "rgba(96, 165, 250, 0.12)",
      textMain: "#e2e8f0",
      textMuted: "#8b9cb3",
      accentBlue: "#60a5fa",
      accentGreen: "#34d399",
      accentRed: "#f87171",
      gold: "#fbbf24",
      cyan: "#38bdf8",
      purple: "#a78bfa",
      crimson: "#fb7185",
    },
  },
  tokyo: {
    id: "tokyo",
    name: "Tokyo Synthwave Night",
    badge: "🌃 CREATIVIDAD",
    description: "Slate violeta profundo con suaves tonos lavanda y cian que estimulan el flujo de trabajo.",
    colors: {
      bg: "#0b0c16",
      bgCard: "rgba(21, 23, 42, 0.90)",
      bgSelect: "#191c36",
      glassBg: "rgba(167, 139, 250, 0.05)",
      glassBgHover: "rgba(167, 139, 250, 0.10)",
      glassBorder: "rgba(167, 139, 250, 0.16)",
      textMain: "#f1f0ff",
      textMuted: "#9290b8",
      accentBlue: "#6366f1",
      accentGreen: "#10b981",
      accentRed: "#f43f5e",
      gold: "#f59e0b",
      cyan: "#06b6d4",
      purple: "#c084fc",
      crimson: "#ec4899",
    },
  },
  monokai: {
    id: "monokai",
    name: "Obsidian Monokai Pro",
    badge: "🏛️ CLÁSICO",
    description: "Tradición Monokai Pro refinada en calidez oliva oscura y crema suave sin deslumbramiento.",
    colors: {
      bg: "#121314",
      bgCard: "rgba(28, 29, 31, 0.90)",
      bgSelect: "#222427",
      glassBg: "rgba(169, 220, 118, 0.04)",
      glassBgHover: "rgba(169, 220, 118, 0.08)",
      glassBorder: "rgba(169, 220, 118, 0.14)",
      textMain: "#f8f8f2",
      textMuted: "#969896",
      accentBlue: "#78dce8",
      accentGreen: "#a9dc76",
      accentRed: "#ff6188",
      gold: "#ffd866",
      cyan: "#78dce8",
      purple: "#ab9df2",
      crimson: "#fc9867",
    },
  },
  solar: {
    id: "solar",
    name: "Solarized Cyber-Teal",
    badge: "☀️ ERGONOMÍA",
    description: "Azul-petróleo profundo con acentos teal y ámbar de máxima ergonomía lumínica.",
    colors: {
      bg: "#041017",
      bgCard: "rgba(7, 28, 38, 0.90)",
      bgSelect: "#0c3345",
      glassBg: "rgba(45, 212, 191, 0.04)",
      glassBgHover: "rgba(45, 212, 191, 0.09)",
      glassBorder: "rgba(45, 212, 191, 0.16)",
      textMain: "#e6f4f1",
      textMuted: "#7da8a3",
      accentBlue: "#38bdf8",
      accentGreen: "#2dd4bf",
      accentRed: "#f43f5e",
      gold: "#f59e0b",
      cyan: "#14b8a6",
      purple: "#818cf8",
      crimson: "#fb7185",
    },
  },
  cyberpunk: {
    id: "cyberpunk",
    name: "Night City 2077",
    badge: "⚡ NIGHT CITY",
    description: "Estética futurista extrema inspirada en Cyberpunk 2077 con amarillo neón #FCEE09, cian Trauma Team y negro carbón.",
    colors: {
      bg: "#05060a",
      bgCard: "rgba(14, 16, 28, 0.92)",
      bgSelect: "#171a2e",
      glassBg: "rgba(252, 238, 9, 0.045)",
      glassBgHover: "rgba(252, 238, 9, 0.09)",
      glassBorder: "rgba(252, 238, 9, 0.20)",
      textMain: "#fafbff",
      textMuted: "#8b94a8",
      accentBlue: "#00f0ff",
      accentGreen: "#00ff9f",
      accentRed: "#ff003c",
      gold: "#fcee09",
      cyan: "#00f0ff",
      purple: "#d600ff",
      crimson: "#ff003c",
    },
  },
  matrix: {
    id: "matrix",
    name: "Matrix Phosphor",
    badge: "🟢 DIGITAL RAIN",
    description: "Verde fósforo terminal #00FF66 sobre negro absoluto con resplandor CRT y estética hacker legendaria.",
    colors: {
      bg: "#020703",
      bgCard: "rgba(4, 18, 8, 0.92)",
      bgSelect: "#062810",
      glassBg: "rgba(0, 255, 102, 0.04)",
      glassBgHover: "rgba(0, 255, 102, 0.09)",
      glassBorder: "rgba(0, 255, 102, 0.22)",
      textMain: "#e8ffe8",
      textMuted: "#689f72",
      accentBlue: "#00ffcc",
      accentGreen: "#00ff66",
      accentRed: "#ff3366",
      gold: "#a6ff00",
      cyan: "#00ffaa",
      purple: "#00dd88",
      crimson: "#ff2a55",
    },
  },
  outrun: {
    id: "outrun",
    name: "HyperDrive RetroWave",
    badge: "🌴 80S SYNTHWAVE",
    description: "Fantasía synthwave ochentera con magenta neón #FF007F, azul láser y puesta de sol cromada.",
    colors: {
      bg: "#070512",
      bgCard: "rgba(18, 12, 34, 0.92)",
      bgSelect: "#28174a",
      glassBg: "rgba(255, 0, 127, 0.05)",
      glassBgHover: "rgba(255, 0, 127, 0.10)",
      glassBorder: "rgba(255, 0, 127, 0.22)",
      textMain: "#fff0f8",
      textMuted: "#a788b5",
      accentBlue: "#00f0ff",
      accentGreen: "#00ffcc",
      accentRed: "#ff0055",
      gold: "#ffbe0b",
      cyan: "#00f0ff",
      purple: "#d900ff",
      crimson: "#ff007f",
    },
  },
  makora: {
    id: "makora",
    name: "Divine General Makora",
    badge: "☸ RUEDA DE ADAPTACIÓN",
    description: "Estética divina inspirada en la Rueda de 8 Mangos y el General Sagrado: dorado celestial #FFD700, obsidiana y jade esmeralda.",
    colors: {
      bg: "#06070a",
      bgCard: "rgba(14, 16, 23, 0.94)",
      bgSelect: "#1e2230",
      glassBg: "rgba(255, 215, 0, 0.04)",
      glassBgHover: "rgba(255, 215, 0, 0.08)",
      glassBorder: "rgba(255, 215, 0, 0.22)",
      textMain: "#f8fafc",
      textMuted: "#94a3b8",
      accentBlue: "#00e5ff",
      accentGreen: "#10b981",
      accentRed: "#ef4444",
      gold: "#ffd700",
      cyan: "#00f0ff",
      purple: "#8b5cf6",
      crimson: "#f43f5e",
    },
  },
  skyrim: {
    id: "skyrim",
    name: "Skyrim Elder Frost",
    badge: "❄️ TAMRIEL DRAGONBORN",
    description: "Noches heladas de Skyrim con auroras boreales, acero nórdico #38BDF8, oro de Aetherius y runas de dragón.",
    colors: {
      bg: "#070a10",
      bgCard: "rgba(12, 18, 28, 0.94)",
      bgSelect: "#1b2738",
      glassBg: "rgba(56, 189, 248, 0.04)",
      glassBgHover: "rgba(56, 189, 248, 0.09)",
      glassBorder: "rgba(56, 189, 248, 0.24)",
      textMain: "#f0f9ff",
      textMuted: "#94a3b8",
      accentBlue: "#38bdf8",
      accentGreen: "#34d399",
      accentRed: "#f97316",
      gold: "#facc15",
      cyan: "#7dd3fc",
      purple: "#818cf8",
      crimson: "#ef4444",
    },
  },
  dragons_dogma: {
    id: "dragons_dogma",
    name: "Dragon's Dogma Arisen",
    badge: "🔥 THE RIFT & SENESCHAL",
    description: "Fantasía oscura épica inspirada en la Falla y el Fuego del Dragón Grigori: carmesí ígneo #EF4444, oro fundido y piedra del Arisen.",
    colors: {
      bg: "#0b0707",
      bgCard: "rgba(22, 13, 13, 0.94)",
      bgSelect: "#301a1a",
      glassBg: "rgba(239, 68, 68, 0.04)",
      glassBgHover: "rgba(239, 68, 68, 0.09)",
      glassBorder: "rgba(239, 68, 68, 0.24)",
      textMain: "#fef2f2",
      textMuted: "#a8a29e",
      accentBlue: "#60a5fa",
      accentGreen: "#10b981",
      accentRed: "#ef4444",
      gold: "#f59e0b",
      cyan: "#06b6d4",
      purple: "#a855f7",
      crimson: "#dc2626",
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
