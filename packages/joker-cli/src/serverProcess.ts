import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates the Joker server runtime. The CLI never embeds a second runtime —
 * it starts (or attaches to) the same server the Electron app uses.
 *
 * Resolution order:
 *   1. dist-server-bundle/index.cjs  (packaged / release builds)
 *   2. dist-server/index.js          (local `tsc` build output)
 *   3. npm run dev:server            (source checkout fallback)
 */
export interface ServerEntrypoint {
  command: string;
  args: string[];
}

const here = dirname(fileURLToPath(import.meta.url));

export function findServerEntrypoint(): ServerEntrypoint {
  // Walk up from this file so a globally-installed copy of the package can
  // still find a sibling checkout of Joker.
  let dir = resolve(here, '..', '..');
  for (let i = 0; i < 6; i += 1) {
    const bundle = join(dir, 'dist-server-bundle', 'index.cjs');
    if (existsSync(bundle)) return { command: process.execPath, args: [bundle] };
    const compiled = join(dir, 'dist-server', 'index.js');
    if (existsSync(compiled)) return { command: process.execPath, args: [compiled] };
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'server', 'index.ts'))) {
      return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'server:dev'] };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'dev:server'] };
}

export interface StartedServer {
  child: ChildProcess | undefined;
  token: string;
  baseUrl: string;
  owned: boolean;
}

/**
 * Ensures an agent server is reachable at `baseUrl`. If not reachable and
 * auto-start is allowed, spawns one on an ephemeral port with a fresh local
 * API token (same trust model as the desktop app: localhost + bearer token).
 */
export async function ensureServer(options: {
  baseUrl: string;
  token: string;
  projectPath?: string;
  autoStart: boolean;
}): Promise<StartedServer> {
  const healthy = await pingServer(options.baseUrl, options.token);
  if (healthy) {
    return { child: undefined, token: options.token, baseUrl: options.baseUrl, owned: false };
  }
  if (!options.autoStart) {
    throw new Error(`Joker server is not reachable at ${options.baseUrl}. Start it or pass --url.`);
  }

  const entry = findServerEntrypoint();
  // Server output goes to a log file instead of inheriting our stdio: the
  // server outlives the CLI process and must never hold the parent's pipes
  // open (otherwise piped consumers like `| head` never see EOF).
  const logPath = join(findProjectRoot(), '.cache', 'joker-cli-server.log');
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');

  const child = spawn(entry.command, entry.args, {
    cwd: findProjectRoot(),
    env: {
      ...process.env,
      AGENT_LOCAL_TOKEN: options.token,
      HOST: new URL(options.baseUrl).hostname,
      PORT: String(new URL(options.baseUrl).port || '8787')
    },
    stdio: ['ignore', logFd, logFd],
    detached: true
  });
  child.unref();
  persistLocalToken(options.baseUrl, options.token);

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await pingServer(options.baseUrl, options.token)) {
      return { child, token: options.token, baseUrl: options.baseUrl, owned: true };
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for the Joker server to start.');
}

function findProjectRoot(): string {
  let dir = resolve(here, '..', '..');
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export async function pingServer(baseUrl: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Generates the local API token used when the CLI owns the server lifecycle. */
export function generateLocalToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens for CLI-owned servers are persisted per base URL (mode 0600) so a
 * later CLI invocation can attach to the still-running detached server.
 */
const TOKEN_FILE = join(homedir(), '.joker', 'server-tokens.json');

export function loadPersistedToken(baseUrl: string): string | undefined {
  try {
    if (!existsSync(TOKEN_FILE)) return undefined;
    const map = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as Record<string, string>;
    return map[baseUrl];
  } catch {
    return undefined;
  }
}

function persistLocalToken(baseUrl: string, token: string): void {
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true });
    let map: Record<string, string> = {};
    if (existsSync(TOKEN_FILE)) {
      map = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as Record<string, string>;
    }
    map[baseUrl] = token;
    writeFileSync(TOKEN_FILE, JSON.stringify(map, null, 2), { mode: 0o600 });
  } catch {
    // best-effort; attach will just require an explicit --token
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
