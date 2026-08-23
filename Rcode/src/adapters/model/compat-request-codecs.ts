import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import type { ModelRequest, ModelToolSpec } from '../../ports/model-client.js'
import { isDeepSeekHost } from './model-error-probe.js'

// CloudCode's protobuf Schema message has no JSON-Schema meta keywords (they all
// start with "$"), nor the legacy "definitions"/"additionalProperties" keys.
// Passing them through makes cloudcode-pa return 400 ("Unknown name \"$schema\""),
// so strip them recursively before assigning a tool's inputSchema to parameters.
const CLOUDCODE_SCHEMA_DROPPED_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'additionalProperties',
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

// CloudCode's :fetchAvailableModels exposes internal model names that differ
// from the public Gemini names. Map the legacy/public ids to the internal ids so
// a stale configured model still routes (otherwise cloudcode returns 404 NOT_FOUND).
const CLOUDCODE_MODEL_ALIASES: Record<string, string> = {
  'gemini-3-pro': 'gemini-pro-agent',
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

export type CompatChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | CompatChatMessageContentPart[] | null
  name?: string
  tool_call_id?: string
  reasoning_content?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export type CompatChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type ReasoningCapability = ModelCapabilityMetadata['reasoning']

export type CompatRequestCodecInput = {
  request: ModelRequest
  model: string
  messages: CompatChatMessage[]
  tools: ModelToolSpec[]
  stream: boolean
  endpointFormat: ModelEndpointFormat
  includeStreamUsage?: boolean
  baseUrl: string
  reasoning?: ReasoningCapability
  maxTokens?: number
  isCodex: boolean
  isCodexLite: boolean
  codexNativeImageGeneration: boolean
}

export type CompatRequestCodecDeps = {
  splitOpenAiMessages: (messages: CompatChatMessage[]) => CompatChatMessage[]
  responsesInput: (messages: CompatChatMessage[]) => Array<Record<string, unknown>>
  toAnthropic: (
    messages: CompatChatMessage[],
    thinkingMode: boolean
  ) => { system: string; messages: Array<{ content: unknown }> }
  toCloudCode: (
    messages: CompatChatMessage[]
  ) => { system: string; contents: Array<Record<string, unknown>> }
  applyAnthropicCacheControl: (messages: Array<{ content: unknown }>) => void
  plainText: (content: CompatChatMessage['content']) => string
  applyChatReasoning: (
    body: Record<string, unknown>,
    effort: string | undefined,
    input: { includeThinking: boolean; nativeDeepSeekHost: boolean; reasoning?: ReasoningCapability }
  ) => void
  responsesReasoning: (
    effort: string | undefined,
    reasoning: ReasoningCapability,
    options: { maxEffort: 'high' | 'xhigh'; includeSummary: boolean }
  ) => Record<string, unknown> | null
  applyAnthropicReasoning: (
    body: Record<string, unknown>,
    effort: string | undefined,
    reasoning: ReasoningCapability
  ) => void
  resolveReasoning: (
    effort: string | undefined,
    reasoning: NonNullable<ReasoningCapability>
  ) => string | undefined
}

const DEFAULT_MESSAGES_MAX_TOKENS = 8_192
const DEFAULT_MESSAGES_REASONING_MAX_TOKENS = 32_768

export class CompatRequestCodecs {
  constructor(private readonly deps: CompatRequestCodecDeps) {}

  build(input: CompatRequestCodecInput): Record<string, unknown> {
    switch (input.endpointFormat) {
      case 'responses':
        return this.responses(input)
      case 'messages':
        return this.messages(input)
      case 'cloudcode':
        return this.cloudcode(input)
      default:
        return this.chatCompletions(input)
    }
  }

  private chatCompletions(input: CompatRequestCodecInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: input.model,
      stream: input.stream,
      messages: this.deps.splitOpenAiMessages(input.messages)
    }
    if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens
    if (input.request.temperature !== undefined) body.temperature = input.request.temperature
    if (input.request.topP !== undefined) body.top_p = input.request.topP
    if (input.request.responseFormat === 'json_object') body.response_format = { type: 'json_object' }
    if (input.stream && input.includeStreamUsage !== false) body.stream_options = { include_usage: true }
    const nativeDeepSeekHost = isDeepSeekHost(input.baseUrl)
    const includeThinking = !isAzureOpenAiEndpoint(input.baseUrl)
    this.deps.applyChatReasoning(body, input.request.reasoningEffort, {
      includeThinking,
      nativeDeepSeekHost,
      reasoning: input.reasoning
    })
    if (
      includeThinking && nativeDeepSeekHost &&
      !Object.prototype.hasOwnProperty.call(body, 'thinking') &&
      isThinkingProducerModel(input.model)
    ) {
      body.thinking = { type: 'enabled' }
    }
    if (input.tools.length) {
      body.tools = input.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }))
    }
    return body
  }

  private responses(input: CompatRequestCodecInput): Record<string, unknown> {
    const system = input.isCodex ? input.messages.filter((message) => message.role === 'system') : []
    const nonSystem = input.isCodex
      ? input.messages.filter((message) => message.role !== 'system')
      : input.messages
    const instructions = system
      .map((message) => this.deps.plainText(message.content).trim())
      .filter(Boolean)
      .join('\n\n')
    const responseTools = input.tools.map((tool) => ({
      type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema
    }))
    const responseInput = this.deps.responsesInput(this.deps.splitOpenAiMessages(nonSystem))
    const litePrefix: Array<Record<string, unknown>> = input.isCodexLite
      ? [
          { type: 'additional_tools', role: 'developer', tools: responseTools },
          ...(instructions ? [{
            type: 'message', role: 'developer',
            content: [{ type: 'input_text', text: instructions }]
          }] : [])
        ]
      : []
    const body: Record<string, unknown> = {
      model: input.model,
      stream: input.stream,
      input: input.isCodexLite ? [...litePrefix, ...responseInput] : responseInput,
      ...(input.isCodexLite
        ? { store: false, tool_choice: 'auto', parallel_tool_calls: false }
        : input.isCodex ? { instructions: instructions || ' ', store: false } : {})
    }
    if (input.maxTokens !== undefined && !input.isCodex) body.max_output_tokens = input.maxTokens
    if (input.request.temperature !== undefined) body.temperature = input.request.temperature
    if (input.request.topP !== undefined) body.top_p = input.request.topP
    if (input.request.responseFormat === 'json_object') body.text = { format: { type: 'json_object' } }
    const reasoning = this.deps.responsesReasoning(
      input.request.reasoningEffort,
      input.reasoning,
      { maxEffort: input.isCodex ? 'xhigh' : 'high', includeSummary: input.isCodex }
    )
    if (reasoning || input.isCodexLite) {
      body.reasoning = input.isCodexLite ? { ...(reasoning ?? {}), context: 'all_turns' } : reasoning!
      if (input.isCodex) body.include = ['reasoning.encrypted_content']
    }
    if (!input.isCodexLite && responseTools.length) body.tools = responseTools
    if (!input.isCodexLite && input.isCodex && input.codexNativeImageGeneration) {
      body.tools = [...((body.tools ?? []) as Record<string, unknown>[]), { type: 'image_generation' }]
    }
    return body
  }

  private messages(input: CompatRequestCodecInput): Record<string, unknown> {
    const anthropicThinking = input.reasoning?.requestProtocol === 'anthropic-thinking'
    const converted = this.deps.toAnthropic(input.messages, anthropicThinking)
    this.deps.applyAnthropicCacheControl(converted.messages)
    const resolvedEffort = anthropicThinking && input.reasoning
      ? this.deps.resolveReasoning(input.request.reasoningEffort, input.reasoning)
      : undefined
    const thinkingEnabled = resolvedEffort !== undefined && resolvedEffort !== 'off'
    const body: Record<string, unknown> = {
      model: input.model,
      stream: input.stream,
      max_tokens: input.maxTokens ?? (
        thinkingEnabled ? DEFAULT_MESSAGES_REASONING_MAX_TOKENS : DEFAULT_MESSAGES_MAX_TOKENS
      ),
      messages: converted.messages
    }
    const systemText = input.request.responseFormat === 'json_object'
      ? [converted.system, 'Return a valid JSON object only.'].filter((item) => item.trim()).join('\n\n')
      : converted.system
    if (systemText) {
      body.system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
    }
    if (input.request.temperature !== undefined) body.temperature = input.request.temperature
    if (input.request.topP !== undefined) body.top_p = input.request.topP
    this.deps.applyAnthropicReasoning(body, input.request.reasoningEffort, input.reasoning)
    if (input.tools.length) {
      body.tools = input.tools.map((tool) => ({
        name: tool.name, description: tool.description, input_schema: tool.inputSchema
      }))
    }
    console.error('[DEBUG-PAYLOAD] body.tools =', JSON.stringify(body.tools, null, 2))
    return body
  }

  private cloudcode(input: CompatRequestCodecInput): Record<string, unknown> {
    const converted = this.deps.toCloudCode(input.messages)
    const generationConfig: Record<string, unknown> = {}
    if (input.maxTokens !== undefined) generationConfig.maxOutputTokens = input.maxTokens
    if (input.request.temperature !== undefined) generationConfig.temperature = input.request.temperature
    if (input.request.topP !== undefined) generationConfig.topP = input.request.topP

    const effort = input.request.reasoningEffort
    if (effort && effort !== 'off') {
      const thinkingConfig: Record<string, unknown> = { includeThoughts: true }
      if (effort === 'low') {
        thinkingConfig.thinkingBudget = 1024
      } else if (effort === 'medium') {
        thinkingConfig.thinkingBudget = 4096
      } else if (effort === 'high' || effort === 'max') {
        thinkingConfig.thinkingBudget = 8192
      }
      generationConfig.thinkingConfig = thinkingConfig
    }

    const request: Record<string, unknown> = {
      contents: converted.contents
    }
    if (Object.keys(generationConfig).length) request.generationConfig = generationConfig
    if (converted.system.trim()) {
      request.systemInstruction = { parts: [{ text: converted.system }] }
    }
    if (input.tools.length) {
      request.tools = [
        {
          functionDeclarations: input.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: toCloudCodeSchema(tool.inputSchema)
          }))
        }
      ]
    }
    console.error('[DEBUG-PAYLOAD] request.tools =', JSON.stringify(request.tools, null, 2))
    return {
      model: mapCloudCodeModel(input.model),
      request
    }
  }
}

function isAzureOpenAiEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com')
  } catch {
    return /\.openai\.azure\.com\b|\.cognitiveservices\.azure\.com\b/i.test(baseUrl)
  }
}

function isThinkingProducerModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized === 'deepseek-v4-pro' || normalized === 'deepseek-v4-flash' ||
    normalized.includes('deepseek-reasoner') || normalized.endsWith('/deepseek-v4-pro') ||
    normalized.endsWith('/deepseek-v4-flash')
}
