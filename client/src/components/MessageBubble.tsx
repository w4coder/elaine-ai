import { Check, Copy, Pencil, RotateCcw, Send, X } from "lucide-react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { ImageAttachment, MessageBlock, MessageRecord, VisualizerWidget } from "../lib/types";
import React from "react";
import { FileViewerSidebar } from "./FileViewerSidebar";
import { AppLogo, AppLogoSparkle } from "./AppLogo";
import { VisualBlock } from "./VisualBlock";

interface MessageBubbleProps {
  message: MessageRecord;
  isStreaming?: boolean;
  onResend?: (content: string) => void;
  onSendPrompt?: (text: string) => void;
}

function getReasoning(message: MessageRecord): string {
  if (!message.metadata || typeof message.metadata.reasoning !== "string") return "";
  return message.metadata.reasoning.trim();
}

function getWidgets(message: MessageRecord): VisualizerWidget[] {
  if (!Array.isArray(message.metadata?.widgets)) return [];
  return (message.metadata.widgets as unknown[]).filter(
    (w): w is VisualizerWidget =>
      typeof w === "object" &&
      w !== null &&
      (w as VisualizerWidget).type === "visualizer_widget" &&
      typeof (w as VisualizerWidget).widget_code === "string"
  );
}

function getBlocks(message: MessageRecord): MessageBlock[] | null {
  if (!Array.isArray(message.metadata?.blocks)) return null;
  return message.metadata.blocks as MessageBlock[];
}

function WidgetSkeleton({ title }: { title: string }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)" }}
      aria-label={`Rendering ${title || "widget"}…`}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div
          className="w-3 h-3 rounded-full animate-pulse"
          style={{ background: "rgba(255,255,255,0.15)" }}
        />
        {title ? (
          <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.45)" }}>
            {title}
          </span>
        ) : (
          <div
            className="h-2.5 rounded-full animate-pulse"
            style={{ background: "rgba(255,255,255,0.1)", width: "120px" }}
          />
        )}
      </div>
      <div className="p-4 space-y-2.5">
        <p className="text-xs animate-pulse" style={{ color: "rgba(255,255,255,0.3)" }}>
          Generating visual…
        </p>
        <div
          className="h-2 rounded-full animate-pulse"
          style={{ background: "rgba(255,255,255,0.07)", width: "85%" }}
        />
        <div
          className="h-2 rounded-full animate-pulse"
          style={{ background: "rgba(255,255,255,0.06)", width: "65%" }}
        />
        <div
          className="h-24 rounded-xl mt-3 animate-pulse"
          style={{ background: "rgba(255,255,255,0.05)" }}
        />
      </div>
    </div>
  );
}

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = React.useState(false);

  const previewLines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-4);

  return (
    <div className="msg-assistant__reasoning">
      <button
        type="button"
        className="flex items-center gap-1 w-full text-left"
        style={{
          color: "var(--text-soft)",
          fontSize: "0.9rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {isStreaming ? (
          <AppLogoSparkle size={20} animated={isStreaming && !open} />
        ) : (
          <AppLogo size={20} animated={isStreaming && !open} />
        )}
        Thinking {open ? "▼" : "▶"}
      </button>
      {!open && isStreaming && previewLines.length > 0 && (
        <div className="px-3 pt-1 pb-1 space-y-0.5 ml-1 border-l border-gray-600 pl-2 thaught_preview">
          {previewLines.map((line, i) => (
            <p
              key={i}
              className="text-xs truncate"
              style={{ color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}
            >
              {line}
            </p>
          ))}
        </div>
      )}
      {open && <pre>{content}</pre>}
    </div>
  );
}

function getImages(message: MessageRecord): ImageAttachment[] {
  if (!Array.isArray(message.metadata?.images)) {
    return [];
  }

  return message.metadata.images.filter(
    (image): image is ImageAttachment =>
      typeof image === "object" &&
      image !== null &&
      typeof image.name === "string" &&
      typeof image.mimeType === "string" &&
      typeof image.dataUrl === "string"
  );
}

