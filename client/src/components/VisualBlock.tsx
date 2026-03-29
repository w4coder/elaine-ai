/**
 * VisualBlock.tsx
 * Renders visualizer tool output inline in the chat.
 *
 * Security model:
 * - sandbox="allow-scripts" WITHOUT allow-same-origin → null origin, no parent DOM access
 * - srcDoc (not src) → no network request, content never touches a URL
 * - CSS variables + shared classes injected into every iframe
 * - sendPrompt() and openLink() injected via postMessage bridge
 * - Auto-resizes via ResizeObserver on the iframe's contentDocument
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { CSS_VARIABLES_LIGHT, CSS_VARIABLES_DARK, SHARED_CSS } from "../lib/design-system";

interface VisualBlockProps {
  title: string;
  widgetCode: string;
  loadingMessages?: string[];
  onSendPrompt?: (text: string) => void;
}

function buildIframeDocument(widgetCode: string, isDark: boolean): string {
  const cssVars = isDark ? CSS_VARIABLES_DARK : CSS_VARIABLES_LIGHT;
  const isSvg = widgetCode.trimStart().startsWith("<svg");

  const baseStyles = isSvg
    ? `html, body { margin: 0; padding: 0; background: ${isDark ? "#1a1815" : "#ffffff"}; }
       svg { width: 100%; height: auto; display: block; }`
    : `html, body { margin: 0; padding: 0; background: transparent;
         font-family: var(--font-sans); color: var(--color-text-primary);
         font-size: 16px; line-height: 1.7; box-sizing: border-box; }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {
${cssVars}
}
${baseStyles}
${SHARED_CSS}
</style>
</head>
<body>
${widgetCode}
<script>
(function() {
  // Bridge: iframe → parent
  window.sendPrompt = function(text) {
    window.parent.postMessage({ type: "visualizer:sendPrompt", text: String(text) }, "*")
  }

  window.openLink = function(url) {
    window.parent.postMessage({ type: "visualizer:openLink", url: String(url) }, "*")
  }

  // Auto-resize: notify parent of content height
  function reportHeight() {
    var h = document.documentElement.scrollHeight
    window.parent.postMessage({ type: "visualizer:resize", height: h }, "*")
  }

  requestAnimationFrame(reportHeight)

  if (window.ResizeObserver) {
    new ResizeObserver(reportHeight).observe(document.body)
  }
})()
</script>
</body>
</html>`;
}

export function VisualBlock({
  title,
  widgetCode,
  loadingMessages = ["Loading visual..."],
  onSendPrompt,
}: VisualBlockProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  console.log("Rendering VisualBlock with title:", title, "isDark:", isDark);
  useEffect(() => {
    if (!isLoading || loadingMessages.length <= 1) return;
    const interval = setInterval(() => {
      setLoadingIndex((i) => (i + 1) % loadingMessages.length);
    }, 800);
    return () => clearInterval(interval);
  }, [isLoading, loadingMessages]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (!iframeRef.current) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      switch (data.type) {
        case "visualizer:resize":
          setHeight(Math.max(60, (data.height as number) + 16));
          break;
        case "visualizer:sendPrompt":
          onSendPrompt?.(data.text as string);
          break;
        case "visualizer:openLink":
          if (window.confirm(`Open link?\n\n${data.url as string}`)) {
            window.open(data.url as string, "_blank", "noopener,noreferrer");
          }
          break;
      }
    },
    [onSendPrompt]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  const srcDoc = buildIframeDocument(widgetCode, isDark);

  return (
    <div style={{ margin: "8px 0", position: "relative" }}>
      {isLoading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            color: "rgba(255,255,255,0.4)",
            pointerEvents: "none",
            zIndex: 1,
            minHeight: 60,
          }}
        >
          {loadingMessages[loadingIndex]}
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        style={{
          width: "100%",
          height: `${height}px`,
          border: "none",
          display: "block",
          borderRadius: 8,
          background: "transparent",
          transition: "height 0.15s ease",
          opacity: isLoading ? 0 : 1,
        }}
        onLoad={() => setIsLoading(false)}
      />
    </div>
  );
}
