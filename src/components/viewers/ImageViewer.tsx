import { useState } from "react";
import { Image as ImageIcon, ZoomIn, ZoomOut, Maximize, Sparkles } from "lucide-react";

interface Props {
  path: string;
  onAskAgent?: (prompt: string) => void;
}

export default function ImageViewer({ path, onAskAgent }: Props) {
  const [zoom, setZoom] = useState(1);
  const fileName = path.split(/[\\/]/).pop() || path;

  const imgSrc = path.startsWith("http") || path.startsWith("data:")
    ? path
    : `https://asset.localhost/${encodeURIComponent(path)}`;

  const handleAskAgent = () => {
    onAskAgent?.(`Analiza detalladamente la imagen adjunta "${fileName}" y describe sus componentes, texto visible, arquitectura o errores.`);
  };

  return (
    <div className="multi-mode-viewer image-viewer-wrap">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <ImageIcon size={13} className="text-cyan" />
          <span className="viewer-file-tag">Visor de Imagen</span>
          <span className="img-name-badge">{fileName}</span>
        </div>
        <div className="viewer-toolbar-center">
          <div className="zoom-controls">
            <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} title="Alejar">
              <ZoomOut size={12} />
            </button>
            <span className="zoom-percent">{Math.round(zoom * 100)}%</span>
            <button className="icon-btn" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} title="Acercar">
              <ZoomIn size={12} />
            </button>
            <button className="btn btn-subtle" onClick={() => setZoom(1)} title="Tamaño original 100%">
              <Maximize size={11} />
              <span>100%</span>
            </button>
          </div>
        </div>
        <div className="viewer-toolbar-right">
          <button className="btn btn-primary btn-subtle" onClick={handleAskAgent} title="Extraer OCR y analizar contenido con IA">
            <Sparkles size={11} />
            <span>Analizar con Makora</span>
          </button>
        </div>
      </div>

      <div className="image-viewer-stage">
        <div className="checkerboard-bg">
          <img
            src={imgSrc}
            alt={fileName}
            className="stage-image"
            style={{ transform: `scale(${zoom})` }}
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
        </div>
      </div>
    </div>
  );
}
