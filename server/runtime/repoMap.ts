/**
 * Built-in `repo_map` tool backend (P0). Ported from the Electron adapter's
 * builtin-repo-map-tool: compact ranked codebase map using path/symbol/import
 * extraction, git recency, and BM25-like scoring with a scan budget.
 */

import type { Dirent, Stats } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_SYMBOLS = 12;
const DEFAULT_SCAN_LIMIT = 2500;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 8;
const MAX_SYMBOL_BYTES = 512 * 1024;
const MAX_GIT_RECENT_FILES = 250;
const INDEX_CONCURRENCY = 12;

const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", ".next", ".nuxt", ".turbo",
  ".cache", ".codex", "dist", "out", "build", "coverage", "target",
  ".venv", "venv", "__pycache__", ".pytest_cache"
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".kt", ".kts",
  ".cs", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp",
  ".swift", ".rb", ".php", ".vue", ".svelte",
  ".json", ".toml", ".yaml", ".yml", ".md", ".mdx"
]);

const IMPORTANT_FILE_NAMES = new Set([
  "package.json", "tsconfig.json", "vite.config.ts", "electron.vite.config.ts",
  "README.md", "AGENTS.md", "CLAUDE.md", "pyproject.toml", "Cargo.toml", "go.mod"
]);

export type RepoMapSymbol = { name: string; kind: string; line: number };

type RepoMapFile = {
  path: string;
  relativePath: string;
  language: string;
  size: number;
  symbols: RepoMapSymbol[];
  imports: string[];
  tokens: string[];
};

type RepoMapIndex = {
  root: string;
  target: string;
  scanBackend: "git" | "filesystem";
  scannedAt: number;
  gitHead?: string;
  files: RepoMapFile[];
  scannedFiles: number;
  skippedDirectories: string[];
  truncated: boolean;
  recentFiles: Map<string, number>;
};

type CacheEntry = { index: RepoMapIndex; expiresAt: number; scanLimit: number };

const cache = new Map<string, CacheEntry>();

export interface RepoMapOptions {
  workspaceRoot: string;
  targetPath?: string;
  query?: string;
  maxFiles?: number;
  maxSymbolsPerFile?: number;
  maxScanFiles?: number;
  refresh?: boolean;
  signal?: AbortSignal;
}

function pruneCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

/** POSIX-normalized relative path. */
function normalizeRelPath(value: string): string {
  return value.split("\\").join("/").replace(/^\.\//, "");
}

function spawnCapture(command: string, args: string[], options: { cwd: string; signal?: AbortSignal } ): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout }));
    options.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
  });
}

// --- Discovery ---

type FileDiscovery = { filePaths: string[]; skippedDirectories: string[]; truncated: boolean };

async function discoverGitFiles(input: { workspaceRoot: string; target: string; maxScanFiles: number; signal?: AbortSignal }): Promise<FileDiscovery | null> {
  const targetRelative = normalizeRelPath(relative(input.workspaceRoot, input.target) || ".");
  try {
    const result = await spawnCapture(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", targetRelative],
      { cwd: input.workspaceRoot, signal: input.signal }
    );
    if (result.exitCode !== 0) return null;
    const filePaths: string[] = [];
    let truncated = false;
    for (const rawPath of result.stdout.split("\0")) {
      const relativePath = normalizeRelPath(rawPath.trim());
      if (!relativePath || shouldSkipRelativePath(relativePath)) continue;
      const absolutePath = join(input.workspaceRoot, relativePath);
      if (!shouldIndexFile(absolutePath)) continue;
      if (filePaths.length >= input.maxScanFiles) { truncated = true; break; }
      filePaths.push(absolutePath);
    }
    return { filePaths, skippedDirectories: ["gitignored and nested repositories"], truncated };
  } catch {
    return null;
  }
}

