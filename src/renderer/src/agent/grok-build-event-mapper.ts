/**
 * Maps GrokBuildEvent (from grok-build ACP runtime) to ThreadEventSink events
 * that the chat store understands. This is the bridge between grok-build's
 * streaming event model and Rcode's SSE-based event model.
 */
import type { GrokBuildEvent } from '@shared/Rcode-gui-api'
import type {
  ThreadDeltaEvent,
  ToolEventPayload,
  ThreadUsageSnapshot
} from './types'

// ---------------------------------------------------------------------------
// Local state for a single streaming turn
// ---------------------------------------------------------------------------

export interface GrokBuildTurnState {
  turnId: string
  userMessageItemId: string
  threadId: string
  text: string
  toolCalls: Map<string, GrokBuildToolState>
  seq: number
  startTime: number
  inputTokens: number
  outputTokens: number
}

export interface GrokBuildToolState {
  toolCallId: string
  toolName: string
  toolInput: unknown
  status: 'running' | 'success' | 'error'
  output?: string
}

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

/**
 * Convert a GrokBuildEvent to zero or more actions that can be dispatched
 * to a ThreadEventSink. Returns an array because some grok events may
 * produce multiple sink events (e.g. tool-call with output).
 */
export function mapGrokBuildEvent(
  event: GrokBuildEvent,
  turn: GrokBuildTurnState
): GrokBuildMappedAction[] {
  switch (event.type) {
    case 'text-chunk':
      return mapTextChunk(event, turn)
    case 'tool-call':
      return mapToolCall(event, turn)
    case 'tool-output':
      return mapToolOutput(event, turn)
    case 'turn-complete':
      return mapTurnComplete(event, turn)
    case 'error':
      return mapError(event)
    case 'status':
      return mapStatus(event)
    default:
      return []
  }
}

export type GrokBuildMappedAction =
  | { kind: 'delta'; delta: ThreadDeltaEvent }
  | { kind: 'tool'; payload: ToolEventPayload }
  | { kind: 'seq'; seq: number }
  | { kind: 'turn_complete' }
  | { kind: 'usage'; usage: ThreadUsageSnapshot }
  | { kind: 'error'; message: string; code?: string }

// ---------------------------------------------------------------------------
// Individual event mappers
// ---------------------------------------------------------------------------

function mapTextChunk(
  event: Extract<GrokBuildEvent, { type: 'text-chunk' }>,
  turn: GrokBuildTurnState
): GrokBuildMappedAction[] {
  turn.text += event.text
  turn.seq += 1
  return [
    { kind: 'seq', seq: turn.seq },
    {
      kind: 'delta',
      delta: { text: event.text, kind: 'agent_message', seq: turn.seq }
    }
  ]
}

function mapToolCall(
  event: Extract<GrokBuildEvent, { type: 'tool-call' }>,
  turn: GrokBuildTurnState
): GrokBuildMappedAction[] {
  const existing = turn.toolCalls.get(event.toolCallId)
  const status = mapToolStatus(event.status)

  turn.toolCalls.set(event.toolCallId, {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    toolInput: event.toolInput,
    status,
    output: existing?.output
  })

  turn.seq += 1
  const actions: GrokBuildMappedAction[] = [
    { kind: 'seq', seq: turn.seq },
    {
      kind: 'tool',
      payload: {
        itemId: event.toolCallId,
        summary: `${event.toolName}(${summarizeToolInput(event.toolInput)})`,
        status,
        toolKind: 'tool_call',
        detail: typeof event.toolInput === 'string' ? event.toolInput : undefined,
        meta: {
          toolName: event.toolName,
          toolInput: event.toolInput
        }
      }
    }
  ]

  return actions
}

function mapToolOutput(
  event: Extract<GrokBuildEvent, { type: 'tool-output' }>,
  turn: GrokBuildTurnState
): GrokBuildMappedAction[] {
  const existing = turn.toolCalls.get(event.toolCallId)
  if (existing) {
    existing.output = event.output
    existing.status = 'success'
  }

  turn.seq += 1
  return [
    { kind: 'seq', seq: turn.seq },
    {
      kind: 'tool',
      payload: {
        itemId: event.toolCallId,
        summary: existing?.toolName ?? 'tool',
        status: 'success',
        toolKind: 'tool_call',
        detail: truncateOutput(event.output),
        meta: {
          toolName: existing?.toolName,
          toolOutput: event.output
        }
      }
    }
  ]
}

function mapTurnComplete(
  event: Extract<GrokBuildEvent, { type: 'turn-complete' }>,
  turn: GrokBuildTurnState
): GrokBuildMappedAction[] {
  turn.seq += 1
  const actions: GrokBuildMappedAction[] = [
    { kind: 'seq', seq: turn.seq },
    { kind: 'turn_complete' }
  ]

  if (event.usage) {
    turn.inputTokens = event.usage.inputTokens
    turn.outputTokens = event.usage.outputTokens
    actions.push({
      kind: 'usage',
      usage: {
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        reasoningTokens: 0,
        cachedTokens: 0,
        cacheMissTokens: 0,
        cacheHitRate: null,
        totalTokens: event.usage.inputTokens + event.usage.outputTokens,
        costUsd: 0,
        costCny: null
      }
    })
  }

  return actions
}

function mapError(
  event: Extract<GrokBuildEvent, { type: 'error' }>
): GrokBuildMappedAction[] {
  return [{ kind: 'error', message: event.message, code: event.code }]
}

function mapStatus(
  _event: Extract<GrokBuildEvent, { type: 'status' }>
): GrokBuildMappedAction[] {
  // Status events are informational and don't map to UI events directly
  return []
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapToolStatus(status: string): ToolEventPayload['status'] {
  switch (status) {
    case 'running':
    case 'pending':
      return 'running'
    case 'completed':
      return 'success'
    case 'error':
      return 'error'
    default:
      return 'running'
  }
}

function summarizeToolInput(input: unknown): string {
  if (typeof input === 'string') {
    return input.length > 80 ? input.slice(0, 80) + '...' : input
  }
  if (input && typeof input === 'object') {
    try {
      const s = JSON.stringify(input)
      return s.length > 80 ? s.slice(0, 80) + '...' : s
    } catch {
      return '...'
    }
  }
  return String(input ?? '')
}

function truncateOutput(output: string): string {
  return output.length > 500 ? output.slice(0, 500) + '...' : output
}