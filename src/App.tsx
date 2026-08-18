import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchBalance,
  gitStatus,
  homeDir,
  keyringGet,
  keyringSet,
  listModels,
  mcpConfigure,
  pickFolder,
  readTextFile,
  writeFile,
} from "./api";
import { presetById } from "./providers";
import { DEFAULT_CONFIG } from "./defaults";
import { applyTheme, loadSavedTheme, THEME_LIST } from "./themes";
import Header from "./components/Header";
import Explorer from "./components/Explorer";
import Chat from "./components/Chat";
import UsagePanel from "./components/UsagePanel";
import SettingsModal from "./components/SettingsModal";
import TerminalPanel from "./components/TerminalPanel";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import OnboardingModal from "./components/OnboardingModal";
import UnifiedWorkspace from "./components/UnifiedWorkspace";
import GitModal from "./components/GitModal";
import AnalyticsModal from "./components/AnalyticsModal";


import type {
  AgentMode,
  AppConfig,
  BalanceInfo,
  ChatConfig,
  ChatUsage,
  DiffInfo,
  GitStatusInfo,
  McpSpec,
  ModelConfig,
  OpenFile,
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
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("makora.settings");
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

function loadFolders(): string[] {
  try {
    const raw = localStorage.getItem("makora.folders");
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem("makora.config");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      const models = (parsed.models ?? DEFAULT_CONFIG.models).map((m) => ({
        ...(DEFAULT_CONFIG.models.find((d) => d.id === m.id) ?? {}),
        ...m,
        inputPrice: m.inputPrice ?? 0,
        outputPrice: m.outputPrice ?? 0,
        visionEnabled: m.visionEnabled ?? false,
      }));
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
  const [folders, setFolders] = useState<string[]>(loadFolders);
  const [workspaceName, setWorkspaceName] = useState(
    () => localStorage.getItem("makora.wsname") ?? "Workspace",
  );
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [config, setConfig] = useState<AppConfig>(loadConfig);
  const [theme, setTheme] = useState<ThemeId>(loadSavedTheme);
  const [agentMode, setAgentMode] = useState<AgentMode>("act");
  const [isSplit, setIsSplit] = useState(false);
  const [zenMode, setZenMode] = useState(false);


  const [explorerOpen, setExplorerOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  const [models, setModels] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage>({
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showGitModal, setShowGitModal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);

  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [homePath, setHomePath] = useState<string>("");
  const lastBalanceAt = useRef<number>(0);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffInfo | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mcpTools, setMcpTools] = useState<string[]>([]);
  const [lastUsage, setLastUsage] = useState<ChatUsage | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [runningToolName, setRunningToolName] = useState<string | null>(null);
  const [gitInfo, setGitInfo] = useState<GitStatusInfo | null>(null);

  // Apply theme on load and change
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("makora.theme", theme);
  }, [theme]);

  // Load API key securely from OS Keyring
  useEffect(() => {
    keyringGet(settings.providerId)
      .then((key) => {
        if (key && !settings.apiKey) {
          setSettings((s) => ({ ...s, apiKey: key }));
        }
      })
      .catch(() => undefined);
  }, [settings.providerId]);

  // Sync API key updates to OS Keyring
  useEffect(() => {
    if (settings.apiKey) {
      keyringSet(settings.providerId, settings.apiKey).catch(() => undefined);
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

  const effectiveFolders =
    folders.length > 0 ? folders : homePath ? [homePath] : [];

  // Poll Git Status for active folder
  useEffect(() => {
    if (effectiveFolders.length > 0) {
      gitStatus(effectiveFolders[0])
        .then(setGitInfo)
        .catch(() => setGitInfo(null));
    } else {
      setGitInfo(null);
    }
  }, [effectiveFolders, refreshTick]);

  const preset = presetById(settings.providerId);
  const modelConfig = config.models.find((m) => m.id === settings.model);
  const thinkingLevel: ThinkingLevel = modelConfig?.thinkingLevel ?? "medium";

  const requestConfig: ChatConfig = {
    kind: preset.kind,
    baseUrl: settings.baseUrl || preset.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    reasoningEffort: modelConfig?.reasoningEnabled ? modelConfig.thinkingLevel : null,
    maxOutputTokens: modelConfig?.maxOutputTokens ?? null,
    temperature: null,
    visionEnabled: modelConfig?.visionEnabled ?? false,
  };

  const skillsContent = config.skills
    .map((s) => `### ${s.name}\n${s.content}`)
    .join("\n\n");

  const costUsd = modelConfig
    ? (usage.inputTokens * modelConfig.inputPrice +
        usage.outputTokens * modelConfig.outputPrice) /
      1_000_000
    : 0;

  const balanceBlocked =
    balance !== null && balance.amount > 0 && costUsd >= balance.amount;
  const blockReason = balance
    ? `Coste de sesión (${costUsd.toFixed(4)} ${balance.currency}) ≥ saldo (${balance.amount.toFixed(2)} ${balance.currency}).`
    : "";

  useEffect(() => {
    localStorage.setItem("makora.settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    localStorage.setItem("makora.folders", JSON.stringify(folders));
  }, [folders]);
  useEffect(() => {
    localStorage.setItem("makora.wsname", workspaceName);
  }, [workspaceName]);
  useEffect(() => {
    localStorage.setItem("makora.config", JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    setModels([]);
    setModelsError(null);
    setBalance(null);
    if (settings.providerId !== "custom") {
      setSettings((s) => ({ ...s, baseUrl: presetById(settings.providerId).baseUrl }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.providerId]);

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

  const refreshBalance = async (force = false) => {
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
  };

  const connect = async () => {
    setConnecting(true);
    setModelsError(null);
    try {
      const m = await listModels(requestConfig);
      setModels(m);
      if (!settings.model && m.length) setSettings((s) => ({ ...s, model: m[0] }));
      refreshBalance();
    } catch (e) {
      setModelsError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const addFolder = async (pathOverride?: string) => {
    if (pathOverride) {
      if (!folders.includes(pathOverride)) setFolders((f) => [...f, pathOverride]);
      return;
    }
    const p = await pickFolder();
    if (p && !folders.includes(p)) setFolders((f) => [...f, p]);
  };

  const newWorkspace = () => {
    setFolders([]);
    setWorkspaceName("Workspace");
  };

  const removeFolder = (path: string) =>
    setFolders((f) => f.filter((x) => x !== path));

  const addUsage = (u: ChatUsage) => {
    setUsage((prev) => ({
      inputTokens: prev.inputTokens + u.inputTokens,
      outputTokens: prev.outputTokens + u.outputTokens,
      cachedTokens: prev.cachedTokens + u.cachedTokens,
    }));
    setLastUsage(u);
    refreshBalance();
  };

  const openFile = useCallback(async (path: string) => {
    try {
      const raw = await readTextFile(path);
      const content = raw.replace(/\r\n/g, "\n");
      setOpenFiles((fs) => {
        if (fs.some((f) => f.path === path)) {
          return fs.map((f) => (f.path === path ? { ...f, content, originalContent: content, isDirty: false } : f));
        }
        return [...fs, { path, content, originalContent: content, isDirty: false }];
      });
      setActivePath(path);
    } catch (e) {
      setOpenFiles((fs) => [...fs.filter((f) => f.path !== path), { path, content: String(e), isDirty: false }]);
      setActivePath(path);
    }
  }, []);

  const closeFile = useCallback((path: string) => {
    setOpenFiles((fs) => {
      const next = fs.filter((f) => f.path !== path);
      if (activePath === path) {
        const remaining = next.length > 0 ? next[next.length - 1].path : null;
        setActivePath(remaining);
      }
      return next;
    });
    setDiff((d) => (d && activePath === path ? null : d));
  }, [activePath]);

  const updateFileContent = (path: string, content: string) => {
    const normalized = content.replace(/\r\n/g, "\n");
    setOpenFiles((fs) =>
      fs.map((f) => {
        if (f.path === path) {
          const orig = f.originalContent !== undefined ? f.originalContent.replace(/\r\n/g, "\n") : undefined;
          const isDirty = orig !== undefined ? normalized !== orig : false;
          return { ...f, content: normalized, isDirty };
        }
        return f;
      }),
    );
  };

  const saveFile = async (path: string) => {
    const file = openFiles.find((f) => f.path === path);
    if (!file) return;
    try {
      await writeFile(effectiveFolders, path, file.content);
      setOpenFiles((fs) =>
        fs.map((f) => (f.path === path ? { ...f, originalContent: file.content, isDirty: false } : f)),
      );
      setRefreshTick((t) => t + 1);
    } catch (e) {
      console.warn("save file:", e);
    }
  };

  const applyArtifact = async (path: string, content: string) => {
    try {
      const normalized = content.replace(/\r\n/g, "\n");
      const old = await writeFile(effectiveFolders, path, normalized);
      setDiff({ before: old ?? "", after: normalized });
      setOpenFiles((fs) =>
        fs.some((f) => f.path === path)
          ? fs.map((f) => (f.path === path ? { ...f, content: normalized, originalContent: normalized, isDirty: false } : f))
          : [...fs, { path, content: normalized, originalContent: normalized, isDirty: false }],
      );
      setActivePath(path);
      setRefreshTick((t) => t + 1);
    } catch (e) {
      console.warn("apply artifact:", e);
    }
  };

  const revertDiff = async () => {
    if (!diff || !activePath) return;
    try {
      const beforeNormalized = diff.before.replace(/\r\n/g, "\n");
      await writeFile(effectiveFolders, activePath, beforeNormalized);
      setDiff({ before: diff.after, after: diff.before });
      setOpenFiles((fs) =>
        fs.map((f) => (f.path === activePath ? { ...f, content: beforeNormalized, originalContent: beforeNormalized, isDirty: false } : f)),
      );
      setRefreshTick((t) => t + 1);
    } catch (e) {
      console.warn("revert:", e);
    }
  };


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

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      if (isCmdOrCtrl && (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "k")) {
        e.preventDefault();
        setShowPalette((prev) => !prev);
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setExplorerOpen((prev) => !prev);
      } else if (isCmdOrCtrl && (e.key.toLowerCase() === "j" || e.key === "`")) {
        e.preventDefault();
        setTerminalOpen((prev) => !prev);
      } else if (isCmdOrCtrl && e.key === ",") {
        e.preventDefault();
        setShowSettings((prev) => !prev);
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
  }, [activePath, closeFile]);

  // Chat Element instance to pass into Workspace
  const chatNode = (
    <Chat
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
      agentMode={agentMode}
      onToggleMode={setAgentMode}
      onUsage={addUsage}
      onApplyArtifact={applyArtifact}
      onStatusChange={(busy, tool) => {
        setAgentBusy(busy);
        setRunningToolName(tool);
      }}
    />
  );


  const showLeftSidebar = explorerOpen && !zenMode;
  const showRightPanel = panelOpen && !zenMode;

  return (
    <div className={`app ${zenMode ? "zen-mode-active" : ""}`}>
      <Header
        workspaceName={workspaceName}
        onWorkspaceName={setWorkspaceName}
        folderCount={folders.length}
        onAddFolder={() => addFolder()}
        onNewWorkspace={newWorkspace}
        onOpenSettings={() => setShowSettings(true)}
        onOpenPalette={() => setShowPalette(true)}
        onOpenOnboarding={() => setShowOnboarding(true)}
        explorerOpen={explorerOpen}
        onToggleExplorer={() => setExplorerOpen((prev) => !prev)}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((prev) => !prev)}
        currentTheme={theme}
        onSelectTheme={setTheme}
      />

      <div className="layout-root">
        {/* Left Explorer Sidebar */}
        {showLeftSidebar && (
          <aside className="sidebar-explorer">
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
        )}

        {/* Central Master Workspace & Terminal */}
        <main className="central-area">
          <UnifiedWorkspace
            openFiles={openFiles}
            activePath={activePath}
            onActivateFile={setActivePath}
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
          />


          {terminalOpen && (
            <div className="bottom-terminal-drawer">
              <TerminalPanel
                cwd={effectiveFolders[0] || homePath || null}
                currentTheme={theme}
                onCollapse={() => setTerminalOpen(false)}
              />
            </div>
          )}
        </main>

        {/* Right Parameters and Usage Panel */}
        {showRightPanel && (
          <aside className="sidebar-usage-panel">
            <UsagePanel
              settings={settings}
              onSettings={setSettings}
              models={models}
              modelsError={modelsError}
              connecting={connecting}
              onConnect={connect}
              usage={usage}
              thinkingLevel={thinkingLevel}
              onThinkingLevel={(t) => updateModelConfig({ thinkingLevel: t })}
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
        onToggleTerminal={() => setTerminalOpen((prev) => !prev)}
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
        onToggleTerminal={() => setTerminalOpen((prev) => !prev)}
        onToggleExplorer={() => setExplorerOpen((prev) => !prev)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenOnboarding={() => setShowOnboarding(true)}
        onToggleMode={() => setAgentMode((m) => (m === "act" ? "plan" : "act"))}
        onAddFolder={() => addFolder()}
        onNewWorkspace={newWorkspace}
        onClearChat={() => undefined}
      />

      {showSettings && (
        <SettingsModal
          config={config}
          onConfig={setConfig}
          settings={settings}
          onSaveSettings={setSettings}
          models={models}
          connecting={connecting}
          modelsError={modelsError}
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
          onClose={() => setShowGitModal(false)}
          onRefreshWorkspace={() => setRefreshTick((t) => t + 1)}
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
    </div>
  );
}

export default App;

