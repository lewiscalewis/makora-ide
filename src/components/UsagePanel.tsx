import { PROVIDERS } from "../providers";
import { THINKING_LEVELS } from "../defaults";
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
  icon: string;
  label: string;
  thinking: ThinkingLevel;
  reasoning: boolean;
}[] = [
  { id: "eco", icon: "🍃", label: "Eco", thinking: "none", reasoning: false },
  { id: "balanced", icon: "⚖️", label: "Balanced", thinking: "medium", reasoning: false },
  { id: "deep", icon: "🧠", label: "Deep", thinking: "high", reasoning: true },
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
        <span>Panel</span>
        <button className="icon-btn" title="Colapsar panel" onClick={onCollapse}>
          ▸
        </button>
      </div>
      <h3 className="panel-title">Parámetros</h3>

      <div className="field">
        <label>Proveedor</label>
        <select
          value={settings.providerId}
          onChange={(e) =>
            onSettings({ ...settings, providerId: e.target.value, model: "" })
          }
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
          <label>API key</label>
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
        {connecting ? "Conectando…" : "Conectar"}
      </button>
      {modelsError && <p className="error small">{modelsError}</p>}

      <h3 className="panel-title">Pensamiento</h3>
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
        {PROFILES.map((p) => (
          <button
            key={p.id}
            className="profile-btn"
            title={p.label}
            onClick={() => onProfile({ thinking: p.thinking, reasoning: p.reasoning })}
          >
            <span>{p.icon}</span>
            <span>{p.label}</span>
          </button>
        ))}
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

      <h3 className="panel-title">Consumo</h3>
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

      <h3 className="panel-title">Crédito</h3>
      {canBalance && (
        <button className="btn btn-connect" onClick={onRefreshBalance} disabled={balanceLoading}>
          {balanceLoading ? "Consultando…" : "Consultar saldo"}
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

      <h3 className="panel-title">MCP</h3>
      {mcpTools.length === 0 ? (
        <p className="muted small">Sin servidores MCP activos.</p>
      ) : (
        <details className="mcp-health">
          <summary>🟢 {mcpTools.length} herramienta{mcpTools.length === 1 ? "" : "s"} registrada{mcpTools.length === 1 ? "" : "s"}</summary>
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
