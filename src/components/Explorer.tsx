import { useEffect, useState } from "react";
import {
  createDir,
  createFile,
  deletePath,
  listDir,
  renamePath,
  revealInExplorer,
} from "../api";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  PanelLeftClose,
  FilePlus,
  FolderPlus,
  Trash2,
  Edit2,
  ExternalLink,
  FileCode,
  FileText,
  Image,
  Code2,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import type { DirEntry } from "../types";

function basename(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function dirname(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx > 0 ? cleaned.slice(0, idx) : cleaned;
}

function joinPath(dir: string, file: string): string {
  const cleanedDir = dir.replace(/[\\/]+$/, "");
  const sep = cleanedDir.includes("\\") ? "\\" : "/";
  return `${cleanedDir}${sep}${file.replace(/^[\\/]+/, "")}`;
}

export function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return <FileCode size={13} className="text-cyan" />;
    case "rs":
    case "py":
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return <Code2 size={13} className="text-purple" />;
    case "md":
    case "txt":
    case "doc":
      return <FileText size={13} className="text-blue" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "svg":
    case "gif":
    case "webp":
      return <Image size={13} className="text-green" />;
    default:
      return <FileText size={13} className="opacity-60" />;
  }
}

interface TreeNodeProps {
  path: string;
  depth: number;
  activePath?: string | null;
  onOpenFile: (path: string) => void;
  onContext: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onRemoveRoot?: (path: string) => void;
}

