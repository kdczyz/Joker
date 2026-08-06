/**
 * Rcode HTTP endpoint path templates. The renderer and the main
 * process IPC allow-list both derive their paths from this table, so
 * adding a new endpoint is a one-file change.
 *
 * `*TEMPLATE` constants carry the `{id}` / `{turn}` placeholders
 * literally. `*PATH(...)` builders perform the URL encoding and
 * return a concrete path for runtime use.
 */

export const RCODE_HEALTH_PATH = '/health'
export const RCODE_HEALTH_TEMPLATE = '/health'

export const RCODE_RUNTIME_INFO_PATH = '/v1/runtime/info'
export const RCODE_RUNTIME_INFO_TEMPLATE = '/v1/runtime/info'

export const RCODE_RUNTIME_TOOLS_PATH = '/v1/runtime/tools'
export const RCODE_RUNTIME_TOOLS_TEMPLATE = '/v1/runtime/tools'

export const RCODE_SUPPLY_CHAIN_AUDIT_PATH = '/v1/supply-chain/audit'
export const RCODE_SUPPLY_CHAIN_AUDIT_TEMPLATE = '/v1/supply-chain/audit'
export const RCODE_SUPPLY_CHAIN_UPDATE_CHECK_PATH = '/v1/supply-chain/update-check'
export const RCODE_SUPPLY_CHAIN_UPDATE_CHECK_TEMPLATE = '/v1/supply-chain/update-check'

export const RCODE_MCP_OAUTH_PATH = '/v1/mcp/oauth'
export const RCODE_MCP_OAUTH_TEMPLATE = '/v1/mcp/oauth'
export const RCODE_MCP_OAUTH_SERVER_TEMPLATE = '/v1/mcp/oauth/{id}'
export function RcodeMcpOAuthServerPath(serverId: string): string {
  return `/v1/mcp/oauth/${encodeURIComponent(serverId)}`
}

export const RCODE_SKILLS_PATH = '/v1/skills'
export const RCODE_SKILLS_TEMPLATE = '/v1/skills'

export const RCODE_ATTACHMENTS_PATH = '/v1/attachments'
export const RCODE_ATTACHMENTS_TEMPLATE = '/v1/attachments'
export const RCODE_ATTACHMENT_DIAGNOSTICS_PATH = '/v1/attachments/diagnostics'
export const RCODE_ATTACHMENT_DIAGNOSTICS_TEMPLATE = '/v1/attachments/diagnostics'
export const RCODE_ATTACHMENT_TEMPLATE = '/v1/attachments/{id}'
export function RcodeAttachmentPath(attachmentId: string): string {
  return `/v1/attachments/${encodeURIComponent(attachmentId)}`
}
export const RCODE_ATTACHMENT_CONTENT_TEMPLATE = '/v1/attachments/{id}/content'
export function RcodeAttachmentContentPath(attachmentId: string): string {
  return `${RcodeAttachmentPath(attachmentId)}/content`
}

export const RCODE_MEMORY_PATH = '/v1/memory'
export const RCODE_MEMORY_TEMPLATE = '/v1/memory'
export const RCODE_MEMORY_DIAGNOSTICS_PATH = '/v1/memory/diagnostics'
export const RCODE_MEMORY_DIAGNOSTICS_TEMPLATE = '/v1/memory/diagnostics'
export const RCODE_MEMORY_RECORD_TEMPLATE = '/v1/memory/{id}'
export function RcodeMemoryRecordPath(memoryId: string): string {
  return `/v1/memory/${encodeURIComponent(memoryId)}`
}

export const RCODE_THREADS_PATH = '/v1/threads'
export const RCODE_THREADS_TEMPLATE = '/v1/threads'