async function discoverFilesystemFiles(input: { workspaceRoot: string; target: string; maxScanFiles: number; signal?: AbortSignal }, targetStat: Stats): Promise<FileDiscovery> {
  const filePaths: string[] = [];
  const skippedDirectories: string[] = [];
  const queue = targetStat.isDirectory() ? [input.target] : [];
  let queueIndex = 0;
  let truncated = false;
  if (targetStat.isFile() && shouldIndexFile(input.target)) filePaths.push(input.target);
  while (queueIndex < queue.length) {
    if (input.signal?.aborted) throw new Error("repo_map aborted");
    const current = queue[queueIndex];
    queueIndex += 1;
    if (!current) break;
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    if (current !== input.target && entries.some((entry) => entry.isDirectory() && entry.name === ".git")) {
      skippedDirectories.push(normalizeRelPath(relative(input.workspaceRoot, current)));
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (input.signal?.aborted) throw new Error("repo_map aborted");
      const next = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          skippedDirectories.push(normalizeRelPath(relative(input.workspaceRoot, next) || entry.name));
          continue;
        }
        queue.push(next);
        continue;
      }
      if (!entry.isFile() || !shouldIndexFile(next)) continue;
      if (filePaths.length >= input.maxScanFiles) {
        truncated = true;
        queueIndex = queue.length;
        break;
      }
      filePaths.push(next);
    }
  }
  return { filePaths, skippedDirectories, truncated };
}

function shouldSkipRelativePath(relativePath: string): boolean {
  return normalizeRelPath(relativePath).split("/").some((segment) => SKIP_DIRS.has(segment));
}

// --- Indexing ---

async function indexRepoFiles(workspaceRoot: string, filePaths: string[], signal?: AbortSignal): Promise<RepoMapFile[]> {
  const files: RepoMapFile[] = [];
  for (let start = 0; start < filePaths.length; start += INDEX_CONCURRENCY) {
    if (signal?.aborted) throw new Error("repo_map aborted");
    const indexed = await Promise.all(
      filePaths.slice(start, start + INDEX_CONCURRENCY).map((filePath) => indexFile(workspaceRoot, filePath))
    );
    for (const file of indexed) if (file) files.push(file);
  }
  return files;
}

async function indexFile(workspaceRoot: string, filePath: string): Promise<RepoMapFile | null> {
  let fileStat: Stats;
  try {
    fileStat = await stat(filePath);
  } catch {
    return null;
  }
  if (fileStat.size > 5 * 1024 * 1024) return null;
  let text = "";
  if (fileStat.size <= MAX_SYMBOL_BYTES) {
    const buffer = await readFile(filePath);
    if (isBinaryBuffer(buffer)) return null;
    text = buffer.toString("utf8");
  }
  const relativePath = normalizeRelPath(relative(workspaceRoot, filePath) || basename(filePath));
  const symbols = text ? extractSymbols(text) : [];
  const imports = text ? extractImports(text) : [];
  const language = languageForPath(filePath);
  const tokens = tokenize(`${relativePath} ${language} ${symbols.map((symbol) => symbol.name).join(" ")} ${imports.join(" ")}`);
  return { path: filePath, relativePath, language, size: fileStat.size, symbols, imports, tokens };
}

function shouldIndexFile(filePath: string): boolean {
  const name = basename(filePath);
  return IMPORTANT_FILE_NAMES.has(name) || SOURCE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function extractSymbols(text: string): RepoMapSymbol[] {
  const out: RepoMapSymbol[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const symbol = symbolFromLine(line);
    if (!symbol) continue;
    out.push({ ...symbol, line: index + 1 });
    if (out.length >= 120) break;
  }
  return out;
}

function symbolFromLine(line: string): Omit<RepoMapSymbol, "line"> | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) return null;
  const patterns: Array<[RegExp, string]> = [
    [/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, "function"],
    [/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
    [/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"],
    [/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, "type"],
    [/^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, "enum"],
    [/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, "function"],
    [/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, "function"],
    [/^class\s+([A-Za-z_]\w*)/, "class"],
    [/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, "function"],
    [/^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/, "type"],
    [/^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/, "function"],
    [/^type\s+([A-Za-z_]\w*)\s+/, "type"],
    [/^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*class\s+([A-Za-z_]\w*)/, "class"],
    [/^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*(?:interface|enum)\s+([A-Za-z_]\w*)/, "type"]
  ];
  for (const [pattern, kind] of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return { name: match[1], kind };
  }
  return null;
}

function extractImports(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    const match =
      trimmed.match(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/) ??
      trimmed.match(/^import\s+['"]([^'"]+)['"]/) ??
      trimmed.match(/^export\s+.*?\s+from\s+['"]([^'"]+)['"]/) ??
      trimmed.match(/^const\s+\w+\s*=\s*require\(['"]([^'"]+)['"]\)/) ??
      trimmed.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+/) ??
      trimmed.match(/^use\s+([A-Za-z0-9_:]+)/) ??
      trimmed.match(/^package\s+([A-Za-z0-9_.]+)/);
    const value = match?.[1]?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= 30) break;
  }
  return out;
}

