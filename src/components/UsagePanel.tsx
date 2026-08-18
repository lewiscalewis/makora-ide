import { PROVIDERS } from "../providers";
import { THINKING_LEVELS } from "../defaults";
import {
  SlidersHorizontal,
  ShieldCheck,
  RefreshCw,
  Layers,
  PanelRightClose,
  Zap,
  Scale,
  Brain,
  Leaf,
} from "lucide-react";
import type {
  BalanceInfo,
  ChatUsage,
  Settings,
  ThinkingLevel,
  Usage,
} from "../types";

interface UsagePanelProps {
  settings: Settings;
  onSettings: (s: Settings) => void;
  models: string[];
  modelsError: string | null;
  connecting: boolean;
  onConnect: () => void;
  usage: Usage;
  thinkingLevel: ThinkingLevel;
  onThinkingLevel: (t: ThinkingLevel) => void;
  balance: BalanceInfo | null;
  balanceLoading: boolean;
  costUsd: number;
  onRefreshBalance: () => void;
  onCollapse: () => void;
  contextWindow: number;
  lastUsage: ChatUsage | null;
  mcpTools: string[];
  onProfile: (p: { thinking: ThinkingLevel; reasoning: boolean }) => void;
}

const PROFILES: {
  id: string;
  icon: typeof Leaf;
  label: string;
  thinking: ThinkingLevel;
  reasoning: boolean;
}[] = [
  { id: "eco", icon: Leaf, label: "Eco", thinking: "none", reasoning: false },
  { id: "balanced", icon: Scale, label: "Balanced", thinking: "medium", reasoning: false },
  { id: "deep", icon: Brain, label: "Deep", thinking: "high", reasoning: true },
];