function TreeNode({
  path,
  depth,
  activePath,
  onOpenFile,
  onContext,
  onRemoveRoot,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (children === null) {
      try {
        const list = await listDir(path);
        setChildren(list);
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const name = basename(path);

  return (
    <div className="tree-node">
      <div
        className={"tree-row" + (depth === 0 ? " root" : "")}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={toggle}
        onContextMenu={(e) => onContext(e, path, true)}
        title={path}
      >
        <span className="tree-chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="tree-folder-icon">
          {expanded ? (
            <FolderOpen size={13} className="text-cyan" />
          ) : (
            <Folder size={13} className="text-cyan opacity-80" />
          )}
        </span>
        <span className="tree-name">{name}</span>
        {depth === 0 && onRemoveRoot && (
          <button
            className="icon-btn tree-remove"
            title="Quitar carpeta del workspace"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveRoot(path);
            }}
          >
            <X size={10} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="tree-children">
          {error && <div className="muted small">{error}</div>}
          {children === null && !error && <div className="muted small">…</div>}
          {children?.map((c) =>
            c.isDir ? (
              <TreeNode
                key={c.path}
                path={c.path}
                depth={depth + 1}
                activePath={activePath}
                onOpenFile={onOpenFile}
                onContext={onContext}
              />
            ) : (
              <div
                key={c.path}
                className={
                  "tree-row file-row" +
                  (activePath === c.path ? " active-tree-file" : "")
                }
                style={{ paddingLeft: (depth + 1) * 14 + 6 }}
                onClick={() => onOpenFile(c.path)}
                onContextMenu={(e) => onContext(e, c.path, false)}
                title={c.path}
              >
                <span className="file-badge-icon">{getFileIcon(c.name)}</span>
                <span className="tree-name file">{c.name}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

interface MenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

type PromptState =
  | { kind: "rename"; path: string; isDir: boolean }
  | { kind: "newfile" | "newdir"; dir: string }
  | { kind: "delete"; path: string; isDir: boolean };

interface ExplorerProps {
  folders: string[];
  activePath?: string | null;
  onRemoveFolder: (path: string) => void;
  onCollapse: () => void;
  onOpenFile: (path: string) => void;
  onChanged: () => void;
  refreshTick: number;
}

export default function Explorer({
  folders,
  activePath,
  onRemoveFolder,
  onCollapse,
  onOpenFile,
  onChanged,
  refreshTick,
}: ExplorerProps) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(null);
      setPrompt(null);
      setActionError(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const openContext = (e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setActionError(null);
    setPrompt(null);
    setMenu({ x: e.clientX, y: e.clientY, path, isDir });
  };

  const runFs = async (fn: () => Promise<void>) => {
    try {
      await fn();
      onChanged();
      setMenu(null);
      setPrompt(null);
    } catch (e) {
      setActionError(String(e));
    }
  };

  const submitPrompt = () => {
    if (!prompt) return;
    const value = promptValue.trim();
    if (!value) return;
    switch (prompt.kind) {
      case "rename": {
        const parent = dirname(prompt.path);
        const next = parent ? joinPath(parent, value) : value;
        runFs(() => renamePath(folders, prompt.path, next));
        break;
      }
      case "newfile":
        runFs(() => createFile(folders, joinPath(prompt.dir, value)));
        break;
      case "newdir":
        runFs(() => createDir(folders, joinPath(prompt.dir, value)));
        break;
      case "delete":
        runFs(() => deletePath(folders, prompt.path));
        break;
    }
  };

  return (
    <aside className="explorer">
      <div className="panel-head">
        <span className="panel-title-text">{t.explorer.title}</span>
        <div className="panel-head-actions">
          <button
            className="icon-btn"
            title={t.explorer.refresh}
            onClick={onChanged}
          >
            <RefreshCw size={12} />
          </button>
          <button
            className="icon-btn"
            title={t.explorer.hide}
            onClick={onCollapse}
          >
            <PanelLeftClose size={12} />
          </button>
        </div>
      </div>
      {folders.length === 0 ? (
        <div className="explorer-empty muted">
          <p>{t.explorer.emptyWorkspace}</p>
          <p className="muted small">{t.explorer.emptyWorkspaceHint}</p>
        </div>
      ) : (
        <div key={refreshTick} className="explorer-tree">
          {folders.map((f) => (
            <TreeNode
              key={f}
              path={f}
              depth={0}
              activePath={activePath}
              onOpenFile={onOpenFile}
              onContext={openContext}
              onRemoveRoot={onRemoveFolder}
            />
          ))}
        </div>
      )}

      {menu && !prompt && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!menu.isDir && (
            <button className="ctx-item" onClick={() => onOpenFile(menu.path)}>
              <FileText size={12} />
              <span>{t.explorer.openInViewer}</span>
            </button>
          )}
          <button className="ctx-item" onClick={() => revealInExplorer(menu.path)}>
            <ExternalLink size={12} />
            <span>Revelar en explorador del SO</span>
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              setPromptValue(basename(menu.path));
              setPrompt({ kind: "rename", path: menu.path, isDir: menu.isDir });
            }}
          >
            <Edit2 size={12} />
            <span>{t.explorer.rename}</span>
          </button>
          {menu.isDir && (
            <>
              <button
                className="ctx-item"
                onClick={() => {
                  setPromptValue("");
                  setPrompt({ kind: "newfile", dir: menu.path });
                }}
              >
                <FilePlus size={12} />
                <span>{t.explorer.newFile}</span>
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  setPromptValue("");
                  setPrompt({ kind: "newdir", dir: menu.path });
                }}
              >
                <FolderPlus size={12} />
                <span>{t.explorer.newFolder}</span>
              </button>
            </>
          )}
          <button
            className="ctx-item danger"
            onClick={() =>
              setPrompt({ kind: "delete", path: menu.path, isDir: menu.isDir })
            }
          >
            <Trash2 size={12} />
            <span>{t.explorer.deleteItem}</span>
          </button>
        </div>
      )}

      {prompt && (
        <div
          className="ctx-menu"
          style={{ left: menu?.x ?? 50, top: menu?.y ?? 50 }}
          onClick={(e) => e.stopPropagation()}
        >
          {prompt.kind === "delete" ? (
            <div>
              <p className="small">
                {t.explorer.deleteConfirm}{" "}
                <strong>{basename(prompt.path)}</strong>?
              </p>
              <div className="ctx-actions">
                <button className="btn btn-subtle" onClick={() => setPrompt(null)}>
                  {t.common.cancel}
                </button>
                <button className="btn btn-danger" onClick={submitPrompt}>
                  {t.explorer.deleteItem}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <input
                autoFocus
                className="ctx-input"
                value={promptValue}
                placeholder={
                  prompt.kind === "rename"
                    ? t.explorer.newNamePlaceholder
                    : prompt.kind === "newfile"
                      ? t.explorer.newFilePlaceholder
                      : t.explorer.newFolderPlaceholder
                }
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitPrompt();
                  if (e.key === "Escape") setPrompt(null);
                }}
              />
              <div className="ctx-actions">
                <button className="btn btn-subtle" onClick={() => setPrompt(null)}>
                  {t.common.cancel}
                </button>
                <button className="btn btn-primary" onClick={submitPrompt}>
                  {t.common.confirm}
                </button>
              </div>
            </div>
          )}
          {actionError && <p className="error small">{actionError}</p>}
        </div>
      )}
    </aside>
  );
}
