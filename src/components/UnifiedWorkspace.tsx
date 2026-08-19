import { type ReactNode, useCallback, useState } from "react";
import MarkdownViewer from "./viewers/MarkdownViewer";
import DataGridViewer from "./viewers/DataGridViewer";
import ImageViewer from "./viewers/ImageViewer";
import SvgViewer from "./viewers/SvgViewer";
import PdfViewer from "./viewers/PdfViewer";
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
import { useI18n } from "../i18n";

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
  onAskAgent?: (prompt: string) => void;
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
    case "pdf":
      return <FileText size={13} className="text-purple" />;
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
  onAskAgent,
}: UnifiedWorkspaceProps) {
  const { t } = useI18n();
  const isChatTabActive = activePath === null;

  const [splitRatio, setSplitRatio] = useState<number>(() => {
    const saved = localStorage.getItem("makora.splitRatio");
    return saved ? Math.max(20, Math.min(80, Number(saved))) : 50;
  });

  const handleSplitResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const initialRatio = splitRatio;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / rect.width) * 100;
      const newRatio = Math.max(20, Math.min(80, initialRatio + deltaPercent));
      setSplitRatio(newRatio);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      localStorage.setItem("makora.splitRatio", String(splitRatio));
    };

    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [splitRatio]);

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
          <p>{t.workspace.emptyEditorHint}</p>
        </div>
      );
    }

    const path = targetFile.path;
    const lower = path.toLowerCase();

    if (lower.endsWith(".pdf")) {
      return <PdfViewer path={path} onAskAgent={onAskAgent} />;
    }

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
                title={t.workspace.newChatTooltip}
              >
                <Plus size={13} />
              </button>
            )}
            <div
              className={`master-chat-tab ${isChatTabActive ? "active" : ""}`}
              onClick={() => onActivateFile(null)}
              title={t.workspace.masterChat}
            >
              <Sparkles size={12} className="master-tab-icon" />
              <span className="master-tab-title">{t.workspace.masterChat}</span>
              <span
                className={`master-status-dot ${agentBusy ? "pulse-dot" : "idle-dot"}`}
                title={agentBusy ? (runningToolName ? `${t.chat.toolsRunning} (${runningToolName})` : t.chat.thinking) : "Ready"}
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
                {file.isDirty && <span className="tab-dirty-dot" title={t.workspace.unsavedChanges}>●</span>}
                <button
                  className="tab-close-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseFile(file.path);
                  }}
                  title={t.workspace.closeTab}
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
            title={t.workspace.splitView}
          >
            <Columns2 size={12} />
            <span>{t.workspace.splitView}</span>
          </button>

          <button
            className={`tab-control-btn ${zenMode ? "active" : ""}`}
            onClick={onToggleZenMode}
            title={t.workspace.zenMode}
          >
            {zenMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            <span>{t.workspace.zenMode}</span>
          </button>
        </div>
      </div>

      {/* Dynamic Main Canvas */}
      <div className={`workspace-canvas ${isSplit ? "layout-split" : "layout-single"}`}>
        {isSplit ? (
          <div className="split-canvas">
            <div className="split-side left-side" style={{ flex: `0 0 ${splitRatio}%`, maxWidth: `${splitRatio}%` }}>
              {chatElement}
            </div>
            <div
              className="resizer-col resizer-split"
              onMouseDown={handleSplitResize}
              title="Arrastrar para redimensionar (Split View)"
            />
            <div className="split-side right-side" style={{ flex: `0 0 ${100 - splitRatio}%`, maxWidth: `${100 - splitRatio}%` }}>
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
