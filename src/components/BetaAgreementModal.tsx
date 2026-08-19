import { useState } from "react";
import { ShieldCheck, Lock, AlertOctagon, CheckSquare, Square, FileText } from "lucide-react";

interface Props {
  isOpen: boolean;
  onAccept: () => void;
  isExpired?: boolean;
  expirationError?: string | null;
}

export default function BetaAgreementModal({
  isOpen,
  onAccept,
  isExpired = false,
  expirationError,
}: Props) {
  const [accepted, setAccepted] = useState(false);

  if (!isOpen && !isExpired) return null;

  if (isExpired) {
    return (
      <div className="modal-overlay modal-blocking">
        <div className="modal beta-modal-card">
          <div className="beta-header text-center">
            <div className="beta-icon-wrap expired">
              <AlertOctagon size={36} className="text-red" />
            </div>
            <h2>Período Beta Concluido</h2>
            <p className="muted small mt-6">
              {expirationError ||
                "Esta versión preliminar de MakoraIDE ha caducado. Por favor, solicita una actualización oficial al desarrollador."}
            </p>
          </div>

          <div className="beta-expired-body">
            <div className="beta-notice-box">
              <Lock size={16} className="text-gold" />
              <span>
                El acceso a esta compilación se encuentra deshabilitado por protocolo de seguridad temporal.
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay modal-blocking">
      <div className="modal beta-modal-card">
        <div className="beta-header">
          <div className="beta-icon-wrap">
            <ShieldCheck size={28} className="text-cyan" />
          </div>
          <div>
            <h2>Acuerdo de Confidencialidad y Evaluación Beta</h2>
            <p className="muted small">MakoraIDE · Protocolo de Protección de Propiedad Intelectual</p>
          </div>
        </div>

        <div className="beta-clauses-container font-mono">
          <div className="beta-clause-item">
            <span className="clause-num">1. PROPIEDAD EXCLUSIVA:</span>
            <p>
              Todo el código fuente, interfaz de usuario, lógica algorítmica, arquitectura de optimización de tokens y conceptos técnicos son propiedad intelectual exclusiva de su autor y desarrollador.
            </p>
          </div>

          <div className="beta-clause-item">
            <span className="clause-num">2. FIN EXCLUSIVO DE EVALUACIÓN:</span>
            <p>
              La cesión de uso es temporal, no exclusiva e intransferible, con el único propósito de evaluar el rendimiento, ergonomía y reportar incidencias.
            </p>
          </div>

          <div className="beta-clause-item">
            <span className="clause-num">3. CONFIDENCIALIDAD:</span>
            <p>
              El usuario se compromete a no compartir, distribuir, publicar capturas ni divulgar detalles técnicos, modelos de negocio o métricas a terceros sin autorización previa por escrito.
            </p>
          </div>

          <div className="beta-clause-item">
            <span className="clause-num">4. PROHIBICIÓN DE INGENIERÍA INVERSA:</span>
            <p>
              Queda expresamente prohibido descompilar, desensamblar, desofuscar o intentar extraer el código fuente y modelos integrados en el ejecutable.
            </p>
          </div>

          <div className="beta-clause-item">
            <span className="clause-num">5. CESIÓN DE FEEDBACK:</span>
            <p>
              Cualquier sugerencia, informe o reporte de error aportado se considerará voluntario y cedido para la mejora continua del producto.
            </p>
          </div>
        </div>

        <div className="beta-footer">
          <label className="beta-checkbox-row" onClick={() => setAccepted((v) => !v)}>
            {accepted ? (
              <CheckSquare size={16} className="text-cyan" />
            ) : (
              <Square size={16} className="text-muted" />
            )}
            <span>
              He leído, comprendo y acepto íntegramente las condiciones de confidencialidad y propiedad intelectual de MakoraIDE.
            </span>
          </label>

          <button
            className="btn btn-primary beta-accept-btn"
            disabled={!accepted}
            onClick={onAccept}
          >
            <FileText size={13} />
            <span>Aceptar Términos y Acceder al IDE</span>
          </button>
        </div>
      </div>
    </div>
  );
}
