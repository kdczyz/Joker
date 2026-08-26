import * as readline from 'node:readline/promises';
import { AgentClient, type RunRequest } from './client.js';
import type { PendingApproval, PermissionMode, StreamEvent, ThinkingMode } from './types.js';
import { isPermissionMode, THINKING_MODES } from './types.js';
import { SessionRenderer, paint } from './render.js';
import { commandAudit, commandStatus, commandTools } from './commands.js';

/** Formats an approval prompt shown before y/N confirmation. */
export function formatApproval(approval: PendingApproval): string {
  return [
    paint('33', `⚠ approval required (${approval.risk}): ${approval.toolCall.name}`),
    paint('2', summarizeApprovalArgs(approval.toolCall.arguments)),
    paint('2', `reason: ${approval.reason}`)
  ].join('\n  ');
}

function summarizeApprovalArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, ' ').slice(0, 200)}`)
    .join(' ');
}

/**
 * Interactive REPL (`joker` with no args). One persistent conversation,
 * slash commands, and interactive approval prompts over the same SSE flow
 * the GUI uses (`/api/agent/run` → `approval_required` → `/api/agent/approve`).
 */
export interface SessionOptions {
  client: AgentClient;
  projectPath: string;
  mode: PermissionMode;
  thinking: ThinkingMode;
  model?: string;
}

/** Mutable in-session state changed via slash commands. */
interface SessionState {
  conversationId: string | undefined;
  mode: PermissionMode;
  thinking: ThinkingMode;
  model: string | undefined;
  projectPath: string;
}

export async function runSession(options: SessionOptions): Promise<void> {
  const { client } = options;
  const state: SessionState = {
    conversationId: undefined,
    mode: options.mode,
    thinking: options.thinking,
    model: options.model,
    projectPath: options.projectPath
  };

  console.log(paint('1', paint('36', 'Joker')) + paint('2', ' cli'));
  console.log(paint('2', `project=${state.projectPath} mode=${state.mode} thinking=${state.thinking}`));
  console.log(paint('2', 'Type a task, /help for commands, Ctrl+D to exit.\n'));

  const handleInput = async (input: string): Promise<boolean> => {
    if (input.startsWith('/')) {
      const result = await handleSlash(input, client, state);
      return !result.exit;
    }
    const renderer = new SessionRenderer();
    state.conversationId =
      (await runTurn(client, undefined, renderer, {
        prompt: input,
        conversationId: state.conversationId,
        mode: state.mode,
        thinkingMode: state.thinking,
        model: state.model,
        projectPath: state.projectPath
      })) ?? state.conversationId;
    process.stdout.write('\n');
    return true;
  };

  // Non-TTY stdin (piped scripts) would leave readline questions unsettled at
  // EOF; read the whole buffer up front and process lines synchronously.
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const lines = Buffer.concat(chunks).toString('utf8').split('\n');
    for (const rawLine of lines) {
      const input = rawLine.trim();
      if (!input) continue;
      const keepGoing = await handleInput(input);
      if (!keepGoing) break;
    }
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      let input: string;
      try {
        input = (await rl.question(paint('36', '› '))).trim();
      } catch {
        break; // EOF (Ctrl+D)
      }
      if (!input) continue;
      const keepGoing = await handleInput(input);
      if (!keepGoing) break;
    }
  } finally {
    rl.close();
  }
}

const SLASH_HELP = `  /help              show commands
  /exit              quit (also Ctrl+D)
  /clear             start a fresh conversation
  /mode [mode]       default | plan | workspace_write | full_access (alias: yolo)
  /model [id]        set or show model override
  /thinking [mode]   fast | balanced | deep
  /project           show project root
  /status            runtime health
  /tools             list registered agent tools
  /audit [n]         recent audit events`;

async function handleSlash(
  input: string,
  client: AgentClient,
  state: SessionState
): Promise<{ exit?: boolean }> {
  const parts = input.slice(1).trim().split(/\s+/);
  const command = parts[0] ?? '';
  const args = parts.slice(1);
  switch (command) {
    case '':
    case 'help':
      console.log(SLASH_HELP);
      return {};
    case 'exit':
    case 'quit':
      return { exit: true };
    case 'clear':
      state.conversationId = undefined;
      console.log(paint('2', 'conversation cleared'));
      return {};
    case 'mode': {
      if (!args[0]) {
        console.log(`mode=${state.mode}`);
        return {};
      }
      const normalized = args[0] === 'yolo' ? 'full_access' : args[0];
      if (!isPermissionMode(normalized)) {
        console.log(paint('33', 'unknown mode; expected default|plan|workspace_write|full_access'));
        return {};
      }
      state.mode = normalized;
      console.log(`mode=${state.mode}`);
      return {};
    }
    case 'model':
      state.model = args.length ? args.join(' ') : state.model;
      console.log(`model=${state.model ?? '(server default)'}`);
      return {};
    case 'thinking': {
      if (!args[0]) {
        console.log(`thinking=${state.thinking}`);
        return {};
      }
      if (!(THINKING_MODES as readonly string[]).includes(args[0])) {
        console.log(paint('33', 'unknown thinking mode; expected fast|balanced|deep'));
        return {};
      }
      state.thinking = args[0] as ThinkingMode;
      console.log(`thinking=${state.thinking}`);
      return {};
    }
    case 'project':
      console.log(`project=${state.projectPath}`);
      return {};
    case 'status':
      try {
        await commandStatus(client);
      } catch (error) {
        console.log(paint('31', error instanceof Error ? error.message : String(error)));
      }
      return {};
    case 'tools':
      try {
        await commandTools(client);
      } catch (error) {
        console.log(paint('31', error instanceof Error ? error.message : String(error)));
      }
      return {};
    case 'audit': {
      const limit = Number.parseInt(args[0] ?? '', 10);
      try {
        await commandAudit(client, Number.isFinite(limit) ? limit : 30);
      } catch (error) {
        console.log(paint('31', error instanceof Error ? error.message : String(error)));
      }
      return {};
    }
    default:
      console.log(`Unknown command: /${command} (try /help)`);
      return {};
  }
}

export type Approver = (
  approval: PendingApproval
) => Promise<boolean> | boolean;

/**
 * Runs one streamed turn and resolves any approvals through `approver`,
 * continuing via `/api/agent/approve` exactly like the GUI gate.
 * Returns the conversation id once the turn settles.
 */
export async function runTurn(
  client: AgentClient,
  approver: Approver | undefined,
  renderer: { onEvent(event: StreamEvent): void },
  request: RunRequest
): Promise<string | undefined> {
  let conversationId = request.conversationId;
  let pendingApprovals: PendingApproval[] = [];

  const forward = (event: StreamEvent): void => {
    if (event.type === 'run_started' || event.type === 'approval_required' || event.type === 'completed' || event.type === 'error') {
      if (event.conversationId) conversationId = event.conversationId;
    }
    if (event.type === 'approval_required') {
      pendingApprovals = event.approvals ?? [];
      return;
    }
    renderer.onEvent(event);
  };

  await client.runStream(request, forward);

  while (pendingApprovals.length > 0 && approver) {
    const approvals = pendingApprovals;
    pendingApprovals = [];
    for (const approval of approvals) {
      const allow = await approver(approval);
      await client.approveStream(approval.id, allow, request, forward);
    }
  }

  return conversationId;
}
