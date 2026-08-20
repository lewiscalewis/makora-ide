import { useState } from "react";
import { Check, Copy, FileCode, X, Eye, Columns } from "lucide-react";

export interface DiffReviewModalProps {
  isOpen: boolean;
  filePath: string;
  diffContent: string;
  onClose: () => void;
  onApply?: () => void;
}

export default function DiffReviewModal({
  isOpen,
  filePath,
  diffContent,
  onClose,
  onApply,
}: DiffReviewModalProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [applied, setApplied] = useState(false);

  if (!isOpen) return null;

  const lines = diffContent.split("\n");
  const additions = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const deletions = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  const handleCopy = () => {
    navigator.clipboard.writeText(diffContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleApply = () => {
    if (onApply) {
      onApply();
      setApplied(true);
      setTimeout(() => {
        setApplied(false);
        onClose();
      }, 800);
    }
  };

  return (
    <div className="diff-modal-backdrop" onClick={onClose} aria-modal="true" role="dialog">
      <div className="diff-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="diff-modal-header">
          <div className="diff-modal-title-col">
            <div className="diff-modal-badge">
              <FileCode size={13} className="text-cyan" />
              <span className="font-mono text-xs">{filePath || "Modificación de archivo"}</span>
            </div>
            <div className="diff-stats-row">
              <span className="diff-stat-add font-mono">+{additions}</span>
              <span className="diff-stat-del font-mono">-{deletions}</span>
              <span className="diff-stat-total muted font-mono">{lines.length} líneas</span>
            </div>
          </div>

          <div className="diff-modal-actions">
            <div className="diff-view-toggle">
              <button
                type="button"
                className={`diff-toggle-btn ${viewMode === "unified" ? "active" : ""}`}
                onClick={() => setViewMode("unified")}
                title="Vista unificada"
              >
                <Eye size={12} />
                <span>Unificada</span>
              </button>
              <button
                type="button"
                className={`diff-toggle-btn ${viewMode === "split" ? "active" : ""}`}
                onClick={() => setViewMode("split")}
                title="Vista en paralelo"
              >
                <Columns size={12} />
                <span>Paralelo</span>
              </button>
            </div>

            <button
              type="button"
              className="btn btn-subtle diff-copy-btn"
              onClick={handleCopy}
              title="Copiar diff"
            >
              {copied ? <Check size={13} className="text-green" /> : <Copy size={13} />}
              <span>{copied ? "Copiado" : "Copiar"}</span>
            </button>

            <button
              type="button"
              className="btn btn-subtle diff-close-btn"
              onClick={onClose}
              title="Cerrar modal"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="diff-modal-body">
          <div className={`diff-pre-container ${viewMode}`}>
            <pre className="diff-pre-body font-mono">
              {lines.map((line, idx) => {
                let cls = "diff-line-ctx";
                if (line.startsWith("+") && !line.startsWith("+++")) {
                  cls = "diff-line-add";
                } else if (line.startsWith("-") && !line.startsWith("---")) {
                  cls = "diff-line-del";
                } else if (line.startsWith("@@") || line.includes("SEARCH") || line.includes("REPLACE")) {
                  cls = "diff-line-hunk";
                }
                return (
                  <div key={idx} className={`diff-line-row ${cls}`}>
                    <span className="diff-line-num">{idx + 1}</span>
                    <span className="diff-line-text">{line || " "}</span>
                  </div>
                );
              })}
            </pre>
          </div>
        </div>

        <div className="diff-modal-footer">
          <span className="diff-footer-hint muted text-xs">
            Revisa con atención los bloques modificados antes de confirmar la integración.
          </span>
          <div className="diff-footer-buttons">
            <button type="button" className="btn btn-subtle" onClick={onClose}>
              Descartar
            </button>
            {onApply && (
              <button
                type="button"
                className={`btn btn-primary ${applied ? "applied-success" : ""}`}
                onClick={handleApply}
                disabled={applied}
              >
                {applied ? (
                  <>
                    <Check size={13} />
                    <span>¡Aplicado con éxito!</span>
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    <span>Aceptar e Integrar Cambios</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
