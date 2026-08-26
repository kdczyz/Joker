import * as readline from 'node:readline/promises';
import { AgentClient, type RunRequest } from './client.js';
import { JsonlRenderer, QuietRenderer, paint, type EventRenderer } from './render.js';
import { runTurn, type Approver } from './session.js';

/** Turns opaque runtime errors into actionable CLI hints. */
export function humanizeError(message: string): string {
  if (/\bfetch failed\b/i.test(message)) {
    return `${message} — 无法连接上游模型接口。请检查网络/代理，或在 Joker GUI 的 AI 接口设置中确认 baseUrl 与密钥（CLI 与 GUI 共用同一 provider 配置）。`;
  }
  if (/local API token is required/i.test(message)) {
    return `${message} — 传入 --token <token> 或设置 AGENT_LOCAL_TOKEN 环境变量后重试。`;
  }
  if (/not configured|missing key/i.test(message)) {
    return `${message} — 先在 Joker 桌面端完成 provider 配置，或用 --model 覆盖默认模型。`;
  }
  return message;
}

export interface ExecOptions {
  client: AgentClient;
  prompt: string;
  projectPath: string;
  mode: RunRequest['mode'];
  thinking?: RunRequest['thinkingMode'];
  model?: string;
  /** Resume an existing conversation instead of starting a new one. */
  conversationId?: string;
  /** `json` emits JSONL events; `quiet` prints only the final answer. */
  output: 'quiet' | 'json';
  /** Headless default: auto-deny approvals (safe for CI). */
  autoApprove: boolean;
}

/**
 * Headless one-shot execution (`joker exec "<task>"`), the scripting/CI
 * counterpart of codex exec / grok headless mode.
 *
 * Exit code contract:
 *   0 = completed · 1 = error/no answer · 2 = approval required but not
 *   approvable (auto-denied or non-interactive stdin)
 */
export async function runExec(options: ExecOptions): Promise<number> {
  const renderer: EventRenderer =
    options.output === 'json' ? new JsonlRenderer() : new QuietRenderer();

  const approver: Approver = async (approval) => {
    if (!options.autoApprove || !process.stdin.isTTY) {
      if (options.output === 'quiet') {
        process.stderr.write(
          paint('33', `approval required but auto-approve is off; denied: ${approval.toolCall.name}\n`)
        );
      }
      return false;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      process.stderr.write(
        `\n${paint('33', `⚠ approval (${approval.risk}): ${approval.toolCall.name}`)}\n`
      );
      const answer = (await rl.question('Allow? [y/N] ')).trim().toLowerCase();
      return answer === 'y' || answer === 'yes';
    } finally {
      rl.close();
    }
  };

  const outcomeBox: { value: 'completed' | 'error' } = { value: 'completed' };
  const wrappedRenderer = {
    onEvent(event: Parameters<EventRenderer['onEvent']>[0]): void {
      if (event.type === 'error') {
        outcomeBox.value = 'error';
        renderer.onEvent({ ...event, message: humanizeError(event.message) });
        return;
      }
      renderer.onEvent(event);
    }
  };

  await runTurn(options.client, approver, wrappedRenderer, {
    prompt: options.prompt,
    conversationId: options.conversationId,
    mode: options.mode,
    thinkingMode: options.thinking,
    model: options.model,
    projectPath: options.projectPath
  });

  if (outcomeBox.value === 'error') return 1;
  if (!renderer.finalAnswer) {
    // The turn ended without a final answer (e.g. every approval was denied).
    return 2;
  }
  return 0;
}
