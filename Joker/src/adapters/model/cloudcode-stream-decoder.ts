import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import {
  ModelStreamResourceBudget,
  type PendingToolCall
} from './model-stream-resource-budget.js'

export type CloudCodeStreamDecodeResult = {
  chunks: ModelStreamChunk[]
  sawTextDelta: boolean
  finishReason: string | null
  usage: UsageSnapshot | null
}

/**
 * Decodes a single SSE payload from Cloud Code Assist
 * (`cloudcode-pa.googleapis.com/v1internal:streamGenerateContent`) into
 * Joker model stream chunks. The wire format is Gemini-style: a
 * `candidates[]` array whose `content.parts[]` carry incremental text
 * deltas, `thought` markers for reasoning, and `functionCall` for tool use.
 */
export function decodeCloudCodeStreamPayload(input: {
  payload: Record<string, unknown>
  pendingArguments: Map<string, PendingToolCall>
  pendingByIndex: Map<number, string>
  completedToolCalls: Set<string>
  sawTextDelta: boolean
  budget: ModelStreamResourceBudget
  normalizeUsage: (usage: Record<string, unknown>) => UsageSnapshot
  parseToolArguments: (raw: string) => Record<string, unknown>
}): CloudCodeStreamDecodeResult {
  const chunks: ModelStreamChunk[] = []
  let sawText = input.sawTextDelta
  let finishReason: string | null = null
  let usage: UsageSnapshot | null = null

  // CloudCode wraps each SSE payload in a `response` object: the wire shape is
  // { "response": { "candidates": [...], "usageMetadata": {...} }, "traceId": ... }.
  // Fall back to the bare payload in case a deployment returns it unwrapped.
  const root = (input.payload.response as Record<string, unknown> | undefined) ?? input.payload
  const candidates = root.candidates as Array<Record<string, unknown>> | undefined
  const candidate = candidates?.[0]
  if (candidate && typeof candidate === 'object') {
    const content = candidate.content as Record<string, unknown> | undefined
    const parts = content?.parts as Array<Record<string, unknown>> | undefined
    for (const part of parts ?? []) {
      const text = part.text
      const thought = part.thought
      const functionCall = part.functionCall

      const thoughtText =
        typeof thought === 'string' && thought.length > 0
          ? thought
          : thought === true && typeof text === 'string' && text.length > 0
            ? text
            : undefined

      if (thoughtText) {
        chunks.push({ kind: 'assistant_reasoning_delta', text: thoughtText })
      } else if (typeof text === 'string' && text.length > 0) {
        sawText = true
        chunks.push({ kind: 'assistant_text_delta', text })
      }

      if (functionCall && typeof functionCall === 'object') {
        const fc = functionCall as Record<string, unknown>
        const name = (typeof fc.name === 'string' ? fc.name : '').replace(/__/g, ':')
        const callId = `call_${input.pendingArguments.size + 1}`
        if (!input.completedToolCalls.has(callId)) {
          input.completedToolCalls.add(callId)
          const pending = input.budget.pendingCall(input.pendingArguments, callId, undefined)
          if (name) pending.name = name
          // CloudCode returns the complete functionCall in a single part (not
          // incremental argument deltas). Emit the complete call directly
          // so the collector surfaces a tool_call_ready intent.
          chunks.push({
            kind: 'tool_call_complete',
            callId,
            toolName: name,
            arguments: input.parseToolArguments(JSON.stringify(fc.args ?? {}))
          })
        }
        finishReason = 'tool_calls'
      }
    }
    const reason = candidate.finishReason
    if (typeof reason === 'string') {
      const mapped = mapCloudCodeFinishReason(reason)
      if (finishReason !== 'tool_calls' || mapped !== 'stop') {
        finishReason = mapped
      }
    }
  }

  const usageMeta = root.usageMetadata as Record<string, unknown> | undefined
  if (usageMeta) {
    usage = input.normalizeUsage({
      prompt_tokens: usageMeta.promptTokenCount,
      completion_tokens: usageMeta.candidatesTokenCount,
      total_tokens: usageMeta.totalTokenCount
    })
    if (finishReason === null) finishReason = 'stop'
  }

  return { chunks, sawTextDelta: sawText, finishReason, usage }
}

function mapCloudCodeFinishReason(reason: string): string {
  switch (reason) {
    case 'STOP':
      return 'stop'
    case 'MAX_TOKENS':
      return 'length'
    case 'TOOL_CALLS':
    case 'FUNCTION_CALL':
      return 'tool_calls'
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
      return 'content_filter'
    default:
      return reason.toLowerCase()
  }
}