export function MessageBubble({
  message,
  isStreaming = false,
  onResend,
  onSendPrompt,
}: MessageBubbleProps) {
  const [editing, setEditing] = React.useState(false);
  const [openFile, setOpenFile] = React.useState<{ path: string; name: string } | null>(null);
  const [editText, setEditText] = React.useState("");
  const reasoning = getReasoning(message);
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleEdit() {
    setEditText(message.content);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setEditText("");
  }

  function handleSend() {
    if (!editText.trim()) return;
    onResend?.(editText);
    setEditing(false);
    setEditText("");
  }

  if (message.role === "user") {
    const images = getImages(message);
    return (
      <div className="msg-user group flex flex-col items-end">
        {editing ? (
          <div className="w-full">
            <textarea
              className="w-full rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none"
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.9)",
                minHeight: "80px",
              }}
              rows={Math.max(3, editText.split("\n").length)}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleSend();
                }
                if (e.key === "Escape") handleCancel();
              }}
              autoFocus
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button
                type="button"
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
                style={{ color: "rgba(255,255,255,0.45)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.45)")}
              >
                <X size={12} />
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!editText.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-40"
                style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)" }}
                onMouseEnter={(e) => {
                  if (editText.trim()) e.currentTarget.style.background = "rgba(255,255,255,0.16)";
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
              >
                <Send size={12} />
                Send
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="msg-user__body">
              {images.length > 0 && (
                <div className="msg-user__images h-35">
                  {images.map((image, index) => (
                    <img
                      key={`${image.name}-${index}`}
                      className="msg-user__image h-35"
                      src={image.dataUrl}
                      alt={image.name}
                    />
                  ))}
                </div>
              )}
              {message.content ? <p>{message.content}</p> : null}
            </div>
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 mt-1 justify-end transition-opacity">
              <button
                type="button"
                title="Copy"
                onClick={handleCopy}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "rgba(255,255,255,0.3)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
              <button
                type="button"
                title="Edit"
                onClick={handleEdit}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "rgba(255,255,255,0.3)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
              >
                <Pencil size={18} />
              </button>
              {onResend && (
                <button
                  type="button"
                  title="Resend"
                  onClick={() => onResend(message.content)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
                >
                  <RotateCcw size={18} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  if (message.role === "assistant") {
    const widgets = getWidgets(message);
    const blocks = getBlocks(message);

    const markdownComponents = {
      a({ href, children }: { href?: string; children?: React.ReactNode }) {
        if (href?.startsWith("file://")) {
          const path = href.slice("file://".length);
          const name = path.split("/").pop() ?? path;
          return (
            <button
              type="button"
              className="msg-file-chip"
              onClick={() => setOpenFile({ path, name })}
              title={path}
            >
              📄 {String(children)}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      },
    };

    return (
      <>
        <div className="msg-assistant-row">
          <div className="msg-assistant">
            {blocks ? (
              blocks.map((block, i) => {
                if (block.type === "reasoning") {
                  return (
                    <ThinkingBlock
                      key={i}
                      content={block.content}
                      isStreaming={isStreaming && i === blocks.length - 1}
                    />
                  );
                }
                if (block.type === "text") {
                  return block.content ? (
                    <Markdown
                      key={i}
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                      urlTransform={(url) => url}
                      components={markdownComponents}
                    >
                      {block.content}
                    </Markdown>
                  ) : null;
                }
                if (block.type === "widget") {
                  const widget = widgets[block.index];
                  if (!widget) return null;
                  return (
                    <VisualBlock
                      key={i}
                      title={widget.title}
                      widgetCode={widget.widget_code}
                      loadingMessages={widget.loading_messages}
                      onSendPrompt={onSendPrompt}
                    />
                  );
                }
                if (block.type === "widget_loading") {
                  return <WidgetSkeleton key={i} title={block.title} />;
                }
                return null;
              })
            ) : (
              <>
                {reasoning && (
                  <ThinkingBlock
                    content={reasoning}
                    isStreaming={isStreaming && !message.content}
                  />
                )}
                {message.content && (
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    urlTransform={(url) => url}
                    components={markdownComponents}
                  >
                    {message.content}
                  </Markdown>
                )}
                {widgets.map((widget, i) => (
                  <VisualBlock
                    key={i}
                    title={widget.title}
                    widgetCode={widget.widget_code}
                    loadingMessages={widget.loading_messages}
                    onSendPrompt={onSendPrompt}
                  />
                ))}
              </>
            )}
          </div>
        </div>
        {openFile && <FileViewerSidebar file={openFile} onClose={() => setOpenFile(null)} />}
      </>
    );
  }

  return (
    <div className="msg-tool">
      <span className="msg-tool__label">{message.toolName || "Tool"}</span>
      <p>{message.content}</p>
    </div>
  );
}
