import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentClient } from './client.js';
import { resolveConfig, type CliOverrides } from './config.js';
import { ensureServer, generateLocalToken, loadPersistedToken } from './serverProcess.js';
import { paint } from './render.js';
import { runSession } from './session.js';
import { runExec, humanizeError } from './exec.js';
import { commandMcp } from './mcpCommands.js';
import { commandAudit, commandStatus, commandTools } from './commands.js';
import {
  isApprovalPolicy,
  isSandboxMode,
  resolvePermissionMode,
  type ApprovalPolicy,
  type SandboxMode
} from './codexFlags.js';

export interface ParsedArgs {
  /** Codex-style invocation: `rcode`, `rcode exec`, `rcode resume`, `rcode mcp`, ... */
  command: string;
  rest: string[];
  overrides: CliOverrides;
  execFlags: Array<'--json' | '--yes'>;
  resumeId?: string;
}

export interface CodexStyleFlags {
  yolo?: boolean;
  fullAuto?: boolean;
  sandbox?: SandboxMode;
  approval?: ApprovalPolicy;
}

const FLAGS_WITH_VALUE = new Set([
  // codex-style
  '-C', '--cd',
  '-m', '--model',
  '-s', '--sandbox',
  '-a', '--ask-for-approval',
  '--config',
  // rcode runtime attachment
  '--project', '--mode', '--thinking', '--url', '--token'
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const overrides: CliOverrides = {};
  const flags: CodexStyleFlags = {};
  const execFlags: Array<'--json' | '--yes'> = [];
  const rest: string[] = [];
  let modeExplicit = false;
  let resumeId: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const value = () => argv[++i] ?? '';
    switch (arg) {
      case '-C':
      case '--cd':
      case '--project':
        overrides.projectPath = value();
        break;
      case '-m':
      case '--model':
        overrides.model = value();
        break;
      case '-s':
      case '--sandbox': {
        const sandbox = value();
        if (!isSandboxMode(sandbox)) {
          throw new Error(`invalid --sandbox "${sandbox}" (expected read-only|workspace-write|danger-full-access)`);
        }
        flags.sandbox = sandbox;
        break;
      }
      case '-a':
      case '--ask-for-approval': {
        const policy = value();
        if (!isApprovalPolicy(policy)) {
          throw new Error(`invalid --ask-for-approval "${policy}" (expected untrusted|on-failure|on-request|never)`);
        }
        flags.approval = policy;
        if (policy === 'never') overrides.noServerStart; // no-op, keeps lint calm
        break;
      }
      case '--full-auto':
        flags.fullAuto = true;
        break;
      case '--yolo':
        flags.yolo = true;
        break;
      case '--dangerously-bypass-approvals-and-sandbox':
        flags.yolo = true;
        break;
      case '--json':
        execFlags.push('--json');
        break;
      case '--yes':
        execFlags.push('--yes');
        break;
      case '--no-start-server':
      case '--no-server':
        overrides.noServerStart = true;
        break;
      case '--config':
        value(); // accepted for compatibility; layered config file already covers this
        break;
      case '--mode': {
        // escape hatch to the native rcode axis
        overrides.mode = normalizeNativeMode(value());
        modeExplicit = true;
        break;
      }
      case '--thinking':
        overrides.thinking = normalizeThinking(value());
        break;
      case '--url':
        overrides.baseUrl = value();
        break;
      case '--token':
        overrides.token = value();
        break;
      default:
        rest.push(arg);
    }
  }

  // Native `--mode` (if given) wins; otherwise translate the codex-style axes.
  if (!modeExplicit) {
    overrides.mode = resolvePermissionMode(flags);
  }

  const command = rest.shift() ?? 'chat';
  if (command === 'resume') {
    // codex: `codex resume [SESSION_ID]` — omit for picker (we take last)
    resumeId = rest.shift();
  }
  return { command, rest, overrides, execFlags, resumeId };
}

function normalizeNativeMode(value: string): CliOverrides['mode'] {
  if (['default', 'plan', 'workspace_write', 'full_access', 'read_only', 'ask', 'auto', 'yolo'].includes(value)) {
    return value as CliOverrides['mode'];
  }
  throw new Error(`unknown mode: ${value} (expected default|plan|workspace_write|full_access)`);
}

function normalizeThinking(value: string): 'fast' | 'balanced' | 'deep' {
  if (['fast', 'balanced', 'deep'].includes(value)) return value as 'fast' | 'balanced' | 'deep';
  throw new Error(`unknown thinking mode: ${value} (expected fast|balanced|deep)`);
}