// --- Ranking ---

function rankFiles(files: RepoMapFile[], query: string, recentFiles: Map<string, number>): Array<{ file: RepoMapFile; score: number; reasons: string[] }> {
  const queryTokens = tokenize(query);
  const documentFrequency = documentFrequencyFor(files);
  const averageLength = files.length > 0
    ? Math.max(1, files.reduce((total, file) => total + file.tokens.length, 0) / files.length)
    : 1;
  return files
    .map((file) => {
      const reasons: string[] = [];
      const queryScore = queryTokens.length > 0
        ? bm25(file.tokens, queryTokens, documentFrequency, files.length, averageLength)
        : 0;
      const rawPathBoost = importantPathBoost(file.relativePath);
      const pathBoost = queryTokens.length > 0 ? rawPathBoost * 0.25 : rawPathBoost;
      const recency = recentFiles.get(file.relativePath) ?? 0;
      if (queryScore > 0) reasons.push("query_match");
      if (pathBoost > 0) reasons.push("entrypoint_or_core_path");
      if (recency > 0) reasons.push("git_recent");
      if (file.symbols.length > 0) reasons.push("symbols");
      return { file, score: Number((queryScore + pathBoost + recency).toFixed(3)), reasons };
    })
    .sort((a, b) => b.score - a.score || a.file.relativePath.localeCompare(b.file.relativePath));
}

function bm25(documentTokens: string[], queryTokens: string[], documentFrequency: Map<string, number>, documentCount: number, averageLength: number): number {
  const tf = new Map<string, number>();
  for (const token of documentTokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  let score = 0;
  const k1 = 1.2;
  const b = 0.75;
  const docLength = Math.max(documentTokens.length, 1);
  for (const token of new Set(queryTokens)) {
    const frequency = tf.get(token) ?? 0;
    if (frequency === 0) continue;
    const df = documentFrequency.get(token) ?? 0;
    const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
    const normalized = (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * (docLength / averageLength)));
    score += idf * normalized;
  }
  return score;
}

function documentFrequencyFor(files: RepoMapFile[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const file of files) {
    for (const token of new Set(file.tokens)) out.set(token, (out.get(token) ?? 0) + 1);
  }
  return out;
}

function importantPathBoost(relativePath: string): number {
  const name = basename(relativePath);
  if (IMPORTANT_FILE_NAMES.has(name)) return 2.5;
  if (/^(src|app|packages|Rcode)\//.test(relativePath)) return 0.8;
  if (/(^|\/)(index|main|runtime|server|router|store|config)\.[^.]+$/.test(relativePath)) return 1.4;
  return 0;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.normalize("NFKC").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)) {
    const token = match[0];
    for (const part of token.split(/[_-]+/)) {
      if (part.length >= 2 && !/^\d+$/.test(part)) tokens.push(part);
    }
    if (token.length >= 2 && !/^\d+$/.test(token)) tokens.push(token);
  }
  for (const segment of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = [...segment];
    for (let size = 2; size <= Math.min(4, chars.length); size += 1) {
      for (let index = 0; index <= chars.length - size; index += 1) {
        tokens.push(chars.slice(index, index + size).join(""));
      }
    }
  }
  return tokens;
}

