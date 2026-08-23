import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  Play,
  QrCode,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  getLanIps,
  remotePairCode,
  remoteRevoke,
  remoteStart,
  remoteStatus,
  remoteStop,
  remoteTunnelStart,
  remoteTunnelStop,
} from "../api";
import type { RemoteStatus as RemoteStatusType } from "../types";

const POLL_MS = 2500;
const PAIR_TTL_SECS = 180;

interface RemotePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function fmtTtl(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function RemotePanel({ isOpen, onClose }: RemotePanelProps) {
  const [status, setStatus] = useState<RemoteStatusType | null>(null);
  const [ips, setIps] = useState<string[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [ttl, setTtl] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Estado del servidor (polling ligero mientras el panel está abierto)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await remoteStatus();
        if (!cancelled) setStatus(s);
      } catch {
        /* el servidor aún no está registrado: ignorar */
      }
    };
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    getLanIps()
      .then(setIps)
      .catch(() => setIps([]));
  }, [isOpen]);

  // Cuenta atrás del código de emparejamiento
  useEffect(() => {
    if (ttl <= 0) return;
    const id = setInterval(() => setTtl((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [ttl > 0]);

  if (!isOpen) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      const s = await remoteStatus();
      setStatus(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () => run(() => remoteStart(null));
  const handleStop = () => run(() => remoteStop());
  const handlePair = () =>
    run(async () => {
      const c = await remotePairCode();
      setCode(c);
      setTtl(PAIR_TTL_SECS);
    });
  const handleRevoke = () =>
    run(async () => {
      await remoteRevoke();
      setCode(null);
      setTtl(0);
    });
  const handleTunnelStart = () => run(() => remoteTunnelStart());
  const handleTunnelStop = () => run(() => remoteTunnelStop());

  const urls = ips
    .filter(() => status?.port)
    .map((ip) => `https://${ip}:${status!.port}`);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin portapapeles */
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal remote-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Acceso remoto"
      >
        <div className="modal-header">
          <div className="settings-header-left">
            <MonitorSmartphone size={16} />
            <h3>Acceso remoto</h3>
          </div>
          <button className="btn btn-subtle btn-sm" onClick={onClose} aria-label="Cerrar">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="remote-hero">
            <div className="remote-hero-status">
              {status?.running ? (
                <>
                  <span className="remote-dot on" />
                  <strong>Servidor activo</strong>
                  <span className="muted">· puerto {status.port}</span>
                </>
              ) : (
                <>
                  <span className="remote-dot" />
                  <strong>Servidor detenido</strong>
                </>
              )}
            </div>
            <div className="remote-hero-meta muted">
              {status?.running ? (
                <>Escanea o abre la URL en tu teléfono (misma red Wi-Fi).</>
              ) : (
                <>Inicia el servidor para conectarte desde el móvil.</>
              )}
            </div>
          </div>

          {error && <div className="remote-error">{error}</div>}

          <div className="remote-actions">
            {status?.running ? (
              <button
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={handleStop}
              >
                {busy ? <Loader2 size={14} className="spin" /> : <Square size={14} />}
                Detener servidor
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={handleStart}
              >
                {busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                Iniciar servidor
              </button>
            )}

            {status?.running && (
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={handlePair}
              >
                <KeyRound size={14} />
                {code ? "Generar nuevo código" : "Generar código de emparejamiento"}
              </button>
            )}

            {status?.deviceLabel && (
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={handleRevoke}
                title={`Dispositivo emparejado: ${status.deviceLabel}`}
              >
                <Trash2 size={14} />
                Revocar dispositivo
              </button>
            )}
          </div>

          {code && (
            <div className="remote-code-card">
              <div className="remote-code-label">
                <KeyRound size={13} />
                Código de emparejamiento
                <span className={ttl <= 30 ? "remote-ttl warn" : "remote-ttl"}>
                  {ttl > 0 ? `válido ${fmtTtl(ttl)}` : "expirado"}
                </span>
              </div>
              <div className="remote-code">{code}</div>
              <div className="muted small">
                Introdúcelo en el teléfono cuando el navegador lo pida.
              </div>
            </div>
          )}

          {status?.running && (
            <div className="remote-section">
              <div className="remote-section-title">
                <Globe size={13} />
                Acceso público
              </div>
              {status.tunnelActive && status.tunnelUrl ? (
                <>
                  <div className="remote-url remote-url-public">
                    <code>{status.tunnelUrl}</code>
                    <button
                      className="btn btn-subtle btn-sm"
                      onClick={() => copy(status.tunnelUrl!)}
                      title="Copiar URL pública"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  <div className="remote-actions">
                    <button className="btn btn-sm" disabled={busy} onClick={handleTunnelStop}>
                      {busy ? <Loader2 size={14} className="spin" /> : <Square size={14} />}
                      Detener túnel
                    </button>
                  </div>
                  <div className="muted small">
                    URL efímera de Cloudflare: cambia al reiniciar el túnel. Funciona desde
                    cualquier red, no solo la Wi-Fi local.
                  </div>
                </>
              ) : (
                <>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={handleTunnelStart}
                  >
                    {busy ? <Loader2 size={14} className="spin" /> : <Globe size={14} />}
                    Exponer públicamente (Cloudflare)
                  </button>
                  <div className="muted small">
                    Crea una URL pública segura (TLS de Cloudflare) para acceder desde el
                    móvil estés donde estés.
                  </div>
                </>
              )}
            </div>
          )}

          {status?.running && (
            <div className="remote-section">
              <div className="remote-section-title">
                <Wifi size={13} />
                Red local (misma Wi-Fi)
              </div>
              {urls.length > 0 ? (
                <div className="remote-urls">
                  {urls.map((u) => (
                    <div key={u} className="remote-url">
                      <code>{u}</code>
                      <button
                        className="btn btn-subtle btn-sm"
                        onClick={() => copy(u)}
                        title="Copiar URL"
                      >
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted small">
                  No se pudo detectar la IP local. Usa la IP de tu equipo en la red
                  Wi-Fi con el puerto {status.port}.
                </div>
              )}
              <ol className="remote-steps">
                <li>Inicia el servidor y genera el código.</li>
                <li>
                  En el móvil abre{" "}
                  <code className="muted">https://IP-del-PC:{status.port}</code> (acepta el
                  aviso de certificado autofirmado).
                </li>
                <li>Introduce el código de emparejamiento.</li>
                <li>Chatea con Makora desde el navegador del móvil.</li>
              </ol>
            </div>
          )}

          <div className="remote-section">
            <div className="remote-section-title">
              <QrCode size={13} />
              Estado
            </div>
            <div className="remote-meta-grid">
              <div>
                <div className="muted small">Fingerprint del servidor</div>
                <div className="mono small">{status?.fingerprint ?? "—"}</div>
              </div>
              <div>
                <div className="muted small">Modelo configurado</div>
                <div className="small">
                  {status?.configured ? status.config.model : "No configurado"}
                </div>
              </div>
              <div>
                <div className="muted small">Dispositivo emparejado</div>
                <div className="small">
                  {status?.deviceLabel ?? "Ninguno"} {status?.running ? "" : " (servidor detenido)"}
                </div>
              </div>
            </div>
            {!status?.running && (
              <div className="remote-off-note">
                <WifiOff size={13} />
                <span>
                  El servidor se detiene al cerrar MakoraIDE. Usa el código antes de
                  los 3 minutos de validez.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
