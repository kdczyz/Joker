/**
 * Bidirectional adapter that wraps the Google Cloud Code Assist (Antigravity)
 * wire protocol as a standard OpenAI `/v1/chat/completions` endpoint.
 *
 * Inputs/outputs at the adapter boundary match the OpenAI shapes so a generic
 * OpenAI client can drive Antigravity without knowing the CloudCode specifics
 * (Gemini `contents[]`, `functionDeclarations`, `:streamGenerateContent`, etc.)
 * — the adapter handles message/schema/tool mapping plus SSE event framing.
 *
 * Usage:
 *   1. `openAiChatToCloudCodeBody()` converts an OpenAI request body into the
 *      CloudCode `{ model, request: { contents, systemInstruction, tools,
 *      generationConfig } }` shape posted to `:generateContent` or
 *      `:streamGenerateContent?alt=sse`.
 *   2. For non-streaming responses, `cloudCodeResponseToOpenAiChat()` rewrites
 *      the Gemini `candidates[].content.parts[]` output to
 *      `choices[].message.{content,tool_calls}` with matching usage metadata.
 *   3. For streaming SSE responses, `cloudCodeSseToOpenAiSse()` consumes a raw
 *      CloudCode SSE frame (the JSON payload after `data:`) and emits 0..N
 *      OpenAI-compatible SSE `data:` frames, ending with a synthetic `[DONE]`
 *      when the terminal CloudCode frame carries a finish reason.
 */

import { repairToolArguments } from './tool-argument-repair.js'

// ---------------------------------------------------------------------------
// JSON-Schema keys that CloudCode protobuf Schema rejects. Mirrors the
// constants used by compat-request-codecs so manual adapters stay in sync.
// ---------------------------------------------------------------------------
const CLOUDCODE_SCHEMA_DROPPED_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'additionalProperties',
  'strict',
  'title'
])
const NUMERIC_SCHEMA_KEYS = new Set([
  'maxLength',
  'minLength',
  'maxItems',
  'minItems',
  'maximum',
  'minimum'
])

// ---------------------------------------------------------------------------
// CloudCode model alias mapping — matches compat-request-codecs.
// ---------------------------------------------------------------------------
const CLOUDCODE_MODEL_ALIASES: Record<string, string> = {
  'gemini-3-pro': 'gemini-pro-agent',
  'gemini-2.5-pro': 'gemini-pro-agent',
  'gemini-2.5-flash': 'gemini-3-flash',
  'gemini-3-pro-high': 'gemini-pro-agent',
  'gemini-3-pro-low': 'gemini-pro-agent',
  'gemini-3-pro-medium': 'gemini-pro-agent',
  'gemini-3.1-pro': 'gemini-pro-agent',
  'gemini-3.1-pro-high': 'gemini-pro-agent',
  'gemini-3.1-pro-low': 'gemini-pro-agent',
  'gemini-3.1-pro-medium': 'gemini-pro-agent',
  'gemini-3-flash-agent': 'gemini-3-flash',
  'gemini-3.6-flash': 'gemini-3.7-flash-tiered',
  'gemini-3.6-flash-high': 'gemini-3.7-flash-tiered',
  'gemini-3.6-flash-medium': 'gemini-3.7-flash-tiered',
  'gemini-3.6-flash-low': 'gemini-3.7-flash-tiered',
  'gemini-3.7-flash': 'gemini-3.7-flash-tiered',
  'gemini-3.7-flash-high': 'gemini-3.7-flash-tiered',
  'gemini-3.7-flash-medium': 'gemini-3.7-flash-tiered',
  'gemini-3.7-flash-low': 'gemini-3.7-flash-tiered',
  'claude-sonnet-4-5-thinking': 'claude-sonnet-4-6'
}

function mapCloudCodeModel(model: string): string {
  return CLOUDCODE_MODEL_ALIASES[model] ?? model
}

// ---------------------------------------------------------------------------
// OpenAI request -> CloudCode request
// ---------------------------------------------------------------------------

type OpenAiChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content:
    | string
    | null
    | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >
  name?: string
  tool_call_id?: string
  reasoning_content?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

