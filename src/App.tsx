import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  fetchBalance,
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
import SplitPane from "./core/SplitPane";
import Header from "./components/Header";
import Explorer from "./components/Explorer";
import Chat from "./components/Chat";
import UsagePanel from "./components/UsagePanel";
import SettingsModal from "./components/SettingsModal";
import TerminalPanel from "./components/TerminalPanel";
import EditorPanel from "./components/EditorPanel";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import OnboardingModal from "./components/OnboardingModal";
import type {
  AgentMode,
  AppConfig,
  BalanceInfo,
  ChatConfig,
  ChatUsage,
  DiffInfo,
  LayoutState,
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

const DEFAULT_LAYOUT: LayoutState = {
  explorer: 270,
  right: 320,
  term: 190,
  editor: 260,
  explorerCollapsed: false,
  rightCollapsed: false,
  termCollapsed: false,
  editorCollapsed: false,
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

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem("makora.layout");
    if (raw) return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_LAYOUT;
}

function PanelShell({
  collapsed,
  label,
  horizontal,
  onExpand,
  children,
}: {
  collapsed: boolean;
  label: string;
  horizontal?: boolean;
  onExpand: () => void;
  children: ReactNode;
}) {
  if (!collapsed) return <>{children}</>;
  return (
    <div
      className={"panel-collapsed" + (horizontal ? " horizontal" : "")}
      title={`Expandir ${label}`}
    >
      <button className="icon-btn" onClick={onExpand}>
        {horizontal ? "▴" : "▸"}
      </button>
      <span className="collapsed-label">{label}</span>
    </div>
  );
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
  const [layout, setLayout] = useState<LayoutState>(loadLayout);
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
    ? `Coste de sesión (${costUsd.toFixed(4)} ${balance.currency}) ≥ saldo (${balance.amount.toFixed(2)} ${balance.currency}). El único límite es el saldo: recarga o cambia de proveedor.`
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
    localStorage.setItem("makora.layout", JSON.stringify(layout));
  }, [layout]);

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
      const content = await readTextFile(path);
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
    setOpenFiles((fs) => fs.filter((f) => f.path !== path));
    setActivePath((a) => (a === path ? null : a));
    setDiff((d) => (d && activePath === path ? null : d));
  }, [activePath]);

  const updateFileContent = (path: string, content: string) => {
    setOpenFiles((fs) =>
      fs.map((f) => {
        if (f.path === path) {
          const isDirty = f.originalContent !== undefined ? content !== f.originalContent : true;
          return { ...f, content, isDirty };
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
    } catch (e) {
      console.warn("save file:", e);
    }
  };

  const applyArtifact = async (path: string, content: string) => {
    try {
      const old = await writeFile(effectiveFolders, path, content);
      setDiff({ before: old ?? "", after: content });
      setOpenFiles((fs) =>
        fs.some((f) => f.path === path)
          ? fs.map((f) => (f.path === path ? { ...f, content, originalContent: content, isDirty: false } : f))
          : [...fs, { path, content, originalContent: content, isDirty: false }],
      );
      setActivePath(path);
    } catch (e) {
      console.warn("apply artifact:", e);
    }
  };

  const revertDiff = async () => {
    if (!diff || !activePath) return;
    try {
      await writeFile(effectiveFolders, activePath, diff.before);
      setDiff({ before: diff.after, after: diff.before });
      setOpenFiles((fs) =>
        fs.map((f) => (f.path === activePath ? { ...f, content: diff.before, originalContent: diff.before, isDirty: false } : f)),
      );
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
        setLayout((l) => ({ ...l, explorerCollapsed: !l.explorerCollapsed }));
      } else if (isCmdOrCtrl && (e.key.toLowerCase() === "j" || e.key === "`")) {
        e.preventDefault();
        setLayout((l) => ({ ...l, termCollapsed: !l.termCollapsed }));
      } else if (isCmdOrCtrl && e.key === ",") {
        e.preventDefault();
        setShowSettings((prev) => !prev);
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

  return (
    <div className="app">
      <Header
        workspaceName={workspaceName}
        onWorkspaceName={setWorkspaceName}
        folderCount={folders.length}
        onAddFolder={() => addFolder()}
        onNewWorkspace={newWorkspace}
        onOpenSettings={() => setShowSettings(true)}
        onOpenPalette={() => setShowPalette(true)}
        onOpenOnboarding={() => setShowOnboarding(true)}
        currentTheme={theme}
        onSelectTheme={setTheme}
      />
      <div className="layout">
        <SplitPane
          direction="horizontal"
          sizes={[layout.explorer, 0, layout.right]}
          minSizes={[200, 0, 280]}
          collapsed={[layout.explorerCollapsed, false, layout.rightCollapsed]}
          onSizes={(s) => setLayout((l) => ({ ...l, explorer: s[0], right: s[2] }))}
          onToggle={(i) =>
            setLayout((l) =>
              i === 0
                ? { ...l, explorerCollapsed: !l.explorerCollapsed }
                : { ...l, rightCollapsed: !l.rightCollapsed },
            )
          }
          flexIndex={1}
        >
          <PanelShell
            collapsed={layout.explorerCollapsed}
            label="Explorador"
            onExpand={() =>
              setLayout((l) => ({ ...l, explorerCollapsed: false }))
            }
          >
            <Explorer
              folders={folders}
              activePath={activePath}
              onRemoveFolder={removeFolder}
              onCollapse={() =>
                setLayout((l) => ({ ...l, explorerCollapsed: true }))
              }
              onOpenFile={openFile}
              onChanged={() => setRefreshTick((t) => t + 1)}
              refreshTick={refreshTick}
            />
          </PanelShell>
          <SplitPane
            direction="vertical"
            sizes={[layout.editor, 0, layout.term]}
            minSizes={[120, 0, 110]}
            collapsed={[layout.editorCollapsed, false, layout.termCollapsed]}
            onSizes={(s) =>
              setLayout((l) => ({ ...l, editor: s[0], term: s[2] }))
            }
            onToggle={(i) =>
              setLayout((l) =>
                i === 0
                  ? { ...l, editorCollapsed: !l.editorCollapsed }
                  : { ...l, termCollapsed: !l.termCollapsed },
              )
            }
            flexIndex={1}
          >
            <PanelShell
              collapsed={layout.editorCollapsed}
              label="Visor"
              horizontal
              onExpand={() =>
                setLayout((l) => ({ ...l, editorCollapsed: false }))
              }
            >
              <EditorPanel
                files={openFiles}
                activePath={activePath}
                diff={diff}
                onActivate={setActivePath}
                onClose={closeFile}
                onCollapse={() =>
                  setLayout((l) => ({ ...l, editorCollapsed: true }))
                }
                onRevertDiff={revertDiff}
                onUpdateContent={updateFileContent}
                onSaveFile={saveFile}
              />
            </PanelShell>
            <Chat
              config={requestConfig}
              ready={settings.model !== ""}
              folders={effectiveFolders}
              skillsContent={skillsContent}
              thinkingLevel={thinkingLevel}
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
            <PanelShell
              collapsed={layout.termCollapsed}
              label="Terminal"
              horizontal
              onExpand={() =>
                setLayout((l) => ({ ...l, termCollapsed: false }))
              }
            >
              <TerminalPanel
                cwd={effectiveFolders[0] || homePath || null}
                currentTheme={theme}
                onCollapse={() =>
                  setLayout((l) => ({ ...l, termCollapsed: true }))
                }
              />
            </PanelShell>
          </SplitPane>
          <PanelShell
            collapsed={layout.rightCollapsed}
            label="Panel"
            onExpand={() =>
              setLayout((l) => ({ ...l, rightCollapsed: false }))
            }
          >
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
              onCollapse={() =>
                setLayout((l) => ({ ...l, rightCollapsed: true }))
              }
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
          </PanelShell>
        </SplitPane>
      </div>

      <StatusBar
        workspaceName={workspaceName}
        folderCount={folders.length}
        activeModel={settings.model}
        agentBusy={agentBusy}
        runningToolName={runningToolName}
        usage={usage}
        costUsd={costUsd}
        currentTheme={theme}
        onCycleTheme={cycleTheme}
        onToggleTerminal={() =>
          setLayout((l) => ({ ...l, termCollapsed: !l.termCollapsed }))
        }
        onOpenPalette={() => setShowPalette(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <CommandPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        folders={effectiveFolders}
        onOpenFile={openFile}
        onSelectTheme={setTheme}
        onToggleTerminal={() =>
          setLayout((l) => ({ ...l, termCollapsed: !l.termCollapsed }))
        }
        onToggleExplorer={() =>
          setLayout((l) => ({ ...l, explorerCollapsed: !l.explorerCollapsed }))
        }
        onOpenSettings={() => setShowSettings(true)}
        onOpenOnboarding={() => setShowOnboarding(true)}
        onToggleMode={() => setAgentMode((m) => (m === "act" ? "plan" : "act"))}
        onAddFolder={() => addFolder()}
        onNewWorkspace={newWorkspace}
        onClearChat={() => {
          // Handled via clearChat in chat
        }}
      />

      {showSettings && (
        <SettingsModal
          config={config}
          onConfig={setConfig}
          onClose={() => setShowSettings(false)}
          currentTheme={theme}
          onSelectTheme={setTheme}
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
    </div>
  );
}

export default App;
