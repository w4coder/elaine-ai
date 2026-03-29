import React from "react";
import { X, FileText } from "lucide-react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { api } from "../lib/api";
interface FileViewerSidebarProps {
  file: { path: string; name: string };
  onClose(): void;
}

export function FileViewerSidebar({ file, onClose }: FileViewerSidebarProps) {
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setContent(null);
    setError(null);
    api
      .readFile(file.path)
      .then((res) => setContent(res.content))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load file")
      );
  }, [file.path]);

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const lang =
    (
      {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        py: "python",
        rs: "rust",
        go: "go",
        json: "json",
        md: "markdown",
        css: "css",
        html: "html",
        sh: "bash",
        yml: "yaml",
        yaml: "yaml",
        txt: "text",
      } as Record<string, string>
    )[ext] ?? "text";

  const markdownContent = content !== null ? `\`\`\`${lang}\n${content}\n\`\`\`` : null;

  return (
    <div className="file-viewer-sidebar">
      <div className="file-viewer-sidebar__header">
        <div className="file-viewer-sidebar__title">
          <FileText size={14} />
          <span title={file.path}>{file.name}</span>
        </div>
        <button
          type="button"
          className="file-viewer-sidebar__close"
          onClick={onClose}
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
      <div className="file-viewer-sidebar__body">
        {error && <p className="file-viewer-sidebar__error">{error}</p>}
        {content === null && !error && <p className="file-viewer-sidebar__loading">Loading…</p>}
        {markdownContent && (
          <Markdown rehypePlugins={[rehypeHighlight]}>{markdownContent}</Markdown>
        )}
      </div>
    </div>
  );
}