type OpenAiChatRequest = {
  model: string
  messages: OpenAiChatMessage[]
  stream?: boolean
  max_tokens?: number
  temperature?: number
  top_p?: number
  response_format?: { type: 'json_object' | 'text' }
  stream_options?: { include_usage?: boolean }
  reasoning_effort?: 'off' | 'low' | 'medium' | 'high' | 'max' | 'auto'
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: Record<string, unknown>
    }
  }>
}

type CloudCodeContentPart =
  | { text: string; thought?: boolean }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

type CloudCodeRequest = {
  model: string
  request: {
    contents: Array<{ role: 'user' | 'model'; parts: CloudCodeContentPart[] }>
    systemInstruction?: { parts: Array<{ text: string }> }
    generationConfig?: Record<string, unknown>
    tools?: Array<{ functionDeclarations: Array<Record<string, unknown>> }>
  }
}

function toCloudCodeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCloudCodeSchema)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$') || CLOUDCODE_SCHEMA_DROPPED_KEYS.has(key)) continue
    if (NUMERIC_SCHEMA_KEYS.has(key)) {
      if (typeof child === 'number' && Number.isFinite(child)) {
        out[key] = Math.floor(child)
        continue
      }
      if (typeof child === 'string') {
        const parsed = parseInt(child.trim(), 10)
        if (!Number.isNaN(parsed)) {
          out[key] = parsed
          continue
        }
      }
      continue
    }
    if (key === 'type' && typeof child === 'string') {
      out[key] = child.toUpperCase()
      continue
    }
    out[key] = toCloudCodeSchema(child)
  }
  if (Array.isArray(out.required)) {
    if (out.properties && typeof out.properties === 'object') {
      const validKeys = new Set(Object.keys(out.properties))
      out.required = (out.required as unknown[]).filter(
        (r) => typeof r === 'string' && validKeys.has(r)
      )
      if ((out.required as unknown[]).length === 0) delete out.required
    } else {
      delete out.required
    }
  }
  return out
}

