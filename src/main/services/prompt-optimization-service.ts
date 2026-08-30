import {
  DEFAULT_MODEL_PROVIDER_BASE_URL,
  getModelProviderProfile,
  modelEndpointPath,
  modelProviderModelProfile,
  opencodeZenClientHeaders,
  resolveJokerPromptOptimizationPrompt,
  resolveJokerRuntimeSettings,
  resolveModelEndpointFormat,
  resolveModelProviderProxyUrl,
  isCustomModelEndpointFormat,
  type AppSettingsV1,
  type ModelEndpointFormat,
  type ModelProviderProfileV1
} from '../../shared/app-settings'
import type {
  PromptOptimizationFailureReason,
  PromptOptimizationResult
} from '../../shared/Joker-gui-api'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import {
  codexResponsesLiteInput,
  resolveCodexResponsesRequestAuth,
  usesCodexResponsesLite,
  withCodexResponsesLiteHeader
} from '../codex-responses-lite'

type PromptOptimizationRequestPayload = {
  url: string
  endpointFormat: ModelEndpointFormat
  headers: Record<string, string>
  body: Record<string, unknown>
}

// Reasoning models (mimo-v2.5-free and friends on the free tier) bill their
// thinking tokens against `max_tokens`, so a small budget can come back with
// reasoning and an empty answer. Keep enough headroom for both.
const DEFAULT_MAX_OUTPUT_TOKENS = 4096
/**
 * Prompt optimization is a single short request, so it gets its own bounded
 * retry policy instead of the per-message retry that only covers the main
 * chat stream. Free/aggregated providers (Joker-free / opencode-zen, gateways)
 * routinely answer a burst with 429, and one 429 used to fail the whole action.
 */
const MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1_000
const RETRY_MAX_DELAY_MS = 5_000
const RETRYABLE_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const MAX_DETAIL_CHARS = 200

type PromptOptimizationTransport = {
  sleep: (ms: number) => Promise<void>
  now: () => number
  random: () => number
}

const DEFAULT_TRANSPORT: PromptOptimizationTransport = {
  sleep: (ms) => new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms))
  }),
  now: () => Date.now(),
  random: () => Math.random()
}

type PromptOptimizationFailureDetail = {
  status: number
  detail: string
}

function buildModelEndpointUrl(baseUrl: string, endpointFormat: ModelEndpointFormat): string {
  if (isCustomModelEndpointFormat(endpointFormat)) return exactModelEndpointUrl(baseUrl)
  const path = modelEndpointPath(endpointFormat)
  const normalized = baseUrl.replace(/\/+$/, '')
  if (!normalized) return `/v1/${path}`
  if (normalized.endsWith('/v1')) return `${normalized}/${path}`
  if (normalized.endsWith('/beta')) return `${normalized.slice(0, -5)}/v1/${path}`
  return `${normalized}/v1/${path}`
}

function exactModelEndpointUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const query = trimmed.search(/[?#]/)
  if (query < 0) return trimmed.replace(/\/+$/, '')
  return `${trimmed.slice(0, query).replace(/\/+$/, '')}${trimmed.slice(query)}`
}

function firstProviderModel(provider: ModelProviderProfileV1): string {
  return provider.models.map((item) => item.trim()).find(Boolean) ?? ''
}

function defaultPromptOptimizationModel(
  runtime: ReturnType<typeof resolveJokerRuntimeSettings>,
  provider: ModelProviderProfileV1
): string {
  const smallModel = runtime.smallModel?.trim() ?? ''
  const smallProviderId = runtime.smallModelProviderId?.trim() || runtime.providerId.trim() || provider.id
  if (smallModel && smallProviderId === provider.id) return smallModel

  const mainModel = runtime.model.trim()
  const mainProviderId = runtime.providerId.trim() || provider.id
  if (mainModel && mainProviderId === provider.id) return mainModel

  return firstProviderModel(provider) || mainModel
}

function providerOffersModel(provider: ModelProviderProfileV1, model: string | undefined): boolean {
  const normalized = model?.trim().toLowerCase() ?? ''
  if (!normalized) return false
  if (provider.models.some((item) => item.trim().toLowerCase() === normalized)) return true
  return Object.keys(provider.modelProfiles ?? {})
    .some((key) => key.trim().toLowerCase() === normalized)
}

function effectivePromptOptimizationModel(
  settings: AppSettingsV1,
  overrides?: { modelOverride?: string; providerIdOverride?: string }
): {
  providerId: string
  model: string
  apiKey: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  responsesMode?: 'lite'
  systemPrompt: string
  timeoutMs: number
} {
  const runtime = resolveJokerRuntimeSettings(settings)
  const promptOptimization = runtime.promptOptimization
  // Always use the current session model for prompt optimization.
  // Provider/model overrides from the renderer (composerModel/composerProviderId)
  // take top priority, then fall back to the active session provider+model.
  const providerId =
    overrides?.providerIdOverride?.trim() || runtime.providerId
  const provider = getModelProviderProfile(settings, providerId)
  const requestedModel = overrides?.modelOverride?.trim()
  const sessionModel = defaultPromptOptimizationModel(runtime, provider)
  /**
   * Gateways (Joker-free / opencode-zen included) forward an unknown model id
   * to a paid upstream and answer `429 FreeUsageLimitError` instead of
   * rejecting the id, so one stale model setting silently breaks the whole
   * action while normal chat — which always uses a listed model — keeps
   * working. Prefer a model this provider actually offers. Providers with a
   * free-form model list (empty `models`) keep the requested id.
   */
  const model = [requestedModel, sessionModel, firstProviderModel(provider)]
    .find((candidate) => providerOffersModel(provider, candidate))
    ?? (requestedModel || sessionModel)
  const profile = modelProviderModelProfile(provider, model)
  const endpointFormat = profile?.endpointFormat ?? provider.endpointFormat
  return {
    providerId: provider.id,
    model,
    apiKey: provider.apiKey.trim() || runtime.apiKey.trim(),
    baseUrl: provider.baseUrl.trim() || runtime.baseUrl.trim() || DEFAULT_MODEL_PROVIDER_BASE_URL,
    endpointFormat,
    responsesMode: profile?.responsesMode,
    systemPrompt: resolveJokerPromptOptimizationPrompt(runtime),
    timeoutMs: promptOptimization.timeoutMs
  }
}

function buildPromptOptimizationRequest(input: {
  providerId: string
  baseUrl: string
  apiKey: string
  endpointFormat: ModelEndpointFormat
  model: string
  systemPrompt: string
  sourceText: string
  responsesMode?: 'lite'
}): PromptOptimizationRequestPayload | null {
  const endpointFormat = resolveModelEndpointFormat(input.endpointFormat, input.baseUrl)
  if (!endpointFormat) return null
  // Fence the source text: small models otherwise treat a short or colloquial
  // instruction as "no input yet" and answer with a request for more details.
  const userContent = `<instruction>\n${input.sourceText}\n</instruction>`
  const auth = resolveCodexResponsesRequestAuth(input.baseUrl, input.apiKey)
  const responsesLite = usesCodexResponsesLite(input.baseUrl, input.responsesMode)
  const headers: Record<string, string> = withCodexResponsesLiteHeader({
    // Must come first: chat and prompt optimization have to look like the same
    // client to the provider or the free tier meters them into different
    // buckets and only one of them keeps working.
    ...opencodeZenClientHeaders(input.providerId, input.baseUrl),
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.apiKey}`,
    ...auth.headers
  }, responsesLite)
  if (endpointFormat === 'messages') {
    headers['x-api-key'] = auth.apiKey
    headers['anthropic-version'] = '2023-06-01'
  }
  if (endpointFormat === 'responses') {
    if (responsesLite) {
      return {
        url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
        endpointFormat,
        headers,
        body: {
          model: input.model,
          input: codexResponsesLiteInput(input.systemPrompt, [{ role: 'user', content: userContent }]),
          store: false,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          reasoning: { context: 'all_turns' }
        }
      }
    }
    return {
      url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
      endpointFormat,
      headers,
      body: {
        model: input.model,
        instructions: input.systemPrompt,
        input: userContent,
        max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS
      }
    }
  }
  if (endpointFormat === 'messages') {
    return {
      url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
      endpointFormat,
      headers,
      body: {
        model: input.model,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        max_tokens: DEFAULT_MAX_OUTPUT_TOKENS
      }
    }
  }
  return {
    url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
    endpointFormat,
    headers,
    body: {
      model: input.model,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: DEFAULT_MAX_OUTPUT_TOKENS
    }
  }
}

function extractPromptOptimizationContent(rawJson: string, endpointFormat: ModelEndpointFormat): string {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>
  if (endpointFormat === 'responses') {
    if (typeof parsed.output_text === 'string') return parsed.output_text.trim()
    const output = parsed.output
    if (!Array.isArray(output)) return ''
    return output.map((item) => {
      if (!item || typeof item !== 'object') return ''
      const content = (item as { content?: unknown }).content
      if (!Array.isArray(content)) return ''
      return content.map((block) => {
        if (!block || typeof block !== 'object') return ''
        const text = (block as { text?: unknown }).text
        if (typeof text === 'string') return text
        const outputText = (block as { output_text?: unknown }).output_text
        return typeof outputText === 'string' ? outputText : ''
      }).join('')
    }).join('').trim()
  }
  if (endpointFormat === 'messages') {
    const content = parsed.content
    if (!Array.isArray(content)) return ''
    return content.map((block) =>
      block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : ''
    ).join('').trim()
  }
  const choices = parsed.choices
  if (!Array.isArray(choices)) return ''
  const first = choices[0]
  return first && typeof first === 'object'
    ? String((first as { message?: { content?: unknown } }).message?.content ?? '').trim()
    : ''
}

/**
 * Models routinely wrap or preamble their answer even when told not to
 * (``` fences, "优化后的提示词：", "Here's the optimized prompt:"). Whatever
 * survives here is what lands in the composer, so strip the scaffolding and
 * keep only the rewritten text.
 */
function cleanOptimizedPromptText(value: string): string {
  let text = value.trim()
  // Fenced block: take the content, dropping an optional language tag line.
  const fence = text.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/)
  if (fence) text = fence[1].trim()
  // "优化后的提示词：" / "Rewritten prompt:" style labels on the first line.
  const labeled = text.match(
    /^\s*(?:优化(?:后)?的?(?:提示词|指令|prompt)|改写(?:后)?的?(?:提示词|指令)|rewritten\s+prompt|optimized\s+prompt|here(?:'s| is| are)?(?:\s+the)?(?:\s+(?:optimized|rewritten))?\s+prompt)\s*[:：\-–—]?\s*(?:\r?\n)+([\s\S]*)$/i
  )
  if (labeled) text = labeled[1].trim()
  // A single pair of quotes wrapped around the whole thing.
  const quoted = text.match(/^(["'])([\s\S]*)\1$/)
  if (quoted) text = quoted[2].trim()
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/** "请提供…" / "please provide …": the model wants more input instead of rewriting. */
const ASKS_FOR_INPUT_PATTERNS: readonly RegExp[] = [
  /请(?:提供|告诉|输入|发送|补充|给出|发给我|贴出|描述|说明)/,
  /(?:可以|麻烦|需要)(?:你)?(?:把|将)?[^。\n]{0,14}(?:发|贴|给|告诉|提供)我/,
  /\bplease (?:provide|share|send|give|paste|describe|tell me)\b/i,
  /\bcan you (?:provide|share|send|paste|give)\b/i,
  /\bwhat (?:would|do) you (?:like|want)\b/i
]

/** "这是一个…工具" / "this is a … tool": the model is describing itself. */
const SELF_DESCRIPTION_PATTERNS: readonly RegExp[] = [
  /^(?:这是一个|我是一个|我是一款|我是|本(?:工具|助手|模型)是|作为(?:一个)?)/,
  /^(?:this is|i am|i'?m|as an?)\b/i
]

function matchesAnyPattern(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

/**
 * True when the model answered *to* the prompt instead of rewriting it — it
 * asks for more details, introduces itself, or narrates what it is about to do.
 * Such output must never replace what the user typed.
 *
 * Each check is skipped when the source text has the same trait, so a prompt
 * that legitimately starts with "我是一个…" or asks the agent to "请提供…" is
 * still rewritten normally.
 */
function looksLikeConversation(text: string, sourceText: string): boolean {
  const source = sourceText.trim()
  // A clarifying question: the rewrite ends with "?" but the source did not.
  if (/[?？]\s*$/.test(text) && !/[?？]\s*$/.test(source)) return true
  if (matchesAnyPattern(ASKS_FOR_INPUT_PATTERNS, text) && !matchesAnyPattern(ASKS_FOR_INPUT_PATTERNS, source)) return true
  if (matchesAnyPattern(SELF_DESCRIPTION_PATTERNS, text) && !matchesAnyPattern(SELF_DESCRIPTION_PATTERNS, source)) return true
  // A narration preamble. No `\b` — CJK characters are not \w, so a word
  // boundary right after them never matches.
  return /^(?:好的|明白|收到|当然|没问题|我来帮你|我可以帮助|这是优化后的|sure|certainly|of course|i'?d be happy to|i will help|here are some)/i.test(text)
}

/** Length of `reasoning_content` in a chat completion, used to explain empty answers. */
function extractReasoningChars(rawJson: string, endpointFormat: ModelEndpointFormat): number {
  if (endpointFormat !== 'chat_completions') return 0
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>
    const choices = parsed.choices
    if (!Array.isArray(choices)) return 0
    const message = (choices[0] as { message?: { reasoning_content?: unknown } } | undefined)?.message
    return typeof message?.reasoning_content === 'string' ? message.reasoning_content.length : 0
  } catch {
    return 0
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').trim()
}

function errorTextFrom(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.message === 'string') return record.message
  // Anthropic / gateway shape: { type: 'error', error: { type, message } }
  const nested = record.error
  if (nested && typeof nested === 'object') {
    const nestedMessage = (nested as Record<string, unknown>).message
    if (typeof nestedMessage === 'string') return nestedMessage
  }
  return ''
}

/** Pulls a human-readable message out of an upstream error body. */
function extractErrorMessage(bodyText: string): string {
  const raw = bodyText.trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const candidate = [
      errorTextFrom(parsed.error),
      typeof parsed.message === 'string' ? parsed.message : '',
      typeof parsed.error_description === 'string' ? parsed.error_description : ''
    ].map((item) => collapseWhitespace(item)).find(Boolean)
    if (candidate) return candidate.slice(0, MAX_DETAIL_CHARS)
  } catch {
    // Not JSON — fall through to the plain-text branch.
  }
  return collapseWhitespace(stripMarkup(raw)).slice(0, MAX_DETAIL_CHARS)
}

/** `Retry-After` in delta-seconds or HTTP-date form. Capped to keep the UI responsive. */
function parseRetryAfterMs(value: string | null, now: number): number | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(600_000, Math.round(seconds * 1000))
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isFinite(dateMs)) return null
  return Math.min(600_000, Math.max(0, dateMs - now))
}

function retryDelayMs(retryAfter: string | null, attempt: number, transport: PromptOptimizationTransport): number {
  const hinted = parseRetryAfterMs(retryAfter, transport.now())
  if (hinted != null) return Math.min(RETRY_MAX_DELAY_MS, Math.max(RETRY_BASE_DELAY_MS, hinted))
  const exponential = RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1)
  const jitter = Math.round(transport.random() * 250)
  return Math.min(RETRY_MAX_DELAY_MS, exponential + jitter)
}

function classifyFailure(status: number): PromptOptimizationFailureReason {
  if (status === 429 || status === 425) return 'rate_limited'
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'unavailable'
  if (status === 0) return 'network'
  return 'request'
}

function describeFailure(
  failure: PromptOptimizationFailureDetail,
  attempts: number,
  timeoutMs: number
): { reason: PromptOptimizationFailureReason; message: string } {
  const detail = failure.detail ? `: ${failure.detail}` : ''
  const retried = attempts > 1 ? ` (retried ${attempts - 1} times)` : ''
  const status = failure.status
  switch (classifyFailure(status)) {
    case 'rate_limited':
      return {
        reason: 'rate_limited',
        message: `Rate limited by the model provider (HTTP ${status})${detail}${retried}`
      }
    case 'unauthorized':
      return {
        reason: 'unauthorized',
        message: `The model provider rejected the credentials (HTTP ${status})${detail}`
      }
    case 'timeout':
      return {
        reason: 'timeout',
        message: `Prompt optimization timed out after ${Math.round(timeoutMs / 1000)}s${retried}`
      }
    case 'unavailable':
      return {
        reason: 'unavailable',
        message: `The model provider is temporarily unavailable (HTTP ${status})${detail}${retried}`
      }
    case 'network':
      return {
        reason: 'network',
        message: `Could not reach the model provider${detail}${retried}`
      }
    default:
      return {
        reason: 'request',
        message: `Prompt optimization request failed (HTTP ${status})${detail}${retried}`
      }
  }
}

function failureResult(
  failure: PromptOptimizationFailureDetail,
  attempts: number,
  timeoutMs: number
): PromptOptimizationResult {
  const { reason, message } = describeFailure(failure, attempts, timeoutMs)
  return {
    ok: false,
    message,
    reason,
    status: failure.status,
    attempts,
    detail: failure.detail || undefined
  }
}

/**
 * Wraps the request so every failure carries the provider+model it was sent
 * with — "why does chat work but optimization not" is unanswerable otherwise,
 * because the two paths do not necessarily use the same model id.
 */
export async function optimizePrompt(
  settings: AppSettingsV1,
  sourceText: string,
  overrides?: { modelOverride?: string; providerIdOverride?: string },
  options?: Partial<PromptOptimizationTransport>
): Promise<PromptOptimizationResult> {
  const result = await requestPromptOptimization(settings, sourceText, overrides, options)
  if (result.ok) return result
  const modelSettings = effectivePromptOptimizationModel(settings, overrides)
  return {
    ...result,
    model: modelSettings.model,
    providerId: modelSettings.providerId
  }
}

async function requestPromptOptimization(
  settings: AppSettingsV1,
  sourceText: string,
  overrides?: { modelOverride?: string; providerIdOverride?: string },
  options?: Partial<PromptOptimizationTransport>
): Promise<PromptOptimizationResult> {
  const trimmed = sourceText.trim()
  if (!trimmed) {
    return { ok: false, message: 'Prompt text is empty.', reason: 'empty_input' }
  }
  const modelSettings = effectivePromptOptimizationModel(settings, overrides)
  if (!resolveJokerRuntimeSettings(settings).promptOptimization.enabled) {
    return { ok: false, message: 'Prompt optimization is disabled.', reason: 'disabled' }
  }
  if (!modelSettings.apiKey) {
    return {
      ok: false,
      message: 'Prompt optimization model is missing an API key.',
      reason: 'missing_key'
    }
  }
  if (!resolveCodexResponsesRequestAuth(modelSettings.baseUrl, modelSettings.apiKey).apiKey) {
    return {
      ok: false,
      message: 'ChatGPT subscription credentials are invalid. Please sign in again.',
      reason: 'invalid_credentials'
    }
  }
  const request = buildPromptOptimizationRequest({
    providerId: modelSettings.providerId,
    baseUrl: modelSettings.baseUrl,
    apiKey: modelSettings.apiKey,
    endpointFormat: modelSettings.endpointFormat,
    responsesMode: modelSettings.responsesMode,
    model: modelSettings.model,
    systemPrompt: modelSettings.systemPrompt,
    sourceText: trimmed
  })
  if (!request) {
    return {
      ok: false,
      message: 'Prompt optimization endpoint format is invalid.',
      reason: 'invalid_endpoint'
    }
  }

  const transport: PromptOptimizationTransport = { ...DEFAULT_TRANSPORT, ...options }
  const timeoutMs = Math.max(1, modelSettings.timeoutMs)
  // `timeoutMs` is the budget for the whole action, not for a single attempt.
  const deadline = transport.now() + timeoutMs
  let failure: PromptOptimizationFailureDetail | null = null
  /** Last answer that talked to the user instead of rewriting their text. */
  let strayAnswer: string | null = null
  let attempts = 0

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = deadline - transport.now()
    if (remainingMs <= 0) break
    attempts = attempt
    let response: Response
    let bodyText = ''
    try {
      response = await fetchWithOptionalProxy(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(remainingMs)
      }, resolveModelProviderProxyUrl(settings))
      bodyText = await response.text()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const aborted = error instanceof Error
        && (error.name === 'TimeoutError' || error.name === 'AbortError')
      if (aborted) {
        return {
          ok: false,
          message: `Prompt optimization timed out after ${Math.round(timeoutMs / 1000)}s.`,
          reason: 'timeout',
          attempts: attempt
        }
      }
      failure = { status: 0, detail }
      if (attempt >= MAX_ATTEMPTS) break
      const waitMs = retryDelayMs(null, attempt, transport)
      if (transport.now() + waitMs >= deadline) break
      await transport.sleep(waitMs)
      continue
    }
    if (response.ok) {
      let optimized = ''
      try {
        optimized = cleanOptimizedPromptText(
          extractPromptOptimizationContent(bodyText, request.endpointFormat)
        )
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          reason: 'request',
          status: response.status,
          attempts: attempt
        }
      }
      if (optimized && looksLikeConversation(optimized, trimmed)) {
        // The model replied to the prompt instead of rewriting it. Overwriting
        // the composer with a clarifying question would destroy what the user
        // typed, so keep their text. Sampling is the culprit, not the request,
        // so spend the remaining attempts before surfacing it as a failure.
        strayAnswer = optimized
        if (attempt >= MAX_ATTEMPTS) break
        const waitMs = retryDelayMs(null, attempt, transport)
        if (transport.now() + waitMs >= deadline) break
        await transport.sleep(waitMs)
        continue
      }
      if (!optimized) {
        // A 200 with empty content is a provider-side truncation, not a
        // transient condition, so retrying the same request would not help.
        const reasoningChars = extractReasoningChars(bodyText, request.endpointFormat)
        return {
          ok: false,
          message: 'Prompt optimization returned empty text.',
          reason: 'empty_response',
          status: response.status,
          attempts: attempt,
          ...(reasoningChars > 0
            ? {
                detail: `The model used the whole output budget on reasoning (${reasoningChars} chars) and returned no answer.`
              }
            : {})
        }
      }
      return {
        ok: true,
        text: optimized,
        model: modelSettings.model,
        providerId: modelSettings.providerId
      }
    }
    failure = { status: response.status, detail: extractErrorMessage(bodyText) }
    if (!RETRYABLE_HTTP_STATUS.has(response.status)) break
    if (attempt >= MAX_ATTEMPTS) break
    const waitMs = retryDelayMs(response.headers.get('retry-after'), attempt, transport)
    if (transport.now() + waitMs >= deadline) break
    await transport.sleep(waitMs)
  }

  if (strayAnswer) {
    return {
      ok: false,
      message: 'The model answered the prompt instead of rewriting it.',
      reason: 'unusable_output',
      status: 200,
      attempts: Math.max(1, attempts),
      detail: strayAnswer.slice(0, MAX_DETAIL_CHARS)
    }
  }
  return failureResult(failure ?? { status: 0, detail: '' }, Math.max(1, attempts), timeoutMs)
}
