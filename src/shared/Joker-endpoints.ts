/**
 * Joker HTTP endpoint path templates. The renderer and the main
 * process IPC allow-list both derive their paths from this table, so
 * adding a new endpoint is a one-file change.
 *
 * `*TEMPLATE` constants carry the `{id}` / `{turn}` placeholders
 * literally. `*PATH(...)` builders perform the URL encoding and
 * return a concrete path for runtime use.
 */

export const JOKER_HEALTH_PATH = '/health'
export const JOKER_HEALTH_TEMPLATE = '/health'

export const JOKER_RUNTIME_INFO_PATH = '/v1/runtime/info'
export const JOKER_RUNTIME_INFO_TEMPLATE = '/v1/runtime/info'

export const JOKER_RUNTIME_TOOLS_PATH = '/v1/runtime/tools'
export const JOKER_RUNTIME_TOOLS_TEMPLATE = '/v1/runtime/tools'

export const JOKER_SUPPLY_CHAIN_AUDIT_PATH = '/v1/supply-chain/audit'
export const JOKER_SUPPLY_CHAIN_AUDIT_TEMPLATE = '/v1/supply-chain/audit'
export const JOKER_SUPPLY_CHAIN_UPDATE_CHECK_PATH = '/v1/supply-chain/update-check'
export const JOKER_SUPPLY_CHAIN_UPDATE_CHECK_TEMPLATE = '/v1/supply-chain/update-check'

export const JOKER_MCP_OAUTH_PATH = '/v1/mcp/oauth'
export const JOKER_MCP_OAUTH_TEMPLATE = '/v1/mcp/oauth'
export const JOKER_MCP_OAUTH_SERVER_TEMPLATE = '/v1/mcp/oauth/{id}'
export function JokerMcpOAuthServerPath(serverId: string): string {
  return `/v1/mcp/oauth/${encodeURIComponent(serverId)}`
}

export const JOKER_SKILLS_PATH = '/v1/skills'
export const JOKER_SKILLS_TEMPLATE = '/v1/skills'

export const JOKER_ATTACHMENTS_PATH = '/v1/attachments'
export const JOKER_ATTACHMENTS_TEMPLATE = '/v1/attachments'
export const JOKER_ATTACHMENT_DIAGNOSTICS_PATH = '/v1/attachments/diagnostics'
export const JOKER_ATTACHMENT_DIAGNOSTICS_TEMPLATE = '/v1/attachments/diagnostics'
export const JOKER_ATTACHMENT_TEMPLATE = '/v1/attachments/{id}'
export function JokerAttachmentPath(attachmentId: string): string {
  return `/v1/attachments/${encodeURIComponent(attachmentId)}`
}
export const JOKER_ATTACHMENT_CONTENT_TEMPLATE = '/v1/attachments/{id}/content'
export function JokerAttachmentContentPath(attachmentId: string): string {
  return `${JokerAttachmentPath(attachmentId)}/content`
}

export const JOKER_MEMORY_PATH = '/v1/memory'
export const JOKER_MEMORY_TEMPLATE = '/v1/memory'
export const JOKER_MEMORY_DIAGNOSTICS_PATH = '/v1/memory/diagnostics'
export const JOKER_MEMORY_DIAGNOSTICS_TEMPLATE = '/v1/memory/diagnostics'
export const JOKER_MEMORY_RECORD_TEMPLATE = '/v1/memory/{id}'
export function JokerMemoryRecordPath(memoryId: string): string {
  return `/v1/memory/${encodeURIComponent(memoryId)}`
}

export const JOKER_THREADS_PATH = '/v1/threads'
export const JOKER_THREADS_TEMPLATE = '/v1/threads'

