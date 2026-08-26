import type { WebSearchResult } from '../../../ports/web-provider.js'
import type { SearchEngineContext, SearchEngineDef, SearchEngineId } from './types.js'
import { SEARCH_PAGE_MAX_BYTES } from './types.js'
import { dedupeByHost } from './duckduckgo.js'

export type KeylessSearchOutcome = {
  results: WebSearchResult[]
  /** Engine that produced the winning result set. */
  engine: string
  cacheStatus: 'hit' | 'miss'
  /** Engines attempted before success, in order. */
  attempts: SearchEngineId[]
}

type CacheEntry = {
  expiresAt: number
  results: WebSearchResult[]
}

const CACHE_TTL_MS = 10 * 60 * 1000
const COOLDOWN_MS = 3 * 60 * 1000

/**
 * Executes a query across a keyless engine chain: per-engine cooldown after
 * failures, a short-lived TTL result cache, and in-flight dedup so identical
 * concurrent queries share one upstream request.
 */
export class KeylessSearchExecutor {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<KeylessSearchOutcome>>()
  private readonly coolingUntil = new Map<SearchEngineId, number>()
  private readonly nowMs: () => number

  constructor(
    private readonly context: SearchEngineContext,
    options: { nowMs?: () => number } = {}
  ) {
    this.nowMs = options.nowMs ?? Date.now
  }

  async search(
    engines: SearchEngineDef[],
    request: { query: string; limit: number; timeoutMs: number; signal: AbortSignal }
  ): Promise<KeylessSearchOutcome> {
    const cacheKey = `${request.limit}:${request.query.trim().toLowerCase()}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > this.nowMs()) {
      return { results: cached.results, engine: cached.results[0]?.provider ?? '', cacheStatus: 'hit', attempts: [] }
    }

    const existing = this.inFlight.get(cacheKey)
    if (existing) return existing

    const task = this.executeChain(engines, request).finally(() => {
      this.inFlight.delete(cacheKey)
    })
    this.inFlight.set(cacheKey, task)

    const outcome = await task
    if (outcome.results.length > 0) {
      this.cache.set(cacheKey, { expiresAt: this.nowMs() + CACHE_TTL_MS, results: outcome.results })
    }
    return outcome
  }

  private async executeChain(
    engines: SearchEngineDef[],
    request: { query: string; limit: number; timeoutMs: number; signal: AbortSignal }
  ): Promise<KeylessSearchOutcome> {
    const now = this.nowMs()
    const available: SearchEngineDef[] = []
    const cooledOff: SearchEngineDef[] = []
    for (const engine of engines) {
      const until = this.coolingUntil.get(engine.id) ?? 0
      ;(until > now ? cooledOff : available).push(engine)
    }
    // Cooled-off engines still get a last-chance attempt rather than an
    // instant total failure when every engine is currently benched.
    const chain = [...available, ...(available.length ? [] : cooledOff)]

    const attempts: SearchEngineId[] = []
    let lastError: unknown
    for (const engine of chain) {
      if (request.signal.aborted) break
      attempts.push(engine.id)
      try {
        const results = await executeEngine(engine, request, this.context)
        this.coolingUntil.delete(engine.id)
        if (results.length > 0) {
          return { results, engine: engine.id, cacheStatus: 'miss', attempts }
        }
        lastError = new Error(`${engine.label} returned no parsable results`)
      } catch (error) {
        lastError = error
        this.coolingUntil.set(engine.id, this.nowMs() + COOLDOWN_MS)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('all keyless search engines failed')
  }
}

/** Fetch one result page through the secure transport and parse it. */
async function executeEngine(
  engine: SearchEngineDef,
  request: { query: string; limit: number; timeoutMs: number; signal: AbortSignal },
  context: SearchEngineContext
): Promise<WebSearchResult[]> {
  const document = await context.requestDocument({
    url: engine.requestUrl(request.query),
    maxBytes: SEARCH_PAGE_MAX_BYTES,
    timeoutMs: request.timeoutMs,
    signal: request.signal,
    headers: engine.headers()
  })
  const html = Buffer.concat(document.chunks).toString('utf8')
  const drafts = dedupeByHost(engine.parse(html)).slice(0, request.limit)
  return drafts.map((draft, index) => ({
    sourceId: sourceIdForSearch(engine.id, draft.url),
    url: draft.url,
    title: draft.title || draft.url,
    snippet: draft.snippet,
    retrievedAt: context.nowIso(),
    provider: engine.id as string,
    rank: index + 1
  }))
}

function sourceIdForSearch(engineId: string, url: string): string {
  let hash = 0
  const value = `${engineId}:${url}`
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return `web_search_${Math.abs(hash).toString(36)}`
}