// --- Git metadata ---

async function gitHeadForWorkspace(workspaceRoot: string): Promise<string | undefined> {
  try {
    const result = await spawnCapture("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot });
    const value = result.stdout.trim();
    return result.exitCode === 0 && value ? value : undefined;
  } catch {
    return undefined;
  }
}

async function gitRecentFiles(workspaceRoot: string, signal?: AbortSignal): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const status = await spawnCapture("git", ["status", "--short"], { cwd: workspaceRoot, signal });
    if (status.exitCode === 0) {
      for (const line of status.stdout.split(/\r?\n/)) {
        const rawPath = line.slice(3).trim().replace(/^"|"$/g, "");
        if (!rawPath) continue;
        const normalized = normalizeRelPath(rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() ?? rawPath : rawPath);
        out.set(normalized, Math.max(out.get(normalized) ?? 0, 3));
        if (out.size >= MAX_GIT_RECENT_FILES) break;
      }
    }
  } catch { /* Git metadata is a boost, not a requirement. */ }
  try {
    const log = await spawnCapture("git", ["log", "--name-only", "--pretty=format:", "-n", "30"], { cwd: workspaceRoot, signal });
    if (log.exitCode === 0) {
      let rank = 0;
      for (const line of log.stdout.split(/\r?\n/)) {
        const file = normalizeRelPath(line.trim());
        if (!file || out.has(file)) continue;
        out.set(file, Math.max(0.2, 1.5 - rank * 0.02));
        rank += 1;
        if (out.size >= MAX_GIT_RECENT_FILES) break;
      }
    }
  } catch { /* Git metadata is a boost, not a requirement. */ }
  return out;
}

// --- Formatting helpers ---