export function printHelp(bin = 'rcode'): void {
  console.log(`${paint('1', paint('36', 'Rcode'))}${paint('1', ' cli')} ${paint('2', '— terminal coding agent over the Rcode runtime')}

Usage:
  ${bin}                       Interactive session (REPL)
  ${bin} "query"              One-shot prompt, then REPL context is kept on disk
  ${bin} exec "<task>"        Non-interactive run for scripts & CI
  ${bin} resume [SESSION_ID]  Resume a previous conversation
  ${bin} mcp                  Manage MCP servers (add/list/remove/tools/test)
  ${bin} status               Runtime health
  ${bin} tools                Registered agent tools
  ${bin} audit [n]            Recent audit events

Options:
  -C, --cd <dir>              Work in <dir> instead of cwd
  -m, --model <id>            Model override
  -s, --sandbox <mode>        read-only | workspace-write | danger-full-access
  -a, --ask-for-approval <p>  untrusted | on-failure | on-request | never
      --full-auto             Low-friction sandboxed automatic execution
      --yolo                  No approvals, full access (also
                              --dangerously-bypass-approvals-and-sandbox)
      --thinking <mode>       fast | balanced | deep
      --url <url>             Attach to a running server (default http://127.0.0.1:8787)
      --token <token>         Local API token (or AGENT_LOCAL_TOKEN env)
      --no-start-server       Never spawn the server; attach only

exec options:
  --json                      Emit one JSON event per line (stable contract)
  --yes                       Auto-approve tool calls (non-interactive default is deny)

Config:
  ~/.rcode/config.json merges under flags and env vars.
`);
}

/** Entry point. Returns the process exit code. */
export async function runCli(argv: string[], bin = 'rcode'): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(paint('31', error instanceof Error ? error.message : String(error)));
    return 1;
  }

  if (
    parsed.command === 'help' ||
    parsed.command === '--help' ||
    parsed.command === '-h' ||
    parsed.command === '--version'
  ) {
    printHelp(bin);
    return 0;
  }

  const positional = parsed.rest.filter((item) => !(item === '--json' || item === '--yes'));
  const config = resolveConfig(parsed.overrides);

  try {
    const started = await ensureServer({
      baseUrl: config.baseUrl,
      token: config.token || loadPersistedToken(config.baseUrl) || generateLocalToken(),
      autoStart: config.autoStartServer
    });
    const client = new AgentClient(started.baseUrl, started.token);

    switch (parsed.command) {
      case 'chat': {
        await runSession({
          client,
          projectPath: config.projectPath,
          mode: config.mode,
          thinking: config.thinking,
          model: config.model
        });
        return 0;
      }
      case 'exec': {
        const prompt = positional.join(' ').trim();
        if (!prompt) {
          console.error(paint('31', 'exec requires a task prompt'));
          return 1;
        }
        return await runExec({
          client,
          prompt,
          projectPath: config.projectPath,
          mode: config.mode,
          thinking: config.thinking,
          model: config.model,
          output: parsed.execFlags.includes('--json') ? 'json' : 'quiet',
          autoApprove: parsed.execFlags.includes('--yes')
        });
      }
      case 'resume': {
        const conversationId = parsed.resumeId ?? loadLastConversationId(config.projectPath);
        if (!conversationId) {
          console.error(paint('31', 'no conversation id given and none found; pass one: rcode resume <id>'));
          return 1;
        }
        await runSession({
          client,
          projectPath: config.projectPath,
          mode: config.mode,
          thinking: config.thinking,
          model: config.model,
          conversationId
        });
        return 0;
      }
      case 'mcp':
        await commandMcp(client, positional);
        return 0;
      case 'status':
        await commandStatusSafe(client);
        return 0;
      case 'tools':
        await commandToolsSafe(client);
        return 0;
      case 'audit': {
        const limit = Number.parseInt(positional[0] ?? '', 10);
        await commandAuditSafe(client, Number.isFinite(limit) ? limit : 30);
        return 0;
      }
      default: {
        // codex behavior: bare text without a known subcommand is a prompt
        const prompt = [parsed.command, ...positional].join(' ').trim();
        return await runExec({
          client,
          prompt,
          projectPath: config.projectPath,
          mode: config.mode,
          thinking: config.thinking,
          model: config.model,
          output: parsed.execFlags.includes('--json') ? 'json' : 'quiet',
          autoApprove: parsed.execFlags.includes('--yes')
        });
      }
    }
  } catch (error) {
    console.error(paint('31', humanizeCliError(error)));
    return 1;
  }
}

function commandStatusSafe(client: AgentClient): Promise<void> {
  return commandStatus(client);
}
function commandToolsSafe(client: AgentClient): Promise<void> {
  return commandTools(client);
}
async function commandAuditSafe(client: AgentClient, limit: number): Promise<void> {
  await commandAudit(client, limit);
}

import { commandAudit, commandStatus, commandTools } from './commands.js';
import { humanizeError } from './exec.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function humanizeCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return humanizeError(message);
}

const LAST_SESSION_FILE = '.rcode-last-session';

/** Persists the last conversation id per project so `rcode resume` works bare. */
export function saveLastConversationId(projectPath: string, conversationId: string): void {
  try {
    writeFileSync(join(projectPath, LAST_SESSION_FILE), `${conversationId}\n`);
  } catch {
    /* best effort */
  }
}

export function loadLastConversationId(projectPath: string): string | undefined {
  try {
    const file = join(projectPath, LAST_SESSION_FILE);
    if (!existsSync(file)) return undefined;
    const id = readFileSync(file, 'utf8').trim();
    return /^[a-zA-Z0-9_-]{4,80}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

import { writeFileSync } from 'node:fs';
