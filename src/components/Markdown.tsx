import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface CodeBlockProps {
  className?: string;
  children?: ReactNode;
  onApplyArtifact?: (path: string, content: string) => void;
}

function CodeBlock({ className, children, onApplyArtifact }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);
  const raw = String(children ?? "");
  const langMatch = /language-([\w+.-]+)/.exec(className ?? "");
  const info = langMatch?.[1] ?? "";
  const parts = info.split(":");
  const lang = parts[0];
  const artifactPath = parts.slice(1).join(":").trim() || null;
  const isDiff = lang === "diff";

  const copy = () => {
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const apply = () => {
    if (artifactPath && onApplyArtifact) {
      onApplyArtifact(artifactPath, raw);
      setApplied(true);
      setTimeout(() => setApplied(false), 1500);
    }
  };

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{artifactPath ?? lang}</span>
        <div className="code-actions">
          {artifactPath && onApplyArtifact && (
            <button className="code-btn" onClick={apply}>
              {applied ? "Aplicado ✓" : "Aplicar al workspace"}
            </button>
          )}
          <button className="code-btn" onClick={copy}>
            {copied ? "Copiado ✓" : "Copiar"}
          </button>
        </div>
      </div>
      <pre className={isDiff ? "diff-pre" : "code-pre"}>
        {isDiff
          ? raw.split("\n").map((line, i) => {
              const cls = line.startsWith("+")
                ? "diff-add"
                : line.startsWith("-")
                  ? "diff-del"
                  : line.startsWith("@@")
                    ? "diff-hunk"
                    : "";
              return (
                <span key={i} className={cls}>
                  {line + "\n"}
                </span>
              );
            })
          : raw}
      </pre>
    </div>
  );
}

interface MarkdownProps {
  text: string;
  onApplyArtifact?: (path: string, content: string) => void;
}

export default function Markdown({ text, onApplyArtifact }: MarkdownProps) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children }) {
            const content = String(children ?? "").replace(/\n$/, "");
            if (className || content.includes("\n")) {
              return (
                <CodeBlock className={className} onApplyArtifact={onApplyArtifact}>
                  {content}
                </CodeBlock>
              );
            }
            return <code className="inline-code">{content}</code>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="table-wrap">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