export const RCODE_THREAD_TEMPLATE = '/v1/threads/{id}'
export function RcodeThreadPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}`
}

export const RCODE_THREAD_FORK_TEMPLATE = '/v1/threads/{id}/fork'
export function RcodeThreadForkPath(threadId: string): string {
  return `${RcodeThreadPath(threadId)}/fork`
}

export const RCODE_THREAD_GOAL_TEMPLATE = '/v1/threads/{id}/goal'
export function RcodeThreadGoalPath(threadId: string): string {
  return `${RcodeThreadPath(threadId)}/goal`
}

export const RCODE_THREAD_TODOS_TEMPLATE = '/v1/threads/{id}/todos'
export function RcodeThreadTodosPath(threadId: string): string {
  return `${RcodeThreadPath(threadId)}/todos`
}

export const RCODE_THREAD_COMPACT_TEMPLATE = '/v1/threads/{id}/compact'
export function RcodeThreadCompactPath(threadId: string): string {
  return `${RcodeThreadPath(threadId)}/compact`
}

export const RCODE_THREAD_REVIEW_TEMPLATE = '/v1/threads/{id}/review'
export function RcodeThreadReviewPath(threadId: string): string {
  return `${RcodeThreadPath(threadId)}/review`
}

export const RCODE_THREAD_REWIND_TEMPLATE = '/v1/threads/{id}/rewind'
export function RcodeThreadRewindPath(threadId: string): string {
  return `${RcodeThreadPath(threadId)}/rewind`
}

export const RCODE_THREAD_TURNS_TEMPLATE = '/v1/threads/{id}/turns'
export function RcodeThreadTurnsPath(threadId: string): string {
  return `${RcodeThreadPath(threadId)}/turns`
}

export const RCODE_THREAD_TURN_TEMPLATE = '/v1/threads/{id}/turns/{turn}'
export function RcodeThreadTurnPath(threadId: string, turnId: string): string {
  return `${RcodeThreadTurnsPath(threadId)}/${encodeURIComponent(turnId)}`
}

export const RCODE_THREAD_STEER_TEMPLATE = '/v1/threads/{id}/turns/{turn}/steer'
export function RcodeThreadSteerPath(threadId: string, turnId: string): string {
  return `${RcodeThreadTurnPath(threadId, turnId)}/steer`
}

export const RCODE_THREAD_INTERRUPT_TEMPLATE = '/v1/threads/{id}/turns/{turn}/interrupt'
export function RcodeThreadInterruptPath(threadId: string, turnId: string): string {
  return `${RcodeThreadTurnPath(threadId, turnId)}/interrupt`
}

export const RCODE_THREAD_EVENTS_TEMPLATE = '/v1/threads/{id}/events'
export function RcodeThreadEventsPath(threadId: string): string {
  return `${RcodeThreadPath(threadId)}/events`
}

export const RCODE_APPROVAL_TEMPLATE = '/v1/approvals/{id}'
export function RcodeApprovalPath(approvalId: string): string {
  return `/v1/approvals/${encodeURIComponent(approvalId)}`
}

export const RCODE_USER_INPUT_TEMPLATE = '/v1/user-inputs/{id}'
export function RcodeUserInputPath(inputId: string): string {
  return `/v1/user-inputs/${encodeURIComponent(inputId)}`
}

export const RCODE_SESSION_RESUME_TEMPLATE = '/v1/sessions/{id}/resume-thread'
export function RcodeSessionResumePath(sessionId: string): string {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/resume-thread`
}

export const RCODE_USAGE_PATH = '/v1/usage'
export const RCODE_USAGE_TEMPLATE = '/v1/usage'

export const RCODE_DEBUG_LLM_ROUNDS_PATH = '/v1/debug/llm-rounds'
export const RCODE_DEBUG_LLM_ROUNDS_TEMPLATE = '/v1/debug/llm-rounds'

export const RCODE_BACKGROUND_SHELLS_PATH = '/v1/background-shells'
export const RCODE_BACKGROUND_SHELLS_TEMPLATE = '/v1/background-shells'
export const RCODE_BACKGROUND_SHELL_TEMPLATE = '/v1/background-shells/{sessionId}'
export function RcodeBackgroundShellPath(sessionId: string): string {
  return `/v1/background-shells/${encodeURIComponent(sessionId)}`
}
export function RcodeBackgroundShellStopPath(sessionId: string): string {
  return `${RcodeBackgroundShellPath(sessionId)}/stop`
}

/** Thread mode shared with the Rcode contract. */
export type RcodeThreadMode = 'agent' | 'plan'

const THREAD_MODES: ReadonlySet<RcodeThreadMode> = new Set<RcodeThreadMode>(['agent', 'plan'])

export function isRcodeThreadMode(value: unknown): value is RcodeThreadMode {
  return typeof value === 'string' && (THREAD_MODES as Set<string>).has(value)
}

export function normalizeThreadMode(value: unknown): RcodeThreadMode {
  return value === 'plan' ? 'plan' : 'agent'
}
