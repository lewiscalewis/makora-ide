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
} from "lucide-react";

import type { GitCommitInfo, GitFileItem, GitStatusInfo } from "../types";

interface Props {
  folder: string;
  onClose: () => void;
  onRefreshWorkspace?: () => void;
}

export default function GitModal({ folder, onClose, onRefreshWorkspace }: Props) {
  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [files, setFiles] = useState<GitFileItem[]>([]);
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<GitFileItem | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"changes" | "history">("changes");

  const refreshGit = async () => {
    if (!folder) return;
    setLoading(true);
    setError(null);
    try {
      const [st, fls, logs] = await Promise.all([
        gitStatus(folder),
        gitFiles(folder),
        gitLog(folder, 30),
      ]);
      setStatus(st);
      setFiles(fls);
      setCommits(logs);
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
      setMessage(`Push completado:\n${out}`);
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
              <span className="git-branch-badge">
                {status?.branch || "HEAD"}
              </span>
            </div>
          </div>

          <div className="git-header-actions">
            <button
              className="btn btn-subtle"
              onClick={handlePull}
              disabled={pulling}
              title="Descargar cambios remotos (git pull)"
            >
              <ArrowDown size={12} className={pulling ? "animate-bounce" : ""} />
              <span>{pulling ? "Descargando..." : "Pull"}</span>
            </button>
            <button
              className="btn btn-subtle btn-primary"
              onClick={handlePush}
              disabled={pushing}
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

        {/* Mode Selector */}
        <div className="modal-tabs git-tabs">
          <button
            className={`tab ${activeTab === "changes" ? "active" : ""}`}
            onClick={() => setActiveTab("changes")}
          >
            <FileDiff size={13} />
            <span>Cambios de Trabajo ({files.length})</span>
          </button>
          <button
            className={`tab ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            <Clock size={13} />
            <span>Historial de Commits ({commits.length})</span>
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

          {activeTab === "changes" ? (
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
                  <span>Cambios no preparados ({unstagedFiles.length})</span>
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
                  <button
                    className="btn btn-primary git-commit-btn"
                    disabled={stagedFiles.length === 0 || !commitMsg.trim() || loading}
                    onClick={handleCommit}
                  >
                    <CheckCheck size={12} />
                    <span>Commit ({stagedFiles.length} archivos)</span>
                  </button>
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
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
