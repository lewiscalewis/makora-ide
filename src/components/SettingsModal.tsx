import { useState } from "react";
import { THINKING_LEVELS } from "../defaults";
import { THEME_LIST } from "../themes";
import {
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
} from "lucide-react";

import type {
  AppConfig,
  McpConfig,
  ModelConfig,
  SkillConfig,
  ThemeId,
  ThinkingLevel,
} from "../types";

type Tab = "models" | "context" | "skills" | "mcps" | "appearance";

interface Props {
  config: AppConfig;
  onConfig: (c: AppConfig) => void;
  onClose: () => void;
  currentTheme: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
}

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function SettingsModal({
  config,
  onConfig,
  onClose,
  currentTheme,
  onSelectTheme,
}: Props) {
  const [tab, setTab] = useState<Tab>("models");

  const updModel = (i: number, patch: Partial<ModelConfig>) =>
    onConfig({
      ...config,
      models: config.models.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    });
  const addModel = () =>
    onConfig({
      ...config,
      models: [
        ...config.models,
        {
          id: "",
          label: "",
          providerId: "deepseek",
          thinkingLevel: "medium",
          contextWindow: 128000,
          maxOutputTokens: 8192,
          reasoningEnabled: false,
          visionEnabled: false,
          inputPrice: 0,
          outputPrice: 0,
        },
      ],
    });
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
              <h3>Configuración de MakoraIDE</h3>
              <span className="settings-sub muted small">Ajustes de motor agéntico, modelos, skills y temas</span>
            </div>
          </div>
          <button className="icon-btn" title="Cerrar (Esc)" onClick={onClose}>
            <X size={13} />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="modal-tabs">
          <button
            className={`tab ${tab === "models" ? "active" : ""}`}
            onClick={() => setTab("models")}
          >
            <Cpu size={12} />
            <span>Modelos ({config.models.length})</span>
          </button>
          <button
            className={`tab ${tab === "context" ? "active" : ""}`}
            onClick={() => setTab("context")}
          >
            <Layers size={12} />
            <span>Contexto & Presupuesto</span>
          </button>
          <button
            className={`tab ${tab === "skills" ? "active" : ""}`}
            onClick={() => setTab("skills")}
          >
            <Sparkles size={12} />
            <span>Skills Agénticas</span>
          </button>
          <button
            className={`tab ${tab === "mcps" ? "active" : ""}`}
            onClick={() => setTab("mcps")}
          >
            <Network size={12} />
            <span>Servidores MCP</span>
          </button>
          <button
            className={`tab ${tab === "appearance" ? "active" : ""}`}
            onClick={() => setTab("appearance")}
          >
            <Palette size={12} />
            <span>Apariencia & Temas</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          {tab === "models" && (
            <div className="cfg-section">
              <div className="cfg-top-action">
                <button className="btn btn-connect" onClick={addModel}>
                  <Plus size={12} />
                  <span>Añadir Modelo Personalizado</span>
                </button>
              </div>

              <div className="cfg-cards-stack">
                {config.models.map((m, i) => (
                  <div className="cfg-card" key={i}>
                    <div className="cfg-head">
                      <div className="cfg-head-title">
                        <Cpu size={14} className="text-cyan" />
                        <strong>{m.label || m.id || "Nuevo modelo"}</strong>
                        {m.reasoningEnabled && <span className="badge-pill">Thinking</span>}
                        {m.visionEnabled && <span className="badge-pill">Visión</span>}
                      </div>
                      <button className="icon-btn-micro danger" title="Eliminar modelo" onClick={() => removeModel(i)}>
                        <Trash2 size={11} />
                      </button>
                    </div>

                    <div className="grid-2">
                      <div className="field">
                        <label>ID del Proveedor</label>
                        <input
                          placeholder="ej. deepseek-chat"
                          value={m.id}
                          onChange={(e) => updModel(i, { id: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label>Etiqueta Visible</label>
                        <input
                          placeholder="ej. DeepSeek V3 Flash"
                          value={m.label}
                          onChange={(e) => updModel(i, { label: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="grid-2">
                      <div className="field">
                        <label>Pensamiento por Defecto</label>
                        <select
                          value={m.thinkingLevel}
                          onChange={(e) => updModel(i, { thinkingLevel: e.target.value as ThinkingLevel })}
                        >
                          {THINKING_LEVELS.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Ventana de Contexto (Tokens)</label>
                        <input
                          type="number"
                          value={m.contextWindow}
                          onChange={(e) => updModel(i, { contextWindow: num(e.target.value, 0) })}
                        />
                      </div>
                    </div>

                    <div className="grid-2">
                      <div className="field">
                        <label>Máx. Tokens de Salida</label>
                        <input
                          type="number"
                          value={m.maxOutputTokens}
                          onChange={(e) => updModel(i, { maxOutputTokens: num(e.target.value, 0) })}
                        />
                      </div>
                      <div className="checks-row align-center">
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={m.reasoningEnabled}
                            onChange={(e) => updModel(i, { reasoningEnabled: e.target.checked })}
                          />
                          <span>Razonamiento API (Thinking)</span>
                        </label>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={m.visionEnabled}
                            onChange={(e) => updModel(i, { visionEnabled: e.target.checked })}
                          />
                          <span>Visión (OCR / Imágenes)</span>
                        </label>
                      </div>
                    </div>

                    <div className="grid-2">
                      <div className="field">
                        <label>Precio Entrada ($/1M Tokens)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={m.inputPrice}
                          onChange={(e) => updModel(i, { inputPrice: num(e.target.value, 0) })}
                        />
                      </div>
                      <div className="field">
                        <label>Precio Salida ($/1M Tokens)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={m.outputPrice}
                          onChange={(e) => updModel(i, { outputPrice: num(e.target.value, 0) })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "context" && (
            <div className="cfg-section">
              <div className="analytics-info-box">
                <Layers size={14} className="text-cyan" />
                <div>
                  <strong>Presupuesto Dinámico de Contexto</strong>
                  <p className="small muted">
                    Controla el reparto del contexto entre el sistema, el historial de conversación y los archivos analizados.
                  </p>
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>Presupuesto Total (Tokens)</label>
                  <input
                    type="number"
                    value={config.context.maxTokens}
                    onChange={(e) => setCtx({ maxTokens: num(e.target.value, 0) })}
                  />
                </div>
                <div className="field">
                  <label>Repo-Map Árbol (Tokens)</label>
                  <input
                    type="number"
                    value={config.context.repoMapTokens}
                    onChange={(e) => setCtx({ repoMapTokens: num(e.target.value, 0) })}
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>Cuota Instrucciones Sistema (%)</label>
                  <input
                    type="number"
                    value={config.context.systemShare}
                    onChange={(e) => setCtx({ systemShare: num(e.target.value, 0) })}
                  />
                </div>
                <div className="field">
                  <label>Cuota Historial Chat (%)</label>
                  <input
                    type="number"
                    value={config.context.historyShare}
                    onChange={(e) => setCtx({ historyShare: num(e.target.value, 0) })}
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label>Cuota Archivos del Workspace (%)</label>
                  <input
                    type="number"
                    value={config.context.filesShare}
                    onChange={(e) => setCtx({ filesShare: num(e.target.value, 0) })}
                  />
                </div>
                <div className="field">
                  <label>Umbral de Compactación Automática (0-1)</label>
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
                <span>Incluir estructura viva del workspace en cada instrucción</span>
              </label>
            </div>
          )}

          {tab === "skills" && (
            <div className="cfg-section">
              <div className="cfg-card system-skill">
                <div className="cfg-head">
                  <div className="cfg-head-title">
                    <Sparkles size={14} className="text-cyan" />
                    <strong>Makora Core Engine Skill (Sistema)</strong>
                  </div>
                  <span className="badge-pill active">Activa por defecto</span>
                </div>
                <p className="muted small">
                  Optimiza cada respuesta para economizar tokens: instrucciones concisas, parches quirúrgicos, lectura selectiva de rangos y auto-recuperación ante fallos.
                </p>
              </div>

              <button className="btn btn-connect" onClick={addSkill}>
                <Plus size={12} />
                <span>Añadir Nueva Skill Personalizada</span>
              </button>

              <div className="cfg-cards-stack">
                {config.skills.map((s, i) => (
                  <div className="cfg-card" key={i}>
                    <div className="cfg-head">
                      <strong>{s.name || "Nueva skill"}</strong>
                      <button className="icon-btn-micro danger" title="Eliminar" onClick={() => removeSkill(i)}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="field">
                      <label>Nombre de la Skill</label>
                      <input value={s.name} onChange={(e) => updSkill(i, { name: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Descripción del Contexto</label>
                      <input value={s.description} onChange={(e) => updSkill(i, { description: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Contenido del Prompt / Reglas</label>
                      <textarea
                        rows={4}
                        value={s.content}
                        onChange={(e) => updSkill(i, { content: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "mcps" && (
            <div className="cfg-section">
              <p className="muted small">
                Configura servidores MCP (Model Context Protocol) externos para conectar Makora con bases de datos, APIs o herramientas locales.
              </p>

              <button className="btn btn-connect" onClick={addMcp}>
                <Plus size={12} />
                <span>Añadir Servidor MCP</span>
              </button>

              <div className="cfg-cards-stack">
                {config.mcps.map((m, i) => (
                  <div className="cfg-card" key={i}>
                    <div className="cfg-head">
                      <div className="cfg-head-title">
                        <Network size={14} className="text-purple" />
                        <strong>{m.name || "Servidor MCP"}</strong>
                      </div>
                      <button className="icon-btn-micro danger" title="Eliminar" onClick={() => removeMcp(i)}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="grid-2">
                      <div className="field">
                        <label>Nombre Identificador</label>
                        <input value={m.name} onChange={(e) => updMcp(i, { name: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Comando Ejecutable (binario / npx / uvx)</label>
                        <input value={m.command} onChange={(e) => updMcp(i, { command: e.target.value })} />
                      </div>
                    </div>
                    <div className="field">
                      <label>Argumentos (separados por espacio o JSON array)</label>
                      <input value={m.args} onChange={(e) => updMcp(i, { args: e.target.value })} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "appearance" && (
            <div className="cfg-section">
              <h4 className="section-title">Paleta de Color & Contraste (WCAG 2.2 AAA)</h4>
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
