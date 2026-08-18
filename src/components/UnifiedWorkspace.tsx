import type { ReactNode } from "react";
import MarkdownViewer from "./viewers/MarkdownViewer";
import DataGridViewer from "./viewers/DataGridViewer";
import ImageViewer from "./viewers/ImageViewer";
import SvgViewer from "./viewers/SvgViewer";
import EditorPanel from "./EditorPanel";
import {
  Sparkles,
  Columns2,
  FileCode,
  Maximize2,
  Minimize2,
  X,
  FileText,
  Image,
  Table,
  Code2,
  Plus,
} from "lucide-react";
import type { DiffInfo, OpenFile } from "../types";

interface UnifiedWorkspaceProps {
  openFiles: OpenFile[];
  activePath: string | null;
  onActivateFile: (path: string | null) => void;
  onCloseFile: (path: string) => void;
  onUpdateContent: (path: string, content: string) => void;
  onSaveFile: (path: string) => void;
  diff: DiffInfo | null;
  onRevertDiff: () => void;

  agentBusy: boolean;
  runningToolName: string | null;

  isSplit: boolean;
  onToggleSplit: () => void;
  zenMode: boolean;
  onToggleZenMode: () => void;

  chatElement: ReactNode;
  onNewChat?: () => void;
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return <FileCode size={13} className="text-cyan" />;
    case "rs":
      return <Code2 size={13} className="text-purple" />;
    case "py":
      return <Code2 size={13} className="text-blue" />;
    case "json":
      return <Code2 size={13} className="text-gold" />;
    case "md":
    case "mdx":
      return <FileText size={13} className="text-blue" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
    case "gif":
    case "svg":
      return <Image size={13} className="text-green" />;
    case "csv":
    case "tsv":
      return <Table size={13} className="text-cyan" />;
    default:
      return <FileText size={13} className="opacity-70" />;
  }
}

export default function UnifiedWorkspace({
  openFiles,
  activePath,
  onActivateFile,
  onCloseFile,
  onUpdateContent,
  onSaveFile,
  diff,
  onRevertDiff,
  agentBusy,
  runningToolName,
  isSplit,
  onToggleSplit,
  zenMode,
  onToggleZenMode,
  chatElement,
  onNewChat,
}: UnifiedWorkspaceProps) {
  const isChatTabActive = activePath === null;

  // Determine active file for editor (fallback to last open file if in split mode with chat selected)
  const targetFile = activePath
    ? openFiles.find((f) => f.path === activePath)
    : openFiles.length > 0
      ? openFiles[openFiles.length - 1]
      : null;

  const renderActiveViewer = () => {
    if (!targetFile) {
      return (
        <div className="editor-empty muted">
          <p>Selecciona un archivo del explorador o presiona <kbd className="hint-kbd">Ctrl+P</kbd></p>
        </div>
      );
    }

    const path = targetFile.path;
    const lower = path.toLowerCase();

    if (lower.endsWith(".md") || lower.endsWith(".mdx")) {
      return (
        <MarkdownViewer
          content={targetFile.content}
          path={path}
          isDirty={targetFile.isDirty}
          onUpdateContent={(c) => onUpdateContent(path, c)}
          onSave={() => onSaveFile(path)}
        />
      );
    }

    if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
      return <DataGridViewer content={targetFile.content} path={path} />;
    }

    if (lower.endsWith(".svg")) {
      return <SvgViewer content={targetFile.content} path={path} />;
    }

    if (/\.(png|jpg|jpeg|webp|gif|avif)$/i.test(lower)) {
      return <ImageViewer path={path} />;
    }

    // Default Code Editor
    return (
      <EditorPanel
        files={openFiles}
        activePath={targetFile.path}
        diff={diff}
        onActivate={onActivateFile}
        onClose={onCloseFile}
        onCollapse={() => undefined}
        onRevertDiff={onRevertDiff}
        onUpdateContent={onUpdateContent}
        onSaveFile={onSaveFile}
      />
    );
  };

  return (
    <div className="unified-workspace">
      {/* Unified Tab Bar */}
      <div className="unified-tab-bar">
        <div className="tab-bar-tabs">
          {/* Sticky Master Chat Tab with Accessible New Chat Icon Button on the Left */}
          <div className="master-chat-tab-container">
            {onNewChat && (
              <button
                type="button"
                className="tab-new-chat-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onActivateFile(null);
                  onNewChat();
                }}
                title="Nueva conversación limpia (Ctrl+L)"
              >
                <Plus size={13} />
              </button>
            )}
            <div
              className={`master-chat-tab ${isChatTabActive ? "active" : ""}`}
              onClick={() => onActivateFile(null)}
              title="Abrir Chat del Agente Makora"
            >
              <Sparkles size={12} className="master-tab-icon" />
              <span className="master-tab-title">MAKORA CHAT</span>
              <span
                className={`master-status-dot ${agentBusy ? "pulse-dot" : "idle-dot"}`}
                title={agentBusy ? (runningToolName ? `Ejecutando ${runningToolName}` : "Razonando...") : "Listo"}
              />
            </div>
          </div>

          {/* Open File Tabs */}
          {openFiles.map((file) => {
            const isActive = !isChatTabActive && file.path === activePath;
            const name = file.path.split(/[\\/]/).pop() || file.path;

            return (
              <div
                key={file.path}
                className={`file-tab ${isActive ? "active" : ""}`}
                onClick={() => onActivateFile(file.path)}
                title={file.path}
              >
                <span className="tab-file-icon">{getFileIcon(name)}</span>
                <span className="tab-title">{name}</span>
                {file.isDirty && <span className="tab-dirty-dot" title="Cambios no guardados">●</span>}
                <button
                  className="tab-close-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseFile(file.path);
                  }}
                  title="Cerrar pestaña (Ctrl+W)"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>

        {/* View Mode Actions (Split & Zen) */}
        <div className="tab-bar-controls">
          <button
            className={`tab-control-btn ${isSplit ? "active" : ""}`}
            onClick={onToggleSplit}
            title={isSplit ? "Desactivar vista dividida" : "Dividir vista: Chat y Editor lado a lado"}
          >
            <Columns2 size={12} />
            <span>Split</span>
          </button>

          <button
            className={`tab-control-btn ${zenMode ? "active" : ""}`}
            onClick={onToggleZenMode}
            title={zenMode ? "Salir de Modo Zen" : "Modo Zen: Enfoque total"}
          >
            {zenMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            <span>{zenMode ? "Salir Zen" : "Zen"}</span>
          </button>
        </div>
      </div>

      {/* Dynamic Main Canvas */}
      <div className={`workspace-canvas ${isSplit ? "layout-split" : "layout-single"}`}>
        {isSplit ? (
          <div className="split-canvas">
            <div className="split-side left-side">
              {chatElement}
            </div>
            <div className="split-side right-side">
              {renderActiveViewer()}
            </div>
          </div>
        ) : isChatTabActive ? (
          <div className="canvas-pane chat-pane full-canvas">
            {chatElement}
          </div>
        ) : (
          <div className="canvas-pane editor-pane full-canvas">
            {renderActiveViewer()}
          </div>
        )}
      </div>
    </div>
  );
}
