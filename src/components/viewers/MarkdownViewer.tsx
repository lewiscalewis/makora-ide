import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { FileText, Code2, Eye, Columns2, Save } from "lucide-react";
import Markdown from "../Markdown";

interface Props {
  content: string;
  path: string;
  isDirty?: boolean;
  onUpdateContent?: (content: string) => void;
  onSave?: () => void;
}

export default function MarkdownViewer({
  content,
  path,
  isDirty = false,
  onUpdateContent,
  onSave,
}: Props) {
  const [viewMode, setViewMode] = useState<"code" | "preview" | "split">("split");
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (viewMode === "preview") {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      return;
    }

    const host = hostRef.current;
    if (!host) return;

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const saveHandler = EditorView.domEventHandlers({
      keydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          onSave?.();
          return true;
        }
        return false;
      },
    });

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const next = update.state.doc.toString();
        onUpdateContent?.(next);
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        saveHandler,
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path, viewMode]);

  return (
    <div className="multi-mode-viewer markdown-viewer-wrap">
      {/* Top control bar */}
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <FileText size={13} className="text-cyan" />
          <span className="viewer-file-tag">Markdown / MDX</span>
          {isDirty && <span className="dirty-badge">● Modificado</span>}
        </div>
        <div className="viewer-toolbar-center">
          <div className="segmented-control">
            <button
              className={`seg-btn ${viewMode === "code" ? "active" : ""}`}
              onClick={() => setViewMode("code")}
              title="Ver y editar código Markdown fuente"
            >
              <Code2 size={11} />
              <span>Código</span>
            </button>
            <button
              className={`seg-btn ${viewMode === "preview" ? "active" : ""}`}
              onClick={() => setViewMode("preview")}
              title="Renderizado interactivo (Mermaid, Tablas, Fórmulas)"
            >
              <Eye size={11} />
              <span>Preview</span>
            </button>
            <button
              className={`seg-btn ${viewMode === "split" ? "active" : ""}`}
              onClick={() => setViewMode("split")}
              title="Vista dividida sincronizada"
            >
              <Columns2 size={11} />
              <span>Split</span>
            </button>
          </div>
        </div>
        <div className="viewer-toolbar-right">
          {isDirty && (
            <button className="btn btn-save" onClick={onSave} title="Guardar cambios (Ctrl+S)">
              <Save size={11} />
              <span>Guardar</span>
            </button>
          )}
        </div>
      </div>

      {/* Main viewer body */}
      <div className={`viewer-body mode-${viewMode}`}>
        {(viewMode === "code" || viewMode === "split") && (
          <div className="viewer-pane editor-pane">
            <div ref={hostRef} className="editor-host" />
          </div>
        )}
        {(viewMode === "preview" || viewMode === "split") && (
          <div className="viewer-pane preview-pane">
            <div className="preview-content markdown-rendered">
              <Markdown text={content} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
