/**
 * web_fetch - Agentic Web Fetch Skill (v3 Production Hardened)
 *
 * Goals:
 *  - Reliable extraction for agentic workflows (fast fetch + browser fallback)
 *  - Resistant to SPAs, bot protection, and flaky pages
 *  - Safe under load (size guards, throttling, concurrency limits)
 *  - LLM-friendly output (clean markdown, safe trimming, metadata)
 *
 * Dependencies (open-source):
 *   @mozilla/readability, jsdom, turndown, playwright
 *
 * Install:
 *   npm i @mozilla/readability jsdom turndown playwright
 *   npx playwright install chromium
 */

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { chromium } from "playwright";

// ---------------------------------------------------------------------------
// 0. SMALL UTILS
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hardTimeout(promise, ms, label = "Operation timed out") {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function normalizeUrl(rawUrl) {
  const u = new URL(rawUrl);
  u.hash = "";
  // Sort query params for stable cache keys (keeps semantics but improves hit rate)
  // Note: URLSearchParams.sort() is supported in modern Node.
  u.searchParams.sort();
  return u.toString();
}

function safeTrimMarkdown(text, maxChars) {
  if (!text || text.length <= maxChars) return text || "";
  const slice = text.slice(0, maxChars);
  // Prefer cutting at paragraph boundaries
  const lastPara = slice.lastIndexOf("\n\n");
  if (lastPara > maxChars * 0.6) return slice.slice(0, lastPara).trim();
  // Next best: end of line
  const lastLine = slice.lastIndexOf("\n");
  if (lastLine > maxChars * 0.6) return slice.slice(0, lastLine).trim();
  return slice.trim();
}

// ---------------------------------------------------------------------------
// 1. DOMAIN THROTTLE (anti-ban stability)
// ---------------------------------------------------------------------------

const DOMAIN_COOLDOWN_MS = 1500;
const domainAccessMap = new Map();

async function throttleDomain(url) {
  const hostname = new URL(url).hostname;
  const now = Date.now();
  const last = domainAccessMap.get(hostname) || 0;
  const delta = now - last;
  if (delta < DOMAIN_COOLDOWN_MS) await sleep(DOMAIN_COOLDOWN_MS - delta);
  domainAccessMap.set(hostname, Date.now());
}

// ---------------------------------------------------------------------------
// 2. IN-MEMORY LRU CACHE WITH TTL
// ---------------------------------------------------------------------------

const CACHE_MAX_SIZE = 150;
const CACHE_TTL_MS = 5 * 60 * 1000;

class LRUCache {
  constructor(maxSize, ttlMs) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    this.map.set(key, { value, ts: Date.now() });
  }

  invalidate(key) {
    this.map.delete(key);
  }
}

const cache = new LRUCache(CACHE_MAX_SIZE, CACHE_TTL_MS);

// ---------------------------------------------------------------------------
// 3. HEADERS — randomized, realistic
// ---------------------------------------------------------------------------

function getRealisticHeaders() {
  const browsers = ["Chrome/120.0.0.0", "Chrome/121.0.0.0", "Chrome/122.0.0.0"];
  const osList = [
    "Windows NT 10.0; Win64; x64",
    "Macintosh; Intel Mac OS X 10_15_7",
    "X11; Linux x86_64",
  ];
  const browser = browsers[Math.floor(Math.random() * browsers.length)];
  const os = osList[Math.floor(Math.random() * osList.length)];

  return {
    "User-Agent": `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) ${browser} Safari/537.36`,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
    DNT: "1",
  };
}

// ---------------------------------------------------------------------------
// 4. CONTENT-TYPE GUARD + SAFE RESPONSE READ (size cap)
// ---------------------------------------------------------------------------

function parseContentType(header = "") {
  return header.split(";")[0].trim().toLowerCase();
}

const MAX_HTML_BYTES = 5_000_000; // 5MB safety cap

