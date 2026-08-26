/** Stream events emitted by `POST /api/agent/run` and `/api/agent/approve`. */
export type StreamEvent =
  | { type: 'run_started'; conversationId: string }
  | { type: 'workflow_state'; phase: string; label: string }
  | { type: 'task_plan'; plan: { steps?: Array<{ title?: string; status?: string }> } }
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | {
      type: 'billing_usage';
      usage: {
        rawInputTokens: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cachedTokens?: number;
        cacheReadTokens?: number;
      };
      model: string;
      provider: string;
    }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'permission_decision'; toolCallId: string; effect: 'allow' | 'ask' | 'deny'; reason: string }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'subagent_update'; run: { id: string; label?: string; status?: string } }
  | { type: 'diff_created'; diffs: DiffResult[] }
  | { type: 'approval_required'; conversationId: string; answer: string; approvals: PendingApproval[] }
  | { type: 'completed'; conversationId: string; answer: string }
  | { type: 'error'; conversationId: string; message: string };

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  content: string;
  summary?: string;
  exitCode?: number;
}

export interface DiffResult {
  filePath: string;
  addedLines: number;
  removedLines: number;
  lines: Array<{ type: 'same' | 'add' | 'remove'; content: string }>;
}

export interface PendingApproval {
  id: string;
  toolCall: ToolCall;
  reason: string;
  risk: 'low' | 'medium' | 'high';
}

export const PERMISSION_MODES = ['default', 'plan', 'workspace_write', 'full_access'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

export const THINKING_MODES = ['fast', 'balanced', 'deep'] as const;
export type ThinkingMode = (typeof THINKING_MODES)[number];

export function isThinkingMode(value: string): value is ThinkingMode {
  return (THINKING_MODES as readonly string[]).includes(value);
}