function chatContentToTextOnly(
  content: OpenAiChatMessage['content']
): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function parseDataUri(value: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/is.exec(value)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

function geminiInlineData(value: string): { mimeType: string; data: string } | null {
  const data = parseDataUri(value)
  if (data) return { mimeType: data.mimeType, data: data.base64 }
  return null
}

/**
 * Convert an OpenAI `/v1/chat/completions` request body into the CloudCode
 * `:generateContent` / `:streamGenerateContent` request shape.
 *
 * The adapter mirrors the behaviour of `messagesToCloudCode` plus the
 * `cloudcode()` codec in compat-request-codecs, including the pre-scan for
 * tool-call id → name resolution so `functionResponse.name` is never empty.
 */
export function openAiChatToCloudCodeBody(input: OpenAiChatRequest): CloudCodeRequest {
  const system: string[] = []
  const contents: Array<{ role: 'user' | 'model'; parts: CloudCodeContentPart[] }> = []

  const appendTurn = (role: 'user' | 'model', parts: CloudCodeContentPart[]): void => {
    if (!parts.length) return
    const last = contents[contents.length - 1]
    if (last && last.role === role) {
      last.parts.push(...parts)
    } else {
      contents.push({ role, parts: [...parts] })
    }
  }

  if (input.reasoning_effort && input.reasoning_effort !== 'off') {
    system.push('Before taking action or responding, please think step-by-step and wrap your thinking process strictly inside <think> and </think> tags. Do not skip this step.');
  }

  const toolNameById = new Map<string, string>()
  for (const message of input.messages) {
    for (const call of message.tool_calls ?? []) {
      if (call.id) toolNameById.set(call.id, call.function.name)
    }
  }

  for (const message of input.messages) {
    if (message.role === 'system') {
      const text = chatContentToTextOnly(message.content).trim()
      if (text) system.push(text)
      continue
    }

    if (message.role === 'tool') {
      const name = message.tool_call_id
        ? (toolNameById.get(message.tool_call_id) || message.name || 'tool')
        : (message.name || 'tool')
      const raw = chatContentToTextOnly(message.content)
      let responseObj: Record<string, unknown>
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          responseObj = parsed as Record<string, unknown>
        } else {
          responseObj = { output: parsed }
        }
      } catch {
        responseObj = { output: raw }
      }
      appendTurn('user', [{ functionResponse: { name: name.replace(/:/g, '__'), response: responseObj } }])
      continue
    }

    const role = message.role === 'assistant' ? 'model' : 'user'
    const parts: CloudCodeContentPart[] = []

    if (
      message.role === 'assistant' &&
      typeof message.reasoning_content === 'string' &&
      message.reasoning_content.length > 0
    ) {
      parts.push({ text: message.reasoning_content, thought: true })
    }

    if (typeof message.content === 'string') {
      if (message.content) parts.push({ text: message.content })
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text') {
          if (part.text) parts.push({ text: part.text })
        } else if (part.type === 'image_url') {
          const inline = geminiInlineData(part.image_url.url)
          if (inline) parts.push({ inlineData: inline })
        }
      }
    }

    const toolCalls = message.tool_calls ?? []
    for (let index = 0; index < toolCalls.length; index++) {
      const call = toolCalls[index]
      const functionCallPart: CloudCodeContentPart & { functionCall: unknown; thoughtSignature?: string } = {
        functionCall: {
          name: call.function.name,
          args: repairToolArguments(call.function.arguments).arguments
        }
      }
      if (index === 0) {
        functionCallPart.thoughtSignature = 'skip_thought_signature_validator'
      }
      parts.push(functionCallPart)
    }

    appendTurn(role, parts)
  }

  const generationConfig: Record<string, unknown> = {}
  if (input.max_tokens !== undefined) generationConfig.maxOutputTokens = input.max_tokens
  if (input.temperature !== undefined) generationConfig.temperature = input.temperature
  if (input.top_p !== undefined) generationConfig.topP = input.top_p

  const effort = input.reasoning_effort
  if (effort && effort !== 'off' && effort !== 'auto') {
    const thinkingConfig: Record<string, unknown> = { includeThoughts: true }
    if (effort === 'low') thinkingConfig.thinkingBudget = 1024
    else if (effort === 'medium') thinkingConfig.thinkingBudget = 4096
    else if (effort === 'high' || effort === 'max') thinkingConfig.thinkingBudget = 8192
    generationConfig.thinkingConfig = thinkingConfig
  }

  const request: CloudCodeRequest['request'] = { contents }
  if (Object.keys(generationConfig).length) request.generationConfig = generationConfig
  if (system.join('\n\n').trim()) {
    request.systemInstruction = { parts: [{ text: system.join('\n\n') }] }
  }
  if (input.tools && input.tools.length) {
    request.tools = [
      {
        functionDeclarations: input.tools.map((tool) => ({
          name: tool.function.name.replace(/:/g, "__"),
          description: tool.function.description ?? '',
          parameters: toCloudCodeSchema(tool.function.parameters) as Record<string, unknown>
        }))
      }
    ]
  }

  return {
    model: mapCloudCodeModel(input.model),
    request
  }
}

// ---------------------------------------------------------------------------
// CloudCode response -> OpenAI response (non-streaming)
// ---------------------------------------------------------------------------

type CloudCodeCandidate = {
  content?: { parts?: Array<Record<string, unknown>> }
  finishReason?: string
}

type CloudCodeUsageMeta = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

type CloudCodeNonStreamResponse = {
  response?: {
    candidates?: CloudCodeCandidate[]
    usageMetadata?: CloudCodeUsageMeta
  }
  candidates?: CloudCodeCandidate[]
  usageMetadata?: CloudCodeUsageMeta
}

type OpenAiToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OpenAiChoice = {
  index: number
  finish_reason: string
  message: {
    role: 'assistant'
    content: string | null
    reasoning_content?: string
    tool_calls?: OpenAiToolCall[]
  }
}

type OpenAiUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

type OpenAiChatResponse = {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: OpenAiChoice[]
  usage: OpenAiUsage
}