async function safeReadResponseText(response, maxBytes = MAX_HTML_BYTES) {
  // Node fetch provides a web stream body; use reader to enforce size.
  if (!response.body || typeof response.body.getReader !== "function") {
    // Fallback: no streaming API available; use .text() but still guard with content-length.
    const len = Number(response.headers.get("content-length") || "0");
    if (len && len > maxBytes)
      throw new Error(`Response exceeds maximum allowed size (${maxBytes} bytes)`);
    return await response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      try {
        await reader.cancel();
      } catch {}
      throw new Error(`Response exceeds maximum allowed size (${maxBytes} bytes)`);
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

const NON_HTML_HANDLERS = {
  "application/json": (text, excerpt) => ({
    title: "JSON Response",
    method: "raw_json",
    content: safeTrimMarkdown(text, excerpt),
  }),
  "application/xml": (text, excerpt) => ({
    title: "XML Response",
    method: "raw_xml",
    content: safeTrimMarkdown(text, excerpt),
  }),
  "text/xml": (text, excerpt) => ({
    title: "XML Response",
    method: "raw_xml",
    content: safeTrimMarkdown(text, excerpt),
  }),
  "text/plain": (text, excerpt) => ({
    title: "Plain Text",
    method: "raw_text",
    content: safeTrimMarkdown(text, excerpt),
  }),
  "application/pdf": () => ({
    method: "unsupported_pdf",
    error:
      "PDF detected. Use a dedicated PDF parser in your pipeline (e.g., pdf-parse) or add a PDF mode here.",
    content: null,
  }),
};

// ---------------------------------------------------------------------------
// 5. EXTRACTION — Readability + Turndown + Metadata
// ---------------------------------------------------------------------------

function buildTurndownService() {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // Remove boilerplate-ish elements
  td.remove([
    "script",
    "style",
    "noscript",
    "nav",
    "footer",
    "aside",
    "header",
    "form",
    "button",
    "input",
    "select",
    '[class*="cookie"]',
    '[class*="banner"]',
    '[class*="popup"]',
    '[class*="modal"]',
    '[id*="cookie"]',
    '[id*="newsletter"]',
    '[aria-hidden="true"]',
  ]);

  // Normalize code blocks (pre/code)
  td.addRule("cleanCode", {
    filter: ["pre", "code"],
    replacement: (content, node) => {
      const code = (node.textContent || "").trim();
      if (!code) return "";
      return node.nodeName === "PRE" ? `\n\n\`\`\`\n${code}\n\`\`\`\n\n` : `\`${code}\``;
    },
  });

  return td;
}

function extractMeta(document) {
  const meta = {};
  document.querySelectorAll("meta").forEach((m) => {
    const name = m.getAttribute("name") || m.getAttribute("property");
    const content = m.getAttribute("content");
    if (name && content) meta[name.toLowerCase()] = content;
  });

  return {
    author: meta["author"] || meta["article:author"] || null,
    published_time: meta["article:published_time"] || meta["og:published_time"] || null,
    modified_time: meta["article:modified_time"] || null,
    og_title: meta["og:title"] || null,
    og_description: meta["og:description"] || null,
    og_site_name: meta["og:site_name"] || null,
  };
}

function extractContent(html, url, excerptLength) {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  const meta = extractMeta(document);

  const reader = new Readability(document);
  const article = reader.parse();

  if (!article || !article.textContent?.trim()) {
    const raw = document.body?.textContent ?? "";
    const clean = raw.replace(/\s+/g, " ").trim();
    return {
      ...meta,
      title: meta.og_title || document.title || undefined,
      description: meta.og_description || undefined,
      content: safeTrimMarkdown(clean, excerptLength),
      total_chars: clean.length,
      is_fallback: true,
    };
  }

  const td = buildTurndownService();
  let markdown = td.turndown(article.content ?? "");
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

  return {
    ...meta,
    title: article.title,
    siteName: article.siteName,
    description: article.excerpt,
    content: safeTrimMarkdown(markdown, excerptLength),
    total_chars: markdown.length,
  };
}

// ---------------------------------------------------------------------------
// 6. SPA DETECTION — structure-aware
// ---------------------------------------------------------------------------

const SPA_CONTENT_THRESHOLD = 300;
const HTML_STRUCTURE_RE = /<(p|h[1-6]|article|main|section)\b/i;

function looksLikeSPA(html, extractedChars) {
  if (extractedChars > SPA_CONTENT_THRESHOLD) return false;
  return !HTML_STRUCTURE_RE.test(html);
}

// ---------------------------------------------------------------------------
// 7. BROWSER SINGLETON + CONCURRENCY LIMITER
// ---------------------------------------------------------------------------

let _browser = null;

async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  }
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

class Semaphore {
  constructor(max) {
    this.max = max;
    this.cur = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.cur < this.max) {
      this.cur += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.cur += 1;
  }

  release() {
    this.cur = Math.max(0, this.cur - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const MAX_BROWSER_CONTEXTS = 5;
const browserSem = new Semaphore(MAX_BROWSER_CONTEXTS);

// ---------------------------------------------------------------------------
// 8. TOOL EXPORT
// ---------------------------------------------------------------------------

export default {
  name: "web_fetch",
  description: "Fetch text content from a URL.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch." },
    },
    required: ["url"],
  },

  async execute({
    url,
    excerpt = 8000,
    force_browser = false,
    no_cache = false,
    max_bytes = MAX_HTML_BYTES,
    total_timeout_ms = 30_000,
  }) {
    return hardTimeout(
      (async () => {
        // --- URL VALIDATION ---
        let normalizedUrl;
        try {
          normalizedUrl = normalizeUrl(url);
          // Ensure URL is valid
          new URL(normalizedUrl);
        } catch {
          return { error: "Invalid URL provided.", url };
        }

        // --- DOMAIN THROTTLE ---
        await throttleDomain(normalizedUrl);

        // --- CACHE LOOKUP ---
        const cacheKey = `${normalizedUrl}::${excerpt}`;
        if (!no_cache) {
          const cached = cache.get(cacheKey);
          if (cached) return { ...cached, url: normalizedUrl, from_cache: true };
        }

        let usedBrowser = false;

        // ================================================================
        // PHASE 1: FAST FETCH (retry + backoff)
        // ================================================================
        if (!force_browser) {
          const MAX_RETRIES = 2;
          const headers = getRealisticHeaders();

          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              const response = await fetch(normalizedUrl, {
                headers,
                redirect: "follow",
                signal: AbortSignal.timeout(10_000),
              });

              const finalUrl = normalizeUrl(response.url || normalizedUrl);

              // Bot protection usually 403/503
              if (response.status === 403 || response.status === 503) {
                break;
              }

              if (!response.ok) {
                if (attempt < MAX_RETRIES) {
                  await sleep(1000 * (attempt + 1));
                  continue;
                }
                break;
              }

              const mime = parseContentType(response.headers.get("content-type") ?? "");

              // Non-HTML handlers
              if (mime !== "text/html") {
                const rawText = await safeReadResponseText(response, max_bytes);
                const handler = NON_HTML_HANDLERS[mime];
                if (handler) {
                  const result = {
                    ...handler(rawText, excerpt),
                    url: normalizedUrl,
                    final_url: finalUrl,
                    mime,
                  };
                  if (!no_cache && !result.error) cache.set(cacheKey, result);
                  return result;
                }
                return {
                  error: `Unsupported content type: ${mime}`,
                  url: normalizedUrl,
                  final_url: finalUrl,
                  mime,
                };
              }

              // HTML
              const html = await safeReadResponseText(response, max_bytes);
              const quick = extractContent(html, finalUrl, excerpt);

              if (looksLikeSPA(html, quick.total_chars ?? 0)) {
                // fall through to browser
                break;
              }

              const result = {
                ...quick,
                url: normalizedUrl,
                final_url: finalUrl,
                method: "fast_fetch",
                mime,
              };
              if (!no_cache) cache.set(cacheKey, result);
              return result;
            } catch (e) {
              if (attempt < MAX_RETRIES) {
                await sleep(1000 * (attempt + 1));
                continue;
              }
              // last attempt failed => proceed to browser
            }
          }
        }

        // ================================================================
        // PHASE 2: BROWSER FALLBACK (concurrency-limited contexts)
        // ================================================================
        usedBrowser = true;
        await browserSem.acquire();

        try {
          const browser = await getBrowser();
          const ua = getRealisticHeaders()["User-Agent"];

          const context = await browser.newContext({
            userAgent: ua,
            viewport: { width: 1280, height: 800 },
            javaScriptEnabled: true,
            extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
          });

          // Speed: block heavy resources
          await context.route("**/*", (route) => {
            const type = route.request().resourceType();
            if (["image", "media", "font", "stylesheet"].includes(type)) route.abort();
            else route.continue();
          });

          const page = await context.newPage();

          let finalUrl = normalizedUrl;
          let html = "";

          try {
            await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
            finalUrl = normalizeUrl(page.url() || normalizedUrl);

            // Wait for meaningful text (best-effort)
            await page
              .waitForFunction(() => (document.body?.innerText?.length ?? 0) > 200, {
                timeout: 8_000,
              })
              .catch(() => {});

            // Trigger lazy content and settle network
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});

            html = await page.content();

            // Hard size guard on browser HTML too
            if (html.length > max_bytes) {
              html = html.slice(0, max_bytes);
            }
          } finally {
            await context.close();
          }

          const extracted = extractContent(html, finalUrl, excerpt);
          const result = {
            ...extracted,
            url: normalizedUrl,
            final_url: finalUrl,
            method: "headless_browser",
            mime: "text/html",
          };
          if (!no_cache) cache.set(cacheKey, result);
          return result;
        } finally {
          browserSem.release();
        }
      })(),
      total_timeout_ms,
      "web_fetch: total timeout exceeded"
    ).catch((error) => {
      return {
        error: error?.message || String(error),
        phase_failed: String(error?.message || "").includes("total timeout")
          ? "total_timeout"
          : "unknown",
        url,
      };
    });
  },
};
