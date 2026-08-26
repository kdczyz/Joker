import type { SearchEngineDef, SearchEngineId } from './types.js'
import { BAIDU_ENGINE } from './baidu.js'
import { BING_ENGINE } from './bing.js'
import { DUCKDUCKGO_ENGINE } from './duckduckgo.js'

export { BROWSER_UA, dedupeByHost } from './duckduckgo.js'
export { KeylessSearchExecutor, type KeylessSearchOutcome } from './keyless-executor.js'
export type { SearchEngineDef, SearchEngineId, SearchResultDraft, SearchEngineContext } from './types.js'

export const SEARCH_ENGINES: Record<SearchEngineId, SearchEngineDef> = {
  duckduckgo: DUCKDUCKGO_ENGINE,
  bing: BING_ENGINE,
  baidu: BAIDU_ENGINE
}

/** Default order: privacy-friendly global first, CN-reachable engine last. */
const DEFAULT_CHAIN: SearchEngineId[] = ['duckduckgo', 'bing', 'baidu']

/**
 * Resolve `config.web.provider` into an ordered engine chain.
 * Accepted values: `auto`/undefined, or comma-separated engine ids such as
 * `bing,baidu`. Unknown names are ignored; empty results fall back to auto.
 */
export function resolveSearchEngineChain(provider: string | undefined): SearchEngineDef[] {
  if (!provider || provider === 'auto') {
    return DEFAULT_CHAIN.map((id) => SEARCH_ENGINES[id])
  }
  const requested = provider
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is SearchEngineId => name in SEARCH_ENGINES)
  const chain = [...new Set(requested)].map((id) => SEARCH_ENGINES[id])
  return chain.length ? chain : DEFAULT_CHAIN.map((id) => SEARCH_ENGINES[id])
}
