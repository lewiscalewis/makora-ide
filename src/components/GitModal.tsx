import { useEffect, useState } from "react";
import {
  gitStatus,
  gitFiles,
  gitDiff,
  gitLog,
  gitStage,
  gitUnstage,
  gitStageAll,
  gitCommit,
  gitPush,
  gitPull,
  gitBranches,
  gitCheckout,
  gitBranchCreate,
  gitDiscard,
  gitRemoteGet,
  gitRemoteSet,
  gitFetch,
  gitInit,
} from "../api";
import {
  GitBranch,
  GitCommit,
  RefreshCw,
  Plus,
  Minus,
  CheckCheck,
  ArrowUp,
  ArrowDown,
  FileDiff,
  Clock,
  User,
  X,
  Globe,
  Trash2,
  FolderGit2,
  ChevronDown,
  Check,
  DownloadCloud,
} from "lucide-react";

import type { GitCommitInfo, GitFileItem, GitRemoteInfo, GitStatusInfo } from "../types";

interface Props {
  folder: string;
  onClose: () => void;
  onRefreshWorkspace?: () => void;
}

export default function GitModal({ folder, onClose, onRefreshWorkspace }: Props) {
  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [files, setFiles] = useState<GitFileItem[]>([]);
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [remotes, setRemotes] = useState<GitRemoteInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<GitFileItem | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"changes" | "history" | "remotes">("changes");

  // Branch creation modal state
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);

  // Remote config state
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");

  const isNotGitRepo = status === null && !loading;

  const refreshGit = async () => {
    if (!folder) return;
    setLoading(true);
    setError(null);
    try {
      const [st, fls, logs, brs, rems] = await Promise.all([
        gitStatus(folder),
        gitFiles(folder),
        gitLog(folder, 40),
        gitBranches(folder).catch(() => []),
        gitRemoteGet(folder).catch(() => []),
      ]);
      setStatus(st);
      setFiles(fls);
      setCommits(logs);
      setBranches(brs);
      setRemotes(rems);
      if (rems.length > 0 && !remoteUrl) {
        setRemoteUrl(rems[0].url);
        setRemoteName(rems[0].name);
      }
      if (fls.length > 0 && !selectedFile) {
        handleSelectFile(fls[0]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshGit();
  }, [folder]);

  const handleSelectFile = async (file: GitFileItem) => {
    setSelectedFile(file);
    try {
      const diff = await gitDiff(folder, file.path, file.isStaged);
      setDiffText(diff || "(Sin cambios detectados en el diff)");
    } catch (e) {
      setDiffText(`Error obteniendo diff: ${e}`);
    }
  };

  const handleStage = async (path: string) => {
    try {
      await gitStage(folder, path);
      await refreshGit();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleUnstage = async (path: string) => {
    try {
      await gitUnstage(folder, path);
      await refreshGit();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleStageAll = async () => {
    try {
      await gitStageAll(folder);
      await refreshGit();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDiscard = async (path: string) => {
    if (!confirm(`¿Descartar los cambios no guardados en '${path}'? Esta acción no se puede deshacer.`)) return;
    try {
      await gitDiscard(folder, path);
      setMessage(`Cambios descartados en ${path}`);
      await refreshGit();
      onRefreshWorkspace?.();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    try {
      setLoading(true);
      const out = await gitCommit(folder, commitMsg.trim());
      setMessage(`Commit realizado con éxito:\n${out}`);
      setCommitMsg("");
      await refreshGit();
      onRefreshWorkspace?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePush = async () => {
    try {
      setPushing(true);
      setError(null);
      const out = await gitPush(folder);
      setMessage(`Push completado con éxito:\n${out}`);
      await refreshGit();
    } catch (e) {
      setError(String(e));
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    try {
      setPulling(true);
      setError(null);
      const out = await gitPull(folder);
      setMessage(`Pull completado:\n${out}`);
      await refreshGit();
      onRefreshWorkspace?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setPulling(false);
    }
  };

  const handleFetch = async () => {
    try {
      setFetching(true);
      setError(null);
      const out = await gitFetch(folder);
      setMessage(`Fetch completado:\n${out || "Referencias actualizadas"}`);
      await refreshGit();
    } catch (e) {
      setError(String(e));
    } finally {
      setFetching(false);
    }
  };

  const handleSwitchBranch = async (branchName: string) => {
    try {
      setLoading(true);
      const cleanBranch = branchName.replace(/^remotes\/[^/]+\//, "");
      const out = await gitCheckout(folder, cleanBranch);
      setMessage(`Cambiado a rama '${cleanBranch}':\n${out}`);
      setBranchDropdownOpen(false);
      await refreshGit();
      onRefreshWorkspace?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    try {
      setLoading(true);
      const out = await gitBranchCreate(folder, newBranchName.trim());
      setMessage(`Nueva rama creada y activada '${newBranchName.trim()}':\n${out}`);
      setNewBranchName("");
      setShowNewBranch(false);
      await refreshGit();
      onRefreshWorkspace?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRemote = async () => {
    if (!remoteUrl.trim()) return;
    try {
      setLoading(true);
      const out = await gitRemoteSet(folder, remoteName.trim() || "origin", remoteUrl.trim());
      setMessage(out);
      await refreshGit();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleInitRepo = async () => {
    try {
      setLoading(true);
      const out = await gitInit(folder);
      setMessage(`Repositorio inicializado:\n${out}`);
      await refreshGit();
      onRefreshWorkspace?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const stagedFiles = files.filter((f) => f.isStaged);
  const unstagedFiles = files.filter((f) => !f.isStaged);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal git-studio-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header git-header">
          <div className="git-header-left">
            <GitBranch size={16} className="text-cyan" />
            <div className="git-header-title">
              <h3>Control de Versiones Git</h3>
              {status && (
                <div className="git-branch-selector-wrap">
                  <button
                    type="button"
                    className="git-branch-badge-btn"
                    onClick={() => setBranchDropdownOpen((o) => !o)}
                    title="Seleccionar o cambiar rama"
                  >
                    <span>{status.branch || "HEAD"}</span>
                    <ChevronDown size={11} />
                  </button>
                  {branchDropdownOpen && (
                    <div className="git-branch-dropdown">
                      <div className="git-branch-dropdown-header">
                        <span>Ramas Locales & Remotas</span>
                        <button
                          type="button"
                          className="git-text-btn"
                          onClick={() => {
                            setBranchDropdownOpen(false);
                            setShowNewBranch(true);
                          }}
                        >
                          + Nueva
                        </button>
                      </div>
                      <div className="git-branch-list">
                        {branches.map((b) => (
                          <button
                            key={b}
                            type="button"
                            className={`git-branch-item ${b === status.branch ? "active" : ""}`}
                            onClick={() => handleSwitchBranch(b)}
                          >
                            <span>{b}</span>
                            {b === status.branch && <Check size={11} className="text-cyan" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="git-header-actions">
            <button
              className="btn btn-subtle"
              onClick={handleFetch}
              disabled={fetching || isNotGitRepo}
              title="Descargar referencias remotas (git fetch --all)"
            >
              <DownloadCloud size={12} className={fetching ? "animate-spin" : ""} />
              <span>{fetching ? "Fetching..." : "Fetch"}</span>
            </button>
            <button
              className="btn btn-subtle"
              onClick={handlePull}
              disabled={pulling || isNotGitRepo}
              title="Descargar cambios remotos (git pull)"
            >
              <ArrowDown size={12} className={pulling ? "animate-bounce" : ""} />
              <span>{pulling ? "Descargando..." : "Pull"}</span>
            </button>
            <button
              className="btn btn-subtle btn-primary"
              onClick={handlePush}
              disabled={pushing || isNotGitRepo}
              title="Publicar cambios locales en remoto (git push)"
            >
              <ArrowUp size={12} className={pushing ? "animate-bounce" : ""} />
              <span>{pushing ? "Subiendo..." : "Push"}</span>
            </button>
            <button className="icon-btn" onClick={refreshGit} title="Refrescar estado Git">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
            <button className="icon-btn" onClick={onClose} title="Cerrar (Esc)">
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="modal-tabs git-tabs">
          <button
            className={`tab ${activeTab === "changes" ? "active" : ""}`}
            onClick={() => setActiveTab("changes")}
          >
            <FileDiff size={13} />
            <span>Cambios ({files.length})</span>
          </button>
          <button
            className={`tab ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            <Clock size={13} />
            <span>Historial ({commits.length})</span>
          </button>
          <button
            className={`tab ${activeTab === "remotes" ? "active" : ""}`}
            onClick={() => setActiveTab("remotes")}
          >
            <Globe size={13} />
            <span>Remotos & Conexión ({remotes.length})</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="modal-body git-modal-body">
          {error && (
            <div className="git-alert git-alert-error">
              <strong>Error Git:</strong> {error}
            </div>
          )}
          {message && (
            <div className="git-alert git-alert-success">
              <pre className="small">{message}</pre>
            </div>
          )}

          {isNotGitRepo ? (
            <div className="git-uninit-card">
              <FolderGit2 size={36} className="text-cyan" />
              <h4>Este directorio no es un repositorio Git</h4>
              <p className="muted small">
                Inicializa un repositorio Git local para realizar control de versiones, crear ramas y conectar con GitHub o GitLab.
              </p>
              <button className="btn btn-primary" onClick={handleInitRepo} disabled={loading}>
                <Plus size={13} />
                <span>Inicializar Repositorio Git (git init)</span>
              </button>
            </div>
          ) : activeTab === "changes" ? (
            <div className="git-changes-layout">
              {/* Left File List */}
              <div className="git-files-pane">
                {/* Staged Section */}
                <div className="git-section-header">
                  <span>Preparados para Commit ({stagedFiles.length})</span>
                  {stagedFiles.length > 0 && (
                    <button
                      className="git-text-btn"
                      onClick={() => stagedFiles.forEach((f) => handleUnstage(f.path))}
                    >
                      Quitar todos
                    </button>
                  )}
                </div>
                <div className="git-file-list">
                  {stagedFiles.length === 0 ? (
                    <div className="git-empty-msg muted small">No hay archivos preparados.</div>
                  ) : (
                    stagedFiles.map((f) => (
                      <div
                        key={f.path + "-staged"}
                        className={`git-file-row ${selectedFile?.path === f.path && selectedFile.isStaged ? "active" : ""}`}
                        onClick={() => handleSelectFile(f)}
                      >
                        <span className={`git-status-tag tag-${f.status}`}>{f.status}</span>
                        <span className="git-file-name" title={f.path}>{f.path}</span>
                        <button
                          className="icon-btn-micro"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnstage(f.path);
                          }}
                          title="Despreparar (Unstage)"
                        >
                          <Minus size={10} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Unstaged Section */}
                <div className="git-section-header">
                  <span>Cambios en el Área de Trabajo ({unstagedFiles.length})</span>
                  {unstagedFiles.length > 0 && (
                    <button className="git-text-btn" onClick={handleStageAll}>
                      Preparar todos (+)
                    </button>
                  )}
                </div>
                <div className="git-file-list">
                  {unstagedFiles.length === 0 ? (
                    <div className="git-empty-msg muted small">Árbol de trabajo limpio.</div>
                  ) : (
                    unstagedFiles.map((f) => (
                      <div
                        key={f.path + "-unstaged"}
                        className={`git-file-row ${selectedFile?.path === f.path && !selectedFile.isStaged ? "active" : ""}`}
                        onClick={() => handleSelectFile(f)}
                      >
                        <span className={`git-status-tag tag-${f.status}`}>{f.status}</span>
                        <span className="git-file-name" title={f.path}>{f.path}</span>
                        <div className="git-row-actions">
                          <button
                            className="icon-btn-micro"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDiscard(f.path);
                            }}
                            title="Descartar cambios en este archivo"
                          >
                            <Trash2 size={10} className="text-red" />
                          </button>
                          <button
                            className="icon-btn-micro"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStage(f.path);
                            }}
                            title="Preparar para commit (Stage)"
                          >
                            <Plus size={10} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Commit Box */}
                <div className="git-commit-box">
                  <textarea
                    className="git-commit-input"
                    rows={3}
                    placeholder="Mensaje del commit... (ej. feat: add universal telemetry viewer)"
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        handleCommit();
                      }
                    }}
                  />
                  <div className="git-commit-action-row">
                    <span className="muted micro">Ctrl+Enter para commit</span>
                    <button
                      className="btn btn-primary git-commit-btn"
                      disabled={stagedFiles.length === 0 || !commitMsg.trim() || loading}
                      onClick={handleCommit}
                    >
                      <CheckCheck size={12} />
                      <span>Commit ({stagedFiles.length})</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Diff Viewer */}
              <div className="git-diff-pane">
                <div className="git-diff-header">
                  <span className="git-diff-filename">
                    {selectedFile ? `${selectedFile.path} (${selectedFile.isStaged ? "Preparado" : "Sin preparar"})` : "Selecciona un archivo para ver el diff"}
                  </span>
                </div>
                <div className="git-diff-content">
                  <pre className="diff-pre">
                    {diffText.split("\n").map((line, idx) => {
                      let lineClass = "diff-line-ctx";
                      if (line.startsWith("+") && !line.startsWith("+++")) lineClass = "diff-line-add";
                      else if (line.startsWith("-") && !line.startsWith("---")) lineClass = "diff-line-del";
                      else if (line.startsWith("@@")) lineClass = "diff-line-hunk";
                      return (
                        <div key={idx} className={`diff-line ${lineClass}`}>
                          {line || " "}
                        </div>
                      );
                    })}
                  </pre>
                </div>
              </div>
            </div>
          ) : activeTab === "history" ? (
            /* History Timeline */
            <div className="git-history-pane">
              <div className="git-commits-timeline">
                {commits.map((c) => (
                  <div key={c.hash} className="git-commit-item">
                    <div className="commit-point">
                      <GitCommit size={14} className="text-cyan" />
                    </div>
                    <div className="commit-details">
                      <div className="commit-msg-row">
                        <strong className="commit-subject">{c.message}</strong>
                        <code className="commit-hash" title={c.hash}>{c.shortHash}</code>
                      </div>
                      <div className="commit-meta-row">
                        <span className="commit-author">
                          <User size={11} /> {c.author}
                        </span>
                        <span className="commit-time">
                          <Clock size={11} /> {c.date}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Remotes & Connection Tab */
            <div className="git-remotes-pane">
              <div className="cfg-card">
                <div className="cfg-head">
                  <strong>Repositorios Remotos Conectados</strong>
                  <span className="badge-pill active">{remotes.length} Configurado(s)</span>
                </div>
                {remotes.length === 0 ? (
                  <p className="muted small">No hay repositorios remotos configurados todavía.</p>
                ) : (
                  <div className="git-remote-list">
                    {remotes.map((r, idx) => (
                      <div key={idx} className="git-remote-item">
                        <div className="git-remote-meta">
                          <strong className="text-cyan">{r.name}</strong>
                          <span className="git-remote-url font-mono small">{r.url}</span>
                        </div>
                        <span className="badge-pill micro">{r.fetchOrPush}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="cfg-card">
                <div className="cfg-head">
                  <strong>Conectar o Actualizar Repositorio Remoto (GitHub / GitLab)</strong>
                </div>
                <div className="git-remote-form">
                  <div className="field">
                    <label>Nombre del Remoto</label>
                    <input
                      type="text"
                      value={remoteName}
                      onChange={(e) => setRemoteName(e.target.value)}
                      placeholder="origin"
                    />
                  </div>
                  <div className="field">
                    <label>URL del Repositorio Remoto (HTTPS / SSH)</label>
                    <input
                      type="text"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      placeholder="https://github.com/usuario/repositorio.git"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSaveRemote}
                    disabled={!remoteUrl.trim() || loading}
                  >
                    <Globe size={13} />
                    <span>Guardar y Conectar Remoto</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Inline for New Branch */}
        {showNewBranch && (
          <div className="git-new-branch-overlay" onClick={() => setShowNewBranch(false)}>
            <div className="git-new-branch-box" onClick={(e) => e.stopPropagation()}>
              <h4>Crear Nueva Rama Git</h4>
              <p className="small muted">Se creará una rama nueva basada en la rama actual ({status?.branch || "HEAD"}).</p>
              <input
                type="text"
                autoFocus
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="feature/nombre-de-rama"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateBranch();
                  if (e.key === "Escape") setShowNewBranch(false);
                }}
              />
              <div className="git-new-branch-actions">
                <button type="button" className="btn btn-subtle" onClick={() => setShowNewBranch(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreateBranch}
                  disabled={!newBranchName.trim()}
                >
                  Crear y Cambiar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

