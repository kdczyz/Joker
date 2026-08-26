import type { DiffResult, StreamEvent } from './types.js';

/**
 * Terminal rendering for the Rcode CLI.
 * - `SessionRenderer`: human-friendly streaming output for `rcode` (chat) mode
 * - `JsonlRenderer` / `QuietRenderer`: machine modes for scripting & CI,
 *   mirroring codex's `--json` and grok's headless output styles.
 */
export interface EventRenderer {
  onEvent(event: StreamEvent): void;
  /** Final answer text, if any (used by exec mode exit reporting). */
  finalAnswer: string;
}

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

export function paint(code: string, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const DIM = '2';
const BOLD = '1';
const RED = '31';
const GREEN = '32';
const YELLOW = '33';
const BLUE = '34';
const CYAN = '36';

export function brandBanner(): string {
  const logo = `${paint(BOLD, paint(CYAN, 'R'))}${paint(BOLD, 'code')}`;
  return `${logo} ${paint(DIM, 'cli')} — ${paint(DIM, 'type a task, /help for commands, Ctrl+D to exit')}`;
}

function summarizeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, ' ').slice(0, 120)}`)
    .join(' ')
    .slice(0, 240);
}

export class SessionRenderer implements EventRenderer {
  finalAnswer = '';
  private lastWasTool = false;

  constructor(private readonly err: NodeJS.WriteStream = process.stderr) {}

  onEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'run_started':
        this.err.write(paint(DIM, `\n● conversation ${String(event.conversationId).slice(0, 8)}\n`));
        break;
      case 'workflow_state':
        this.err.write(paint(DIM, `\r\x1b[K${event.label}`));
        this.lastWasTool = true;
        break;
      case 'text_delta':
        if (this.lastWasTool) {
          this.err.write('\n\n');
          this.lastWasTool = false;
        }
        process.stdout.write(event.content);
        break;
      case 'reasoning_delta':
        // reasoning is intentionally not printed in session mode
        break;
      case 'tool_call':
        this.err.write(`\n${paint(CYAN, `⚙ ${event.toolCall.name}`)} ${paint(DIM, summarizeArgs(event.toolCall.arguments))}\n`);
        this.lastWasTool = true;
        break;
      case 'permission_decision':
        this.err.write(paint(DIM, `  permission ${event.effect}: ${event.reason}\n`));
        break;
      case 'tool_result': {
        const status = event.result.ok ? paint(GREEN, 'ok') : paint(RED, 'fail');
        this.err.write(`  ${event.result.name}: ${status}\n`);
        if (!event.result.ok) {
          const excerpt = event.result.content.split('\n').slice(-6).join('\n');
          this.err.write(paint(RED, `  ${excerpt}\n`));
        }
        break;
      }
      case 'diff_created':
        for (const diff of event.diffs) {
          this.err.write(paint(YELLOW, `  Δ ${diff.filePath} +${diff.addedLines}/-${diff.removedLines}\n`));
        }
        break;
      case 'subagent_update':
        this.err.write(paint(DIM, `  subagent ${event.run.id} ${event.run.status ?? ''}\n`));
        break;
      case 'billing_usage':
        this.err.write(
          paint(DIM, `\n  tokens ↑${event.usage.promptTokens} ↓${event.usage.completionTokens}` +
            (event.usage.cacheReadTokens ? ` cache-hit ${event.usage.cacheReadTokens}` : '') +
            ` · ${event.provider}/${event.model}\n`)
        );
        break;
      case 'approval_required':
        // handled by the session loop (interactive prompt), not here
        break;
      case 'completed':
        this.finalAnswer = event.answer;
        if (this.lastWasTool) this.err.write('\n');
        break;
      case 'error':
        this.err.write(paint(RED, `\nerror: ${event.message}\n`));
        break;
    }
  }
}

/** Emits one JSON object per line — stable contract for scripts and CI. */
export class JsonlRenderer implements EventRenderer {
  finalAnswer = '';

  constructor(private readonly out: NodeJS.WritableStream = process.stdout) {}

  onEvent(event: StreamEvent): void {
    this.out.write(`${JSON.stringify(event)}\n`);
    if (event.type === 'completed') this.finalAnswer = event.answer;
  }
}

/** Prints only the final assistant answer — codex `exec` style default. */
export class QuietRenderer implements EventRenderer {
  finalAnswer = '';
  private startedText = false;

  onEvent(event: StreamEvent): void {
    if (event.type === 'text_delta') {
      if (!this.startedText) this.startedText = true;
      process.stdout.write(event.content);
    } else if (event.type === 'completed') {
      this.finalAnswer = event.answer;
    } else if (event.type === 'error') {
      process.stderr.write(paint(RED, `error: ${event.message}\n`));
    }
  }
}
