import { type ReactNode, useCallback, useState } from "react";
import MarkdownViewer from "./viewers/MarkdownViewer";
import DataGridViewer from "./viewers/DataGridViewer";
import ImageViewer from "./viewers/ImageViewer";
import SvgViewer from "./viewers/SvgViewer";
import PdfViewer from "./viewers/PdfViewer";
import EditorPanel from "./EditorPanel";
import ContextMenu, { type ContextMenuItem, type ContextMenuState } from "./ContextMenu";
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
  workspaceFolders?: string[];
  onActivateFile: (path: string | null) => void;
  onCloseFile: (path: string) => void;
  onCloseOtherFiles?: (path: string) => void;
  onCloseFilesToRight?: (path: string) => void;
  onCloseFilesToLeft?: (path: string) => void;
  onCloseAllFiles?: () => void;
  onCloseSavedFiles?: () => void;
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
    case "yaml":
    case "yml":
    case "toml":
      return <FileCode size={13} className="text-yellow" />;
    case "md":
    case "markdown":
    case "txt":
      return <FileText size={13} className="text-green" />;
    case "pdf":
      return <FileText size={13} className="text-purple" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return <Image size={13} className="text-pink" />;
    case "csv":
    case "tsv":
      return <Table size={13} className="text-green" />;
    default:
      return <FileCode size={13} className="text-muted" />;
  }
}

export default function UnifiedWorkspace({
  openFiles,
  activePath,
  workspaceFolders,
  onActivateFile,
  onCloseFile,
  onCloseOtherFiles,
  onCloseFilesToRight,
  onCloseFilesToLeft,
  onCloseAllFiles,
  onCloseSavedFiles,
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  const handleFileTabContextMenu = (e: React.MouseEvent, file: OpenFile, index: number) => {
    e.preventDefault();
    e.stopPropagation();

    const items: ContextMenuItem[] = [
      {
        label: t.workspace.close,
        onSelect: () => onCloseFile(file.path),
      },
      {
        label: t.workspace.closeOthers,
        onSelect: () => onCloseOtherFiles?.(file.path),
      },
    ];

    if (index < openFiles.length - 1) {
      items.push({
        label: t.workspace.closeToRight,
        onSelect: () => onCloseFilesToRight?.(file.path),
      });
    }

    if (index > 0) {
      items.push({
        label: t.workspace.closeToLeft,
        onSelect: () => onCloseFilesToLeft?.(file.path),
      });
    }

    if (openFiles.some((f) => !f.isDirty)) {
      items.push({
        label: t.workspace.closeSaved,
        onSelect: () => onCloseSavedFiles?.(),
      });
    }

    items.push({
      label: t.workspace.closeAll,
      danger: openFiles.some((f) => f.isDirty),
      onSelect: () => onCloseAllFiles?.(),
    });

    items.push({
      label: t.workspace.copyRelativePath,
      onSelect: () => {
        let rel = file.path;
        if (workspaceFolders && workspaceFolders.length > 0) {
          for (const folder of workspaceFolders) {
            if (rel.startsWith(folder)) {
              rel = rel.slice(folder.length).replace(/^[\\/]/, "");
              break;
            }
          }
        }
        navigator.clipboard.writeText(rel);
      },
    });

    items.push({
      label: t.workspace.copyAbsolutePath,
      onSelect: () => {
        navigator.clipboard.writeText(file.path);
      },
    });

    items.push({
      label: t.workspace.splitView,
      onSelect: () => onToggleSplit(),
    });

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items,
    });
  };

  const handleMasterChatContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const items: ContextMenuItem[] = [];
    if (openFiles.length > 0) {
      items.push({
        label: t.workspace.closeAll,
        onSelect: () => onCloseAllFiles?.(),
      });
      if (openFiles.some((f) => !f.isDirty)) {
        items.push({
          label: t.workspace.closeSaved,
          onSelect: () => onCloseSavedFiles?.(),
        });
      }
    }
    items.push({
      label: t.workspace.splitView,
      onSelect: () => onToggleSplit(),
    });
    if (onNewChat) {
      items.push({
        label: t.workspace.newChat,
        onSelect: () => onNewChat(),
      });
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items,
    });
  };

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
              onContextMenu={handleMasterChatContextMenu}
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
          {openFiles.map((file, index) => {
            const isActive = !isChatTabActive && file.path === activePath;
            const name = file.path.split(/[\\/]/).pop() || file.path;

            return (
              <div
                key={file.path}
                className={`file-tab ${isActive ? "active" : ""}`}
                onClick={() => onActivateFile(file.path)}
                onContextMenu={(e) => handleFileTabContextMenu(e, file, index)}
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

      {/* Dynamic Main Canvas. Both panes stay MOUNTED so an in-flight agent
          stream never gets killed by switching tabs; visibility is CSS-only. */}
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
        ) : (
          <>
            <div
              className={`canvas-pane chat-pane full-canvas ${isChatTabActive ? "" : "pane-hidden"}`}
              aria-hidden={!isChatTabActive}
            >
              {chatElement}
            </div>
            {!isChatTabActive && (
              <div className="canvas-pane editor-pane full-canvas">
                {renderActiveViewer()}
              </div>
            )}
          </>
        )}
      </div>

      {/* Context Menu for Tabs */}
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}
