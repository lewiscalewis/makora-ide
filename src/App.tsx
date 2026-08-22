import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  fetchBalance,
  generateTitle,
  gitStatus,
  homeDir,
  keyringGet,
  keyringSet,
  listModels,
  mcpConfigure,
  pickFolder,
  readTextFile,
  writeFile,
  getInitialFile,
  checkBetaValidity,
  detectOllama,
} from "./api";
import { presetById } from "./providers";
import { DEFAULT_CONFIG, getRecommendedModelsForProvider, inferModelConfig, computeCostUsd } from "./defaults";
import { applyTheme, loadSavedTheme, THEME_LIST } from "./themes";
import { useI18n } from "./i18n";
import { UploadCloud, AlertTriangle, CheckCircle2, X } from "lucide-react";
import Header from "./components/Header";
import Explorer from "./components/Explorer";
import Chat from "./components/Chat";
import UsagePanel from "./components/UsagePanel";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import UnifiedWorkspace from "./components/UnifiedWorkspace";
import AmbientCanvas3D from "./components/AmbientCanvas3D";
import ShortcutsModal from "./components/ShortcutsModal";
import WorkspaceTabBar from "./components/WorkspaceTabBar";
import {
  cancelTurn,
  destroySessionRuntime,
  ensureSessionRuntime,
  getSessionRuntime,
  useBusySessionIds,
  useSessionRuntime,
} from "./sessionStore";

// Lazy-loaded heavy components for instant initial startup & smaller initial JS chunk
const SettingsModal = lazy(() => import("./components/SettingsModal"));
const TerminalPanel = lazy(() => import("./components/TerminalPanel"));
const OnboardingModal = lazy(() => import("./components/OnboardingModal"));
const GitModal = lazy(() => import("./components/GitModal"));
const AnalyticsModal = lazy(() => import("./components/AnalyticsModal"));
const HistoryModal = lazy(() => import("./components/HistoryModal"));
const BetaAgreementModal = lazy(() => import("./components/BetaAgreementModal"));
import {
  initSessions,
  saveSessions,
  saveOpenTabIds,
  setActiveSessionId as persistActiveSessionId,
  makeSession,
  sanitizeMessages,
  deriveTitle,
  loadSessionsFromStore,
} from "./sessions";

import type {
  AppConfig,
  BalanceInfo,
  ChatConfig,
  ChatMessage,
  ChatSession,
  ChatUsage,
  GitStatusInfo,
  McpSpec,
  ModelConfig,
  SessionWorkspaceState,
  Settings,
  ThemeId,
  ThinkingLevel,
  Usage,
} from "./types";

import "./App.css";

const DEFAULT_SETTINGS: Settings = {
  providerId: "deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "",
  maxCostPerTurn: 0,
};

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

function defaultWorkspace(): SessionWorkspaceState {
  return {
    folders: [],
    openFiles: [],
    activeFilePath: null,
    agentMode: "act",
    multiAgentMode: "auto",
    thinkingLevel: "medium",
    status: "idle",
    diff: null,
  };
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("makora.settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.model === "gemini-2.5-flash" || parsed.model === "gemini-2.0-flash" || parsed.model === "gemini-1.5-flash") {
        parsed.model = "gemini-3.7-flash";
      } else if (parsed.model === "gemini-2.5-pro" || parsed.model === "gemini-2.0-pro" || parsed.model === "gemini-1.5-pro") {
        parsed.model = "gemini-3.1-pro-preview";
      }
      return { ...DEFAULT_SETTINGS, ...parsed, apiKey: "" };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem("makora.config");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      let models = (parsed.models ?? DEFAULT_CONFIG.models).map((m) => {
        let id = m.id;
        if (id === "gemini-2.5-flash" || id === "gemini-2.0-flash" || id === "gemini-1.5-flash") {
          id = "gemini-3.7-flash";
        } else if (id === "gemini-2.5-pro" || id === "gemini-2.0-pro" || id === "gemini-1.5-pro") {
          id = "gemini-3.1-pro-preview";
        }
        const defaultMatch = DEFAULT_CONFIG.models.find((d) => d.id === id);
        const inferred = inferModelConfig(id);
        const inputPrice = (typeof m.inputPrice === "number" && m.inputPrice > 0) ? m.inputPrice : (defaultMatch?.inputPrice ?? inferred.inputPrice);
        const outputPrice = (typeof m.outputPrice === "number" && m.outputPrice > 0) ? m.outputPrice : (defaultMatch?.outputPrice ?? inferred.outputPrice);
        return {
          ...(defaultMatch ?? {}),
          ...m,
          id,
          inputPrice,
          outputPrice,
          visionEnabled: m.visionEnabled ?? defaultMatch?.visionEnabled ?? inferred.visionEnabled,
        };
      });
      // Deduplicate models by id
      models = models.filter((m, idx, arr) => arr.findIndex((x) => x.id === m.id) === idx);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        models,
        context: { ...DEFAULT_CONFIG.context, ...(parsed.context ?? {}) },
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CONFIG;
}