export default function UsagePanel({
  settings,
  onSettings,
  models,
  modelsError,
  connecting,
  onConnect,
  usage,
  thinkingLevel,
  onThinkingLevel,
  balance,
  balanceLoading,
  costUsd,
  onRefreshBalance,
  onCollapse,
  contextWindow,
  lastUsage,
  mcpTools,
  onProfile,
}: UsagePanelProps) {
  const preset = PROVIDERS.find((p) => p.id === settings.providerId) ?? PROVIDERS[0];
  const showBaseUrl = preset.id === "custom";
  const canBalance = settings.providerId === "deepseek" || settings.providerId === "openrouter";
  const remaining = balance ? Math.max(0, balance.amount - costUsd) : null;

  const cached = lastUsage?.cachedTokens ?? 0;
  const input = lastUsage?.inputTokens ?? 0;
  const windowSize = Math.max(1, contextWindow);
  const cachePct = Math.min(100, (cached / windowSize) * 100);
  const codePct = Math.min(100 - cachePct, ((input - cached) / windowSize) * 100);
  const freePct = Math.max(0, 100 - cachePct - codePct);

  return (
    <aside className="usage">
      <div className="panel-head">
        <div className="panel-head-left">
          <SlidersHorizontal size={13} className="text-cyan" />
          <span className="panel-title-text">Parámetros</span>
        </div>
        <button className="icon-btn" title="Ocultar panel" onClick={onCollapse}>
          <PanelRightClose size={12} />
        </button>
      </div>

      <div className="field">
        <label>Proveedor</label>
        <select
          value={settings.providerId}
          onChange={(e) => {
            const newPid = e.target.value;
            const p = PROVIDERS.find((x) => x.id === newPid) ?? PROVIDERS[0];
            let key = "";
            try {
              const rawKeys = localStorage.getItem("makora.provider_keys");
              if (rawKeys) {
                const parsed = JSON.parse(rawKeys);
                key = parsed[newPid] || "";
              }
            } catch {
              /* ignore */
            }
            onSettings({
              ...settings,
              providerId: newPid,
              baseUrl: p.baseUrl,
              apiKey: key,
              model: "",
            });
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {showBaseUrl && (
        <div className="field">
          <label>Base URL</label>
          <input
            type="text"
            value={settings.baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(e) => onSettings({ ...settings, baseUrl: e.target.value })}
          />
        </div>
      )}

      {preset.needsKey && (
        <div className="field">
          <div className="field-label-row">
            <label>API key</label>
            <span className="keyring-badge" title="Credenciales protegidas mediante Windows DPAPI / SO Keyring">
              <ShieldCheck size={10} />
              <span>Keyring SO</span>
            </span>
          </div>
          <input
            type="password"
            value={settings.apiKey}
            placeholder="sk-…"
            onChange={(e) => onSettings({ ...settings, apiKey: e.target.value })}
          />
        </div>
      )}

      <div className="field">
        <label>Modelo</label>
        <select
          value={settings.model}
          disabled={models.length === 0}
          onChange={(e) => onSettings({ ...settings, model: e.target.value })}
        >
          {models.length === 0 ? (
            <option value="">
              {connecting ? "Conectando…" : "Conecta para listar modelos"}
            </option>
          ) : (
            models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          )}
        </select>
      </div>

      <button className="btn btn-connect" onClick={onConnect} disabled={connecting}>
        <Zap size={12} />
        <span>{connecting ? "Conectando…" : "Conectar"}</span>
      </button>
      {modelsError && <p className="error small">{modelsError}</p>}

      <h3 className="panel-title">Pensamiento & Perfil</h3>
      <div className="field">
        <label>Nivel de razonamiento</label>
        <select
          value={thinkingLevel}
          onChange={(e) => onThinkingLevel(e.target.value as ThinkingLevel)}
        >
          {THINKING_LEVELS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="profiles">
        {PROFILES.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              className="profile-btn"
              title={p.label}
              onClick={() => onProfile({ thinking: p.thinking, reasoning: p.reasoning })}
            >
              <Icon size={12} />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      <h3 className="panel-title">Contexto (último turno)</h3>
      <div className="gauge">
        <div className="gauge-seg gauge-cache" style={{ width: `${cachePct}%` }} />
        <div className="gauge-seg gauge-code" style={{ width: `${codePct}%` }} />
        <div className="gauge-seg gauge-free" style={{ width: `${freePct}%` }} />
      </div>
      <div className="gauge-legend">
        <span><i className="dot dot-cache" /> Caché {cached.toLocaleString()}</span>
        <span><i className="dot dot-code" /> Input {(input - cached).toLocaleString()}</span>
        <span><i className="dot dot-free" /> Libre</span>
      </div>

      <h3 className="panel-title">Consumo de Sesión</h3>
      <dl className="usage-list">
        <div className="usage-row">
          <dt>Tokens entrada</dt>
          <dd>{usage.inputTokens.toLocaleString()}</dd>
        </div>
        <div className="usage-row">
          <dt>Tokens salida</dt>
          <dd>{usage.outputTokens.toLocaleString()}</dd>
        </div>
        <div className="usage-row">
          <dt>Tokens en caché</dt>
          <dd>{usage.cachedTokens.toLocaleString()}</dd>
        </div>
        <div className="usage-row">
          <dt>Coste sesión (est.)</dt>
          <dd className="accent-green">${costUsd.toFixed(4)}</dd>
        </div>
      </dl>

      <h3 className="panel-title">Crédito del Proveedor</h3>
      {canBalance && (
        <button className="btn btn-connect" onClick={onRefreshBalance} disabled={balanceLoading}>
          <RefreshCw size={11} className={balanceLoading ? "animate-spin" : ""} />
          <span>{balanceLoading ? "Consultando…" : "Consultar saldo"}</span>
        </button>
      )}
      <dl className="usage-list">
        <div className="usage-row">
          <dt>Saldo</dt>
          <dd>
            {balance
              ? `${balance.amount.toFixed(2)} ${balance.currency}`
              : canBalance
                ? balanceLoading
                  ? "consultando…"
                  : "no consultado"
                : "no disponible"}
          </dd>
        </div>
        {remaining !== null && (
          <div className="usage-row total">
            <dt>Restante est.</dt>
            <dd>${remaining.toFixed(4)}</dd>
          </div>
        )}
      </dl>

      <h3 className="panel-title">Herramientas MCP</h3>
      {mcpTools.length === 0 ? (
        <p className="muted small">Sin servidores MCP activos.</p>
      ) : (
        <details className="mcp-health">
          <summary>
            <Layers size={11} />
            <span>{mcpTools.length} herramientas activas</span>
          </summary>
          <div className="mcp-list">
            {mcpTools.map((t) => (
              <code key={t} className="mcp-tool">{t}</code>
            ))}
          </div>
        </details>
      )}
    </aside>
  );
}