function countBy<T>(values: T[], keyFor: (value: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const value of values) {
    const key = keyFor(value);
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

function topEntries(map: Map<string, number>, limit: number): Array<{ name: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function firstDirectory(relativePath: string): string {
  const slash = relativePath.indexOf("/");
  return slash === -1 ? "." : relativePath.slice(0, slash);
}

function languageForPath(filePath: string): string {
  const name = basename(filePath);
  if (IMPORTANT_FILE_NAMES.has(name)) return name;
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts": case ".tsx": return "typescript";
    case ".js": case ".jsx": case ".mjs": case ".cjs": return "javascript";
    case ".py": return "python";
    case ".rs": return "rust";
    case ".go": return "go";
    case ".md": case ".mdx": return "markdown";
    case ".json": return "json";
    case ".yaml": case ".yml": return "yaml";
    default: return ext.replace(/^\./, "") || "text";
  }
}

function entrypoints(files: RepoMapFile[]): string[] {
  return files
    .filter((file) => importantPathBoost(file.relativePath) > 0)
    .sort((a, b) => importantPathBoost(b.relativePath) - importantPathBoost(a.relativePath))
    .map((file) => file.relativePath);
}

function suggestions(query: string, resultCount: number, truncated: boolean): string[] {
  const out = [
    resultCount > 0
      ? "Read the highest-ranked files before editing; use grep/lsp for exact call sites."
      : "No source files matched the current scope; try a broader path or refresh=true."
  ];
  if (!query) out.push("Pass query to rank files for the current task instead of returning only entrypoint/core-path scores.");
  if (truncated) out.push("The scan hit maxScanFiles; narrow path or increase maxScanFiles for a fuller map.");
  return out;
}

/**
 * Build (or reuse from cache) the repo map for the requested scope.
 */
export async function buildRepoMap(options: RepoMapOptions): Promise<Record<string, unknown>> {
  const workspaceRoot = options.workspaceRoot;
  const rawTarget = options.targetPath && options.targetPath.trim() ? options.targetPath.trim() : ".";
  const resolvedTarget = rawTarget === "." ? workspaceRoot : join(workspaceRoot, rawTarget);
  const query = typeof options.query === "string" ? options.query.trim() : "";
  const maxFiles = clamp(normalizePositiveInteger(options.maxFiles, DEFAULT_MAX_FILES), 1, 80);
  const maxSymbolsPerFile = clamp(normalizePositiveInteger(options.maxSymbolsPerFile, DEFAULT_MAX_SYMBOLS), 0, 50);
  const maxScanFiles = clamp(normalizePositiveInteger(options.maxScanFiles, DEFAULT_SCAN_LIMIT), 100, 20_000);

  const cacheKey = `${workspaceRoot}\0${resolvedTarget}`;
  const gitHead = await gitHeadForWorkspace(workspaceRoot);
  const now = Date.now();
  pruneCache(now);
  const cached = cache.get(cacheKey);
  const cacheHit = Boolean(
    cached &&
    !options.refresh &&
    cached.expiresAt > now &&
    cached.scanLimit >= maxScanFiles &&
    cached.index.gitHead === gitHead
  );

  const index: RepoMapIndex = cacheHit
    ? cached!.index
    : await buildIndex({ workspaceRoot, target: resolvedTarget, maxScanFiles, gitHead, signal: options.signal });

  if (!cacheHit) {
    cache.delete(cacheKey);
    cache.set(cacheKey, { index, expiresAt: now + CACHE_TTL_MS, scanLimit: maxScanFiles });
    pruneCache(now);
  }

  const ranked = rankFiles(index.files, query, index.recentFiles)
    .slice(0, maxFiles)
    .map((entry) => ({
      path: entry.file.path,
      relative_path: entry.file.relativePath,
      language: entry.file.language,
      size: entry.file.size,
      score: entry.score,
      reasons: entry.reasons,
      symbols: entry.file.symbols.slice(0, maxSymbolsPerFile),
      symbolCount: entry.file.symbols.length,
      imports: entry.file.imports.slice(0, 12)
    }));

  return {
    workspaceRoot,
    path: resolvedTarget,
    relative_path: normalizeRelPath(relative(workspaceRoot, resolvedTarget) || "."),
    query,
    cache: {
      hit: cacheHit,
      ttlMs: CACHE_TTL_MS,
      scannedAt: new Date(index.scannedAt).toISOString(),
      gitHead: index.gitHead ?? null
    },
    totals: {
      scanBackend: index.scanBackend,
      scannedFiles: index.scannedFiles,
      indexedFiles: index.files.length,
      truncated: index.truncated
    },
    languages: topEntries(countBy(index.files, (file) => file.language), 12),
    importantDirectories: topEntries(countBy(index.files, (file) => firstDirectory(file.relativePath)), 12),
    entrypoints: entrypoints(index.files).slice(0, 20),
    files: ranked,
    skippedDirectories: index.skippedDirectories.slice(0, 30),
    suggestions: suggestions(query, ranked.length, index.truncated)
  };
}

async function buildIndex(input: { workspaceRoot: string; target: string; maxScanFiles: number; gitHead?: string; signal?: AbortSignal }): Promise<RepoMapIndex> {
  const startedAt = Date.now();
  const targetStat = await stat(input.target);
  const gitDiscovery = targetStat.isDirectory() ? await discoverGitFiles(input) : null;
  const discovery = gitDiscovery ?? await discoverFilesystemFiles(input, targetStat);
  const [files, recentFiles] = await Promise.all([
    indexRepoFiles(input.workspaceRoot, discovery.filePaths, input.signal),
    gitRecentFiles(input.workspaceRoot, input.signal)
  ]);
  return {
    root: input.workspaceRoot,
    target: input.target,
    scanBackend: gitDiscovery ? "git" : "filesystem",
    scannedAt: startedAt,
    ...(input.gitHead ? { gitHead: input.gitHead } : {}),
    files,
    scannedFiles: discovery.filePaths.length,
    skippedDirectories: discovery.skippedDirectories,
    truncated: discovery.truncated,
    recentFiles
  };
}
