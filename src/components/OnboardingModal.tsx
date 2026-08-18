import { useEffect, useState } from "react";
import { detectOllama, fetchBalance, listModels, pickFolder } from "../api";
import { PROVIDERS } from "../providers";
import { THEME_LIST } from "../themes";
import type { BalanceInfo, ChatConfig, Settings, ThemeId } from "../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSaveSettings: (s: Settings) => void;
  currentTheme: ThemeId;
  onSelectTheme: (t: ThemeId) => void;
  folders: string[];
  onAddFolder: (path: string) => void;
}

export default function OnboardingModal({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  currentTheme,
  onSelectTheme,
  folders,
  onAddFolder,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [providerId, setProviderId] = useState(settings.providerId || "deepseek");
  const [apiKey, setApiKey] = useState(settings.apiKey || "");
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl || "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string; balance?: BalanceInfo | null } | null>(null);
  const [ollamaDetected, setOllamaDetected] = useState(false);

  useEffect(() => {
    detectOllama().then(setOllamaDetected).catch(() => setOllamaDetected(false));
  }, []);

  if (!isOpen) return null;

  const activePreset = PROVIDERS.find((p) => p.id === providerId) || PROVIDERS[0];

  const handleSelectProvider = (id: string) => {
    setProviderId(id);
    const p = PROVIDERS.find((x) => x.id === id);
    if (p && id !== "custom") {
      setBaseUrl(p.baseUrl);
    }
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const cfg: ChatConfig = {
        kind: activePreset.kind,
        baseUrl: baseUrl || activePreset.baseUrl,
        model: "",
        apiKey: apiKey.trim(),
        reasoningEffort: null,
        maxOutputTokens: null,
        temperature: null,
        visionEnabled: false,
      };
      const models = await listModels(cfg);
      if (models.length === 0) {
        setTestResult({ ok: false, msg: "No se encontraron modelos disponibles." });
        return;
      }
      let balance: BalanceInfo | null = null;
      if (providerId === "deepseek" || providerId === "openrouter") {
        balance = await fetchBalance(providerId, baseUrl || activePreset.baseUrl, apiKey.trim());
      }
      setTestResult({
        ok: true,
        msg: `¡Conexión exitosa! (${models.length} modelos detectados)`,
        balance,
      });

      // Save settings with first model
      onSaveSettings({
        providerId,
        baseUrl: baseUrl || activePreset.baseUrl,
        apiKey: apiKey.trim(),
        model: models[0],
      });
    } catch (e) {
      setTestResult({ ok: false, msg: `Error: ${String(e)}` });
    } finally {
      setTesting(false);
    }
  };

  const handlePickWorkspace = async () => {
    const p = await pickFolder();
    if (p) {
      onAddFolder(p);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="onboarding-header">
          <div className="onboarding-brand">
            <img src="/makora-icon.svg" alt="Makora Logo" className="onboarding-logo" />
            <div>
              <h2 className="onboarding-title">Bienvenido a MakoraIDE</h2>
              <p className="onboarding-subtitle">Asistente de Configuración Inicial</p>
            </div>
          </div>
          <button className="icon-btn" title="Cerrar" onClick={onClose}>×</button>
        </div>

        {/* Step Indicator */}
        <div className="onboarding-steps">
          <div className={`step-pill ${step >= 1 ? "active" : ""}`} onClick={() => setStep(1)}>
            <span className="step-num">1</span> Proveedor
          </div>
          <div className={`step-pill ${step >= 2 ? "active" : ""}`} onClick={() => setStep(2)}>
            <span className="step-num">2</span> Conexión & Clave
          </div>
          <div className={`step-pill ${step >= 3 ? "active" : ""}`} onClick={() => setStep(3)}>
            <span className="step-num">3</span> Workspace
          </div>
          <div className={`step-pill ${step >= 4 ? "active" : ""}`} onClick={() => setStep(4)}>
            <span className="step-num">4</span> Tema & Inicio
          </div>
        </div>

        {/* Body */}
        <div className="onboarding-body">
          {step === 1 && (
            <div className="step-content">
              <h3>Elige tu proveedor de IA principal</h3>
              <p className="muted small">
                MakoraIDE se conecta directamente a la API de tu proveedor (Zero-Cloud Proxy, 100% privado).
              </p>
              <div className="provider-grid">
                {PROVIDERS.map((p) => {
                  const isSelected = p.id === providerId;
                  const isOllama = p.id === "ollama";
                  return (
                    <div
                      key={p.id}
                      className={`provider-card ${isSelected ? "selected" : ""}`}
                      onClick={() => handleSelectProvider(p.id)}
                    >
                      <div className="provider-card-head">
                        <strong>{p.label}</strong>
                        {p.id === "deepseek" && <span className="rec-badge">Recomendado</span>}
                        {isOllama && ollamaDetected && <span className="local-badge">🟢 Local Detectado</span>}
                      </div>
                      <p className="provider-desc">
                        {p.id === "deepseek" && "Ultra-económico, razonamiento profundo y compatible con tool-calling."}
                        {p.id === "openai" && "Modelos GPT-4.5, GPT-4o y serie o1/o3 con alta capacidad de código."}
                        {p.id === "anthropic" && "Claude 3.7 Sonnet / 3.5 con razonamiento híbrido y artefactos."}
                        {p.id === "openrouter" && "Acceso unificado a cientos de modelos en una sola API key."}
                        {p.id === "ollama" && "100% offline y gratis en tu propia GPU/CPU local."}
                        {p.id === "custom" && "Cualquier servidor compatible con OpenAI (vLLM, LiteLLM, LM Studio)."}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="step-content">
              <h3>Configura tu API Key ({activePreset.label})</h3>
              <p className="muted small">
                🔒 Tus claves se cifran mediante <strong>Windows DPAPI / SO Keyring</strong> y nunca se envían a servidores de terceros.
              </p>
              <div className="field">
                <label>URL Base</label>
                <input
                  value={baseUrl || activePreset.baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div className="field">
                <label>API Key {providerId === "ollama" ? "(Opcional)" : "(Requerida)"}</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={providerId === "ollama" ? "No requerida para Ollama" : "sk-..."}
                />
              </div>

              <div className="test-action-row">
                <button
                  className="btn btn-connect"
                  onClick={handleTestConnection}
                  disabled={testing || (!apiKey.trim() && providerId !== "ollama")}
                >
                  {testing ? "Verificando conexión..." : "⚡ Probar Conexión & Saldo"}
                </button>
              </div>

              {testResult && (
                <div className={`test-feedback ${testResult.ok ? "success" : "error"}`}>
                  <p>{testResult.ok ? "✓ " : "⚠️ "}{testResult.msg}</p>
                  {testResult.balance && (
                    <p className="balance-highlight">
                      Saldo disponible: <strong>{testResult.balance.amount.toFixed(2)} {testResult.balance.currency}</strong>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="step-content">
              <h3>Selecciona tu Workspace de Trabajo</h3>
              <p className="muted small">
                Elige la carpeta raíz de tu repositorio o proyecto. Makora confinará las herramientas de edición y terminal a este entorno.
              </p>
              <div className="workspace-picker-box">
                <button className="btn btn-primary" onClick={handlePickWorkspace}>
                  📁 Seleccionar Carpeta del Proyecto
                </button>
                <div className="folders-list">
                  {folders.length === 0 ? (
                    <p className="muted small">No hay carpetas seleccionadas (se usará tu directorio personal).</p>
                  ) : (
                    folders.map((f, i) => (
                      <div key={i} className="folder-item-chip">
                        📂 {f}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="step-content">
              <h3>Personaliza tu Estilo Makora</h3>
              <p className="muted small">
                Selecciona tu tema favorito. Se adaptarán fondos, terminal, editor y tarjeta de cristal.
              </p>
              <div className="themes-grid">
                {THEME_LIST.map((t) => (
                  <div
                    key={t.id}
                    className={`theme-card ${t.id === currentTheme ? "selected" : ""}`}
                    onClick={() => onSelectTheme(t.id)}
                  >
                    <div className="theme-card-head">
                      <strong>{t.name}</strong>
                      <span className="theme-badge">{t.badge}</span>
                    </div>
                    <div className="theme-palette-preview">
                      <div className="palette-chip" style={{ background: t.colors.bg }} />
                      <div className="palette-chip" style={{ background: t.colors.cyan }} />
                      <div className="palette-chip" style={{ background: t.colors.purple }} />
                      <div className="palette-chip" style={{ background: t.colors.accentGreen }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="onboarding-footer">
          {step > 1 && (
            <button className="btn" onClick={() => setStep((s) => (s - 1) as any)}>
              ← Anterior
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step < 4 ? (
            <button className="btn btn-primary" onClick={() => setStep((s) => (s + 1) as any)}>
              Siguiente →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onClose}>
              🚀 ¡Comenzar a Desarrollar!
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