function mapCloudCodeFinishReason(reason: string | undefined): string {
  if (!reason) return 'stop'
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

/**
 * Convert a non-streaming CloudCode `:generateContent` response into the
 * standard OpenAI `/v1/chat/completions` response shape.
 *
 * The input payload may be either wrapped (`{ response: { candidates, ... } }`)
 * as produced by `:streamGenerateContent` SSE or unwrapped as returned by
 * `:generateContent` directly — the adapter accepts both.
 */
export function cloudCodeResponseToOpenAiChat(
  input: CloudCodeNonStreamResponse,
  options: { model: string; id?: string; created?: number }
): OpenAiChatResponse {
  const root = input.response ?? input
  const candidates = root.candidates ?? []
  const choices: OpenAiChoice[] = candidates.map((candidate, idx) => {
    const parts = candidate.content?.parts ?? []
    let content = ''
    let reasoning = ''
    const toolCalls: OpenAiToolCall[] = []
    for (const part of parts) {
      const text = typeof part.text === 'string' ? part.text : ''
      const isThought =
        typeof part.thought === 'string'
          ? !!part.thought
          : part.thought === true
      if (isThought && text) {
        reasoning += text
      } else if (text) {
        content += text
      }
      if (part.functionCall && typeof part.functionCall === 'object') {
        const fc = part.functionCall as Record<string, unknown>
        const name = (typeof fc.name === 'string' ? fc.name : '').replace(/__/g, ':')
        const callId = `call_${toolCalls.length + 1}`
        toolCalls.push({
          id: callId,
          type: 'function',
          function: {
            name,
            arguments: JSON.stringify(fc.args ?? {})
          }
        })
      }
    }
    const message: OpenAiChoice['message'] = {
      role: 'assistant',
      content: content.length ? content : null
    }
    if (reasoning.length) message.reasoning_content = reasoning
    if (toolCalls.length) message.tool_calls = toolCalls
    const finishReason = toolCalls.length
      ? 'tool_calls'
      : mapCloudCodeFinishReason(candidate.finishReason)
    return {
      index: idx,
      finish_reason: finishReason,
      message
    }
  })
  if (choices.length === 0) {
    choices.push({
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: null }
    })
  }
  const usageMeta = root.usageMetadata
  const usage: OpenAiUsage = {
    prompt_tokens: Number(usageMeta?.promptTokenCount ?? 0),
    completion_tokens: Number(usageMeta?.candidatesTokenCount ?? 0),
    total_tokens: Number(usageMeta?.totalTokenCount ?? 0)
  }
  return {
    id: options.id ?? `chatcmpl-${Math.random().toString(36).slice(2, 11)}`,
    object: 'chat.completion',
    created: options.created ?? Math.floor(Date.now() / 1000),
    model: options.model,
    choices,
    usage
  }
}

// ---------------------------------------------------------------------------
// CloudCode SSE -> OpenAI SSE  (streaming)
// ---------------------------------------------------------------------------

export type OpenAiSseFrame = {
  /** Raw data string to place after the `data:` prefix (no trailing newline). */
  data: string
  /** When true, the consumer should emit the synthetic `data: [DONE]` frame. */
  done?: boolean
}

type StreamFrameContext = {
  // Monotonic counters for stable, reproducible IDs across chunks.
  toolCallIndex: number
  /** Index of the next `choices[].delta.tool_calls[]` entry. */
  nextToolCallDeltaIndex: number
  /** Set to true once any non-empty text delta has been emitted. */
  sawTextDelta: boolean
  /** Set to true once we emit the terminal frame (finish_reason or usage). */
  emittedTerminal: boolean
  /** OpenAI usage block — only emitted on the last frame when `stream_options.include_usage` was true. */
  includeUsage: boolean
}

export function createCloudCodeStreamContext(options: { includeUsage?: boolean } = {}): StreamFrameContext {
  return {
    toolCallIndex: 0,
    nextToolCallDeltaIndex: 0,
    sawTextDelta: false,
    emittedTerminal: false,
    includeUsage: options.includeUsage ?? false
  }
}

/**
 * Convert a single CloudCode SSE payload (the decoded JSON after `data:`) into
 * one or more OpenAI `/v1/chat/completions` SSE payloads.
 *
 * Callers are expected to:
 *   1. Create a context with `createCloudCodeStreamContext()` before the stream.
 *   2. For each SSE `data:` line, parse JSON and pass it into this function.
 *   3. For every returned `OpenAiSseFrame`, emit `data: ${frame.data}\n\n`.
 *   4. When a frame has `done: true`, additionally emit `data: [DONE]\n\n`
 *      after the frame's own payload (the adapter does not inline `[DONE]`).
 */
