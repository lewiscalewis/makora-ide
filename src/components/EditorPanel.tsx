import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { diffLines } from "../core/diff";
import { getFileIcon } from "./Explorer";
import type { DiffInfo, OpenFile } from "../types";

function langFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext)) return [javascript()];
  if (["rs"].includes(ext)) return [rust()];
  return [];
}

interface CodeViewProps {
  content: string;
  path: string;
  editable: boolean;
  onChangeContent?: (newContent: string) => void;
  onSave?: () => void;
}

function CodeView({
  content,
  path,
  editable,
  onChangeContent,
  onSave,
}: CodeViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const saveKeymap = EditorView.domEventHandlers({
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
      if (update.docChanged && onChangeContent) {
        const text = update.state.doc.toString();
        onChangeContent(text);
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        ...langFor(path),
        saveKeymap,
        updateListener,
        EditorState.readOnly.of(!editable),
        EditorView.editable.of(editable),
      ],
    });

    const view = new EditorView({
      parent: host,
      state,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate editor when path or editable mode changes
  }, [path, editable]);

  // Synchronize document if content changed externally
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== content) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content },
      });
    }
  }, [content]);

  return <div ref={hostRef} className="editor-host" />;
}

interface EditorPanelProps {
  files: OpenFile[];
  activePath: string | null;
  diff: DiffInfo | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCollapse: () => void;
  onRevertDiff: () => void;
  onUpdateContent?: (path: string, content: string) => void;
  onSaveFile?: (path: string) => void;
}

export default function EditorPanel({
  files,
  activePath,
  diff,
  onActivate,
  onClose,
  onCollapse,
  onRevertDiff,
  onUpdateContent,
  onSaveFile,
}: EditorPanelProps) {
  const [mode, setMode] = useState<"code" | "diff">("code");
  const [isEditable, setIsEditable] = useState(true);
  const active = files.find((f) => f.path === activePath) ?? null;

  const fileName = active ? active.path.split(/[\\/]/).pop() || active.path : "";
  const { icon, colorClass } = active ? getFileIcon(fileName) : { icon: "📄", colorClass: "" };
  const lineCount = active ? active.content.split("\n").length : 0;

  return (
    <div className="editor-panel">
      <div className="editor-head">
        <div className="editor-tabs">
          {files.map((f) => {
            const fName = f.path.split(/[\\/]/).pop() || f.path;
            const fIcon = getFileIcon(fName);
            const isActive = f.path === activePath;
            return (
              <div
                key={f.path}
                className={"editor-tab" + (isActive ? " active" : "")}
                onClick={() => onActivate(f.path)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(f.path);
                  }
                }}
                title={f.path}
              >
                <span className={`file-badge-icon ${fIcon.colorClass} tab-file-icon`}>
                  {fIcon.icon}
                </span>
                <span className="editor-tab-name">{fName}</span>
                {f.isDirty && <span className="tab-dirty-dot" title="Modificado sin guardar">●</span>}
                <button
                  className="tab-close"
                  title="Cerrar pestaña (Ctrl+W)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(f.path);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <div className="editor-actions-right">
          {active && !diff && (
            <div className="editor-mode-toggle">
              <button
                className={`mode-btn ${isEditable ? "active" : ""}`}
                onClick={() => setIsEditable(!isEditable)}
                title={isEditable ? "Modo Edición activo (Ctrl+S para guardar)" : "Modo Solo Lectura"}
              >
                {isEditable ? "✏️ Editable" : "🔒 Lectura"}
              </button>
              {active.isDirty && onSaveFile && (
                <button
                  className="btn btn-save"
                  onClick={() => onSaveFile(active.path)}
                  title="Guardar archivo (Ctrl+S)"
                >
                  💾 Guardar
                </button>
              )}
            </div>
          )}

          {active && diff && (
            <div className="editor-mode">
              <button
                className={"mode-btn" + (mode === "code" ? " active" : "")}
                onClick={() => setMode("code")}
              >
                Código
              </button>
              <button
                className={"mode-btn" + (mode === "diff" ? " active" : "")}
                onClick={() => setMode("diff")}
              >
                Diff
              </button>
              {mode === "diff" && (
                <button className="btn btn-danger" onClick={onRevertDiff}>
                  Revertir
                </button>
              )}
            </div>
          )}

          <button className="icon-btn" title="Colapsar panel" onClick={onCollapse}>
            ▴
          </button>
        </div>
      </div>

      {active && (
        <div className="editor-breadcrumb-bar">
          <div className="breadcrumb-path">
            <span className={`file-badge-icon ${colorClass}`}>{icon}</span>
            <span className="breadcrumb-text">{active.path}</span>
          </div>
          <div className="breadcrumb-meta">
            <span>{lineCount} líneas</span>
            <span>{active.content.length} caracteres</span>
            {active.isDirty && <span className="dirty-badge">Sin guardar</span>}
          </div>
        </div>
      )}

      <div className="editor-body">
        {!active && (
          <div className="muted editor-empty">
            <p>Selecciona un archivo del explorador o presiona <kbd className="hint-kbd">Ctrl+P</kbd> para buscar.</p>
          </div>
        )}
        {active && mode === "code" && (
          <CodeView
            content={active.content}
            path={active.path}
            editable={isEditable}
            onChangeContent={(text) => onUpdateContent?.(active.path, text)}
            onSave={() => onSaveFile?.(active.path)}
          />
        )}
        {active && mode === "diff" && diff && (
          <div className="diff-view">
            <div className="diff-lines">
              {diffLines(diff.before, diff.after).map((l, i) => (
                <div key={i} className={"diff-line " + l.type}>
                  <span className="diff-sign">
                    {l.type === "add" ? "+" : l.type === "del" ? "-" : " "}
                  </span>
                  <span className="diff-text">{l.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
