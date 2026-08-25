import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getHardwareProfile,
  listLocalModels,
  startModelDownload,
  cancelModelDownload,
  deleteLocalModel,
  startLocalAi,
} from "../api";
import type {
  DownloadProgress,
  HardwareProfile,
  ModelCatalogEntry,
  Settings,
} from "../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSaveSettings: (s: Settings) => void;
}

export default function LocalAiSetupModal({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}: Props) {
  const [profile, setProfile] = useState<HardwareProfile | null>(null);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<Record<string, DownloadProgress>>({});
  const [loading, setLoading] = useState(true);
  const [startingModel, setStartingModel] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [p, m] = await Promise.all([
        getHardwareProfile(),
        listLocalModels(settings.model || "makoraai-30b"),
      ]);
      setProfile(p);
      setModels(m);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<DownloadProgress>("model-download-progress", (event) => {
      const p = event.payload;
      setActiveDownloads((prev) => ({
        ...prev,
        [p.modelId]: p,
      }));

      if (p.status === "completed") {
        loadData();
      }
    }).then((un) => {
      unlisten = un;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  if (!isOpen) return null;

  const handleStartDownload = async (modelId: string) => {
    try {
      setErrorMsg(null);
      await startModelDownload(modelId);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleCancelDownload = async (modelId: string) => {
    try {
      await cancelModelDownload(modelId);
      setActiveDownloads((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleDeleteModel = async (filename: string) => {
    if (!window.confirm("¿Seguro que deseas eliminar este modelo para liberar espacio en disco?")) {
      return;
    }
    try {
      await deleteLocalModel(filename);
      await loadData();
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleActivateModel = async (entry: ModelCatalogEntry) => {
    setStartingModel(entry.id);
    setErrorMsg(null);
    try {
      const status = await startLocalAi(entry.id, entry.filename);
      const newSettings: Settings = {
        ...settings,
        providerId: "makoraai",
        baseUrl: status.baseUrl,
        model: entry.id,
        apiKey: "",
      };
      onSaveSettings(newSettings);
      onClose();
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setStartingModel(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card local-ai-modal"
        style={{ maxWidth: "780px", width: "90%", maxHeight: "88vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "24px" }}>⚡</span>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>MakoraAI · IA Local Embebida</h2>
              <p style={{ margin: "2px 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Ejecución 100% privada y gratuita en tu hardware sin límites de tokens.
              </p>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Cerrar">✕</button>
        </div>

        {errorMsg && (
          <div style={{ padding: "10px 14px", backgroundColor: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.4)", borderRadius: "8px", color: "#f87171", fontSize: "0.85rem", marginBottom: "16px" }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "8px" }}>⚙️</div>
            <p style={{ margin: 0, fontSize: "0.88rem" }}>Analizando hardware local y modelos disponibles...</p>
          </div>
        )}

        {/* Hardware Profiler Card */}
        {!loading && profile && (
          <div
            style={{
              padding: "14px 18px",
              backgroundColor: "rgba(99, 102, 241, 0.08)",
              border: "1px solid rgba(99, 102, 241, 0.25)",
              borderRadius: "10px",
              marginBottom: "20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <div>
              <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--primary-color, #6366f1)", fontWeight: 600, marginBottom: "4px" }}>
                Hardware Local Detectado
              </div>
              <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-main)" }}>
                {profile.gpuName}
              </div>
              <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "2px" }}>
                {profile.vramGb > 0 ? `${profile.vramGb.toFixed(1)} GB VRAM Dedicada` : "Gráfica compartida"} · {profile.ramGb.toFixed(0)} GB RAM · {profile.cpuCores} Núcleos
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span
                style={{
                  display: "inline-block",
                  padding: "4px 10px",
                  backgroundColor: "rgba(16, 185, 129, 0.15)",
                  color: "#10b981",
                  borderRadius: "20px",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                }}
              >
                ✓ {profile.recommendedTier === "tier1_pro" ? "Tier 1: Pro MoE" : profile.recommendedTier === "tier2_balanced" ? "Tier 2: Balanceado" : "Tier 3: Ligero"}
              </span>
            </div>
          </div>
        )}

        {/* Model Catalog */}
        {!loading && (
          <>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
              Modelos Disponibles para tu Equipo
            </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
          {models.map((m) => {
            const isRecommended = profile?.recommendedModelId === m.id;
            const download = activeDownloads[m.id];
            const isDownloading = download && download.status === "downloading";
            const isPaused = download && download.status === "paused";

            return (
              <div
                key={m.id}
                style={{
                  padding: "16px",
                  borderRadius: "10px",
                  border: isRecommended
                    ? "1.5px solid var(--primary-color, #6366f1)"
                    : "1px solid var(--border-color, #333)",
                  backgroundColor: isRecommended
                    ? "rgba(99, 102, 241, 0.04)"
                    : "var(--card-bg, rgba(255,255,255,0.02))",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontWeight: 600, fontSize: "1rem", color: "var(--text-main)" }}>{m.name}</span>
                      {isRecommended && (
                        <span style={{ fontSize: "0.7rem", backgroundColor: "var(--primary-color, #6366f1)", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }}>
                          RECOMENDADO
                        </span>
                      )}
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", backgroundColor: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: "4px" }}>
                        {m.quantization} · {m.sizeGb} GB
                      </span>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                      {m.description}
                    </p>
                  </div>
                  <div style={{ textAlign: "right", minWidth: "100px" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#10b981" }}>
                      ⚡ {m.speedRating}
                    </span>
                  </div>
                </div>

                {/* Barra de progreso de descarga si está activa */}
                {download && (isDownloading || isPaused) && (
                  <div style={{ marginTop: "12px", marginBottom: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                      <span>{isPaused ? "Descarga pausada" : `Descargando: ${download.speedMbS.toFixed(1)} MB/s`}</span>
                      <span>{download.percentage.toFixed(1)}% ({(download.bytesDownloaded / (1024 * 1024 * 1024)).toFixed(2)} / {(download.totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB)</span>
                    </div>
                    <div style={{ width: "100%", height: "6px", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${download.percentage}%`,
                          height: "100%",
                          backgroundColor: "var(--primary-color, #6366f1)",
                          transition: "width 0.2s ease",
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Acciones */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
                  {m.isDownloaded ? (
                    <>
                      <button
                        className="btn-secondary"
                        style={{ fontSize: "0.8rem", padding: "6px 12px" }}
                        onClick={() => handleDeleteModel(m.filename)}
                      >
                        Eliminar
                      </button>
                      <button
                        className="btn-primary"
                        style={{ fontSize: "0.8rem", padding: "6px 16px" }}
                        disabled={startingModel === m.id}
                        onClick={() => handleActivateModel(m)}
                      >
                        {startingModel === m.id ? "Iniciando..." : m.isActive ? "✓ Activo" : "Usar este modelo"}
                      </button>
                    </>
                  ) : isDownloading ? (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: "0.8rem", padding: "6px 12px" }}
                      onClick={() => handleCancelDownload(m.id)}
                    >
                      Pausar Descarga
                    </button>
                  ) : isPaused ? (
                    <button
                      className="btn-primary"
                      style={{ fontSize: "0.8rem", padding: "6px 16px" }}
                      onClick={() => handleStartDownload(m.id)}
                    >
                      Reanudar Descarga
                    </button>
                  ) : (
                    <button
                      className={isRecommended ? "btn-primary" : "btn-secondary"}
                      style={{ fontSize: "0.8rem", padding: "6px 16px" }}
                      onClick={() => handleStartDownload(m.id)}
                    >
                      Descargar ({m.sizeGb} GB)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </>
        )}

        <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color, #333)", paddingTop: "14px" }}>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Los modelos se guardan en <code>%APPDATA%/MakoraIDE/models</code>
          </div>
          <button className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
