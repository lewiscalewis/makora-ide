import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readBinaryFile, revealInExplorer } from "../../api";
import { useI18n } from "../../i18n";
import {
  FileText,
  ZoomIn,
  ZoomOut,
  Maximize,
  ExternalLink,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
} from "lucide-react";

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface Props {
  path: string;
  onAskAgent?: (prompt: string) => void;
}

export default function PdfViewer({ path, onAskAgent }: Props) {
  const { language } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(100);
  const [extractedText, setExtractedText] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [zoomToast, setZoomToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const fileName = path.split(/[\\/]/).pop() || path;

  const triggerZoomToast = (msg: string) => {
    setZoomToast(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setZoomToast(null), 1400);
  };

  // Keyboard Shortcuts (Ctrl +/-/0 and Arrows for Pages)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      if (isCmdOrCtrl && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        setZoom((z) => {
          const next = Math.min(300, z + 15);
          triggerZoomToast(`Zoom: ${next}%`);
          return next;
        });
      } else if (isCmdOrCtrl && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        setZoom((z) => {
          const next = Math.max(30, z - 15);
          triggerZoomToast(`Zoom: ${next}%`);
          return next;
        });
      } else if (isCmdOrCtrl && e.key === "0") {
        e.preventDefault();
        setZoom(100);
        triggerZoomToast("Zoom: 100%");
      } else if (!isCmdOrCtrl && (e.key === "ArrowLeft" || e.key === "PageUp")) {
        if (numPages > 1) {
          setCurrentPage((p) => {
            const next = Math.max(1, p - 1);
            triggerZoomToast(`Página ${next} / ${numPages}`);
            return next;
          });
        }
      } else if (!isCmdOrCtrl && (e.key === "ArrowRight" || e.key === "PageDown")) {
        if (numPages > 1) {
          setCurrentPage((p) => {
            const next = Math.min(numPages, p + 1);
            triggerZoomToast(`Página ${next} / ${numPages}`);
            return next;
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [numPages]);

  // Non-passive wheel event listener for smooth Ctrl + MouseWheel Zoom
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 15 : -15;
        setZoom((z) => {
          const next = Math.max(30, Math.min(300, z + delta));
          triggerZoomToast(`Zoom: ${next}%`);
          return next;
        });
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Load PDF Document via Tauri Binary Read
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);
    setExtractedText("");

    async function loadPdf() {
      try {
        const rawBytes = await readBinaryFile(path);
        if (isCancelled) return;

        const uint8Array = new Uint8Array(rawBytes);
        const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
        const doc = await loadingTask.promise;
        if (isCancelled) return;

        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setCurrentPage(1);

        // Extract full text in background for agent analysis
        let fullText = "";
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str || "")
            .join(" ");
          if (pageText.trim()) {
            fullText += `\n--- [Página ${i}] ---\n${pageText}\n`;
          }
        }
        if (!isCancelled) {
          setExtractedText(fullText.trim());
          setLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(String(err));
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [path]);

  // Render Current Page onto Canvas
  useEffect(() => {
    if (!pdfDocRef.current || !canvasRef.current || loading) return;

    let isCancelled = false;

    async function renderPage() {
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        const doc = pdfDocRef.current;
        if (!doc) return;

        const page = await doc.getPage(currentPage);
        if (isCancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        const scale = (zoom / 100) * 1.5; // High-DPI base multiplier
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / 1.5}px`;
        canvas.style.height = `${viewport.height / 1.5}px`;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          canvas,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.error("PDF Render Error:", err);
        }
      }
    }

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [currentPage, zoom, loading]);

  const handleAskAgent = () => {
    const textExcerpt = extractedText.slice(0, 15000);
    let prompt = "";

    switch (language) {
      case "en":
        prompt = textExcerpt
          ? `Analyze the attached PDF document "${fileName}". Here is its extracted content:\n\n---\n${textExcerpt}\n---\n\nPlease summarize its key points, technical/legal structure, and important takeaways.`
          : `Analyze the attached PDF document "${fileName}" located at \`${path}\`. Please extract its key insights and structural summary.`;
        break;
      case "fr":
        prompt = textExcerpt
          ? `Analyse le document PDF "${fileName}". Voici son contenu extrait :\n\n---\n${textExcerpt}\n---\n\nMerci de résumer les points clés, la structure et les conclusions.`
          : `Analyse le document PDF "${fileName}" situé à \`${path}\`.`;
        break;
      case "de":
        prompt = textExcerpt
          ? `Analysiere das angehängte PDF-Dokument "${fileName}". Hier ist der extrahierte Inhalt:\n\n---\n${textExcerpt}\n---\n\nBitte fasse die wichtigsten Punkte und Erkenntnisse zusammen.`
          : `Analysiere das PDF-Dokument "${fileName}" unter \`${path}\`.`;
        break;
      case "it":
        prompt = textExcerpt
          ? `Analizza il documento PDF "${fileName}". Ecco il suo contenuto estratto:\n\n---\n${textExcerpt}\n---\n\nRiassumi i punti chiave, la struttura e le conclusioni.`
          : `Analizza il documento PDF "${fileName}" situato in \`${path}\`.`;
        break;
      case "pt":
        prompt = textExcerpt
          ? `Analise o documento PDF "${fileName}". Aqui está o conteúdo extraído:\n\n---\n${textExcerpt}\n---\n\nPor favor, resuma os pontos principais, a estrutura e conclusões.`
          : `Analise o documento PDF "${fileName}" localizado em \`${path}\`.`;
        break;
      case "zh":
        prompt = textExcerpt
          ? `请分析附加的 PDF 文档 "${fileName}"。提取的内容如下：\n\n---\n${textExcerpt}\n---\n\n请总结其核心要点、技术/法律结构和关键结论。`
          : `请分析位于 \`${path}\` 的 PDF 文档 "${fileName}"。`;
        break;
      case "es":
      default:
        prompt = textExcerpt
          ? `Analiza el documento PDF "${fileName}". He extraído su contenido:\n\n---\n${textExcerpt}\n---\n\nResume sus puntos clave, estructura técnica o profesional, conclusiones y posibles implicaciones.`
          : `Analiza el documento PDF "${fileName}" ubicado en \`${path}\`. Resume sus puntos clave y estructura.`;
        break;
    }

    onAskAgent?.(prompt);
  };

  const handleOpenExternal = () => {
    revealInExplorer(path).catch(() => undefined);
  };

  return (
    <div className="multi-mode-viewer pdf-viewer-wrap">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <FileText size={13} className="text-purple" />
          <span className="viewer-file-tag">Documento PDF</span>
          <span className="img-name-badge">{fileName}</span>
        </div>

        <div className="viewer-toolbar-center">
          {numPages > 1 && (
            <div className="pdf-page-controls" style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 8 }}>
              <button
                type="button"
                className="icon-btn"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                title="Página anterior"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="small muted font-mono" style={{ padding: "0 4px", fontSize: 11 }}>
                {currentPage} / {numPages}
              </span>
              <button
                type="button"
                className="icon-btn"
                disabled={currentPage >= numPages}
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                title="Página siguiente"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}

          <div className="zoom-controls">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setZoom((z) => Math.max(50, z - 25))}
              title="Alejar"
            >
              <ZoomOut size={12} />
            </button>
            <span className="zoom-percent">{zoom}%</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setZoom((z) => Math.min(200, z + 25))}
              title="Acercar"
            >
              <ZoomIn size={12} />
            </button>
            <button
              type="button"
              className="btn btn-subtle"
              onClick={() => setZoom(100)}
              title="Escala 100%"
            >
              <Maximize size={11} />
              <span>100%</span>
            </button>
          </div>
        </div>

        <div className="viewer-toolbar-right">
          <button
            type="button"
            className="btn btn-primary btn-subtle"
            onClick={handleAskAgent}
            title="Analizar contenido del PDF con Makora"
          >
            <Sparkles size={11} />
            <span>Analizar con Makora</span>
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="pdf-viewer-stage"
        tabIndex={0}
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          overflow: "auto",
          padding: "24px 16px",
          position: "relative",
          background: "rgba(0, 0, 0, 0.4)",
          minHeight: "100%",
          outline: "none",
        }}
      >
        {/* Floating Zoom / Page Toast Indicator */}
        {zoomToast && (
          <div
            className="pdf-zoom-toast"
            style={{
              position: "fixed",
              top: 90,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1000,
              padding: "6px 14px",
              borderRadius: "20px",
              background: "rgba(0, 200, 214, 0.2)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(0, 200, 214, 0.4)",
              color: "var(--cyan)",
              fontSize: "12px",
              fontWeight: 600,
              fontFamily: "monospace",
              pointerEvents: "none",
              boxShadow: "0 4px 16px rgba(0, 200, 214, 0.3)",
              animation: "fadeIn 0.15s ease",
            }}
          >
            {zoomToast}
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 12 }}>
            <Loader2 size={24} className="spin text-cyan" />
            <span className="muted small">Renderizando páginas PDF...</span>
          </div>
        )}

        {error && !loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 12 }}>
            <AlertCircle size={28} className="text-red" />
            <span className="text-red small">Error al cargar PDF: {error}</span>
            <button type="button" onClick={handleOpenExternal} className="btn btn-primary mt-8">
              <ExternalLink size={12} />
              <span>Abrir en Visor Externo</span>
            </button>
          </div>
        )}

        <div
          style={{
            display: loading || error ? "none" : "flex",
            flexDirection: "column",
            alignItems: "center",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
            borderRadius: "4px",
            background: "#ffffff",
            overflow: "hidden",
            transition: "width 0.1s ease, height 0.1s ease",
          }}
        >
          <canvas ref={canvasRef} />
        </div>

        <div style={{ position: "fixed", bottom: 24, right: 28, zIndex: 10 }}>
          <button
            type="button"
            onClick={handleOpenExternal}
            className="btn btn-primary"
            style={{ fontSize: 11, padding: "5px 12px", boxShadow: "0 4px 18px rgba(0,0,0,0.6)" }}
          >
            <ExternalLink size={12} />
            <span>Abrir en Visor Externo</span>
          </button>
        </div>
      </div>
    </div>
  );
}
