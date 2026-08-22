import { useEffect, useRef, useState } from 'react'
import { parseUsageResponse } from './usage-response'

export type ThreadUsageSummary = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  /** Thread-cumulative cache hit rate (dragged down by the cold first turn). */
  cacheHitRate: number | null
  /** Cache hit rate of the most recent turn; preferred for the usage chip. */
  lastTurnCacheHitRate: number | null
  lastTurnCacheableHitRate?: number | null
  lastTurnTotalInputHitRate?: number | null
  cacheMissReasons?: string[]
  cacheSuggestions?: string[]
  totalTokens: number
  costUsd: number | null
  costCny: number | null
  tokenEconomySavingsTokens: number
  turns: number
}

export type ThreadUsageState = {
  usage: ThreadUsageSummary | null
  loading: boolean
  loaded: boolean
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function hasFiniteNumber(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
}

function usageRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return new Intl.NumberFormat().format(value)
}

function isChineseLocale(locale?: string): boolean {
  const normalized = (locale ?? '').trim().toLowerCase()
  return normalized === 'zh' || normalized.startsWith('zh-')
}

function fallbackLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en'
}

function formatMoneyValue(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0
  if (safeValue > 0 && safeValue < 0.0001) return '<0.0001'
  return safeValue.toFixed(safeValue >= 1 ? 2 : 4)
}

export function formatCost(costUsd: number | null | undefined, locale = fallbackLocale(), costCny?: number | null): string {
  const hasUsd = typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd > 0
  const hasCny = typeof costCny === 'number' && Number.isFinite(costCny) && costCny > 0
  const usdValue = hasUsd ? costUsd : null
  const cnyValue = hasCny ? costCny : null
  if (!hasUsd && !hasCny) return '-'
  if (isChineseLocale(locale)) {
    const value = cnyValue ?? (usdValue ?? 0) * 7.2
    return `￥${formatMoneyValue(value)}`
  }
  if (usdValue != null) return `$${formatMoneyValue(usdValue)}`
  return `￥${formatMoneyValue(cnyValue ?? 0)}`
}

/**
 * True when the summary has any usable cost figure to render. Lets UI segments
 * drop the cost placeholder entirely instead of showing a bare "-" dash when
 * the backend hasn't reported a price.
 */
export function hasUsageCost(
  usage: Pick<ThreadUsageSummary, 'costUsd' | 'costCny'> | null | undefined
): boolean {
  if (!usage) return false
  const usd = usage.costUsd
  const cny = usage.costCny
  return (
    (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) ||
    (typeof cny === 'number' && Number.isFinite(cny) && cny > 0)
  )
}

export function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const percent = Math.max(0, Math.min(100, value * 100))
  if (percent === 0 || percent >= 10) return `${Math.round(percent)}%`
  return `${percent.toFixed(1)}%`
}

export function primaryCacheHitRate(
  usage: Pick<ThreadUsageSummary, 'cacheHitRate' | 'lastTurnCacheHitRate'>
): number | null {
  return usage.lastTurnCacheHitRate ?? usage.cacheHitRate
}

/**
 * Cumulative thread cache hit rate derived from token counts — the SAME formula
 * the overall usage panel uses (cachedTokens / (cachedTokens + cacheMissTokens)).
 * This keeps the conversation bottom bar consistent with the overall stats
 * (issue #654): the last-turn rate could read 0% while the thread cumulative is
 * non-zero. Falls back to the backend-provided `cacheHitRate` when no token
 * telemetry is available.
 */
export function cumulativeCacheHitRate(
  usage: Pick<ThreadUsageSummary, 'cachedTokens' | 'cacheMissTokens' | 'cacheHitRate'>
): number | null {
  const total = usage.cachedTokens + usage.cacheMissTokens
  if (total > 0) return usage.cachedTokens / total
  return usage.cacheHitRate
}

export function formatCacheMissReason(reason: string): string {
  switch (reason) {
    case 'cold_request':
      return 'cold request'
    case 'model_changed':
      return 'model changed'
    case 'provider_changed':
      return 'provider changed'
    case 'endpoint_changed':
      return 'endpoint changed'
    case 'stable_prefix_changed':
      return 'stable prefix changed'
    case 'tool_catalog_changed':
      return 'tool catalog changed'
    case 'skills_changed':
      return 'skills changed'
    case 'cache_ttl_unknown':
      return 'cache TTL/provider reuse unknown'
    case 'provider_cache_miss':
      return 'provider reported cache miss'
    case 'provider_metrics_unavailable':
      return 'provider cache metrics unavailable'
    default:
      return reason.replace(/_/g, ' ')
  }
}

