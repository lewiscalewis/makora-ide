import { useState } from "react";
import { THINKING_LEVELS } from "../defaults";
import { THEME_LIST } from "../themes";
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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Configuración de MakoraIDE</h2>
          <button className="icon-btn" title="Cerrar (Escape)" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-tabs">
          <button className={"tab" + (tab === "models" ? " active" : "")} onClick={() => setTab("models")}>Modelos</button>
          <button className={"tab" + (tab === "context" ? " active" : "")} onClick={() => setTab("context")}>Contexto & Tokens</button>
          <button className={"tab" + (tab === "skills" ? " active" : "")} onClick={() => setTab("skills")}>Skills</button>
          <button className={"tab" + (tab === "mcps" ? " active" : "")} onClick={() => setTab("mcps")}>MCPs</button>
          <button className={"tab" + (tab === "appearance" ? " active" : "")} onClick={() => setTab("appearance")}>🎨 Apariencia & Temas</button>
        </div>

        <div className="modal-body">
          {tab === "models" && (
            <div className="cfg-section">
              <div className="cfg-top-action">
                <button className="btn btn-connect" onClick={addModel}>+ Añadir Modelo Personalizado</button>
              </div>
              {config.models.map((m, i) => (
                <div className="cfg-card" key={i}>
                  <div className="cfg-head">
                    <strong>{m.label || m.id || "Nuevo modelo"}</strong>
                    <button className="icon-btn" title="Eliminar" onClick={() => removeModel(i)}>×</button>
                  </div>
                  <div className="field">
                    <label>ID (del proveedor)</label>
                    <input value={m.id} onChange={(e) => updModel(i, { id: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Etiqueta</label>
                    <input value={m.label} onChange={(e) => updModel(i, { label: e.target.value })} />
                  </div>
                  <div className="grid-2">
                    <div className="field">
                      <label>Pensamiento por defecto</label>
                      <select value={m.thinkingLevel} onChange={(e) => updModel(i, { thinkingLevel: e.target.value as ThinkingLevel })}>
                        {THINKING_LEVELS.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Ventana contexto (tokens)</label>
                      <input type="number" value={m.contextWindow} onChange={(e) => updModel(i, { contextWindow: num(e.target.value, 0) })} />
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="field">
                      <label>Máx. tokens salida</label>
                      <input type="number" value={m.maxOutputTokens} onChange={(e) => updModel(i, { maxOutputTokens: num(e.target.value, 0) })} />
                    </div>
                    <div className="checks-row">
                      <label className="check">
                        <input type="checkbox" checked={m.reasoningEnabled} onChange={(e) => updModel(i, { reasoningEnabled: e.target.checked })} />
                        <span>Razonamiento vía API (thinking)</span>
                      </label>
                      <label className="check">
                        <input type="checkbox" checked={m.visionEnabled} onChange={(e) => updModel(i, { visionEnabled: e.target.checked })} />
                        <span>Visión (imágenes)</span>
                      </label>
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="field">
                      <label>Precio entrada ($/M)</label>
                      <input type="number" step="0.01" value={m.inputPrice} onChange={(e) => updModel(i, { inputPrice: num(e.target.value, 0) })} />
                    </div>
                    <div className="field">
                      <label>Precio salida ($/M)</label>
                      <input type="number" step="0.01" value={m.outputPrice} onChange={(e) => updModel(i, { outputPrice: num(e.target.value, 0) })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "context" && (
            <div className="cfg-section">
              <div className="grid-2">
                <div className="field">
                  <label>Presupuesto total (tokens)</label>
                  <input type="number" value={config.context.maxTokens} onChange={(e) => setCtx({ maxTokens: num(e.target.value, 0) })} />
                </div>
                <div className="field">
                  <label>Repo-map (tokens)</label>
                  <input type="number" value={config.context.repoMapTokens} onChange={(e) => setCtx({ repoMapTokens: num(e.target.value, 0) })} />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Sistema (%)</label>
                  <input type="number" value={config.context.systemShare} onChange={(e) => setCtx({ systemShare: num(e.target.value, 0) })} />
                </div>
                <div className="field">
                  <label>Historial (%)</label>
                  <input type="number" value={config.context.historyShare} onChange={(e) => setCtx({ historyShare: num(e.target.value, 0) })} />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Archivos (%)</label>
                  <input type="number" value={config.context.filesShare} onChange={(e) => setCtx({ filesShare: num(e.target.value, 0) })} />
                </div>
                <div className="field">
                  <label>Umbral compactación (0-1)</label>
                  <input type="number" step="0.05" value={config.context.compactionThreshold} onChange={(e) => setCtx({ compactionThreshold: num(e.target.value, 0) })} />
                </div>
              </div>
              <label className="check">
                <input type="checkbox" checked={config.context.includeWorkspace} onChange={(e) => setCtx({ includeWorkspace: e.target.checked })} />
                <span>Incluir estructura del workspace en el contexto</span>
              </label>
            </div>
          )}

          {tab === "skills" && (
            <div className="cfg-section">
              <p className="muted small">
                Las skills se inyectan como instrucciones del sistema en cada turno agéntico.
              </p>
              <div className="cfg-card system-skill">
                <div className="cfg-head">
                  <strong>⚡ Makora Core Skill (sistema, universal)</strong>
                  <span className="skill-badge">siempre activa</span>
                </div>
                <p className="muted small">
                  Optimiza cada respuesta para gastar el mínimo de tokens sin perder
                  calidad: respuestas esenciales, tools agrupadas, lectura selectiva con
                  grep/list_dir/read_file_range, parches quirúrgicos con apply_patch,
                  reintentos automáticos y ejecución continuada.
                </p>
              </div>
              <button className="btn btn-connect" onClick={addSkill}>+ Añadir Skill</button>
              {config.skills.map((s, i) => (
                <div className="cfg-card" key={i}>
                  <div className="cfg-head">
                    <strong>{s.name || "Nueva skill"}</strong>
                    <button className="icon-btn" title="Eliminar" onClick={() => removeSkill(i)}>×</button>
                  </div>
                  <div className="field">
                    <label>Nombre</label>
                    <input value={s.name} onChange={(e) => updSkill(i, { name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Descripción</label>
                    <input value={s.description} onChange={(e) => updSkill(i, { description: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Contenido</label>
                    <textarea rows={5} value={s.content} onChange={(e) => updSkill(i, { content: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "mcps" && (
            <div className="cfg-section">
              <p className="muted small">Servidores MCP (Model Context Protocol). El agente expone automáticamente las tools descubiertas.</p>
              <button className="btn btn-connect" onClick={addMcp}>+ Añadir Servidor MCP</button>
              {config.mcps.map((m, i) => (
                <div className="cfg-card" key={i}>
                  <div className="cfg-head">
                    <strong>{m.name || "Nuevo MCP"}</strong>
                    <button className="icon-btn" title="Eliminar" onClick={() => removeMcp(i)}>×</button>
                  </div>
                  <div className="field">
                    <label>Nombre del namespace</label>
                    <input value={m.name} onChange={(e) => updMcp(i, { name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Comando ejecutable (ej: npx, uvx, python)</label>
                    <input value={m.command} onChange={(e) => updMcp(i, { command: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Argumentos</label>
                    <input value={m.args} onChange={(e) => updMcp(i, { args: e.target.value })} />
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={m.enabled} onChange={(e) => updMcp(i, { enabled: e.target.checked })} />
                    <span>Servidor Habilitado</span>
                  </label>
                </div>
              ))}
            </div>
          )}

          {tab === "appearance" && (
            <div className="cfg-section">
              <p className="muted small">
                Selecciona tu tema visual Makora. Cada tema adapta fondos, tarjetas de cristal, terminal xterm.js, resaltado de código y acentos.
              </p>
              <div className="themes-grid">
                {THEME_LIST.map((t) => {
                  const isSelected = t.id === currentTheme;
                  return (
                    <div
                      key={t.id}
                      className={`theme-card ${isSelected ? "selected" : ""}`}
                      onClick={() => onSelectTheme(t.id)}
                    >
                      <div className="theme-card-head">
                        <div className="theme-name-group">
                          <strong>{t.name}</strong>
                          <span className="theme-badge">{t.badge}</span>
                        </div>
                        {isSelected && <span className="theme-active-tag">Activo ✓</span>}
                      </div>
                      <p className="theme-desc">{t.description}</p>
                      <div className="theme-palette-preview">
                        <div className="palette-chip" style={{ background: t.colors.bg }} title="Fondo" />
                        <div className="palette-chip" style={{ background: t.colors.cyan }} title="Cian" />
                        <div className="palette-chip" style={{ background: t.colors.purple }} title="Púrpura" />
                        <div className="palette-chip" style={{ background: t.colors.accentGreen }} title="Verde" />
                        <div className="palette-chip" style={{ background: t.colors.gold }} title="Dorado" />
                        <div className="palette-chip" style={{ background: t.colors.crimson }} title="Carmesí" />
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