export function cloudCodeSseToOpenAiSse(
  payload: Record<string, unknown>,
  ctx: StreamFrameContext,
  options: { model: string; id?: string; created?: number }
): OpenAiSseFrame[] {
  const frames: OpenAiSseFrame[] = []
  const id = options.id ?? `chatcmpl-${Math.random().toString(36).slice(2, 11)}`
  const created = options.created ?? Math.floor(Date.now() / 1000)
  const model = options.model

  // CloudCode wraps in `response`; accept both shapes.
  const root = (payload.response as Record<string, unknown> | undefined) ?? payload
  const payloadError = payload.error ?? (root && typeof root === 'object' ? (root as Record<string, unknown>).error : undefined)
  if (payloadError) {
    const message =
      typeof payloadError === 'string'
        ? payloadError
        : payloadError && typeof payloadError === 'object'
          ? String((payloadError as Record<string, unknown>).message ?? JSON.stringify(payloadError))
          : 'model error'
    frames.push({
      data: JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: 'error'
        }],
        error: { message, code: 'model_error' }
      })
    })
    frames.push({ data: '', done: true })
    return frames
  }

  const candidates = root.candidates as Array<Record<string, unknown>> | undefined
  const candidate = candidates?.[0]
  const content = candidate?.content as Record<string, unknown> | undefined
  const parts = content?.parts as Array<Record<string, unknown>> | undefined

  if (parts && parts.length) {
    for (const part of parts) {
      const text = typeof part.text === 'string' ? part.text : ''
      const thought = part.thought
      const thoughtText =
        typeof thought === 'string' && thought.length > 0
          ? thought
          : thought === true && text.length > 0
            ? text
            : undefined
      if (thoughtText) {
        frames.push({
          data: JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: { reasoning_content: thoughtText }
            }]
          })
        })
      } else if (text.length > 0) {
        ctx.sawTextDelta = true
        frames.push({
          data: JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: text }
            }]
          })
        })
      }
      const functionCall = part.functionCall
      if (functionCall && typeof functionCall === 'object') {
        const fc = functionCall as Record<string, unknown>
        const name = (typeof fc.name === 'string' ? fc.name : '').replace(/__/g, ':')
        ctx.toolCallIndex += 1
        const callId = `call_${ctx.toolCallIndex}`
        const deltaIndex = ctx.nextToolCallDeltaIndex
        ctx.nextToolCallDeltaIndex += 1
        // CloudCode emits a single complete functionCall part rather than
        // incremental argument deltas. Map it to a single OpenAI-style tool
        // call delta with the full JSON arguments string.
        frames.push({
          data: JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: deltaIndex,
                  id: callId,
                  type: 'function',
                  function: {
                    name,
                    arguments: JSON.stringify(fc.args ?? {})
                  }
                }]
              }
            }]
          })
        })
      }
    }
  }

  const usageMeta = root.usageMetadata as Record<string, unknown> | undefined
  let finishReason = candidate?.finishReason
    ? mapCloudCodeFinishReason(candidate.finishReason as string)
    : null

  // If a function call was emitted in this payload, synthesize finish_reason
  // even if the CloudCode frame did not explicitly carry TOOL_CALLS yet.
  if (parts?.some((p) => p.functionCall)) {
    finishReason = 'tool_calls'
  }

  if (finishReason) {
    frames.push({
      data: JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: finishReason
        }]
      })
    })
    ctx.emittedTerminal = true
  }

  if (usageMeta && ctx.includeUsage) {
    frames.push({
      data: JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [],
        usage: {
          prompt_tokens: Number(usageMeta.promptTokenCount ?? 0),
          completion_tokens: Number(usageMeta.candidatesTokenCount ?? 0),
          total_tokens: Number(usageMeta.totalTokenCount ?? 0)
        }
      })
    })
    ctx.emittedTerminal = true
  }

  if (ctx.emittedTerminal) {
    frames.push({ data: '', done: true })
  }

  return frames
}
