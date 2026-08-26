import type { WebFetchResult, WebSearchResult } from '../../../ports/web-provider.js'

/** Built-in keyless engines, in default fallback order. */
export type SearchEngineId = 'duckduckgo' | 'bing' | 'baidu'

/** Byte cap for scraped search result pages; snippets never need more. */
export const SEARCH_PAGE_MAX_BYTES = 512_000

export type SearchResultDraft = {
  url: string
  title: string
  snippet: string
}

/**
 * Engines receive a secure document transport (DNS pinning + SSRF policy +
 * redirect handling) instead of touching the network themselves.
 */
export type SearchEngineContext = {
  requestDocument(request: {
    url: string
    maxBytes: number
    timeoutMs: number
    signal: AbortSignal
    headers?: Record<string, string>
  }): Promise<{
    finalUrl: string
    contentType?: string
    chunks: Uint8Array[]
    totalBytes: number
    truncated: boolean
  }>
  nowIso: () => string
}

export type SearchEngineDef = {
  readonly id: SearchEngineId
  readonly label: string
  /** Result-page URL for a query. */
  requestUrl(query: string): string
  /** Extra headers required to get a scrapeable HTML response. */
  headers(): Record<string, string>
  /** Parse one result page into raw drafts; throw if the shape is unrecognizable. */
  parse(html: string): SearchResultDraft[]
}