function App() {
  const { t } = useI18n();
  const [workspaceName, setWorkspaceName] = useState(
    () => localStorage.getItem("makora.wsname") ?? "Workspace",
  );
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [config, setConfig] = useState<AppConfig>(loadConfig);
  const [theme, setTheme] = useState<ThemeId>(loadSavedTheme);
  const [isSplit, setIsSplit] = useState(() => {
    try {
      return localStorage.getItem("makora.isSplit") === "true";
    } catch {
      return false;
    }
  });
  const [zenMode, setZenMode] = useState(false);

  const [explorerOpen, setExplorerOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  const [models, setModels] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showGitModal, setShowGitModal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [homePath, setHomePath] = useState<string>("");
  const lastBalanceAt = useRef<number>(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mcpTools, setMcpTools] = useState<string[]>([]);
  const [lastUsage, setLastUsage] = useState<ChatUsage | null>(null);
  const [gitInfo, setGitInfo] = useState<GitStatusInfo | null>(null);

  // Panel Resizing & Background Glassmorphism State
  const [explorerWidth, setExplorerWidth] = useState<number>(() => {
    const saved = localStorage.getItem("makora.explorerWidth");
    return saved ? Math.max(160, Math.min(500, Number(saved))) : 250;
  });
  const [usagePanelWidth, setUsagePanelWidth] = useState<number>(() => {
    const saved = localStorage.getItem("makora.usagePanelWidth");
    return saved ? Math.max(200, Math.min(550, Number(saved))) : 280;
  });
  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    const saved = localStorage.getItem("makora.terminalHeight");
    return saved ? Math.max(100, Math.min(600, Number(saved))) : 190;
  });
  const [glassMode, setGlassMode] = useState<"normal" | "vivid" | "solid">(() => {
    const saved = localStorage.getItem("makora.glassMode");
    return (saved === "vivid" || saved === "solid" || saved === "normal") ? saved : "normal";
  });

  const toggleGlassMode = useCallback(() => {
    setGlassMode((prev) => {
      const next = prev === "normal" ? "vivid" : prev === "vivid" ? "solid" : "normal";
      localStorage.setItem("makora.glassMode", next);
      return next;
    });
  }, []);

  const handleExplorerResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const initialWidth = explorerWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(160, Math.min(500, initialWidth + (moveEvent.clientX - startX)));
      setExplorerWidth(newWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      localStorage.setItem("makora.explorerWidth", String(explorerWidth));
    };

    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [explorerWidth]);

  const handleUsagePanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const initialWidth = usagePanelWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(550, initialWidth - (moveEvent.clientX - startX)));
      setUsagePanelWidth(newWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      localStorage.setItem("makora.usagePanelWidth", String(usagePanelWidth));
    };

    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [usagePanelWidth]);

  const handleTerminalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const initialHeight = terminalHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(100, Math.min(600, initialHeight - (moveEvent.clientY - startY)));
      setTerminalHeight(newHeight);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      localStorage.setItem("makora.terminalHeight", String(terminalHeight));
    };

    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [terminalHeight]);

  // Drag and Drop & Toasts State
  const [isDragging, setIsDragging] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: "warning" | "info" }[]>([]);

  // EULA & Beta Hardening Protection State
  const [showEula, setShowEula] = useState<boolean>(
    () => localStorage.getItem("makora_eula_accepted") !== "true",
  );
  const [isBetaExpired, setIsBetaExpired] = useState(false);
  const [betaExpirationError, setBetaExpirationError] = useState<string | null>(null);

  useEffect(() => {
    checkBetaValidity().catch((err) => {
      setIsBetaExpired(true);
      setBetaExpirationError(String(err));
    });
  }, []);

  const showToast = useCallback((message: string, type: "warning" | "info" = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
  }, []);

  // Chat history state (persisted in localStorage), workspace incluido por sesión.
  const [sessionState, setSessionState] = useState(initSessions);
  const sessions = sessionState.sessions;
  const openTabIds = sessionState.openTabIds || [sessionState.activeId];
  const activeSessionId = sessionState.activeId;

  // Hidratación desde SQLite (fuente de verdad durable): si localStorage se
  // perdió/limpió o está truncado, restaura el historial completo del store.
  useEffect(() => {
    let cancelled = false;
    loadSessionsFromStore()
      .then((stored) => {
        if (cancelled || !stored || stored.length === 0) return;
        setSessionState((prev) => {
          const totalMessages = (list: ChatSession[]) =>
            list.reduce((n, s) => n + (s.messages?.length ?? 0), 0);
          const useStore =
            prev.sessions.length === 0 ||
            stored.length > prev.sessions.length ||
            totalMessages(stored) > totalMessages(prev.sessions);
          if (!useStore) return prev;
          const nextTabs = stored.slice(0, 3).map((s) => s.id);
          const nextActive = nextTabs[0] ?? stored[0]?.id ?? "";
          return { sessions: stored, openTabIds: nextTabs, activeId: nextActive };
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const openSessions = useMemo(() => {
    const map = new Map(sessions.map((s) => [s.id, s]));
    const list = openTabIds.map((id) => map.get(id)).filter(Boolean) as ChatSession[];
    return list.length > 0 ? list : sessions.slice(0, 1);
  }, [sessions, openTabIds]);

  const [showHistory, setShowHistory] = useState(false);
  const sessionStateRef = useRef(sessionState);
  const saveTimerRef = useRef<number | null>(null);

  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId) ?? openSessions[0] ?? null
    : openSessions[0] ?? null;
  const activeWorkspace: SessionWorkspaceState = activeSession?.workspace ?? defaultWorkspace();
  const activeWorkspaceRef = useRef(activeWorkspace);
  activeWorkspaceRef.current = activeWorkspace;

  const folders = activeWorkspace.folders;
  const openFiles = activeWorkspace.openFiles;
  const activePath = activeWorkspace.activeFilePath;
  const diff = activeWorkspace.diff ?? null;

  const activeRuntime = useSessionRuntime(activeSessionId);
  const busySessionIds = useBusySessionIds();

  // Apply theme on load and change
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("makora.theme", theme);
  }, [theme]);

  // One-time security migration: migrate plaintext keys to OS Keyring and remove unencrypted storage
  useEffect(() => {
    try {
      const rawKeys = localStorage.getItem("makora.provider_keys");
      if (rawKeys) {
        const parsed = JSON.parse(rawKeys);
        for (const [pid, k] of Object.entries(parsed)) {
          if (typeof k === "string" && k.trim()) {
            keyringSet(pid, k.trim()).catch(() => undefined);
          }
        }
        localStorage.removeItem("makora.provider_keys");
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Load API key securely from OS Keyring on mount and when provider changes
  useEffect(() => {
    let cancelled = false;
    async function loadKeyForProvider(providerId: string) {
      if (!providerId) return;
      try {
        const key = await keyringGet(providerId);
        if (!cancelled && key && key.trim()) {
          setSettings((s) => {
            if (s.providerId === providerId && (!s.apiKey || s.apiKey !== key.trim())) {
              return { ...s, apiKey: key.trim() };
            }
            return s;
          });
        }
      } catch (err) {
        console.warn("Keyring load error:", err);
      }
    }

    loadKeyForProvider(settings.providerId);
    // Double check after 250ms in case system keyring service was initializing
    const timer = setTimeout(() => {
      if (!cancelled) loadKeyForProvider(settings.providerId);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [settings.providerId]);

  // Sync API key updates exclusively to OS Keyring (never in localStorage)
  useEffect(() => {
    if (settings.providerId && settings.apiKey && settings.apiKey.trim()) {
      keyringSet(settings.providerId, settings.apiKey.trim()).catch(() => undefined);
    }
  }, [settings.providerId, settings.apiKey]);

  const cycleTheme = () => {
    const list = THEME_LIST.map((t) => t.id);
    const currIdx = list.indexOf(theme);
    const nextIdx = (currIdx + 1) % list.length;
    setTheme(list[nextIdx]);
  };

  useEffect(() => {
    homeDir()
      .then(setHomePath)
      .catch(() => setHomePath(""));
  }, []);

  const effectiveFolders = useMemo(
    () => (folders.length > 0 ? folders : homePath ? [homePath] : []),
    [folders, homePath],
  );

  // Live Git Status synchronization (Interval + Focus + Events)
  const checkGitStatus = useCallback(() => {
    if (effectiveFolders.length > 0) {
      gitStatus(effectiveFolders[0])
        .then(setGitInfo)
        .catch(() => setGitInfo(null));
    } else {
      setGitInfo(null);
    }
  }, [effectiveFolders]);

  useEffect(() => {
    checkGitStatus();

    // 1. Live interval polling every 3.5 seconds
    const interval = setInterval(checkGitStatus, 3500);

    // 2. Window focus listener
    const onFocus = () => checkGitStatus();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkGitStatus, refreshTick]);

  const preset = presetById(settings.providerId);
  const modelConfig =
    config.models.find((m) => m.id === settings.model) ||
    (settings.model ? inferModelConfig(settings.model, settings.providerId) : undefined);
  const thinkingLevel: ThinkingLevel = modelConfig?.thinkingLevel ?? "medium";

  const isVisionActive =
    modelConfig?.visionEnabled ??
    (settings.model ? inferModelConfig(settings.model, settings.providerId).visionEnabled : false);

  const requestConfig: ChatConfig = useMemo(
    () => ({
      kind: preset.kind,
      baseUrl: settings.baseUrl || preset.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
      reasoningEffort:
        modelConfig?.reasoningEnabled &&
        modelConfig.thinkingLevel &&
        modelConfig.thinkingLevel !== "none"
          ? modelConfig.thinkingLevel
          : null,
      maxOutputTokens: modelConfig?.maxOutputTokens ?? null,
      temperature: null,
      visionEnabled: isVisionActive,
      contextWindow: modelConfig?.contextWindow ?? config.context?.maxTokens ?? 128000,
    }),
    [
      preset.kind,
      preset.baseUrl,
      settings.baseUrl,
      settings.model,
      settings.apiKey,
      modelConfig,
      isVisionActive,
      config.context?.maxTokens,
    ],
  );

  const skillsContent = config.skills
    .map((s) => `### ${s.name}\n${s.content}`)
    .join("\n\n");

  // Uso y coste derivados de la sesión activa (los acumulados viven en la sesión).
  const usage: Usage = activeSession
    ? {
        inputTokens: activeSession.inputTokens,
        outputTokens: activeSession.outputTokens,
        cachedTokens: activeSession.cachedTokens,
      }
    : ZERO_USAGE;

  const costUsd = (activeSession?.totalCostUsd ?? 0) > 0
    ? activeSession!.totalCostUsd
    : computeCostUsd(usage, modelConfig, settings.model, settings.providerId);

  const balanceBlocked =
    balance !== null && balance.amount > 0 && costUsd >= balance.amount;
  const blockReason = balance
    ? `Coste de sesión (${costUsd.toFixed(4)} ${balance.currency}) ≥ saldo (${balance.amount.toFixed(2)} ${balance.currency}).`
    : "";

  useEffect(() => {
    const safeSettings = { ...settings, apiKey: "" };
    localStorage.setItem("makora.settings", JSON.stringify(safeSettings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem("makora.isSplit", String(isSplit));
  }, [isSplit]);
  useEffect(() => {
    localStorage.setItem("makora.folders", JSON.stringify(folders));
  }, [folders]);

  const [connectionSuccess, setConnectionSuccess] = useState<string | null>(null);

  const refreshBalance = useCallback(
    async (force = false) => {
      if (settings.providerId !== "deepseek" && settings.providerId !== "openrouter") {
        setBalance(null);
        return;
      }
      const now = Date.now();
      if (!force && now - lastBalanceAt.current < 60_000) return;
      lastBalanceAt.current = now;
      setBalanceLoading(true);
      try {
        const b = await fetchBalance(
          settings.providerId,
          settings.baseUrl || preset.baseUrl,
          settings.apiKey,
        );
        setBalance(b);
      } catch {
        setBalance(null);
      } finally {
        setBalanceLoading(false);
      }
    },
    [settings.providerId, settings.baseUrl, settings.apiKey, preset.baseUrl],
  );

  const [injectedPrompt, setInjectedPrompt] = useState<string | null>(null);

  const connect = async () => {
    setConnecting(true);
    setModelsError(null);
    setConnectionSuccess(null);
    try {
      const m = await listModels(requestConfig);
      if (!m || m.length === 0) {
        throw new Error("No se devolvió ningún modelo en la respuesta del proveedor.");
      }
      setModels(m);
      
      const liveModelsForProv = m.map((id) => inferModelConfig(id, settings.providerId));
      setConfig((c) => {
        const otherProvModels = c.models.filter(
          (x) => (x.providerId || "").toLowerCase() !== settings.providerId.toLowerCase()
        );
        return {
          ...c,
          models: [...otherProvModels, ...liveModelsForProv],
        };
      });

      if (!settings.model || !m.includes(settings.model)) {
        const chosen = m[0];
        setSettings((s) => ({ ...s, model: chosen }));
      }
      setConnectionSuccess(`${m.length} modelos cargados correctamente`);
      refreshBalance();
    } catch (e) {
      setModelsError(String(e));
      setConnectionSuccess(null);
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    localStorage.setItem("makora.wsname", workspaceName);
  }, [workspaceName]);
  useEffect(() => {
    localStorage.setItem("makora.config", JSON.stringify(config));
  }, [config]);

  // Debounced persistence avoids hammering localStorage on every token chunk.
  useEffect(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => saveSessions(sessionState.sessions), 400);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [sessionState.sessions]);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  // Seed del store de streaming por cada sesión conocida (idempotente).
  useEffect(() => {
    sessions.forEach((s) => ensureSessionRuntime(s.id, s.messages));
  }, [sessions]);

  // Flush pending writes when the window is hidden or closed.
  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveSessions(sessionStateRef.current.sessions);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (activeSessionId) persistActiveSessionId(activeSessionId);
  }, [activeSessionId]);

  const prevProviderRef = useRef(settings.providerId);
  useEffect(() => {
    const prevProvider = prevProviderRef.current;
    const providerChanged = prevProvider !== settings.providerId;
    prevProviderRef.current = settings.providerId;
    setModels([]);
    setModelsError(null);
    setBalance(null);
    setSettings((s) => {
      const next = { ...s };
      if (s.providerId !== "custom") {
        next.baseUrl = presetById(s.providerId).baseUrl;
        // Al cambiar de proveedor, el modelo anterior casi nunca existe en el
        // nuevo proveedor: seleccionar el recomendado de inmediato evita
        // errores 404/400 si el usuario envía un mensaje antes de cargar modelos.
        if (providerChanged) {
          const recommended = getRecommendedModelsForProvider(s.providerId);
          const currentBelongs = recommended.some((m) => m.id === s.model);
          if (!currentBelongs) {
            next.model = recommended[0]?.id ?? "";
          }
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.providerId]);

  // Auto-detect local Ollama if no API key is configured
  useEffect(() => {
    const rawKeys = localStorage.getItem("makora.provider_keys");
    let hasAnyKey = false;
    try {
      const parsed = rawKeys ? JSON.parse(rawKeys) : {};
      hasAnyKey = Object.values(parsed).some((k) => Boolean(k));
    } catch {
      /* ignore */
    }

    if (!settings.apiKey && !hasAnyKey) {
      detectOllama()
        .then((running) => {
          if (running) {
            setSettings((s) => ({
              ...s,
              providerId: "ollama",
              baseUrl: "http://localhost:11434/v1",
              apiKey: "",
            }));
          }
        })
        .catch(() => undefined);
    }
  }, []);

  // Auto-connect and load available models on startup or when provider/key is configured
  useEffect(() => {
    if (settings.apiKey || preset.kind === "ollama" || !preset.needsKey) {
      listModels(requestConfig)
        .then((m) => {
          if (m && m.length > 0) {
            setModels(m);
            if (!settings.model || !m.includes(settings.model)) {
              setSettings((s) => ({
                ...s,
                model: s.model && m.includes(s.model) ? s.model : m[0],
              }));
            }
          }
        })
        .catch(() => undefined);
      refreshBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.providerId, settings.apiKey]);

  useEffect(() => {
    const specs: McpSpec[] = config.mcps
      .filter((m) => m.name && m.command)
      .map((m) => ({
        name: m.name,
        command: m.command,
        args: m.args.trim().split(/\s+/).filter(Boolean),
        enabled: m.enabled,
      }));
    mcpConfigure(specs)
      .then(setMcpTools)
      .catch((e) => console.warn("mcp:", e));
  }, [config.mcps]);

  const updateActiveWorkspace = useCallback(
    (
      patch:
        | Partial<SessionWorkspaceState>
        | ((ws: SessionWorkspaceState) => SessionWorkspaceState),
      targetSessionId?: string,
    ) => {
      setSessionState((prev) => {
        const idToUpdate = targetSessionId || prev.activeId;
        return {
          ...prev,
          sessions: prev.sessions.map((s) => {
            if (s.id !== idToUpdate) return s;
            const ws = s.workspace ?? defaultWorkspace();
            const next = typeof patch === "function" ? patch(ws) : { ...ws, ...patch };
            return { ...s, workspace: next };
          }),
        };
      });
    },
    [],
  );

  // Sincroniza el estado (running/completed/error) de CADA sesión de forma aislada
  const prevBusyMapRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    sessions.forEach((s) => {
      const rt = getSessionRuntime(s.id);
      const prev = prevBusyMapRef.current[s.id];
      if (prev !== undefined && prev !== rt.busy) {
        updateActiveWorkspace(
          {
            status: rt.busy ? "running" : rt.error ? "error" : "completed",
          },
          s.id,
        );
      }
      prevBusyMapRef.current[s.id] = rt.busy;
    });
  }, [sessions, busySessionIds, updateActiveWorkspace]);

  const addFolder = useCallback(
    async (pathOverride?: string) => {
      if (pathOverride) {
        const ws = activeWorkspaceRef.current;
        if (!ws.folders.includes(pathOverride)) {
          updateActiveWorkspace({ folders: [...ws.folders, pathOverride] });
        }
        return;
      }
      const p = await pickFolder();
      if (p) {
        const ws = activeWorkspaceRef.current;
        if (!ws.folders.includes(p)) {
          updateActiveWorkspace({ folders: [...ws.folders, p] });
        }
      }
    },
    [updateActiveWorkspace],
  );

  const newWorkspace = useCallback(() => {
    updateActiveWorkspace({ folders: [], openFiles: [], activeFilePath: null, diff: null });
    setWorkspaceName("Workspace");
  }, [updateActiveWorkspace]);

  const removeFolder = useCallback(
    (path: string) => {
      updateActiveWorkspace((ws) => ({
        ...ws,
        folders: ws.folders.filter((x) => x !== path),
      }));
    },
    [updateActiveWorkspace],
  );

  const addUsage = useCallback(
    (id: string, u: ChatUsage, sessionModel?: string) => {
      setLastUsage(u);
      refreshBalance();
      const usedModel = sessionModel || settings.model;
      const turnCost = computeCostUsd(u, modelConfig, usedModel, settings.providerId);
      setSessionState((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => {
          if (s.id !== id) return s;
          const inputTokens = (s.inputTokens ?? 0) + u.inputTokens;
          const outputTokens = (s.outputTokens ?? 0) + u.outputTokens;
          const cachedTokens = (s.cachedTokens ?? 0) + u.cachedTokens;
          return {
            ...s,
            inputTokens,
            outputTokens,
            cachedTokens,
            totalTokens: inputTokens + outputTokens,
            totalCostUsd:
              (s.totalCostUsd ?? 0) + (Number.isFinite(turnCost) ? turnCost : 0),
            updatedAt: Date.now(),
          };
        }),
      }));
    },
    [modelConfig, settings.model, settings.providerId, refreshBalance],
  );

  const isFileSafe = useCallback((path: string): boolean => {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const UNSAFE = ["exe", "dll", "bat", "cmd", "vbs", "ps1", "msi", "scr", "com", "bin", "iso", "sys"];
    return !UNSAFE.includes(ext);
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      const lower = path.toLowerCase();
      // Image or PDF direct visualizers
      if (/\.(png|jpg|jpeg|webp|gif|avif|pdf)$/i.test(lower)) {
        updateActiveWorkspace((ws) => {
          if (ws.openFiles.some((f) => f.path === path)) {
            return { ...ws, activeFilePath: path };
          }
          return {
            ...ws,
            openFiles: [...ws.openFiles, { path, content: "", originalContent: "", isDirty: false }],
            activeFilePath: path,
          };
        });
        return;
      }

      try {
        const raw = await readTextFile(path);
        const content = raw.replace(/\r\n/g, "\n");
        updateActiveWorkspace((ws) => {
          const exists = ws.openFiles.some((f) => f.path === path);
          return {
            ...ws,
            openFiles: exists
              ? ws.openFiles.map((f) =>
                  f.path === path ? { ...f, content, originalContent: content, isDirty: false } : f,
                )
              : [...ws.openFiles, { path, content, originalContent: content, isDirty: false }],
            activeFilePath: path,
          };
        });
      } catch (e) {
        updateActiveWorkspace((ws) => ({
          ...ws,
          openFiles: [
            ...ws.openFiles.filter((f) => f.path !== path),
            { path, content: String(e), isDirty: false },
          ],
          activeFilePath: path,
        }));
      }
    },
    [updateActiveWorkspace],
  );

  const handleDroppedPath = useCallback(
    (droppedPath: string) => {
      if (!droppedPath) return;
      if (!isFileSafe(droppedPath)) {
        const baseName = droppedPath.split(/[\\/]/).pop() || droppedPath;
        showToast(`${t.dragDrop.unsafeFileWarning} (${baseName})`, "warning");
        return;
      }

      const ext = droppedPath.split(".").pop()?.toLowerCase() || "";
      if (ext && ext.length <= 8) {
        openFile(droppedPath);
        const baseName = droppedPath.split(/[\\/]/).pop() || droppedPath;
        showToast(`${t.dragDrop.openedFile} ${baseName}`, "info");
      } else {
        // Treat as directory
        const ws = activeWorkspaceRef.current;
        if (!ws.folders.includes(droppedPath)) {
          updateActiveWorkspace({ folders: [...ws.folders, droppedPath] });
          showToast(`📁 Carpeta añadida al workspace: ${droppedPath.split(/[\\/]/).pop()}`, "info");
        }
      }
    },
    [isFileSafe, openFile, showToast, t, updateActiveWorkspace],
  );

  // Initial CLI Argument file open ("Abrir con..." MakoraIDE)
  useEffect(() => {
    getInitialFile().then((initPath) => {
      if (initPath && isFileSafe(initPath)) {
        openFile(initPath);
        const baseName = initPath.split(/[\\/]/).pop() || initPath;
        showToast(`${t.dragDrop.openedFile} ${baseName}`, "info");
      }
    }).catch(() => undefined);
  }, [isFileSafe, openFile, showToast, t]);

  // Tauri Native Drag-Drop Window Event Listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (event.payload.type === "over" || event.payload.type === "enter") {
          setIsDragging(true);
        } else if (event.payload.type === "leave") {
          setIsDragging(false);
        } else if (event.payload.type === "drop") {
          setIsDragging(false);
          const paths = event.payload.paths;
          if (Array.isArray(paths)) {
            paths.forEach((p) => handleDroppedPath(p));
          }
        }
      }).then((fn) => {
        unlisten = fn;
      }).catch(() => undefined);
    } catch {
      /* ignore */
    }

    return () => {
      unlisten?.();
    };
  }, [handleDroppedPath]);

  const closeFile = useCallback(
    (path: string) => {
      updateActiveWorkspace((ws) => {
        const next = ws.openFiles.filter((f) => f.path !== path);
        const activeFilePath =
          ws.activeFilePath === path
            ? next.length > 0
              ? next[next.length - 1].path
              : null
            : ws.activeFilePath;
        return {
          ...ws,
          openFiles: next,
          activeFilePath,
          diff: ws.activeFilePath === path ? null : ws.diff,
        };
      });
    },
    [updateActiveWorkspace],
  );

  const updateFileContent = useCallback(
    (path: string, content: string) => {
      const normalized = content.replace(/\r\n/g, "\n");
      updateActiveWorkspace((ws) => ({
        ...ws,
        openFiles: ws.openFiles.map((f) => {
          if (f.path !== path) return f;
          const orig =
            f.originalContent !== undefined ? f.originalContent.replace(/\r\n/g, "\n") : undefined;
          const isDirty = orig !== undefined ? normalized !== orig : false;
          return { ...f, content: normalized, isDirty };
        }),
      }));
    },
    [updateActiveWorkspace],
  );

  const saveFile = useCallback(
    async (path: string) => {
      const ws = activeWorkspaceRef.current;
      const file = ws.openFiles.find((f) => f.path === path);
      if (!file) return;
      try {
        const effFolders = ws.folders.length > 0 ? ws.folders : homePath ? [homePath] : [];
        await writeFile(effFolders, path, file.content);
        updateActiveWorkspace((ws2) => ({
          ...ws2,
          openFiles: ws2.openFiles.map((f) =>
            f.path === path ? { ...f, originalContent: file.content, isDirty: false } : f,
          ),
        }));
        setRefreshTick((t) => t + 1);
      } catch (e) {
        console.warn("save file:", e);
      }
    },
    [homePath, updateActiveWorkspace],
  );

  const applyArtifact = useCallback(
    async (path: string, content: string) => {
      try {
        const normalized = content.replace(/\r\n/g, "\n");
        const ws = activeWorkspaceRef.current;
        const effFolders = ws.folders.length > 0 ? ws.folders : homePath ? [homePath] : [];
        const old = await writeFile(effFolders, path, normalized);
        updateActiveWorkspace((ws2) => ({
          ...ws2,
          openFiles: ws2.openFiles.some((f) => f.path === path)
            ? ws2.openFiles.map((f) =>
                f.path === path
                  ? { ...f, content: normalized, originalContent: normalized, isDirty: false }
                  : f,
              )
            : [
                ...ws2.openFiles,
                { path, content: normalized, originalContent: normalized, isDirty: false },
              ],
          activeFilePath: path,
          diff: { before: old ?? "", after: normalized },
        }));
        setRefreshTick((t) => t + 1);
      } catch (e) {
        console.warn("apply artifact:", e);
      }
    },
    [homePath, updateActiveWorkspace],
  );

  const revertDiff = useCallback(async () => {
    const ws = activeWorkspaceRef.current;
    const d = ws.diff ?? null;
    const path = ws.activeFilePath;
    if (!d || !path) return;
    try {
      const beforeNormalized = d.before.replace(/\r\n/g, "\n");
      const effFolders = ws.folders.length > 0 ? ws.folders : homePath ? [homePath] : [];
      await writeFile(effFolders, path, beforeNormalized);
      updateActiveWorkspace((ws2) => ({
        ...ws2,
        openFiles: ws2.openFiles.map((f) =>
          f.path === path
            ? { ...f, content: beforeNormalized, originalContent: beforeNormalized, isDirty: false }
            : f,
        ),
        diff: { before: d.after, after: d.before },
      }));
      setRefreshTick((t) => t + 1);
    } catch (e) {
      console.warn("revert:", e);
    }
  }, [homePath, updateActiveWorkspace]);

  const updateModelConfig = (patch: Partial<ModelConfig>) => {
    if (!settings.model) return;
    setConfig((c) => {
      const exists = c.models.some((m) => m.id === settings.model);
      const fallback: ModelConfig = {
        id: settings.model,
        label: settings.model,
        providerId: settings.providerId,
        thinkingLevel: "medium",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        reasoningEnabled: false,
        visionEnabled: false,
        inputPrice: 0,
        outputPrice: 0,
      };
      const models = exists
        ? c.models.map((m) =>
            m.id === settings.model ? { ...m, ...patch } : m,
          )
        : [...c.models, { ...fallback, ...patch }];
      return { ...c, models };
    });
  };

  const titleGenAttempted = useRef(new Set<string>());
  const maybeGenerateTitle = useCallback(
    (id: string, msgs: ChatMessage[]) => {
      if (titleGenAttempted.current.has(id)) return;
      const firstUser = msgs.find((m) => m.role === "user" && m.content.trim());
      if (!firstUser) return;
      titleGenAttempted.current.add(id);
      generateTitle(requestConfig, firstUser.content.trim().slice(0, 600))
        .then((raw) => {
          const title = (raw || "")
            .trim()
            .replace(/^["'`“”]+|["'`“”]+$/g, "")
            .replace(/^(Título|Title)\s*:\s*/i, "")
            .trim()
            .slice(0, 120);
          if (!title) return;
          setSessionState((prev) => {
            const target = prev.sessions.find((s) => s.id === id);
            if (!target) return prev;
            const nextSessions = prev.sessions.map((s) =>
              s.id === id ? { ...s, title } : s,
            );
            saveSessions(nextSessions);
            return { ...prev, sessions: nextSessions };
          });
        })
        .catch(() => undefined);
    },
    [requestConfig],
  );

  const persistTranscript = useCallback(
    (id: string, messages: ChatMessage[], sessionModel?: string) => {
      if (!id) return;
      const cleaned = sanitizeMessages(messages);
      const current = sessions.find((s) => s.id === id);
      setSessionState((prev) => {
        const target = prev.sessions.find((s) => s.id === id);
        if (!target) return prev;
        const title =
          !target.title || target.title === "Nueva Conversación"
            ? deriveTitle(cleaned)
            : target.title;
        const updated: ChatSession = {
          ...target,
          model: sessionModel || target.model || settings.model,
          title,
          updatedAt: Date.now(),
          messageCount: cleaned.length,
          messages: cleaned,
        };
        // Actualización in-place: las pestañas no se reordenan.
        return {
          ...prev,
          sessions: prev.sessions.map((s) => (s.id === id ? updated : s)),
        };
      });
      if (!current?.title || current.title === "Nueva Conversación") {
        maybeGenerateTitle(id, cleaned);
      }
    },
    [settings.model, sessions, maybeGenerateTitle],
  );

  const handleNewSession = useCallback(() => {
    setSessionState((prev) => {
      // Siempre se crea una pestaña nueva con sesión limpia añadida al historial
      const inheritFolders = [...activeWorkspaceRef.current.folders];
      const fresh = makeSession(settings.model || "", {
        folders: inheritFolders,
        openFiles: [],
        activeFilePath: null,
        status: "idle",
        diff: null,
      });
      const nextSessions = [fresh, ...prev.sessions];
      const nextOpenTabs = [fresh.id, ...prev.openTabIds];
      saveSessions(nextSessions);
      saveOpenTabIds(nextOpenTabs);
      persistActiveSessionId(fresh.id);
      return {
        sessions: nextSessions,
        openTabIds: nextOpenTabs,
        activeId: fresh.id,
      };
    });
  }, [settings.model]);

  // Selecciona o activa una pestaña existente de la barra superior
  const handleSelectSessionTab = useCallback(
    (id: string) => {
      if (id === activeSessionId) return;
      setSessionState((prev) => ({ ...prev, activeId: id }));
      persistActiveSessionId(id);
    },
    [activeSessionId],
  );

  // Abre una sesión desde el modal de Historial (la añade a las pestañas abiertas si estaba cerrada)
  const handleOpenSessionFromHistory = useCallback(
    (id: string) => {
      setSessionState((prev) => {
        const target = prev.sessions.find((s) => s.id === id);
        if (!target) return prev;
        // Re-sembrar el runtime de streaming: al cerrar la pestaña se destruyó
        // (destroySessionRuntime), así que hay que volver a inyectar los
        // mensajes para que el chat no aparezca vacío.
        ensureSessionRuntime(id, target.messages);
        const nextOpenTabs = prev.openTabIds.includes(id)
          ? prev.openTabIds
          : [id, ...prev.openTabIds];
        saveOpenTabIds(nextOpenTabs);
        persistActiveSessionId(id);
        return {
          ...prev,
          openTabIds: nextOpenTabs,
          activeId: id,
        };
      });
      setShowHistory(false);
    },
    [],
  );

  // Cierra exclusivamente la pestaña de la barra superior sin eliminar la sesión del historial
  const handleCloseSessionTab = useCallback(
    (id: string) => {
      cancelTurn(id);
      destroySessionRuntime(id);
      setSessionState((prev) => {
        const nextOpenTabs = prev.openTabIds.filter((tId) => tId !== id);
        let nextActiveId = prev.activeId;
        let nextSessions = prev.sessions;

        if (prev.activeId === id) {
          if (nextOpenTabs.length > 0) {
            nextActiveId = nextOpenTabs[0];
          } else {
            // Si era la única pestaña abierta, crear una nueva sesión limpia
            const fresh = makeSession(settings.model || "");
            nextSessions = [fresh, ...prev.sessions];
            nextOpenTabs.push(fresh.id);
            nextActiveId = fresh.id;
          }
        }

        saveSessions(nextSessions);
        saveOpenTabIds(nextOpenTabs);
        persistActiveSessionId(nextActiveId);

        return {
          sessions: nextSessions,
          openTabIds: nextOpenTabs,
          activeId: nextActiveId,
        };
      });
    },
    [settings.model],
  );

  // Elimina permanentemente una sesión del historial (y de las pestañas si estaba abierta)
  const handleDeleteFromHistory = useCallback(
    (id: string) => {
      cancelTurn(id);
      destroySessionRuntime(id);
      setSessionState((prev) => {
        const remainingSessions = prev.sessions.filter((s) => s.id !== id);
        const remainingTabs = prev.openTabIds.filter((tId) => tId !== id);

        let nextActiveId = prev.activeId;
        let nextSessions = remainingSessions;
        let nextTabs = remainingTabs;

        if (nextSessions.length === 0) {
          const fresh = makeSession(settings.model || "");
          nextSessions = [fresh];
          nextTabs = [fresh.id];
          nextActiveId = fresh.id;
        } else if (prev.activeId === id) {
          if (nextTabs.length > 0) {
            nextActiveId = nextTabs[0];
          } else {
            nextActiveId = nextSessions[0].id;
            nextTabs = [nextSessions[0].id];
          }
        }

        saveSessions(nextSessions);
        saveOpenTabIds(nextTabs);
        persistActiveSessionId(nextActiveId);

        return {
          sessions: nextSessions,
          openTabIds: nextTabs,
          activeId: nextActiveId,
        };
      });
    },
    [settings.model],
  );

  const handleRenameHistorySession = useCallback((id: string, title: string) => {
    setSessionState((prev) => {
      const nextSessions = prev.sessions.map((s) =>
        s.id === id ? { ...s, title: title.trim().slice(0, 120) } : s,
      );
      saveSessions(nextSessions);
      return {
        ...prev,
        sessions: nextSessions,
      };
    });
  }, []);

  const handleClearAllHistory = useCallback(() => {
    setSessionState((prev) => {
      prev.sessions.forEach((s) => {
        cancelTurn(s.id);
        destroySessionRuntime(s.id);
      });
      const fresh = makeSession(settings.model || "");
      const nextSessions = [fresh];
      const nextTabs = [fresh.id];
      saveSessions(nextSessions);
      saveOpenTabIds(nextTabs);
      persistActiveSessionId(fresh.id);
      return {
        sessions: nextSessions,
        openTabIds: nextTabs,
        activeId: fresh.id,
      };
    });
  }, [settings.model]);

  // Terminal: el cwd se fija al abrir el terminal en el workspace activo de ese momento.
  const toggleTerminal = useCallback(() => {
    setTerminalOpen((prev) => !prev);
  }, []);

  const terminalCwd = useMemo(() => {
    const ws = activeWorkspaceRef.current;
    if (ws.folders.length > 0) return ws.folders[0];
    return homePath || undefined;
  }, [terminalOpen, homePath]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      if (isCmdOrCtrl && (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "k")) {
        e.preventDefault();
        setShowPalette((prev) => !prev);
      } else if (isCmdOrCtrl && (e.key.toLowerCase() === "l" || e.key.toLowerCase() === "t")) {
        e.preventDefault();
        handleNewSession();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setExplorerOpen((prev) => !prev);
      } else if (isCmdOrCtrl && (e.key.toLowerCase() === "j" || e.key === "`")) {
        e.preventDefault();
        toggleTerminal();
      } else if (isCmdOrCtrl && e.key === ",") {
        e.preventDefault();
        setShowSettings((prev) => !prev);
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setShowHistory((prev) => !prev);
      } else if (e.key === "F11" || (e.altKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        setZenMode((z) => !z);
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "w") {
        if (activePath) {
          e.preventDefault();
          closeFile(activePath);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [activePath, closeFile, toggleTerminal, handleNewSession]);

  // Chat Element instance to pass into Workspace (memoized; survives re-renders).
  const chatNode = useMemo(() => {
    if (!activeSessionId) return null;
    return (
      <Chat
        key={activeSessionId}
        sessionId={activeSessionId}
        config={requestConfig}
        ready={settings.model !== ""}
        folders={effectiveFolders}
        skillsContent={skillsContent}
        thinkingLevel={thinkingLevel}
        onSelectThinkingLevel={(t) => updateModelConfig({ thinkingLevel: t })}
        models={models}
        activeModel={settings.model}
        onSelectModel={(m) => setSettings((s) => ({ ...s, model: m }))}
        includeWorkspace={config.context.includeWorkspace}
        visionEnabled={modelConfig?.visionEnabled ?? false}
        blocked={balanceBlocked}
        blockReason={blockReason}
        agentMode={activeWorkspace.agentMode ?? "act"}
        onToggleMode={(mode) => updateActiveWorkspace((w) => ({ ...w, agentMode: mode }), activeSessionId)}
        multiAgentMode={activeWorkspace.multiAgentMode ?? "auto"}
        onToggleMultiAgentMode={(mam) => updateActiveWorkspace((w) => ({ ...w, multiAgentMode: mam }), activeSessionId)}
        modelConfig={modelConfig}
        providerId={settings.providerId}
        onUsage={(u) => addUsage(activeSessionId, u, settings.model)}
        onApplyArtifact={applyArtifact}
        onClearSessionTrigger={handleNewSession}
        onTranscriptChange={(m) => persistTranscript(activeSessionId, m, settings.model)}
        injectedPrompt={injectedPrompt}
        onClearInjectedPrompt={() => setInjectedPrompt(null)}
        budgetUsd={settings.maxCostPerTurn > 0 ? settings.maxCostPerTurn : null}
      />
    );
  }, [
    activeSessionId,
    requestConfig,
    settings.model,
    effectiveFolders,
    skillsContent,
    thinkingLevel,
    models,
    config.context.includeWorkspace,
    modelConfig,
    balanceBlocked,
    blockReason,
    activeWorkspace.agentMode,
    activeWorkspace.multiAgentMode,
    settings.providerId,
    addUsage,
    applyArtifact,
    handleNewSession,
    persistTranscript,
    injectedPrompt,
    updateActiveWorkspace,
  ]);

  const agentBusy = activeRuntime.busy;
  const runningToolName = activeRuntime.runningTool;

  const showLeftSidebar = explorerOpen && !zenMode;
  const showRightPanel = panelOpen && !zenMode;

  return (
    <div
      className={`app ${zenMode ? "zen-mode-active" : ""}`}
      data-glass={glassMode}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          for (let i = 0; i < e.dataTransfer.files.length; i++) {
            const file = e.dataTransfer.files[i];
            const filePath = (file as unknown as { path?: string }).path || file.name;
            handleDroppedPath(filePath);
          }
        }
      }}
    >
      <AmbientCanvas3D currentTheme={theme} />

      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="app-drag-overlay">
          <div className="app-drag-box">
            <UploadCloud className="app-drag-icon" />
            <h2 className="app-drag-title">{t.dragDrop.dropHere}</h2>
            <p className="app-drag-subtitle">{t.dragDrop.dropSubtitle}</p>
          </div>
        </div>
      )}

      {/* Interactive Toasts Container */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-msg ${toast.type}`}>
              {toast.type === "warning" ? (
                <AlertTriangle size={15} className="text-gold" />
              ) : (
                <CheckCircle2 size={15} className="text-cyan" />
              )}
              <span>{toast.message}</span>
              <button
                className="icon-btn-micro"
                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
                style={{ marginLeft: 6, opacity: 0.7 }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <Header
        workspaceName={workspaceName}
        onWorkspaceName={setWorkspaceName}
        folderCount={folders.length}
        onAddFolder={() => addFolder()}
        onNewWorkspace={newWorkspace}
        onOpenSettings={() => setShowSettings(true)}
        onOpenPalette={() => setShowPalette(true)}
        onOpenHistory={() => setShowHistory(true)}
        explorerOpen={explorerOpen}
        onToggleExplorer={() => setExplorerOpen((prev) => !prev)}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((prev) => !prev)}
        currentTheme={theme}
        onSelectTheme={setTheme}
        glassMode={glassMode}
        onToggleGlassMode={toggleGlassMode}
      />

      <WorkspaceTabBar
        sessions={openSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSessionTab}
        onNewSession={handleNewSession}
        onCloseSession={handleCloseSessionTab}
        runningSessionIds={busySessionIds}
      />

      <div className="layout-root">
        {/* Left Explorer Sidebar */}
        {showLeftSidebar && (
          <>
            <aside className="sidebar-explorer" style={{ width: `${explorerWidth}px` }}>
              <Explorer
                folders={folders}
                activePath={activePath}
                onRemoveFolder={removeFolder}
                onCollapse={() => setExplorerOpen(false)}
                onOpenFile={openFile}
                onChanged={() => setRefreshTick((t) => t + 1)}
                refreshTick={refreshTick}
              />
            </aside>
            <div
              className="resizer-col resizer-explorer"
              onMouseDown={handleExplorerResize}
              title="Arrastrar para redimensionar explorador"
            />
          </>
        )}

        {/* Central Master Workspace & Terminal */}
        <main className="central-area">
          <UnifiedWorkspace
            openFiles={openFiles}
            activePath={activePath}
            onActivateFile={(path) => updateActiveWorkspace({ activeFilePath: path })}
            onCloseFile={closeFile}
            onUpdateContent={updateFileContent}
            onSaveFile={saveFile}
            diff={diff}
            onRevertDiff={revertDiff}
            agentBusy={agentBusy}
            runningToolName={runningToolName}
            isSplit={isSplit}
            onToggleSplit={() => setIsSplit((s) => !s)}
            zenMode={zenMode}
            onToggleZenMode={() => setZenMode((z) => !z)}
            chatElement={chatNode}
            onNewChat={handleNewSession}
            onAskAgent={(prompt) => {
              updateActiveWorkspace({ activeFilePath: null });
              setInjectedPrompt(prompt);
            }}
          />

          {terminalOpen && (
            <>
              <div
                className="resizer-row resizer-terminal"
                onMouseDown={handleTerminalResize}
                title="Arrastrar para redimensionar terminal"
              />
              <div className="bottom-terminal-drawer" style={{ height: `${terminalHeight}px` }}>
                <TerminalPanel
                  cwd={terminalCwd}
                  currentTheme={theme}
                  onCollapse={() => setTerminalOpen(false)}
                />
              </div>
            </>
          )}
        </main>

        {/* Right Parameters and Usage Panel */}
        {showRightPanel && (
          <>
            <div
              className="resizer-col resizer-usage"
              onMouseDown={handleUsagePanelResize}
              title="Arrastrar para redimensionar panel de parámetros"
            />
            <aside className="sidebar-usage-panel" style={{ width: `${usagePanelWidth}px` }}>
              <UsagePanel
                settings={settings}
                onSettings={setSettings}
                models={models}
                modelsError={modelsError}
                connecting={connecting}
                onConnect={connect}
                usage={usage}
                thinkingLevel={thinkingLevel}
                onThinkingLevel={(th) => updateModelConfig({ thinkingLevel: th })}
                balance={balance}
                balanceLoading={balanceLoading}
                costUsd={costUsd}
                onRefreshBalance={() => refreshBalance(true)}
                onCollapse={() => setPanelOpen(false)}
                contextWindow={modelConfig?.contextWindow ?? 128000}
                lastUsage={lastUsage}
                mcpTools={mcpTools}
                onProfile={(p) =>
                  updateModelConfig({
                    thinkingLevel: p.thinking,
                    reasoningEnabled: p.reasoning,
                  })
                }
              />
            </aside>
          </>
        )}
      </div>

      <StatusBar
        workspaceName={workspaceName}
        folderCount={folders.length}
        gitInfo={gitInfo}
        activeModel={settings.model}
        agentBusy={agentBusy}
        runningToolName={runningToolName}
        usage={usage}
        costUsd={costUsd}
        currentTheme={theme}
        onCycleTheme={cycleTheme}
        onToggleTerminal={toggleTerminal}
        onOpenPalette={() => setShowPalette(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenGit={() => setShowGitModal(true)}
        onOpenAnalytics={() => setShowAnalyticsModal(true)}
      />

      <CommandPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        folders={effectiveFolders}
        onOpenFile={openFile}
        onSelectTheme={setTheme}
        onToggleTerminal={toggleTerminal}
        onToggleExplorer={() => setExplorerOpen((prev) => !prev)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenOnboarding={() => setShowOnboarding(true)}
        onOpenGit={() => setShowGitModal(true)}
        onOpenAnalytics={() => setShowAnalyticsModal(true)}
        onToggleMode={() => updateActiveWorkspace((w) => ({ ...w, agentMode: w.agentMode === "plan" ? "act" : "plan" }))}
        onAddFolder={() => addFolder()}
        onNewWorkspace={newWorkspace}
        onClearChat={handleNewSession}
        onOpenHistory={() => setShowHistory(true)}
      />

      <Suspense fallback={null}>
        {showSettings && (
          <SettingsModal
            config={config}
            onConfig={setConfig}
            settings={settings}
            onSaveSettings={setSettings}
            models={models}
            connecting={connecting}
            modelsError={modelsError}
            connectionSuccess={connectionSuccess}
            onConnect={connect}
            currentTheme={theme}
            onSelectTheme={setTheme}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showOnboarding && (
          <OnboardingModal
            isOpen={showOnboarding}
            onClose={() => setShowOnboarding(false)}
            settings={settings}
            onSaveSettings={setSettings}
            currentTheme={theme}
            onSelectTheme={setTheme}
            folders={folders}
            onAddFolder={(p) => addFolder(p)}
          />
        )}

        {showGitModal && (
          <GitModal
            folder={effectiveFolders[0] || ""}
            onClose={() => {
              setShowGitModal(false);
              setRefreshTick((t) => t + 1);
              checkGitStatus();
            }}
            onRefreshWorkspace={() => {
              setRefreshTick((t) => t + 1);
              checkGitStatus();
            }}
          />
        )}

        {showAnalyticsModal && (
          <AnalyticsModal
            settings={settings}
            usage={usage}
            lastUsage={lastUsage}
            balance={balance}
            balanceLoading={balanceLoading}
            costUsd={costUsd}
            onRefreshBalance={refreshBalance}
            onClose={() => setShowAnalyticsModal(false)}
          />
        )}

        {showShortcuts && (
          <ShortcutsModal
            isOpen={showShortcuts}
            onClose={() => setShowShortcuts(false)}
          />
        )}

        {showHistory && (
          <HistoryModal
            isOpen={showHistory}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onOpen={handleOpenSessionFromHistory}
            onNew={handleNewSession}
            onDelete={handleDeleteFromHistory}
            onRename={handleRenameHistorySession}
            onClearAll={handleClearAllHistory}
            onClose={() => setShowHistory(false)}
          />
        )}

        {showEula && (
          <BetaAgreementModal
            isOpen={showEula}
            isExpired={isBetaExpired}
            expirationError={betaExpirationError}
            onAccept={() => {
              localStorage.setItem("makora_eula_accepted", "true");
              setShowEula(false);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

export default App;
