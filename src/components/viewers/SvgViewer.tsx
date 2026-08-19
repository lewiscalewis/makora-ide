import { useState } from "react";
import { FileCode, Eye, Code2, ZoomIn, ZoomOut, Save } from "lucide-react";
import { useI18n } from "../../i18n";

interface Props {
  content: string;
  path: string;
  isDirty?: boolean;
  onUpdateContent?: (content: string) => void;
  onSave?: () => void;
}

export default function SvgViewer({
  content,
  isDirty = false,
  onUpdateContent,
  onSave,
}: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"graphic" | "code">("graphic");
  const [zoom, setZoom] = useState(1);

  return (
    <div className="multi-mode-viewer svg-viewer-wrap">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <FileCode size={13} className="text-cyan" />
          <span className="viewer-file-tag">SVG</span>
          {isDirty && <span className="dirty-badge">● {t.workspace.unsavedChanges}</span>}
        </div>
        <div className="viewer-toolbar-center">
          <div className="segmented-control">
            <button
              className={`seg-btn ${mode === "graphic" ? "active" : ""}`}
              onClick={() => setMode("graphic")}
            >
              <Eye size={11} />
              <span>{t.editor.graphic}</span>
            </button>
            <button
              className={`seg-btn ${mode === "code" ? "active" : ""}`}
              onClick={() => setMode("code")}
            >
              <Code2 size={11} />
              <span>{t.editor.codeXml}</span>
            </button>
          </div>
          {mode === "graphic" && (
            <div className="zoom-controls">
              <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} title="-">
                <ZoomOut size={12} />
              </button>
              <span className="zoom-percent">{Math.round(zoom * 100)}%</span>
              <button className="icon-btn" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} title="+">
                <ZoomIn size={12} />
              </button>
            </div>
          )}
        </div>
        <div className="viewer-toolbar-right">
          {isDirty && (
            <button className="btn btn-save" onClick={onSave} title={t.editor.saveFile}>
              <Save size={11} />
              <span>{t.editor.save}</span>
            </button>
          )}
        </div>
      </div>

      <div className="svg-stage">
        {mode === "graphic" ? (
          <div
            className="svg-render-box checkerboard-bg"
            style={{ transform: `scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: content }}
          />
        ) : (
          <textarea
            className="svg-xml-textarea"
            value={content}
            onChange={(e) => onUpdateContent?.(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
