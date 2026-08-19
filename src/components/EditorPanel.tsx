import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { Edit3, Lock, Save, RotateCcw, FileCode } from "lucide-react";

import type { DiffInfo, OpenFile } from "../types";

function getLanguageExtension(path: string) {
  if (/\.(jsx?|tsx?|mjs|cjs)$/i.test(path)) return [javascript({ jsx: true, typescript: true })];
  if (/\.rs$/i.test(path)) return [rust()];
  if (/\.(py|pyw)$/i.test(path)) return [python()];
  if (/\.json$/i.test(path)) return [json()];
  if (/\.(md|markdown|mdown)$/i.test(path)) return [markdown()];
  if (/\.(html?|svelte|vue)$/i.test(path)) return [html()];
  if (/\.(css|scss|sass|less)$/i.test(path)) return [css()];
  return [];
}

interface CmProps {
  content: string;
  path: string;
  editable?: boolean;
  onUpdateContent?: (content: string) => void;
  onSave?: () => void;
}

function CodeMirrorEditor({
  content,
  path,
  editable = true,
  onUpdateContent,
  onSave,
}: CmProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
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
        ...getLanguageExtension(path),
        saveHandler,
        updateListener,
        EditorState.readOnly.of(!editable),
        EditorView.lineWrapping,
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
  }, [path, editable]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    const normalized = content.replace(/\r\n/g, "\n");
    if (currentDoc !== normalized) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: normalized },
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
  onRevertDiff,
  onUpdateContent,
  onSaveFile,
}: EditorPanelProps) {
  const [mode, setMode] = useState<"code" | "diff">("code");
  const [isEditable, setIsEditable] = useState(true);
  const active = files.find((f) => f.path === activePath) ?? null;

  const lineCount = active ? active.content.split("\n").length : 0;
  const charCount = active ? active.content.length : 0;


  return (
    <div className="editor-panel">
      {/* Sleek Sub-Toolbar */}
      <div className="editor-sub-bar">
        <div className="sub-bar-left">
          <FileCode size={13} className="text-cyan" />
          <span className="breadcrumb-path" title={active?.path || ""}>
            {active?.path || "Ningún archivo abierto"}
          </span>
          {active?.isDirty && (
            <span className="dirty-badge">● Modificado</span>
          )}
        </div>

        <div className="sub-bar-right">
          {active && !diff && (
            <div className="sub-bar-actions">
              <button
                className={`action-pill ${isEditable ? "active" : ""}`}
                onClick={() => setIsEditable(!isEditable)}
                title={isEditable ? "Modo Edición activo (Ctrl+S para guardar)" : "Modo Solo Lectura"}
              >
                {isEditable ? <Edit3 size={11} /> : <Lock size={11} />}
                <span>{isEditable ? "Editable" : "Lectura"}</span>
              </button>

              {active.isDirty && onSaveFile && (
                <button
                  className="btn btn-save"
                  onClick={() => onSaveFile(active.path)}
                  title="Guardar archivo (Ctrl+S)"
                >
                  <Save size={11} />
                  <span>Guardar</span>
                </button>
              )}
            </div>
          )}

          {active && diff && (
            <div className="sub-bar-actions">
              <div className="segmented-control">
                <button
                  className={`seg-btn ${mode === "code" ? "active" : ""}`}
                  onClick={() => setMode("code")}
                >
                  Código
                </button>
                <button
                  className={`seg-btn ${mode === "diff" ? "active" : ""}`}
                  onClick={() => setMode("diff")}
                >
                  Diff
                </button>
              </div>

              {mode === "diff" && (
                <button className="btn btn-danger" onClick={onRevertDiff}>
                  <RotateCcw size={11} />
                  <span>Revertir</span>
                </button>
              )}
            </div>
          )}

          {active && (
            <div className="editor-metrics">
              <span>{lineCount} líneas</span>
              <span className="metric-sep">•</span>
              <span>{charCount} carácteres</span>
            </div>
          )}
        </div>
      </div>

      {/* Editor Body */}
      <div className="editor-body">
        {!active ? (
          <div className="editor-empty muted">
            <p>Selecciona un archivo del explorador o presiona <kbd className="hint-kbd">Ctrl+P</kbd></p>
          </div>
        ) : diff && mode === "diff" ? (
          <div className="diff-view">
            <div className="diff-lines">
              {diff.before.split("\n").map((line, i) => (
                <div key={"b" + i} className="diff-line del">
                  <span className="diff-sign">-</span>
                  <span>{line}</span>
                </div>
              ))}
              {diff.after.split("\n").map((line, i) => (
                <div key={"a" + i} className="diff-line add">
                  <span className="diff-sign">+</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <CodeMirrorEditor
            content={active.content}
            path={active.path}
            editable={isEditable}
            onUpdateContent={(c) => onUpdateContent?.(active.path, c)}
            onSave={() => onSaveFile?.(active.path)}
          />
        )}
      </div>
    </div>
  );
}