export const JOKER_THREAD_TEMPLATE = '/v1/threads/{id}'
export function JokerThreadPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}`
}

export const JOKER_THREAD_FORK_TEMPLATE = '/v1/threads/{id}/fork'
export function JokerThreadForkPath(threadId: string): string {
  return `${JokerThreadPath(threadId)}/fork`
}

export const JOKER_THREAD_GOAL_TEMPLATE = '/v1/threads/{id}/goal'
export function JokerThreadGoalPath(threadId: string): string {
  return `${JokerThreadPath(threadId)}/goal`
}

export const JOKER_THREAD_TODOS_TEMPLATE = '/v1/threads/{id}/todos'
export function JokerThreadTodosPath(threadId: string): string {
  return `${JokerThreadPath(threadId)}/todos`
}

export const JOKER_THREAD_COMPACT_TEMPLATE = '/v1/threads/{id}/compact'
export function JokerThreadCompactPath(threadId: string): string {
  return `${JokerThreadPath(threadId)}/compact`
}

export const JOKER_THREAD_REVIEW_TEMPLATE = '/v1/threads/{id}/review'
export function JokerThreadReviewPath(threadId: string): string {
  return `${JokerThreadPath(threadId)}/review`
}

export const JOKER_THREAD_REWIND_TEMPLATE = '/v1/threads/{id}/rewind'
export function JokerThreadRewindPath(threadId: string): string {
  return `${JokerThreadPath(threadId)}/rewind`
}

export const JOKER_THREAD_TURNS_TEMPLATE = '/v1/threads/{id}/turns'
export function JokerThreadTurnsPath(threadId: string): string {
  return `${JokerThreadPath(threadId)}/turns`
}

export const JOKER_THREAD_TURN_TEMPLATE = '/v1/threads/{id}/turns/{turn}'
export function JokerThreadTurnPath(threadId: string, turnId: string): string {
  return `${JokerThreadTurnsPath(threadId)}/${encodeURIComponent(turnId)}`
}

export const JOKER_THREAD_STEER_TEMPLATE = '/v1/threads/{id}/turns/{turn}/steer'
export function JokerThreadSteerPath(threadId: string, turnId: string): string {
  return `${JokerThreadTurnPath(threadId, turnId)}/steer`
}

export const JOKER_THREAD_INTERRUPT_TEMPLATE = '/v1/threads/{id}/turns/{turn}/interrupt'
export function JokerThreadInterruptPath(threadId: string, turnId: string): string {
  return `${JokerThreadTurnPath(threadId, turnId)}/interrupt`
}

export const JOKER_THREAD_EVENTS_TEMPLATE = '/v1/threads/{id}/events'
export function JokerThreadEventsPath(threadId: string): string {
  return `${JokerThreadPath(threadId)}/events`
}

export const JOKER_APPROVAL_TEMPLATE = '/v1/approvals/{id}'
export function JokerApprovalPath(approvalId: string): string {
  return `/v1/approvals/${encodeURIComponent(approvalId)}`
}

export const JOKER_USER_INPUT_TEMPLATE = '/v1/user-inputs/{id}'
export function JokerUserInputPath(inputId: string): string {
  return `/v1/user-inputs/${encodeURIComponent(inputId)}`
}

export const JOKER_SESSION_RESUME_TEMPLATE = '/v1/sessions/{id}/resume-thread'
export function JokerSessionResumePath(sessionId: string): string {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/resume-thread`
}

export const JOKER_USAGE_PATH = '/v1/usage'
export const JOKER_USAGE_TEMPLATE = '/v1/usage'

export const JOKER_DEBUG_LLM_ROUNDS_PATH = '/v1/debug/llm-rounds'
export const JOKER_DEBUG_LLM_ROUNDS_TEMPLATE = '/v1/debug/llm-rounds'

export const JOKER_BACKGROUND_SHELLS_PATH = '/v1/background-shells'
export const JOKER_BACKGROUND_SHELLS_TEMPLATE = '/v1/background-shells'
export const JOKER_BACKGROUND_SHELL_TEMPLATE = '/v1/background-shells/{sessionId}'
export function JokerBackgroundShellPath(sessionId: string): string {
  return `/v1/background-shells/${encodeURIComponent(sessionId)}`
}
export function JokerBackgroundShellStopPath(sessionId: string): string {
  return `${JokerBackgroundShellPath(sessionId)}/stop`
}

/** Thread mode shared with the Joker contract. */
export type JokerThreadMode = 'agent' | 'plan'

const THREAD_MODES: ReadonlySet<JokerThreadMode> = new Set<JokerThreadMode>(['agent', 'plan'])

export function isJokerThreadMode(value: unknown): value is JokerThreadMode {
  return typeof value === 'string' && (THREAD_MODES as Set<string>).has(value)
}

export function normalizeThreadMode(value: unknown): JokerThreadMode {
  return value === 'plan' ? 'plan' : 'agent'
}
