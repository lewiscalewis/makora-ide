import { useState } from "react";
import { useI18n } from "../i18n";
import {
  Coins,
  Cpu,
  RefreshCw,
  Sparkles,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldAlert,
  Download,
  X,
  PieChart,
  Percent,
} from "lucide-react";
import type { BalanceInfo, ChatUsage, Settings, Usage } from "../types";
import { inferModelConfig } from "../defaults";

interface Props {
  settings: Settings;
  usage: Usage;
  lastUsage: ChatUsage | null;
  balance: BalanceInfo | null;
  balanceLoading: boolean;
  costUsd: number;
  onRefreshBalance: () => void;
  onClose: () => void;
}

export default function AnalyticsModal({
  settings,
  usage,
  lastUsage,
  balance,
  balanceLoading,
  costUsd,
  onRefreshBalance,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"overview" | "breakdown" | "limits">("overview");

  const totalTokens = usage.inputTokens + usage.outputTokens;
  const cacheHitRate = usage.inputTokens > 0
    ? Math.min(100, (usage.cachedTokens / usage.inputTokens) * 100)
    : 0;

  const currentModel = settings.model || "Modelo Activo";
  const provider = settings.providerId || "default";
  const inferred = inferModelConfig(currentModel, provider);
  const cacheDiscountRatio = provider.includes("gemini") ? 0.75 : 0.90;
  // Estimated savings from prompt caching
  const estimatedSavings = (usage.cachedTokens / 1_000_000) * (inferred.inputPrice || 0.27) * cacheDiscountRatio;

  const exportReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      provider,
      model: currentModel,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        totalTokens,
        cacheHitRate: `${cacheHitRate.toFixed(2)}%`,
        estimatedCostUsd: `$${costUsd.toFixed(5)}`,
        estimatedSavingsUsd: `$${estimatedSavings.toFixed(5)}`,
      },
      balance: balance ? `${balance.amount} ${balance.currency}` : "N/A",
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `makora_telemetry_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal analytics-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="analytics-header-left">
            <Coins size={16} className="text-gold" />
            <div>
              <h3>{t.analytics.title}</h3>
              <span className="analytics-sub">{t.analytics.subtitle}</span>
            </div>
          </div>
          <div className="analytics-header-right">
            <button className="btn btn-subtle" onClick={exportReport} title={t.common.exportJson}>
              <Download size={12} />
              <span>{t.common.exportJson}</span>
            </button>
            <button className="icon-btn" onClick={onClose} title={`${t.common.close} (Esc)`}>
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="modal-tabs">
          <button
            className={`tab ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <PieChart size={12} />
            <span>{t.analytics.tabOverview}</span>
          </button>
          <button
            className={`tab ${activeTab === "breakdown" ? "active" : ""}`}
            onClick={() => setActiveTab("breakdown")}
          >
            <Layers size={12} />
            <span>{t.analytics.tabCache}</span>
          </button>
          <button
            className={`tab ${activeTab === "limits" ? "active" : ""}`}
            onClick={() => setActiveTab("limits")}
          >
            <ShieldAlert size={12} />
            <span>{t.analytics.tabBudget}</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body analytics-body">
          {activeTab === "overview" && (
            <div className="analytics-overview-grid">
              {/* Stat Cards */}
              <div className="analytics-card card-cost">
                <div className="card-top">
                  <span className="card-label">{t.analytics.estimatedCost}</span>
                  <Coins size={15} className="text-gold" />
                </div>
                <div className="card-main-val text-gold">${costUsd.toFixed(4)}</div>
                <div className="card-sub-val muted small">{t.analytics.costSub} {currentModel}</div>
              </div>

              <div className="analytics-card card-balance">
                <div className="card-top">
                  <span className="card-label">{t.analytics.availableBalance} ({provider})</span>
                  <button
                    className="icon-btn-micro"
                    onClick={onRefreshBalance}
                    disabled={balanceLoading}
                    title={t.usagePanel.refreshBalance}
                  >
                    <RefreshCw size={11} className={balanceLoading ? "animate-spin" : ""} />
                  </button>
                </div>
                <div className="card-main-val accent-green">
                  {balance ? `${balance.amount.toFixed(2)} ${balance.currency}` : t.analytics.balanceUnlimited}
                </div>
                <div className="card-sub-val muted small">
                  {balance
                    ? `${t.analytics.balanceLive}. ${t.analytics.balanceVsCost}`
                    : t.analytics.balanceUnlimited}
                </div>
              </div>

              <div className="analytics-card card-cache">
                <div className="card-top">
                  <span className="card-label">{t.analytics.cacheEfficiency}</span>
                  <Percent size={15} className="text-cyan" />
                </div>
                <div className="card-main-val text-cyan">{cacheHitRate.toFixed(1)}%</div>
                <div className="card-sub-val muted small">
                  {t.analytics.estimatedSavings} <span className="accent-green">${estimatedSavings.toFixed(4)}</span>
                </div>
              </div>

              <div className="analytics-card card-total">
                <div className="card-top">
                  <span className="card-label">{t.analytics.totalTokenVolume}</span>
                  <Cpu size={15} className="text-purple" />
                </div>
                <div className="card-main-val text-purple">{totalTokens.toLocaleString()}</div>
                <div className="card-sub-val muted small">{t.analytics.totalTokenVolumeSub}</div>
              </div>

              {/* Detailed Breakdown Box */}
              <div className="analytics-full-card">
                <h4 className="section-title">{t.analytics.breakdownTitle}</h4>
                <div className="token-breakdown-bar">
                  <div
                    className="token-bar-seg seg-input"
                    style={{ width: `${totalTokens > 0 ? (usage.inputTokens / totalTokens) * 100 : 50}%` }}
                    title={`Input: ${usage.inputTokens.toLocaleString()} tokens`}
                  />
                  <div
                    className="token-bar-seg seg-output"
                    style={{ width: `${totalTokens > 0 ? (usage.outputTokens / totalTokens) * 100 : 50}%` }}
                    title={`Output: ${usage.outputTokens.toLocaleString()} tokens`}
                  />
                </div>
                <div className="token-legend-row">
                  <div className="legend-item">
                    <span className="legend-dot dot-input" />
                    <span>{t.analytics.inputLegend}: <strong>{usage.inputTokens.toLocaleString()}</strong></span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot dot-output" />
                    <span>{t.analytics.outputLegend}: <strong>{usage.outputTokens.toLocaleString()}</strong></span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot dot-cache" />
                    <span>{t.analytics.cachedLegend}: <strong>{usage.cachedTokens.toLocaleString()}</strong></span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "breakdown" && (
            <div className="analytics-breakdown-section">
              <div className="analytics-info-box">
                <Sparkles size={14} className="text-cyan" />
                <div>
                  <strong>{t.analytics.smartCachingTitle}</strong>
                  <p className="small muted">
                    {t.analytics.smartCachingDesc}
                  </p>
                </div>
              </div>

              <div className="analytics-metric-table-wrap">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>{t.analytics.metricCol}</th>
                      <th>{t.analytics.lastTurnCol}</th>
                      <th>{t.analytics.totalAccumCol}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><ArrowDownLeft size={11} className="inline-icon text-cyan" /> {t.analytics.totalInput}</td>
                      <td>{(lastUsage?.inputTokens ?? 0).toLocaleString()}</td>
                      <td>{usage.inputTokens.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td><ArrowUpRight size={11} className="inline-icon text-purple" /> {t.analytics.totalOutput}</td>
                      <td>{(lastUsage?.outputTokens ?? 0).toLocaleString()}</td>
                      <td>{usage.outputTokens.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td><Sparkles size={11} className="inline-icon text-green" /> {t.analytics.totalCached}</td>
                      <td>{(lastUsage?.cachedTokens ?? 0).toLocaleString()}</td>
                      <td>{usage.cachedTokens.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td><Percent size={11} className="inline-icon text-gold" /> {t.analytics.cacheHitRatio}</td>
                      <td>
                        {lastUsage && lastUsage.inputTokens > 0
                          ? `${((lastUsage.cachedTokens / lastUsage.inputTokens) * 100).toFixed(1)}%`
                          : "0%"}
                      </td>
                      <td>
                        <span className={cacheHitRate >= 60 ? "accent-green" : "text-gold"}>
                          {cacheHitRate.toFixed(1)}% {cacheHitRate >= 60 ? "⚡" : ""}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "limits" && (
            <div className="analytics-limits-section">
              <div className="cfg-card">
                <div className="cfg-head">
                  <strong>{t.analytics.tabBudget}</strong>
                  <span className="badge-pill active">{t.common.active}</span>
                </div>
                <p className="small muted">
                  Configura límites automáticos para proteger tus claves API de sobrecostes inesperados.
                </p>
                <div className="field">
                  <label>Presupuesto Máximo por Sesión (USD)</label>
                  <input type="number" step="0.50" defaultValue="5.00" />
                </div>
                <div className="field">
                  <label>Alerta de Saldo Bajo (Notificar cuando el saldo sea inferior a)</label>
                  <input type="number" step="1.00" defaultValue="2.00" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
