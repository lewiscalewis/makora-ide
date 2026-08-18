import type { ReactNode } from "react";
import MarkdownViewer from "./viewers/MarkdownViewer";
import DataGridViewer from "./viewers/DataGridViewer";
import ImageViewer from "./viewers/ImageViewer";
import SvgViewer from "./viewers/SvgViewer";
import EditorPanel from "./EditorPanel";
import type { DiffInfo, OpenFile, WorkspaceViewMode } from "../types";

interface UnifiedWorkspaceProps {
  // Tabs
  openFiles: OpenFile[];
  activePath: string | null;
  onActivateFile: (path: string | null) => void;
  onCloseFile: (path: string) => void;
  onUpdateContent: (path: string, content: string) => void;
  onSaveFile: (path: string) => void;
  diff: DiffInfo | null;
  onRevertDiff: () => void;

  // Agent State for Master Tab
  agentBusy: boolean;
  runningToolName: string | null;

  // View Mode
  viewMode: WorkspaceViewMode;
  onViewModeChange: (mode: WorkspaceViewMode) => void;
  zenMode: boolean;
  onToggleZenMode: () => void;

  // Chat Element
  chatElement: ReactNode;
}

function getFileBadge(filename: string): { icon: string; className: string } {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
      return { icon: "TS", className: "icon-ts" };
    case "js":
    case "jsx":
      return { icon: "JS", className: "icon-js" };
    case "rs":
      return { icon: "🦀", className: "icon-rs" };
    case "py":
      return { icon: "🐍", className: "icon-py" };
    case "json":
      return { icon: "{}", className: "icon-json" };
    case "md":
    case "mdx":
      return { icon: "📝", className: "icon-md" };
    case "css":
    case "scss":
      return { icon: "🎨", className: "icon-css" };
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
    case "gif":
      return { icon: "🖼️", className: "icon-img" };
    case "svg":
      return { icon: "💠", className: "icon-svg" };
    case "csv":
    case "tsv":
      return { icon: "📊", className: "icon-csv" };
    default:
      return { icon: "📄", className: "icon-file" };
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
  viewMode,
  onViewModeChange,
  zenMode,
  onToggleZenMode,
  chatElement,
}: UnifiedWorkspaceProps) {
  const isChatActive = activePath === null;
  const activeFile = openFiles.find((f) => f.path === activePath);

  const renderActiveViewer = () => {
    if (!activeFile) {
      return (
        <div className="editor-empty muted">
          <p>Selecciona un archivo del explorador o presiona <kbd className="hint-kbd">Ctrl+P</kbd></p>
        </div>
      );
    }

    const path = activeFile.path;
    const lower = path.toLowerCase();

    if (lower.endsWith(".md") || lower.endsWith(".mdx")) {
      return (
        <MarkdownViewer
          content={activeFile.content}
          path={path}
          isDirty={activeFile.isDirty}
          onUpdateContent={(c) => onUpdateContent(path, c)}
          onSave={() => onSaveFile(path)}
        />
      );
    }

    if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
      return <DataGridViewer content={activeFile.content} path={path} />;
    }

    if (lower.endsWith(".svg")) {
      return (
        <SvgViewer
          content={activeFile.content}
          path={path}
          isDirty={activeFile.isDirty}
          onUpdateContent={(c) => onUpdateContent(path, c)}
          onSave={() => onSaveFile(path)}
        />
      );
    }

    if (/\.(png|jpg|jpeg|webp|gif|avif)$/i.test(lower)) {
      return <ImageViewer path={path} />;
    }

    // Default Code Editor
    return (
      <EditorPanel
        files={openFiles}
        activePath={activePath}
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
      {/* Tab Bar with Sticky Master Chat Tab */}
      <div className="unified-tab-bar">
        <div className="tab-bar-tabs">
          {/* Sticky Master Tab */}
          <div
            className={`master-chat-tab ${isChatActive ? "active" : ""}`}
            onClick={() => onActivateFile(null)}
            title="Pestaña maestra del agente Makora"
          >
            <div className="master-tab-content">
              <span className="master-tab-icon">✨</span>
              <span className="master-tab-title">MAKORA CHAT</span>
              <span
                className={`master-status-dot ${agentBusy ? "pulse-dot" : "idle-dot"}`}
                title={agentBusy ? (runningToolName ? `Ejecutando ${runningToolName}` : "Razonando...") : "Listo"}
              />
            </div>
          </div>

          {/* Open File Tabs */}
          {openFiles.map((file) => {
            const isActive = file.path === activePath;
            const name = file.path.split(/[\\/]/).pop() || file.path;
            const badge = getFileBadge(name);

            return (
              <div
                key={file.path}
                className={`file-tab ${isActive ? "active" : ""}`}
                onClick={() => onActivateFile(file.path)}
                title={file.path}
              >
                <span className={`tab-file-icon ${badge.className}`}>{badge.icon}</span>
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
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {/* View Mode Controls */}
        <div className="tab-bar-controls">
          <div className="segmented-control view-mode-control">
            <button
              className={`seg-btn ${viewMode === "chat" ? "active" : ""}`}
              onClick={() => {
                onViewModeChange("chat");
                onActivateFile(null);
              }}
              title="Mostrar solo el Chat del Agente"
            >
              💬 Chat
            </button>
            <button
              className={`seg-btn ${viewMode === "split" ? "active" : ""}`}
              onClick={() => onViewModeChange("split")}
              title="Vista dividida: Chat a la izquierda y Editor a la derecha"
            >
              ◫ Split
            </button>
            <button
              className={`seg-btn ${viewMode === "editor" ? "active" : ""}`}
              onClick={() => {
                onViewModeChange("editor");
                if (isChatActive && openFiles.length > 0) {
                  onActivateFile(openFiles[0].path);
                }
              }}
              title="Mostrar solo el Editor / Visualizador"
            >
              📝 Editor
            </button>
          </div>

          <button
            className={`zen-mode-btn ${zenMode ? "active" : ""}`}
            onClick={onToggleZenMode}
            title={zenMode ? "Salir de Modo Zen" : "Modo Zen: Ocultar barras laterales para enfoque total"}
          >
            {zenMode ? "🧘 Salir Zen" : "🧘 Zen"}
          </button>
        </div>
      </div>

      {/* Main Workspace Canvas */}
      <div className={`workspace-canvas layout-${viewMode}`}>
        {viewMode === "chat" && (
          <div className="canvas-pane chat-pane full-canvas">
            {chatElement}
          </div>
        )}

        {viewMode === "split" && (
          <div className="split-canvas">
            <div className="split-side left-side">
              {chatElement}
            </div>
            <div className="split-side right-side">
              {renderActiveViewer()}
            </div>
          </div>
        )}

        {viewMode === "editor" && (
          <div className="canvas-pane editor-pane full-canvas">
            {renderActiveViewer()}
          </div>
        )}
      </div>
    </div>
  );
}
