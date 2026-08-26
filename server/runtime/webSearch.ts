/**
 * Built-in `web_search` tool backend (P0).
 *
 * Multi-engine web search with no API key required. Engines are tried in the
 * requested order; each engine failure falls through to the next so rate
 * limits on one engine never silently return an empty result. Results are
 * normalized to { title, url, snippet } and deduplicated by URL.
 */

export type WebSearchEngine = "duckduckgo" | "bing";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: WebSearchEngine;
}

export interface WebSearchOptions {
  query: string;
  limit?: number;
  engines?: WebSearchEngine[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// --- DuckDuckGo HTML endpoint ---

type DuckDuckGoResult = { title: string; url: string; snippet: string };

function parseDuckDuckGoHtml(html: string): DuckDuckGoResult[] {
  const out: DuckDuckGoResult[] = [];
  // Result anchors look like <a rel="nofollow" class="result__a" href="...">Title</a>
  const anchorPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetPattern = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  for (const match of html.matchAll(snippetPattern)) snippets.push(stripTags(match[1] ?? ""));
  let index = 0;
  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = match[1] ?? "";
    const title = stripTags(match[2] ?? "");
    if (!title) { index += 1; continue; }
    // DDG wraps target URLs in a redirect: //duckduckgo.com/l/?uddg=<encoded>&rut=...
    const redirectMatch = rawHref.match(/[?&]uddg=([^&]+)/);
    const target = redirectMatch ? decodeURIComponent(redirectMatch[1]) : rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;
    const url = normalizeUrl(target);
    if (!url) { index += 1; continue; }
    out.push({ title, url, snippet: snippets[index] ?? "" });
    index += 1;
  }
  return out;
}

async function searchDuckDuckGo(options: WebSearchOptions): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(options.query)}`;
  const html = await fetchHtml(url, options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const parsed = parseDuckDuckGoHtml(html);
  if (parsed.length === 0 && /anomaly|captcha|blocked/i.test(html)) {
    throw new Error("duckduckgo rate-limited or captcha challenge returned");
  }
  return parsed.map((entry) => ({ ...entry, engine: "duckduckgo" as const }));
}

// --- Bing web search ---

function parseBingHtml(html: string): Array<{ title: string; url: string; snippet: string }> {
  const out: Array<{ title: string; url: string; snippet: string }> = [];
  // <li class="b_algo"><h2><a href="URL">Title</a></h2> ... <p>snippet</p>
  const itemPattern = /<li class="b_algo"[\s\S]*?<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>([\s\S]*?)(?=<li class="b_algo"|<\/ol|$)/g;
  for (const match of html.matchAll(itemPattern)) {
    const url = normalizeUrl(match[1] ?? "");
    const title = stripTags(match[2] ?? "");
    if (!url || !title) continue;
    const paragraph = (match[3] ?? "").match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ title, url, snippet: paragraph ? stripTags(paragraph[1] ?? "") : "" });
  }
  return out;
}

async function searchBing(options: WebSearchOptions): Promise<WebSearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(options.query)}&count=${Math.min(MAX_LIMIT, (options.limit ?? DEFAULT_LIMIT) + 4)}`;
  const html = await fetchHtml(url, options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (/challenge|captcha/i.test(html) && !/b_algo/.test(html)) {
    throw new Error("bing returned a bot challenge page");
  }
  return parseBingHtml(html).map((entry) => ({ ...entry, engine: "bing" as const }));
}

const ENGINE_IMPLEMENTATIONS: Record<WebSearchEngine, (options: WebSearchOptions) => Promise<WebSearchResult[]>> = {
  duckduckgo: searchDuckDuckGo,
  bing: searchBing
};

/**
 * Run the search across the requested engines in order, merging results.
 * Never throws as long as at least one engine succeeds; returns partial
 * results plus per-engine error notes otherwise.
 */
export async function runWebSearch(options: WebSearchOptions): Promise<{
  results: WebSearchResult[];
  engineErrors: Array<{ engine: WebSearchEngine; error: string }>;
}> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(options.limit ?? DEFAULT_LIMIT)));
  const engines = (options.engines?.length ? options.engines : ["duckduckgo", "bing"]) as WebSearchEngine[];
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const engineErrors: Array<{ engine: WebSearchEngine; error: string }> = [];

  for (const engine of engines) {
    if (results.length >= limit) break;
    const impl = ENGINE_IMPLEMENTATIONS[engine];
    if (!impl) continue;
    try {
      for (const entry of await impl({ ...options, limit })) {
        if (results.length >= limit) break;
        if (seen.has(entry.url)) continue;
        seen.add(entry.url);
        results.push(entry);
      }
      if (results.length >= limit) break;
    } catch (error) {
      engineErrors.push({
        engine,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { results, engineErrors };
}

export function formatWebSearchOutput(payload: {
  results: WebSearchResult[];
  engineErrors: Array<{ engine: WebSearchEngine; error: string }>;
}): string {
  const lines: string[] = [];
  if (payload.results.length === 0) {
    lines.push(`No results found.${payload.engineErrors.length > 0 ? ` Engine errors: ${payload.engineErrors.map((e) => `${e.engine}: ${e.error}`).join("; ")}` : ""}`);
    return lines.join("\n");
  }
  payload.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`);
    lines.push(`   ${result.url}`);
    if (result.snippet) lines.push(`   ${result.snippet.slice(0, 300)}`);
  });
  if (payload.engineErrors.length > 0) {
    lines.push("", `[partial] some engines failed: ${payload.engineErrors.map((e) => `${e.engine} (${e.error})`).join(", ")}`);
  }
  return lines.join("\n");
}