export async function loadThreadUsage(threadId: string): Promise<ThreadUsageSummary | null> {
  if (typeof window.RcodeGui?.runtimeRequest !== 'function') return null
  const params = new URLSearchParams({
    group_by: 'thread',
    thread_id: threadId
  })
  const r = await window.RcodeGui.runtimeRequest(`/v1/usage?${params.toString()}`, 'GET')
  if (!r.ok || !r.body.trim()) return null
  const parsed = parseUsageResponse<{
    buckets?: Array<Record<string, unknown>>
  }>(r.body, 'thread usage')
  const bucket = parsed.buckets?.find((item) => {
    const candidates = [item.thread_id, item.key, item.id, item.label]
    return candidates.some((candidate) => candidate === threadId)
  })
  if (!bucket) return null
  const inputTokens = usageNumber(bucket.input_tokens)
  const outputTokens = usageNumber(bucket.output_tokens)
  const reasoningTokens = usageNumber(bucket.reasoning_tokens)
  const bucketCacheHitRate = usageRate(bucket.cache_hit_rate)
  const hasBucketCacheTelemetry = bucketCacheHitRate !== null
  const cachedTokens = hasBucketCacheTelemetry
      ? usageNumber(bucket.cached_tokens)
      : 0
  const cacheMissTokens = hasBucketCacheTelemetry
      ? usageNumber(bucket.cache_miss_tokens)
      : 0
  const cacheHitRate = bucketCacheHitRate
  const lastTurnCacheHitRate = usageRate(bucket.last_turn_cache_hit_rate)
  const lastTurnCacheableHitRate = usageRate(bucket.last_turn_cacheable_hit_rate)
  const lastTurnTotalInputHitRate = usageRate(bucket.last_turn_total_input_hit_rate)
  const cacheMissReasons = Array.isArray(bucket.last_cache_miss_reasons)
    ? bucket.last_cache_miss_reasons.filter((value): value is string => typeof value === 'string')
    : []
  const cacheSuggestions = Array.isArray(bucket.last_cache_suggestions)
    ? bucket.last_cache_suggestions.filter((value): value is string => typeof value === 'string')
    : []
  const totalTokens = inputTokens + outputTokens
  const rawCostUsd = hasFiniteNumber(bucket, 'cost_usd') ? usageNumber(bucket.cost_usd) : null
  const rawCostCny = hasFiniteNumber(bucket, 'cost_cny') ? usageNumber(bucket.cost_cny) : null
  const costUsd = rawCostUsd != null && rawCostUsd > 0 ? rawCostUsd : null
  const costCny = rawCostCny != null && rawCostCny > 0 ? rawCostCny : null
  const tokenEconomySavingsTokens = usageNumber(bucket.token_economy_savings_tokens)
  const turns = usageNumber(bucket.turns)
  if (
    totalTokens <= 0 &&
    cachedTokens <= 0 &&
    (costUsd ?? 0) <= 0 &&
    (costCny ?? 0) <= 0 &&
    tokenEconomySavingsTokens <= 0 &&
    turns <= 0
  ) return null
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    cacheMissTokens,
    cacheHitRate,
    lastTurnCacheHitRate,
    lastTurnCacheableHitRate,
    lastTurnTotalInputHitRate,
    cacheMissReasons,
    cacheSuggestions,
    totalTokens,
    costUsd,
    costCny,
    tokenEconomySavingsTokens,
    turns
  }
}

export function useThreadUsageState(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageState {
  const [state, setState] = useState<ThreadUsageState>({
    usage: null,
    loading: false,
    loaded: false
  })

  useEffect(() => {
    let cancelled = false
    if (!threadId || !enabled) {
      setState({ usage: null, loading: false, loaded: false })
      return
    }
    setState((current) => ({ ...current, loading: true }))
    void loadThreadUsage(threadId)
      .then((usage) => {
        if (!cancelled) setState({ usage, loading: false, loaded: true })
      })
      .catch(() => {
        if (!cancelled) setState({ usage: null, loading: false, loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, refreshKey, threadId])

  return state
}

export function useThreadUsage(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageSummary | null {
  return useThreadUsageState(threadId, enabled, refreshKey).usage
}

export type ThreadUsageSeriesPoint = {
  /** 1-based turn ordinal within the captured session window. */
  turn: number
  /** Epoch ms when this sample was captured. */
  at: number
  totalTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheHitRate: number | null
  costUsd: number | null
  costCny: number | null
}

/**
 * Captures a per-turn token-usage series for the active thread *during the
 * current app session*. The runtime reports one cumulative `ThreadUsageSummary`
 * per completed turn (via `usageRefreshKey`), and `useThreadUsageState` reloads
 * `threadUsage` on each bump. We append a sample whenever the cumulative total
 * grows, so the line chart grows live as the conversation proceeds.
 *
 * Historical turns from prior sessions are not exposed without a backend
 * change, so the first sample is the loaded cumulative baseline.
 *
 * Robustness: when the active thread changes, `useThreadUsageState` keeps
 * returning the *previous* thread's usage object for a render or two (stale
 * echo) before the new thread loads. We detect that window via object identity
 * (`staleRef`) and never append a bogus point for the wrong thread.
 */
export function useThreadUsageSeries(
  threadId: string | null | undefined,
  usage: ThreadUsageSummary | null
): ThreadUsageSeriesPoint[] {
  const [series, setSeries] = useState<ThreadUsageSeriesPoint[]>([])
  const ref = useRef<{
    threadId?: string
    lastTotal: number
    lastUsage: ThreadUsageSummary | null
    switched: boolean
    staleRef: ThreadUsageSummary | null
  }>({ lastTotal: -1, lastUsage: null, switched: false, staleRef: null })

  useEffect(() => {
    if (!threadId) {
      ref.current = { lastTotal: -1, lastUsage: null, switched: false, staleRef: null }
      setSeries([])
      return
    }
    if (ref.current.threadId !== threadId) {
      ref.current = {
        threadId,
        lastTotal: -1,
        lastUsage: null,
        switched: true,
        staleRef: usage
      }
      setSeries([])
      return
    }
    if (!usage) return
    if (ref.current.switched) {
      if (usage === ref.current.staleRef) return
      ref.current.switched = false
    }
    if (usage === ref.current.lastUsage) return
    if (usage.totalTokens <= ref.current.lastTotal) return
    ref.current.lastUsage = usage
    ref.current.lastTotal = usage.totalTokens
    setSeries((prev) => [
      ...prev,
      {
        turn: prev.length + 1,
        at: Date.now(),
        totalTokens: usage.totalTokens,
        cachedTokens: usage.cachedTokens,
        cacheMissTokens: usage.cacheMissTokens,
        cacheHitRate: usage.cacheHitRate,
        costUsd: usage.costUsd,
        costCny: usage.costCny
      }
    ])
  }, [threadId, usage])

  return series
}
