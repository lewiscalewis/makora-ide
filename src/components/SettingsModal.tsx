import { useState, useEffect } from "react";
import {
  THINKING_LEVELS,
  isModelReasoningSupported,
  isModelVisionSupported,
  inferModelConfig,
} from "../defaults";
import { THEME_LIST } from "../themes";
import { PROVIDERS, presetById } from "../providers";
import { detectOllama, keyringGet, keyringSet, listModels } from "../api";
import { useI18n, LANGUAGE_LIST } from "../i18n";
import { addVaultEntry, getVaultKey, loadVault, removeVaultEntry, touchVaultEntry } from "../vault";
import {
  Key,
  Cpu,
  Layers,
  Sparkles,
  Network,
  Palette,
  X,
  Plus,
  Trash2,
  Check,
  Sliders,
  ShieldCheck,
  Zap,
  Eye,
  EyeOff,
  Server,
  HardDrive,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Loader2,
  Vault,
} from "lucide-react";

import type {
  AppConfig,
  McpConfig,
  ModelConfig,
  Settings,
  SkillConfig,
  ThemeId,
  ThinkingLevel,
  VaultKeyEntry,
} from "../types";

type Tab = "providers" | "models" | "context" | "skills" | "mcps" | "appearance";

interface Props {
  config: AppConfig;
  onConfig: (c: AppConfig) => void;
  settings: Settings;
  onSaveSettings: (s: Settings) => void;
  models: string[];
  connecting: boolean;
  modelsError: string | null;
  connectionSuccess?: string | null;
  onConnect: () => void;
  currentTheme: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
  onClose: () => void;
}

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function SettingsModal({
  config,
  onConfig,
  settings,
  onSaveSettings,
  models,
  connecting,
  modelsError,
  connectionSuccess,
  onConnect,
  currentTheme,
  onSelectTheme,
  onClose,
}: Props) {
  const { language, setLanguage, t } = useI18n();
  const [tab, setTab] = useState<Tab>("providers");
  const [showApiKey, setShowApiKey] = useState(false);
  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);
  const [modelFilterProvider, setModelFilterProvider] = useState<string>(settings.providerId || "deepseek");

  // --- Key Vault state ---
  const [vault, setVault] = useState<VaultKeyEntry[]>(() => loadVault());
  const [vaultName, setVaultName] = useState("");
  const [vaultProvider, setVaultProvider] = useState<string>(settings.providerId || "deepseek");
  const [vaultKey, setVaultKey] = useState("");
  const [vaultNotice, setVaultNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const flashVaultNotice = (text: string, ok: boolean) => {
    setVaultNotice({ text, ok });
    window.setTimeout(() => setVaultNotice(null), 3500);
  };

  const handleVaultAdd = async () => {
    if (!vaultKey.trim()) {
      flashVaultNotice(t.settings.vaultKeyRequired, false);
      return;
    }
    await addVaultEntry(vaultName, vaultProvider, vaultKey);
    setVault(loadVault());
    setVaultName("");
    setVaultKey("");
    flashVaultNotice(t.settings.vaultKeySaved, true);
  };

  const handleVaultUse = async (entry: VaultKeyEntry) => {
    const key = await getVaultKey(entry.id);
    if (!key) {
      flashVaultNotice(t.settings.vaultKeyMissing, false);
      return;
    }
    touchVaultEntry(entry.id);
    setVault(loadVault());
    const preset = presetById(entry.providerId);
    await keyringSet(entry.providerId, key).catch(() => undefined);
    onSaveSettings({
      ...settings,
      providerId: entry.providerId,
      baseUrl: preset.baseUrl,
      apiKey: key,
      model: settings.providerId === entry.providerId ? settings.model : "",
    });
    flashVaultNotice(`${t.settings.vaultKeyApplied} ${entry.name}`, true);
  };

  const handleVaultDelete = (id: string) => {
    removeVaultEntry(id);
    setVault(loadVault());
  };

  const currentPreset = presetById(settings.providerId);

  useEffect(() => {
    detectOllama().then((running) => setOllamaRunning(running)).catch(() => setOllamaRunning(false));
  }, []);

  const handleProviderChange = async (providerId: string) => {
    const preset = presetById(providerId);
    setModelFilterProvider(providerId);
    let savedKey = "";
    try {
      const stored = await keyringGet(providerId);
      if (stored) savedKey = stored;
    } catch {
      /* ignore */
    }

    onSaveSettings({
      ...settings,
      providerId,
      baseUrl: preset.baseUrl,
      apiKey: savedKey,
      model: "",
    });
  };

  const handleApiKeyChange = (apiKey: string) => {
    onSaveSettings({ ...settings, apiKey });
    if (settings.providerId) {
      if (apiKey.trim()) {
        keyringSet(settings.providerId, apiKey.trim()).catch(() => undefined);
      }
    }
  };

  const updModel = (i: number, patch: Partial<ModelConfig>) =>
    onConfig({
      ...config,
      models: config.models.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    });

  const [liveQueryLoading, setLiveQueryLoading] = useState(false);
  const [liveQueryMessage, setLiveQueryMessage] = useState<string | null>(null);

  const queryLiveApiModels = async (provId: string) => {
    setLiveQueryLoading(true);
    setLiveQueryMessage(null);
    try {
      const preset = presetById(provId);
      const activeKey = provId === settings.providerId ? settings.apiKey : (await keyringGet(provId)) || "";
      
      const liveList = await listModels({
        kind: preset.kind,
        baseUrl: provId === settings.providerId ? (settings.baseUrl || preset.baseUrl) : preset.baseUrl,
        apiKey: activeKey,
        model: "",
        reasoningEffort: null,
        maxOutputTokens: null,
        temperature: null,
        visionEnabled: false,
      });

      if (!liveList || liveList.length === 0) {
        throw new Error("La API no devolvió ningún modelo.");
      }

      const generatedModels: ModelConfig[] = liveList.map((mId) => inferModelConfig(mId, provId));

      const otherModels = config.models.filter(
        (m) => (m.providerId || "").toLowerCase() !== provId.toLowerCase()
      );
      const newModels = [...otherModels, ...generatedModels];
      onConfig({ ...config, models: newModels });

      if (generatedModels.length > 0 && (!settings.model || settings.providerId === provId)) {
        onSaveSettings({ ...settings, model: generatedModels[0].id });
      }

      setLiveQueryMessage(`✅ ${liveList.length} modelos reales cargados desde la API oficial de ${preset.label.split(" ")[0]}.`);
      setTimeout(() => setLiveQueryMessage(null), 5000);
    } catch (err) {
      setLiveQueryMessage(`⚠️ Error al consultar API (${presetById(provId).label.split(" ")[0]}): ${String(err)}`);
      setTimeout(() => setLiveQueryMessage(null), 6000);
    } finally {
      setLiveQueryLoading(false);
    }
  };

  const addModel = () => {
    const targetProv = modelFilterProvider === "all" ? (settings.providerId || "deepseek") : modelFilterProvider;
    onConfig({
      ...config,
      models: [
        ...config.models,
        {
          id: "",
          label: "",
          providerId: targetProv,
          thinkingLevel: "none",
          contextWindow: 128000,
          maxOutputTokens: 8192,
          reasoningEnabled: false,
          visionEnabled: false,
          inputPrice: 0,
          outputPrice: 0,
        },
      ],
    });
  };

  const removeModel = (i: number) =>
    onConfig({ ...config, models: config.models.filter((_, idx) => idx !== i) });

  const setCtx = (patch: Partial<AppConfig["context"]>) =>
    onConfig({ ...config, context: { ...config.context, ...patch } });

  const updSkill = (i: number, patch: Partial<SkillConfig>) =>
    onConfig({
      ...config,
      skills: config.skills.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    });

  const addSkill = () =>
    onConfig({ ...config, skills: [...config.skills, { name: "", description: "", content: "" }] });

  const removeSkill = (i: number) =>
    onConfig({ ...config, skills: config.skills.filter((_, idx) => idx !== i) });

  const updMcp = (i: number, patch: Partial<McpConfig>) =>
    onConfig({
      ...config,
      mcps: config.mcps.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    });

  const addMcp = () =>
    onConfig({ ...config, mcps: [...config.mcps, { name: "", command: "", args: "", enabled: true }] });

  const removeMcp = (i: number) =>
    onConfig({ ...config, mcps: config.mcps.filter((_, idx) => idx !== i) });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="settings-header-left">
            <Sliders size={16} className="text-cyan" />
            <div>
              <h3>{t.settings.modalTitle}</h3>
              <span className="settings-sub muted small">{t.settings.modalSubtitle}</span>
            </div>
          </div>
          <button className="icon-btn" title={t.common.close} onClick={onClose}>
            <X size={13} />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="modal-tabs">
          <button
            className={`tab ${tab === "providers" ? "active" : ""}`}
            onClick={() => setTab("providers")}
          >
            <Key size={12} />
            <span>{t.settings.tabProviders}</span>
          </button>
          <button
            className={`tab ${tab === "models" ? "active" : ""}`}
            onClick={() => setTab("models")}
          >
            <Cpu size={12} />
            <span>{t.settings.tabModels} ({config.models.length})</span>
          </button>
          <button
            className={`tab ${tab === "context" ? "active" : ""}`}
            onClick={() => setTab("context")}
          >
            <Layers size={12} />
            <span>{t.settings.tabContext}</span>
          </button>
          <button
            className={`tab ${tab === "skills" ? "active" : ""}`}
            onClick={() => setTab("skills")}
          >
            <Sparkles size={12} />
            <span>{t.settings.tabSkills} ({config.skills.length})</span>
          </button>
          <button
            className={`tab ${tab === "mcps" ? "active" : ""}`}
            onClick={() => setTab("mcps")}
          >
            <Network size={12} />
            <span>{t.settings.tabMcps}</span>
          </button>
          <button
            className={`tab ${tab === "appearance" ? "active" : ""}`}
            onClick={() => setTab("appearance")}
          >
            <Palette size={12} />
            <span>{t.settings.tabAppearance}</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body settings-modal-body">
          {/* TAB 1: PROVIDERS & API KEYS */}
          {tab === "providers" && (
            <div className="cfg-section">
              <div className="analytics-info-box">
                <ShieldCheck size={16} className="text-green" />
                <div>
                  <strong>{t.settings.quickConnectTitle}</strong>
                  <p className="small muted">
                    {t.settings.quickConnectDesc}
                  </p>
                </div>
              </div>

              {/* Provider Selection Card */}
              <div className="cfg-card">
                <div className="cfg-head">
                  <div className="cfg-head-title">
                    <Server size={14} className="text-cyan" />
                    <strong>{t.settings.aiProviderTitle}</strong>
                  </div>
                  {ollamaRunning && (
                    <span className="badge-pill active" title="Servicio local Ollama activo en localhost:11434">
                      {t.settings.ollamaDetected}
                    </span>
                  )}
                </div>

                <div className="field">
                  <label>{t.settings.selectProvider}</label>
                  <select
                    value={settings.providerId}
                    onChange={(e) => handleProviderChange(e.target.value)}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Base URL (editable if custom or local) */}
                <div className="field">
                  <label>{t.settings.endpointBaseUrl}</label>
                  <input
                    type="text"
                    value={settings.baseUrl}
                    placeholder="https://api.openai.com/v1"
                    onChange={(e) => onSaveSettings({ ...settings, baseUrl: e.target.value })}
                  />
                </div>

                {/* API Key Field */}
                {currentPreset.needsKey ? (
                  <div className="field">
                    <div className="field-label-row">
                      <label>{t.settings.apiKeyLabel} {currentPreset.label}</label>
                      <span className="keyring-badge" title="Tus claves están protegidas con encriptación nativa del sistema operativo">
                        <ShieldCheck size={10} />
                        <span>{t.settings.osKeyringSecure}</span>
                      </span>
                    </div>
                    <div className="api-key-input-wrap">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={settings.apiKey}
                        placeholder={
                          settings.providerId === "deepseek"
                            ? "sk-..."
                            : settings.providerId === "openrouter"
                              ? "sk-or-v1-..."
                              : settings.providerId === "gemini"
                                ? "AIzaSy..."
                                : "sk-..."
                        }
                        onChange={(e) => handleApiKeyChange(e.target.value)}
                      />
                      <button
                        type="button"
                        className="icon-btn-micro pass-toggle"
                        onClick={() => setShowApiKey((v) => !v)}
                        title={showApiKey ? "Ocultar clave" : "Mostrar clave"}
                      >
                        {showApiKey ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                    </div>
                    {settings.providerId === "gemini" && (
                      <div className="small muted" style={{ marginTop: 4 }}>
                        💡 Google AI Studio:{" "}
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ color: "var(--cyan)", textDecoration: "underline" }}>
                          aistudio.google.com
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="local-llm-banner">
                    <HardDrive size={14} className="text-green" />
                    <div className="local-llm-text">
                      <strong>{t.settings.localEngineTitle}</strong>
                      <span className="small muted">
                        {t.settings.localEngineDesc}
                      </span>
                    </div>
                  </div>
                )}

                {/* Model Selector & Connection Button */}
                <div className="field">
                  <label>{t.settings.activeModelLabel}</label>
                  <div className="model-selector-row">
                    <select
                      value={settings.model}
                      disabled={models.length === 0}
                      onChange={(e) => onSaveSettings({ ...settings, model: e.target.value })}
                      className="model-main-select"
                    >
                      {models.length === 0 ? (
                        <option value="">
                          {connecting ? t.common.connecting : t.chat.noModels}
                        </option>
                      ) : (
                        models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))
                      )}
                    </select>

                    <button
                      className="btn btn-primary"
                      onClick={onConnect}
                      disabled={connecting || (currentPreset.needsKey && !settings.apiKey)}
                      title="Probar conexión con la API y refrescar catálogo de modelos"
                    >
                      <Zap size={12} />
                      <span>{connecting ? t.common.connecting : t.settings.connectAndList}</span>
                    </button>
                  </div>
                </div>

                {connectionSuccess && (
                  <div className="connection-status-banner success">
                    <CheckCircle2 size={14} className="text-green" />
                    <span>{t.settings.connectionSuccess.replace("{n}", String(models.length))}</span>
                  </div>
                )}

                {modelsError && (
                  <div className="connection-status-banner error">
                    <AlertTriangle size={14} className="text-red" />
                    <div className="connection-error-col">
                      <strong className="connection-error-title">{t.settings.connectionFailed}</strong>
                      <span className="small font-mono connection-error-msg">{modelsError}</span>
                    </div>
                  </div>
                )}

                {/* Budget guard: opcional, pregunta al usuario (nunca corta solo) */}
                <div className="field">
                  <label>💰 Coste máx. por turno (USD) — 0 = sin límite</label>
                  <div className="model-selector-row">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      className="text-input budget-input font-mono"
                      value={settings.maxCostPerTurn ?? 0}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value) || 0);
                        onSaveSettings({ ...settings, maxCostPerTurn: v });
                      }}
                    />
                    <span className="small muted">
                      Al alcanzarlo, el agente te preguntará si continuar sin límite o detener y sintetizar.
                    </span>
                  </div>
                </div>
              </div>

              {/* Key Vault: secure storage for previously used API keys */}
              <div className="cfg-card">
                <div className="cfg-head">
                  <div className="cfg-head-title">
                    <Vault size={14} className="text-gold" />
                    <strong>{t.settings.vaultTitle}</strong>
                  </div>
                  <span className="keyring-badge" title="Los secretos viven en el almacén cifrado del sistema operativo">
                    <ShieldCheck size={10} />
                    <span>{t.settings.osKeyringSecure}</span>
                  </span>
                </div>
                <p className="small muted" style={{ marginBottom: 10 }}>
                  {t.settings.vaultDesc}
                </p>

                {vault.length === 0 ? (
                  <div className="vault-empty">{t.settings.vaultEmpty}</div>
                ) : (
                  <div className="vault-list">
                    {vault.map((entry) => (
                      <div key={entry.id} className="vault-item">
                        <div className="vault-item-info">
                          <span className="vault-item-name font-mono">{entry.name}</span>
                          <span className="vault-item-meta small muted">
                            {presetById(entry.providerId)?.label ?? entry.providerId}
                            {entry.lastUsedAt > 0 && (
                              <> · {t.settings.vaultLastUsed}: {new Date(entry.lastUsedAt).toLocaleDateString()}</>
                            )}
                          </span>
                        </div>
                        <div className="vault-item-actions">
                          <button
                            type="button"
                            className="btn btn-subtle btn-sm"
                            onClick={() => handleVaultUse(entry)}
                            title={t.settings.vaultUse}
                          >
                            <Zap size={11} />
                            <span>{t.settings.vaultUse}</span>
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => handleVaultDelete(entry.id)}
                            title={t.settings.vaultDelete}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="vault-add-row">
                  <input
                    type="text"
                    className="vault-input-name"
                    value={vaultName}
                    placeholder={t.settings.vaultNamePlaceholder}
                    onChange={(e) => setVaultName(e.target.value)}
                  />
                  <select
                    className="vault-input-provider"
                    value={vaultProvider}
                    onChange={(e) => setVaultProvider(e.target.value)}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="password"
                    className="vault-input-key"
                    value={vaultKey}
                    placeholder={t.settings.vaultKeyPlaceholder}
                    onChange={(e) => setVaultKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleVaultAdd();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleVaultAdd}
                    disabled={!vaultKey.trim()}
                  >
                    <Plus size={11} />
                    <span>{t.settings.vaultAdd}</span>
                  </button>
                </div>

                {vaultNotice && (
                  <div className={`connection-status-banner ${vaultNotice.ok ? "success" : "error"}`}>
                    {vaultNotice.ok ? (
                      <CheckCircle2 size={14} className="text-green" />
                    ) : (
                      <AlertTriangle size={14} className="text-red" />
                    )}
                    <span>{vaultNotice.text}</span>
                  </div>
                )}
              </div>

              {/* Quick Preset Guide */}
              <div className="provider-quick-guides">
                <div className="guide-card">
                  <strong>{t.settings.deepseekTitle}</strong>
                  <p className="small muted">{t.settings.deepseekDesc}</p>
                  <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" className="guide-link">
                    <span>{t.settings.getKeyDeepseek}</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
                <div className="guide-card">
                  <strong>{t.settings.openrouterTitle}</strong>
                  <p className="small muted">{t.settings.openrouterDesc}</p>
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="guide-link">
                    <span>{t.settings.getKeyOpenrouter}</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MODELS & PRICING */}
          {tab === "models" && (
            <div className="cfg-section">
              {/* Provider Quick Filter Tabs */}
              <div className="model-provider-filter-bar">
                {PROVIDERS.map((p) => {
                  const isSelected = modelFilterProvider === p.id;
                  const count = config.models.filter((m) => (m.providerId || "deepseek").toLowerCase() === p.id.toLowerCase()).length;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`provider-filter-pill ${isSelected ? "active" : ""}`}
                      onClick={() => setModelFilterProvider(p.id)}
                    >
                      <span>{p.label.split(" ")[0]}</span>
                      {count > 0 && <span className="provider-pill-count">{count}</span>}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`provider-filter-pill ${modelFilterProvider === "all" ? "active" : ""}`}
                  onClick={() => setModelFilterProvider("all")}
                >
                  <span>{t.settings.allModels}</span>
                  <span className="provider-pill-count">{config.models.length}</span>
                </button>
              </div>

              {/* Action Toolbar */}
              <div className="cfg-top-action-bar">
                {modelFilterProvider !== "all" && (
                  <button
                    type="button"
                    className="btn btn-connect"
                    disabled={liveQueryLoading}
                    onClick={() => queryLiveApiModels(modelFilterProvider)}
                    title="API Query"
                    style={{ background: "rgba(0, 200, 214, 0.12)", borderColor: "rgba(0, 200, 214, 0.4)" }}
                  >
                    {liveQueryLoading ? <Loader2 size={12} className="spin" /> : <Globe size={12} className="text-cyan" />}
                    <span>{liveQueryLoading ? t.common.loading : `API (${presetById(modelFilterProvider).label.split(" ")[0]})`}</span>
                  </button>
                )}
                <button type="button" className="btn btn-connect" onClick={addModel}>
                  <Plus size={12} />
                  <span>{t.settings.addCustomModel}</span>
                </button>
              </div>

              {liveQueryMessage && (
                <div
                  className="model-live-feedback"
                  style={{
                    padding: "6px 12px",
                    marginBottom: "12px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    background: liveQueryMessage.includes("✅") ? "rgba(0, 200, 100, 0.15)" : "rgba(255, 170, 0, 0.15)",
                    border: liveQueryMessage.includes("✅") ? "1px solid rgba(0, 200, 100, 0.3)" : "1px solid rgba(255, 170, 0, 0.3)",
                    color: liveQueryMessage.includes("✅") ? "#00ff88" : "#ffb700",
                  }}
                >
                  {liveQueryMessage}
                </div>
              )}

              {/* Filtered Models Stack */}
              <div className="cfg-cards-stack">
                {config.models
                  .map((m, originalIdx) => ({ m, originalIdx }))
                  .filter(({ m }) => modelFilterProvider === "all" || (m.providerId || "deepseek").toLowerCase() === modelFilterProvider.toLowerCase())
                  .map(({ m, originalIdx: i }) => {
                    const canReason = isModelReasoningSupported(m.id, m);
                    const canVision = isModelVisionSupported(m.id, m);

                    return (
                      <div className="cfg-card" key={i}>
                        <div className="cfg-head">
                          <div className="cfg-head-title">
                            <Cpu size={14} className="text-cyan" />
                            <strong>{m.label || m.id || "Model"}</strong>
                            <span className="badge-provider-tag font-mono">
                              {m.providerId || "deepseek"}
                            </span>
                            {m.reasoningEnabled && canReason && <span className="badge-pill">{t.settings.thinkingBadge}</span>}
                            {m.visionEnabled && canVision && <span className="badge-pill">{t.settings.visionBadge}</span>}
                          </div>
                          <button
                            type="button"
                            className="icon-btn-micro danger"
                            title={t.common.delete}
                            onClick={() => removeModel(i)}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>

                        <div className="grid-2">
                          <div className="field">
                            <label>{t.settings.providerModelId}</label>
                            <input
                              placeholder="ej. deepseek-chat"
                              value={m.id}
                              onChange={(e) => {
                                const newId = e.target.value;
                                const inferred = inferModelConfig(newId, m.providerId);
                                updModel(i, {
                                  id: newId,
                                  label: m.label === m.id || !m.label ? inferred.label : m.label,
                                  contextWindow: m.contextWindow === 128000 ? inferred.contextWindow : m.contextWindow,
                                  maxOutputTokens: m.maxOutputTokens === 8192 ? inferred.maxOutputTokens : m.maxOutputTokens,
                                  reasoningEnabled: inferred.reasoningEnabled,
                                  visionEnabled: inferred.visionEnabled,
                                  inputPrice: m.inputPrice === 0 ? inferred.inputPrice : m.inputPrice,
                                  outputPrice: m.outputPrice === 0 ? inferred.outputPrice : m.outputPrice,
                                });
                              }}
                            />
                          </div>
                          <div className="field">
                            <label>{t.settings.visibleLabel}</label>
                            <input
                              placeholder="ej. DeepSeek V3 Flash"
                              value={m.label}
                              onChange={(e) => updModel(i, { label: e.target.value })}
                            />
                          </div>
                        </div>

                        <div className="grid-2">
                          <div className="field" style={{ opacity: canReason ? 1 : 0.45 }}>
                            <label>
                              {t.settings.defaultThinking} {!canReason && "(No soportado)"}
                            </label>
                            <select
                              disabled={!canReason}
                              value={canReason ? m.thinkingLevel : "none"}
                              onChange={(e) =>
                                updModel(i, { thinkingLevel: e.target.value as ThinkingLevel })
                              }
                            >
                              {THINKING_LEVELS.map((th) => (
                                <option key={th.value} value={th.value}>
                                  {th.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label>{t.settings.contextWindow}</label>
                            <input
                              type="number"
                              value={m.contextWindow}
                              onChange={(e) => updModel(i, { contextWindow: num(e.target.value, 0) })}
                            />
                          </div>
                        </div>

                        <div className="grid-2">
                          <div className="field">
                            <label>{t.settings.maxOutputTokens}</label>
                            <input
                              type="number"
                              value={m.maxOutputTokens}
                              onChange={(e) => updModel(i, { maxOutputTokens: num(e.target.value, 0) })}
                            />
                          </div>
                          <div className="checks-row align-center">
                            <label className={`check ${!canReason ? "disabled-check" : ""}`} title={!canReason ? "La arquitectura de este modelo no soporta tokens de razonamiento" : ""}>
                              <input
                                type="checkbox"
                                disabled={!canReason}
                                checked={canReason && m.reasoningEnabled}
                                onChange={(e) => updModel(i, { reasoningEnabled: e.target.checked })}
                              />
                              <span>{t.settings.apiReasoning} {!canReason && " (Incompatible)"}</span>
                            </label>
                            <label className={`check ${!canVision ? "disabled-check" : ""}`} title={!canVision ? "Este modelo no procesa imágenes u OCR" : ""}>
                              <input
                                type="checkbox"
                                disabled={!canVision}
                                checked={canVision && m.visionEnabled}
                                onChange={(e) => updModel(i, { visionEnabled: e.target.checked })}
                              />
                              <span>{t.settings.visionOcr} {!canVision && " (Incompatible)"}</span>
                            </label>
                          </div>
                        </div>

                        <div className="grid-2">
                          <div className="field">
                            <label>{t.settings.inputPrice}</label>
                            <input
                              type="number"
                              step="0.01"
                              value={m.inputPrice}
                              onChange={(e) => updModel(i, { inputPrice: num(e.target.value, 0) })}
                            />
                          </div>
                          <div className="field">
                            <label>{t.settings.outputPrice}</label>
                            <input
                              type="number"
                              step="0.01"
                              value={m.outputPrice}
                              onChange={(e) => updModel(i, { outputPrice: num(e.target.value, 0) })}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* TAB 3: CONTEXT & BUDGET */}
          {tab === "context" && (
            <div className="cfg-section">
              <div className="analytics-info-box">
                <Layers size={14} className="text-cyan" />
                <div>
                  <strong>{t.settings.contextBudgetTitle}</strong>
                  <p className="small muted">
                    {t.settings.contextBudgetDesc}
                  </p>
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>{t.settings.totalBudgetTokens}</label>
                  <input
                    type="number"
                    value={config.context.maxTokens}
                    onChange={(e) => setCtx({ maxTokens: num(e.target.value, 0) })}
                  />
                </div>
                <div className="field">
                  <label>{t.settings.repoMapTokens}</label>
                  <input
                    type="number"
                    value={config.context.repoMapTokens}
                    onChange={(e) => setCtx({ repoMapTokens: num(e.target.value, 0) })}
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>{t.settings.systemInstructionsShare}</label>
                  <input
                    type="number"
                    value={config.context.systemShare}
                    onChange={(e) => setCtx({ systemShare: num(e.target.value, 0) })}
                  />
                </div>
                <div className="field">
                  <label>{t.settings.chatHistoryShare}</label>
                  <input
                    type="number"
                    value={config.context.historyShare}
                    onChange={(e) => setCtx({ historyShare: num(e.target.value, 0) })}
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>{t.settings.workspaceFilesShare}</label>
                  <input
                    type="number"
                    value={config.context.filesShare}
                    onChange={(e) => setCtx({ filesShare: num(e.target.value, 0) })}
                  />
                </div>
                <div className="field">
                  <label>{t.settings.compactionThreshold}</label>
                  <input
                    type="number"
                    step="0.05"
                    value={config.context.compactionThreshold}
                    onChange={(e) => setCtx({ compactionThreshold: num(e.target.value, 0) })}
                  />
                </div>
              </div>

              <label className="check mt-8">
                <input
                  type="checkbox"
                  checked={config.context.includeWorkspace}
                  onChange={(e) => setCtx({ includeWorkspace: e.target.checked })}
                />
                <span>{t.settings.includeWorkspaceStructure}</span>
              </label>
            </div>
          )}

          {/* TAB 4: AGENTIC SKILLS */}
          {tab === "skills" && (
            <div className="cfg-section pb-20">
              <div className="cfg-card system-skill">
                <div className="cfg-head">
                  <div className="cfg-head-title">
                    <Sparkles size={14} className="text-cyan" />
                    <strong>{t.settings.coreSkillTitle}</strong>
                  </div>
                  <span className="badge-pill active">{t.settings.activeByDefault}</span>
                </div>
                <p className="muted small">
                  {t.settings.coreSkillDesc}
                </p>
              </div>

              <div className="cfg-cards-stack">
                {config.skills.map((s, i) => (
                  <div className="cfg-card" key={i}>
                    <div className="cfg-head">
                      <strong>{s.name || "Skill"}</strong>
                      <button className="icon-btn-micro danger" title={t.common.delete} onClick={() => removeSkill(i)}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="field">
                      <label>{t.settings.skillName}</label>
                      <input value={s.name} onChange={(e) => updSkill(i, { name: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>{t.settings.contextDesc}</label>
                      <input value={s.description} onChange={(e) => updSkill(i, { description: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>{t.settings.promptRulesContent}</label>
                      <textarea
                        rows={4}
                        value={s.content}
                        onChange={(e) => updSkill(i, { content: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="cfg-bottom-action mt-12">
                <button className="btn btn-connect" onClick={addSkill}>
                  <Plus size={12} />
                  <span>{t.settings.addNewSkill}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: MCPS */}
          {tab === "mcps" && (
            <div className="cfg-section pb-20">
              <p className="muted small">
                {t.settings.mcpDesc}
              </p>

              <div className="cfg-cards-stack">
                {config.mcps.map((m, i) => (
                  <div className="cfg-card" key={i}>
                    <div className="cfg-head">
                      <div className="cfg-head-title">
                        <Network size={14} className="text-purple" />
                        <strong>{m.name || "MCP Server"}</strong>
                      </div>
                      <button className="icon-btn-micro danger" title={t.common.delete} onClick={() => removeMcp(i)}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="grid-2">
                      <div className="field">
                        <label>{t.settings.mcpName}</label>
                        <input value={m.name} onChange={(e) => updMcp(i, { name: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>{t.settings.mcpCommand}</label>
                        <input value={m.command} onChange={(e) => updMcp(i, { command: e.target.value })} />
                      </div>
                    </div>
                    <div className="field">
                      <label>{t.settings.mcpArgs}</label>
                      <input value={m.args} onChange={(e) => updMcp(i, { args: e.target.value })} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="cfg-bottom-action mt-12">
                <button className="btn btn-connect" onClick={addMcp}>
                  <Plus size={12} />
                  <span>{t.settings.mcpAddBtn}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 6: APPEARANCE & LANGUAGE */}
          {tab === "appearance" && (
            <div className="cfg-section">
              <h4 className="section-title">{t.settings.languageTitle}</h4>
              <div className="theme-grid mb-20">
                {LANGUAGE_LIST.map((l) => {
                  const isActive = l.id === language;
                  return (
                    <div
                      key={l.id}
                      className={`theme-option-card ${isActive ? "active" : ""}`}
                      onClick={() => setLanguage(l.id)}
                    >
                      <div className="theme-card-head">
                        <strong>{l.flag} {l.nativeName}</strong>
                        {isActive && <Check size={13} className="text-cyan" />}
                      </div>
                      <p className="muted micro" style={{ margin: "4px 0 0" }}>{l.name}</p>
                    </div>
                  );
                })}
              </div>

              <h4 className="section-title">{t.settings.colorPaletteTitle}</h4>
              <div className="theme-grid">
                {THEME_LIST.map((th) => {
                  const isActive = th.id === currentTheme;
                  return (
                    <div
                      key={th.id}
                      className={`theme-option-card ${isActive ? "active" : ""}`}
                      onClick={() => onSelectTheme(th.id)}
                    >
                      <div className="theme-card-head">
                        <strong>{th.name}</strong>
                        {isActive && <Check size={13} className="text-cyan" />}
                      </div>
                      <div className="theme-color-preview">
                        <span style={{ background: th.colors.bg }} />
                        <span style={{ background: th.colors.cyan }} />
                        <span style={{ background: th.colors.purple }} />
                        <span style={{ background: th.colors.accentGreen }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
