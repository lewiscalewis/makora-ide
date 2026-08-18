import { useEffect, useState } from "react";
import {
  createDir,
  createFile,
  deletePath,
  listDir,
  renamePath,
  revealInExplorer,
} from "../api";
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

export function getFileIcon(name: string): { icon: string; colorClass: string } {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
      return { icon: "TS", colorClass: "icon-ts" };
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { icon: "JS", colorClass: "icon-js" };
    case "rs":
      return { icon: "🦀", colorClass: "icon-rs" };
    case "py":
      return { icon: "🐍", colorClass: "icon-py" };
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return { icon: "{}", colorClass: "icon-json" };
    case "md":
    case "txt":
    case "doc":
      return { icon: "📝", colorClass: "icon-md" };
    case "html":
    case "css":
    case "scss":
      return { icon: "🎨", colorClass: "icon-css" };
    case "png":
    case "jpg":
    case "jpeg":
    case "svg":
    case "gif":
    case "webp":
      return { icon: "🖼️", colorClass: "icon-img" };
    case "lock":
      return { icon: "🔒", colorClass: "icon-lock" };
    default:
      return { icon: "📄", colorClass: "icon-file" };
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
        setChildren(await listDir(path));
      } catch (e) {
        setError(String(e));
      }
    }
  };

  return (
    <div className="tree-node">
      <div
        className={"tree-row" + (depth === 0 ? " root" : "")}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={toggle}
        onContextMenu={(e) => onContext(e, path, true)}
        title={path}
      >
        <span className="tree-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="tree-folder-icon">📁</span>
        <span className="tree-name">{basename(path)}</span>
        {depth === 0 && onRemoveRoot && (
          <button
            className="icon-btn tree-remove"
            title="Quitar carpeta del workspace"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveRoot(path);
            }}
          >
            ×
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
                {(() => {
                  const { icon, colorClass } = getFileIcon(c.name);
                  return (
                    <span className={`file-badge-icon ${colorClass}`}>{icon}</span>
                  );
                })()}
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
        <span className="panel-title-text">Explorador</span>
        <div className="panel-head-actions">
          <button
            className="icon-btn"
            title="Refrescar explorador"
            onClick={onChanged}
          >
            ⟳
          </button>
          <button
            className="icon-btn"
            title="Colapsar panel (Ctrl+B)"
            onClick={onCollapse}
          >
            ◂
          </button>
        </div>
      </div>
      {folders.length === 0 ? (
        <div className="explorer-empty muted">
          <p>Añade carpetas para construir tu workspace.</p>
          <p className="muted small">Usa "+ Carpeta" en el encabezado.</p>
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
              Abrir en visor
            </button>
          )}
          <button className="ctx-item" onClick={() => revealInExplorer(menu.path)}>
            Revelar en explorador del SO
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              setPrompt({ kind: "rename", path: menu.path, isDir: menu.isDir });
              setPromptValue(basename(menu.path));
            }}
          >
            Renombrar
          </button>
          {menu.isDir && (
            <>
              <button
                className="ctx-item"
                onClick={() => {
                  setPrompt({ kind: "newfile", dir: menu.path });
                  setPromptValue("nuevo_archivo.txt");
                }}
              >
                Nuevo archivo
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  setPrompt({ kind: "newdir", dir: menu.path });
                  setPromptValue("nueva_carpeta");
                }}
              >
                Nueva carpeta
              </button>
            </>
          )}
          <button
            className="ctx-item danger"
            onClick={() =>
              setPrompt({ kind: "delete", path: menu.path, isDir: menu.isDir })
            }
          >
            Eliminar
          </button>
        </div>
      )}

      {menu && prompt && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {prompt.kind === "delete" ? (
            <>
              <p className="muted small">
                ¿Eliminar {prompt.isDir ? "la carpeta" : "el archivo"} "
                {basename(prompt.path)}"?
              </p>
              <div className="ctx-actions">
                <button className="btn btn-danger" onClick={submitPrompt}>
                  Eliminar
                </button>
                <button className="btn" onClick={() => setPrompt(null)}>
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                className="ctx-input"
                value={promptValue}
                autoFocus
                onChange={(e) => setPromptValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitPrompt();
                  if (e.key === "Escape") setPrompt(null);
                }}
              />
              <div className="ctx-actions">
                <button className="btn btn-primary" onClick={submitPrompt}>
                  OK
                </button>
                <button className="btn" onClick={() => setPrompt(null)}>
                  Cancelar
                </button>
              </div>
            </>
          )}
          {actionError && <p className="error small">{actionError}</p>}
        </div>
      )}
    </aside>
  );
}
