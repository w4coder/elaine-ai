import type { ChannelId } from "../types.js";

type ReplySegment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string };

const FENCED_CODE_BLOCK_RE = /```([^\n`]*)\n?([\s\S]*?)```/g;
const HORIZONTAL_RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})$/gm;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function formatReplyForChannel(channelId: ChannelId, text: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }

  const formatted = splitReplySegments(normalized)
    .map((segment) =>
      segment.type === "code"
        ? formatCodeSegment(channelId, segment)
        : formatTextSegment(channelId, segment.content)
    )
    .join("");

  return normalizeWhitespace(formatted);
}

function splitReplySegments(text: string): ReplySegment[] {
  const segments: ReplySegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(FENCED_CODE_BLOCK_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, index) });
    }

    segments.push({
      type: "code",
      language: (match[1] ?? "").trim(),
      content: (match[2] ?? "").replace(/\n+$/, ""),
    });

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments;
}

function formatCodeSegment(
  channelId: ChannelId,
  segment: Extract<ReplySegment, { type: "code" }>
): string {
  if (!segment.content.trim()) {
    return "";
  }

  if (channelId === "telegram") {
    const languageLabel = segment.language ? `${segment.language}\n` : "";
    const indented = segment.content
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    return `\n${languageLabel}${indented}\n`;
  }

  const language = segment.language ? segment.language : "";
  return `\n\`\`\`${language}\n${segment.content}\n\`\`\`\n`;
}

function formatTextSegment(channelId: ChannelId, text: string): string {
  let formatted = text.replace(HORIZONTAL_RULE_RE, "").trimEnd();

  switch (channelId) {
    case "slack":
      formatted = replaceMarkdownLinks(formatted, (label, url) => `<${url}|${label}>`);
      formatted = replaceHeadings(formatted, (title) => `*${title}*`);
      formatted = formatted.replace(/\*\*(.+?)\*\*/gs, "*$1*");
      formatted = formatted.replace(/__(.+?)__/gs, "*$1*");
      formatted = formatted.replace(/~~(.+?)~~/gs, "~$1~");
      break;

    case "discord":
      formatted = replaceMarkdownLinks(formatted, plainLink);
      formatted = replaceHeadings(formatted, (title) => `**${title}**`);
      break;

    case "whatsapp":
      formatted = replaceMarkdownLinks(formatted, plainLink);
      formatted = replaceHeadings(formatted, (title) => `*${title}*`);
      formatted = formatted.replace(/\*\*(.+?)\*\*/gs, "*$1*");
      formatted = formatted.replace(/__(.+?)__/gs, "*$1*");
      formatted = formatted.replace(/~~(.+?)~~/gs, "~$1~");
      break;

    case "telegram":
      formatted = replaceMarkdownLinks(formatted, plainLink);
      formatted = replaceHeadings(formatted, (title) => title);
      formatted = stripPlainTextMarkdown(formatted);
      break;
  }

  return formatted;
}

function replaceMarkdownLinks(
  text: string,
  formatter: (label: string, url: string) => string
): string {
  return text.replace(MARKDOWN_LINK_RE, (_match, label: string, url: string) =>
    formatter(label.trim(), url.trim())
  );
}

function replaceHeadings(text: string, formatter: (title: string) => string): string {
  return text.replace(/^#{1,6}[ \t]+(.+)$/gm, (_match, title: string) => formatter(title.trim()));
}

function stripPlainTextMarkdown(text: string): string {
  let stripped = text;
  stripped = stripped.replace(/\*\*(.+?)\*\*/gs, "$1");
  stripped = stripped.replace(/__(.+?)__/gs, "$1");
  stripped = stripped.replace(/~~(.+?)~~/gs, "$1");
  stripped = stripped.replace(/`([^`]+)`/g, "$1");

  // Strip common italic markers while leaving list bullets like "* item" intact.
  stripped = stripped.replace(
    /(^|[\s([{"'])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?=[$\s)\]}",.!?:;'])/gm,
    "$1$2"
  );
  stripped = stripped.replace(
    /(^|[\s([{"'])_([^\s_](?:[^_\n]*?[^\s_])?)_(?=[$\s)\]}",.!?:;'])/gm,
    "$1$2"
  );

  return stripped;
}

function plainLink(label: string, url: string): string {
  return `${label}: ${url}`;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
