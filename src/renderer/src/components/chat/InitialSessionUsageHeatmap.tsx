import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  formatCompactNumber,
  formatCost,
  formatPercent
} from '../../hooks/use-thread-usage'
import {
  type DailyUsageBucket,
  type DailyUsageState,
  useDailyUsageState
} from '../../hooks/use-daily-usage'
import {
  type ModelUsageState,
  useModelUsageState
} from '../../hooks/use-model-usage'

type CalendarCell = DailyUsageBucket | null
type CalendarColumn = {
  key: string
  cells: CalendarCell[]
}
type UsageTotalsBucket = DailyUsageBucket & { days: number; activeDays: number }
type UsageRangeKey = 'all' | '90d' | '30d' | '7d'
type UsageTabKey = 'overview' | 'models'
type UsageMode = 'daily' | 'weekly' | 'cumulative'

const USAGE_HEATMAP_GRID_DAYS = 26 * 7
const USAGE_RANGE_DAYS: Record<UsageRangeKey, number> = {
  all: 365,
  '90d': 90,
  '30d': 30,
  '7d': 7
}
const USAGE_RANGE_KEYS: UsageRangeKey[] = ['all', '90d', '30d', '7d']
const USAGE_MODE_KEYS: UsageMode[] = ['daily', 'weekly', 'cumulative']
const MODEL_USAGE_COLORS = ['#4f83df', '#6b99e5', '#8db3ed', '#b8cff6']
const MODEL_USAGE_BREAKDOWN_COLORS = {
  cachedInput: '#9bd8ff',
  uncachedInput: '#62aaf8',
  output: '#245fd7'
} as const
const EMPTY_DAILY_USAGE_BUCKETS: DailyUsageBucket[] = []

function lerpChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t)
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexA.replace('#', '')
  const b = hexB.replace('#', '')
  const ar = Number.parseInt(a.slice(0, 2), 16)
  const ag = Number.parseInt(a.slice(2, 4), 16)
  const ab = Number.parseInt(a.slice(4, 6), 16)
  const br = Number.parseInt(b.slice(0, 2), 16)
  const bg = Number.parseInt(b.slice(2, 4), 16)
  const bb = Number.parseInt(b.slice(4, 6), 16)
  const r = lerpChannel(ar, br, t)
  const g = lerpChannel(ag, bg, t)
  const bl = lerpChannel(ab, bb, t)
  return `#${[r, g, bl].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

// Continuous blue gradient from blue-300 (lightest, level 1) to blue-700
// (darkest, level N). The same stops drive both light and dark themes so the
// color scale always progresses from light to dark as token usage increases.
const USAGE_HEATMAP_BLUE_START = '#93c5fd' // blue-300
const USAGE_HEATMAP_BLUE_END = '#1d4ed8' // blue-700
const USAGE_HEATMAP_LEVELS = 8

export const USAGE_HEATMAP_BLUE_STOPS: string[] = Array.from(
  { length: USAGE_HEATMAP_LEVELS },
  (_, index) => lerpColor(USAGE_HEATMAP_BLUE_START, USAGE_HEATMAP_BLUE_END, index / (USAGE_HEATMAP_LEVELS - 1))
)

export const USAGE_HEATMAP_CONTRAST_COLORS = [
  { level: 0, light: '#f5f7fb', dark: '#2a2a2a' },
  ...USAGE_HEATMAP_BLUE_STOPS.map((color, index) => ({
    level: index + 1,
    light: color,
    dark: color
  }))
]

function calendarColumns(buckets: CalendarCell[], cellsPerColumn: number): CalendarColumn[] {
  const columns: CalendarColumn[] = []
  for (let index = 0; index < buckets.length; index += cellsPerColumn) {
    const colCells = buckets.slice(index, index + cellsPerColumn)
    while (colCells.length < cellsPerColumn) colCells.push(null)
    columns.push({
      key: colCells.find((cell) => cell)?.date ?? `col-${index / cellsPerColumn}`,
      cells: colCells
    })
  }
  return columns
}

// Roll daily buckets up into one bucket per week. Used for the "weekly" mode.
function aggregateWeeklyBuckets(buckets: DailyUsageBucket[]): DailyUsageBucket[] {
  const weekly: DailyUsageBucket[] = []
  for (let index = 0; index < buckets.length; index += 7) {
    const weekDays = buckets.slice(index, index + 7)
    const firstDay = weekDays[0]
    let costCnyTotal: number | null = null
    let hasCny = false
    let costCnySum = 0
    const inputTokens = weekDays.reduce((sum, b) => sum + b.inputTokens, 0)
    const outputTokens = weekDays.reduce((sum, b) => sum + b.outputTokens, 0)
    const cachedTokens = weekDays.reduce((sum, b) => sum + b.cachedTokens, 0)
    const cacheMissTokens = weekDays.reduce((sum, b) => sum + b.cacheMissTokens, 0)
    const totalTokens = weekDays.reduce((sum, b) => sum + b.totalTokens, 0)
    const reasoningTokens = weekDays.reduce((sum, b) => sum + b.reasoningTokens, 0)
    const costUsd = weekDays.reduce((sum, b) => sum + b.costUsd, 0)
    const tokenEconomySavingsTokens = weekDays.reduce(
      (sum, b) => sum + b.tokenEconomySavingsTokens,
      0
    )
    const turns = weekDays.reduce((sum, b) => sum + b.turns, 0)
    const threadCount = weekDays.reduce((sum, b) => sum + b.threadCount, 0)
    for (const day of weekDays) {
      if (day.costCny != null) {
        hasCny = true
        costCnySum += day.costCny
      }
    }
    if (hasCny) costCnyTotal = costCnySum
    weekly.push({
      date: firstDay?.date ?? `week-${index / 7}`,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cachedTokens,
      cacheMissTokens,
      totalTokens,
      costUsd,
      costCny: costCnyTotal,
      tokenEconomySavingsTokens,
      turns,
      threadCount,
      cacheHitRate: null
    })
  }
  return weekly
}

// Return the cumulative running total per day. Used for the "cumulative" mode.
function aggregateCumulativeBuckets(buckets: DailyUsageBucket[]): DailyUsageBucket[] {
  let runningTokens = 0
  let runningTurns = 0
  return buckets.map((bucket) => {
    runningTokens += bucket.totalTokens
    runningTurns += bucket.turns
    return { ...bucket, totalTokens: runningTokens, turns: runningTurns }
  })
}

export function usageHeatmapIntensityLevel(
  bucket: Pick<DailyUsageBucket, 'totalTokens' | 'turns'>,
  maxTokens: number,
  maxTurns: number
): number {
  return intensityLevelFromValue(
    maxTokens > 0 ? bucket.totalTokens : bucket.turns,
    maxTokens > 0 ? maxTokens : maxTurns,
    USAGE_HEATMAP_BLUE_STOPS.length
  )
}

function intensityLevelFromValue(value: number, max: number, levels: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.max(1, Math.min(levels, Math.ceil((value / max) * levels)))
}

function usageHasBucketActivity(bucket: Pick<DailyUsageBucket, 'totalTokens' | 'turns'>): boolean {
  return bucket.totalTokens > 0 || bucket.turns > 0
}

function usageStreaks(buckets: DailyUsageBucket[]): { current: number; longest: number } {
  let current = 0
  let longest = 0
  let running = 0
  for (const bucket of buckets) {
    if (usageHasBucketActivity(bucket)) {
      running += 1
      longest = Math.max(longest, running)
    } else {
      running = 0
    }
  }
  for (let index = buckets.length - 1; index >= 0; index -= 1) {
    if (!usageHasBucketActivity(buckets[index])) break
    current += 1
  }
  return { current, longest }
}

function usageRangeBuckets(buckets: DailyUsageBucket[], rangeKey: UsageRangeKey): DailyUsageBucket[] {
  if (rangeKey === 'all') return buckets
  return buckets.slice(-USAGE_RANGE_DAYS[rangeKey])
}

function usageTotalsFromBuckets(buckets: DailyUsageBucket[]): UsageTotalsBucket {
  let hasCny = false
  const totals = buckets.reduce<UsageTotalsBucket>(
    (acc, bucket) => {
      acc.inputTokens += bucket.inputTokens
      acc.outputTokens += bucket.outputTokens
      acc.reasoningTokens += bucket.reasoningTokens
      acc.cachedTokens += bucket.cachedTokens
      acc.cacheMissTokens += bucket.cacheMissTokens
      acc.totalTokens += bucket.totalTokens
      acc.costUsd += bucket.costUsd
      acc.costCny = (acc.costCny ?? 0) + (bucket.costCny ?? 0)
      acc.tokenEconomySavingsTokens += bucket.tokenEconomySavingsTokens
      acc.turns += bucket.turns
      acc.threadCount += bucket.threadCount
      if (bucket.costCny != null) hasCny = true
      if (usageHasBucketActivity(bucket)) acc.activeDays += 1
      return acc
    },
    {
      date: 'totals',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheMissTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costCny: 0,
      tokenEconomySavingsTokens: 0,
      turns: 0,
      threadCount: 0,
      cacheHitRate: null,
      days: buckets.length,
      activeDays: 0
    }
  )
  const cacheTotal = totals.cachedTokens + totals.cacheMissTokens
  return {
    ...totals,
    costCny: hasCny ? totals.costCny : null,
    cacheHitRate: cacheTotal > 0 ? totals.cachedTokens / cacheTotal : null
  }
}

function dailySummary(
  bucket: DailyUsageBucket,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: string
): string {
  return t('usageHeatmapDaySummary', {
    date: bucket.date,
    tokens: formatCompactNumber(bucket.totalTokens),
    cost: formatCost(bucket.costUsd, locale, bucket.costCny),
    saved: formatCompactNumber(bucket.cachedTokens),
    turns: bucket.turns,
    threads: bucket.threadCount,
    cache: formatPercent(bucket.cacheHitRate)
  })
}

function HeatmapGrid({
  buckets,
  loading,
  onSelect
}: {
  buckets: DailyUsageBucket[]
  loading: boolean
  onSelect: (bucket: DailyUsageBucket) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [usageMode, setUsageMode] = useState<UsageMode>('daily')

  // Decide once whether to drive intensity from tokens or turns (driven by the
  // raw daily data, so it stays consistent across all aggregation modes).
  const maxDailyTokens = useMemo(() => Math.max(0, ...buckets.map((b) => b.totalTokens)), [buckets])
  const maxDailyTurns = useMemo(() => Math.max(0, ...buckets.map((b) => b.turns)), [buckets])
  const useTokens = maxDailyTokens > 0

  // Aggregate buckets and compute the per-cell intensity metric for the
  // current mode. The intensity metric is decoupled from the bucket fields so
  // tooltips can still show daily values in cumulative mode.
  const { displayBuckets, intensityValues, cellsPerColumn } = useMemo(() => {
    if (usageMode === 'weekly') {
      const weekly = aggregateWeeklyBuckets(buckets)
      const values = weekly.map((b) => (useTokens ? b.totalTokens : b.turns))
      return { displayBuckets: weekly, intensityValues: values, cellsPerColumn: 1 }
    }
    if (usageMode === 'cumulative') {
      const values = buckets.map((b, index) => {
        let runningTokens = 0
        let runningTurns = 0
        for (let i = 0; i <= index; i += 1) {
          runningTokens += buckets[i].totalTokens
          runningTurns += buckets[i].turns
        }
        return useTokens ? runningTokens : runningTurns
      })
      return { displayBuckets: buckets, intensityValues: values, cellsPerColumn: 7 }
    }
    return {
      displayBuckets: buckets,
      intensityValues: buckets.map((b) => (useTokens ? b.totalTokens : b.turns)),
      cellsPerColumn: 7
    }
  }, [buckets, usageMode, useTokens])

  const maxIntensity = useMemo(
    () => Math.max(0, ...intensityValues),
    [intensityValues]
  )

  const columns = useMemo(
    () => calendarColumns(displayBuckets, cellsPerColumn),
    [displayBuckets, cellsPerColumn]
  )
  const skeletonColumns = Array.from(
    { length: Math.ceil(USAGE_HEATMAP_GRID_DAYS / cellsPerColumn) },
    (_, col) => Array.from({ length: cellsPerColumn }, (_, cell) => col * cellsPerColumn + cell)
  )
  const columnCount = loading
    ? skeletonColumns.length
    : Math.max(columns.length, 1)

  // Month labels: emit a short month name on the first column whose top cell
  // belongs to a new month, otherwise leave the slot blank.
  const monthLabels = useMemo(() => {
    if (loading) return Array.from({ length: columnCount }, () => '')
    const labels: string[] = []
    let prevMonth: number | null = null
    for (const col of columns) {
      const top = col.cells[0]
      const month = top?.date ? new Date(`${top.date}T00:00:00.000Z`).getUTCMonth() + 1 : null
      if (month && month !== prevMonth) {
        labels.push(formatMonthShort(month, i18n.language))
        prevMonth = month
      } else {
        labels.push('')
      }
    }
    return labels
  }, [columns, i18n.language, loading, columnCount])

  return (
    <div className="w-full min-w-0">
      <div className="max-w-full pb-1">
        {/* Daily / Weekly / Cumulative toggle */}
        <div className="mb-2 flex items-center justify-end gap-0.5 text-[11px]">
          {USAGE_MODE_KEYS.map((mode) => {
            const active = usageMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setUsageMode(mode)}
                className={`rounded px-2 py-0.5 transition ${
                  active
                    ? 'bg-ds-accent-soft font-medium text-ds-accent'
                    : 'text-ds-muted hover:bg-ds-subtle hover:text-ds-ink'
                }`}
                aria-pressed={active}
              >
                {t(`usageHeatmapMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`)}
              </button>
            )
          })}
        </div>

        <div>
          <div
            className="grid w-full gap-1"
            style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
            aria-label={t('usageHeatmapGridLabel')}
          >
            {loading
              ? skeletonColumns.map((col) => (
                  <span
                    key={col[0]}
                    className={`grid gap-1 ${cellsPerColumn === 1 ? '' : 'grid-rows-7'}`}
                  >
                    {col.map((cell) => (
                      <span
                        key={cell}
                        className="aspect-square w-full animate-pulse rounded-[2px] border border-ds-border-muted bg-ds-subtle"
                      />
                    ))}
                  </span>
                ))
              : columns.map((col, colIndex) => (
                  <span
                    key={col.key}
                    className={`grid gap-1 ${cellsPerColumn === 1 ? '' : 'grid-rows-7'}`}
                  >
                    {col.cells.map((bucket, cellIndex) => {
                      const globalIndex = colIndex * cellsPerColumn + cellIndex
                      const value = intensityValues[globalIndex] ?? 0
                      const level = intensityLevelFromValue(
                        value,
                        maxIntensity,
                        USAGE_HEATMAP_BLUE_STOPS.length
                      )
                      const isEmpty = level === 0
                      const stop = isEmpty ? undefined : USAGE_HEATMAP_BLUE_STOPS[level - 1]
                      if (!bucket) {
                        return (
                          <span
                            key={`blank-${col.key}-${cellIndex}`}
                            className="aspect-square w-full rounded-[2px] border border-ds-border-muted bg-ds-subtle"
                            aria-hidden
                          />
                        )
                      }
                      return (
                        <button
                          key={bucket.date}
                          type="button"
                          title={dailySummary(bucket, t, i18n.language)}
                          aria-label={dailySummary(bucket, t, i18n.language)}
                          onMouseEnter={() => onSelect(bucket)}
                          onFocus={() => onSelect(bucket)}
                          onClick={() => onSelect(bucket)}
                          className={`aspect-square w-full rounded-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ds-bg ${
                            isEmpty ? 'border-ds-border-muted bg-ds-subtle' : 'border'
                          }`}
                          style={isEmpty ? undefined : { backgroundColor: stop, borderColor: stop }}
                        />
                      )
                    })}
                  </span>
                ))}
          </div>
        </div>

        {/* Month labels at the bottom, aligned with the column grid */}
        <div className="mt-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
          {monthLabels.map((label, index) => (
            <span
              key={index}
              className="truncate text-[10px] leading-tight text-ds-faint"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <span className="grid min-h-[52px] min-w-0 grid-rows-[auto_1fr] rounded-md bg-ds-subtle px-2.5 py-2">
      <span className="min-w-0 truncate whitespace-nowrap text-[12px] leading-4 text-ds-faint" title={label}>
        {label}
      </span>
      <span className="mt-0.5 min-w-0 truncate text-[15px] font-semibold leading-5 tabular-nums text-ds-ink" title={value}>
        {value}
      </span>
    </span>
  )
}

function formatChartDate(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed)
}

function formatMonthShort(month: number, locale: string): string {
  if (month < 1 || month > 12) return ''
  const date = new Date(Date.UTC(2026, month - 1, 1))
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date)
}

function formatTokenCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.round(value)))
}

function modelUsageBreakdownSummary(
  label: string,
  bucket: Pick<DailyUsageBucket, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'cacheMissTokens' | 'totalTokens'>,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: string
): string {
  return t('usageHeatmapModelTooltip', {
    label,
    total: formatTokenCount(bucket.totalTokens, locale),
    input: formatTokenCount(bucket.inputTokens, locale),
    output: formatTokenCount(bucket.outputTokens, locale),
    cacheHit: formatTokenCount(bucket.cachedTokens, locale),
    cacheMiss: formatTokenCount(bucket.cacheMissTokens, locale)
  })
}

function modelUsageChartBreakdown(
  bucket: Pick<DailyUsageBucket, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'cacheMissTokens' | 'totalTokens'>
): {
  cachedInput: number
  uncachedInput: number
  output: number
  total: number
} {
  const cachedInput = Math.max(0, bucket.cachedTokens)
  const uncachedInput = Math.max(
    0,
    bucket.cacheMissTokens > 0 ? bucket.cacheMissTokens : bucket.inputTokens - cachedInput
  )
  const output = Math.max(0, bucket.outputTokens)
  const total = Math.max(0, bucket.totalTokens, cachedInput + uncachedInput + output)
  return {
    cachedInput,
    uncachedInput,
    output,
    total
  }
}

function ModelUsagePanel({
  state,
  fallbackModel,
  locale,
  initialActiveDayIndex = null
}: {
  state: ModelUsageState
  fallbackModel: string
  locale: string
  initialActiveDayIndex?: number | null
}): ReactElement {
  const { t } = useTranslation('common')
  const usage = state.usage
  const modelBuckets = usage?.buckets ?? []
  const dayBuckets = usage?.days ?? []
  const activeDays = dayBuckets.filter((bucket) => bucket.totalTokens > 0)
  const chartDays = (activeDays.length > 0 ? activeDays : dayBuckets).slice(-5)
  const [activeDayIndex, setActiveDayIndex] = useState<number | null>(initialActiveDayIndex)
  const chartBreakdowns = useMemo(
    () => chartDays.map((bucket) => modelUsageChartBreakdown(bucket)),
    [chartDays]
  )
  const maxTokens = Math.max(1, ...chartBreakdowns.map((bucket) => bucket.total))
  const topModels = modelBuckets.slice(0, 4)
  const totalTokens = Math.max(usage?.totals.totalTokens ?? 0, 1)
  const resolvedActiveDayIndex =
    activeDayIndex != null && activeDayIndex >= 0 && activeDayIndex < chartDays.length
      ? activeDayIndex
      : null
  const activeDay = resolvedActiveDayIndex != null ? chartDays[resolvedActiveDayIndex] : null
  const activeBreakdown =
    resolvedActiveDayIndex != null ? chartBreakdowns[resolvedActiveDayIndex] : null
  const tooltipAnchorPercent =
    resolvedActiveDayIndex != null
      ? ((resolvedActiveDayIndex + 0.5) / Math.max(chartDays.length, 1)) * 100
      : 50
  const tooltipTransformClass =
    resolvedActiveDayIndex == null || (resolvedActiveDayIndex > 0 && resolvedActiveDayIndex < chartDays.length - 1)
      ? '-translate-x-1/2'
      : resolvedActiveDayIndex === 0
        ? 'translate-x-0'
        : '-translate-x-full'
  const tooltipRows = activeBreakdown
    ? [
        {
          key: 'cached-input',
          label: t('usageHeatmapModelTooltipCachedInput'),
          value: activeBreakdown.cachedInput,
          color: MODEL_USAGE_BREAKDOWN_COLORS.cachedInput
        },
        {
          key: 'uncached-input',
          label: t('usageHeatmapModelTooltipUncachedInput'),
          value: activeBreakdown.uncachedInput,
          color: MODEL_USAGE_BREAKDOWN_COLORS.uncachedInput
        },
        {
          key: 'output',
          label: t('usageHeatmapModelTooltipOutput'),
          value: activeBreakdown.output,
          color: MODEL_USAGE_BREAKDOWN_COLORS.output
        }
      ]
    : []

  if (state.loading && !usage) {
    return (
      <div className="grid min-h-[180px] place-items-center text-[12px] text-ds-faint">
        {t('usageHeatmapLoading')}
      </div>
    )
  }

  if (modelBuckets.length === 0) {
    return (
      <div className="grid min-h-[180px] place-items-center rounded-md bg-ds-subtle text-[12px] text-ds-faint">
        {t('usageHeatmapModelsEmpty', { model: fallbackModel || '-' })}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline gap-3 px-1">
        <span className="text-[13px] font-medium text-ds-muted">{t('usageHeatmapTokens')}</span>
        <span className="text-[20px] font-semibold tabular-nums text-ds-ink">
          {formatTokenCount(usage?.totals.totalTokens ?? 0, locale)}
        </span>
      </div>
      <div className="grid min-h-[206px] grid-cols-[44px_1fr] gap-2">
        <div className="grid grid-rows-5 pb-5 pt-14 text-right text-[11px] leading-none text-ds-faint">
          {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
            <span key={ratio}>
              {ratio === 0 ? '0' : formatCompactNumber(maxTokens * ratio)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0" onMouseLeave={() => setActiveDayIndex(null)}>
          {activeDay && activeBreakdown ? (
            <div
              className={`pointer-events-none absolute top-0 z-20 w-[min(18rem,calc(100vw-4rem))] max-w-full rounded-[18px] border border-ds-border bg-ds-card/98 p-3 shadow-[0_18px_46px_rgba(20,47,95,0.12)] backdrop-blur-xl ${tooltipTransformClass}`}
              style={{ left: `${tooltipAnchorPercent}%` }}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-[12.5px] font-semibold text-ds-ink">{activeDay.date}</span>
                <span className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums text-ds-ink">
                  {t('usageHeatmapModelTooltipTotalTokens', {
                    value: formatTokenCount(activeBreakdown.total, locale)
                  })}
                </span>
              </div>
              <div className="mt-2 grid gap-1.5">
                {tooltipRows.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[12px] leading-5"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-[3px]"
                      style={{ backgroundColor: row.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 text-ds-muted">{row.label}</span>
                    <span className="whitespace-nowrap tabular-nums text-ds-ink">
                      {t('usageHeatmapModelTooltipTotalTokens', {
                        value: formatTokenCount(row.value, locale)
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid min-h-[150px] min-w-0 grid-flow-col items-end gap-2 pt-14">
          {chartDays.map((bucket, index) => {
            const breakdown = chartBreakdowns[index]
            const segments = [
              {
                key: 'output',
                value: breakdown.output,
                color: MODEL_USAGE_BREAKDOWN_COLORS.output
              },
              {
                key: 'uncached-input',
                value: breakdown.uncachedInput,
                color: MODEL_USAGE_BREAKDOWN_COLORS.uncachedInput
              },
              {
                key: 'cached-input',
                value: breakdown.cachedInput,
                color: MODEL_USAGE_BREAKDOWN_COLORS.cachedInput
              }
            ]
            const dateLabel = formatChartDate(bucket.date, locale)
            const summary = modelUsageBreakdownSummary(dateLabel, bucket, t, locale)
            const active = resolvedActiveDayIndex === index
            const barHeight = Math.max(8, (breakdown.total / maxTokens) * 112)
            return (
              <div key={`${bucket.date}-${index}`} className="relative grid min-w-0 grid-rows-[1fr_auto] gap-2">
                {active ? (
                  <span
                    className="pointer-events-none absolute bottom-5 left-1/2 top-0 z-0 w-px -translate-x-1/2 border-l border-dashed border-accent/35"
                    aria-hidden
                  />
                ) : null}
                <button
                  type="button"
                  title={summary}
                  aria-label={summary}
                  onMouseEnter={() => setActiveDayIndex(index)}
                  onFocus={() => setActiveDayIndex(index)}
                  onClick={() => setActiveDayIndex(index)}
                  className="relative z-[1] flex min-h-[112px] items-end rounded-[10px] px-1 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 focus:ring-offset-ds-bg"
                >
                  <span
                    className={`flex w-full flex-col-reverse overflow-hidden rounded-t-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.36)] transition ${
                      active ? 'ring-1 ring-accent/18' : ''
                    }`}
                    style={{ height: `${barHeight}px` }}
                  >
                    {segments.map((segment) => {
                      const ratio = breakdown.total > 0 ? segment.value / breakdown.total : 0
                      if (ratio <= 0) return null
                      return (
                        <span
                          key={segment.key}
                          className="w-full border-t border-white/35 dark:border-white/10"
                          style={{
                            height: `${Math.max(4, ratio * barHeight)}px`,
                            backgroundColor: segment.color
                          }}
                        />
                      )
                    })}
                  </span>
                </button>
                <span className="truncate text-center text-[11px] text-ds-faint">
                  {dateLabel}
                </span>
              </div>
            )
          })}
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-1.5">
        {topModels.map((bucket, index) => {
          const percent = (bucket.totalTokens / totalTokens) * 100
          const summary = modelUsageBreakdownSummary(bucket.model, bucket, t, locale)
          return (
            <div
              key={bucket.model}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto] items-center gap-3 text-[12px] leading-5"
              title={summary}
              aria-label={summary}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-ds-ink">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: MODEL_USAGE_COLORS[index % MODEL_USAGE_COLORS.length] }}
                />
                <span className="truncate">{bucket.model}</span>
              </span>
              <span className="min-w-0 truncate whitespace-nowrap text-right tabular-nums text-ds-faint">
                {t('usageHeatmapModelTokenBreakdown', {
                  input: formatCompactNumber(bucket.inputTokens),
                  output: formatCompactNumber(bucket.outputTokens),
                  cacheHit: formatCompactNumber(bucket.cachedTokens),
                  cacheMiss: formatCompactNumber(bucket.cacheMissTokens)
                })}
              </span>
              <span className="min-w-[3.2rem] text-right tabular-nums font-semibold text-ds-ink">
                {percent.toFixed(percent >= 10 ? 1 : 1)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UsagePanelCard({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="w-full min-w-0 rounded-[28px] border border-ds-border-muted bg-ds-card/82 p-4 shadow-[0_18px_48px_rgba(86,103,136,0.08)] dark:bg-white/[0.045] sm:p-5">
      {children}
    </div>
  )
}

export function InitialSessionUsageHeatmap(): ReactElement {
  const [refreshKey, setRefreshKey] = useState(0)
  const [rangeKey, setRangeKey] = useState<UsageRangeKey>('all')
  const state = useDailyUsageState(true, refreshKey, USAGE_RANGE_DAYS.all)
  const modelState = useModelUsageState(true, `${refreshKey}:${rangeKey}`, USAGE_RANGE_DAYS[rangeKey])

  return (
    <InitialSessionUsageHeatmapView
      state={state}
      modelState={modelState}
      rangeKey={rangeKey}
      onRangeChange={setRangeKey}
      onRefresh={() => setRefreshKey((value) => value + 1)}
    />
  )
}

export function InitialSessionUsageHeatmapView({
  state,
  modelState = { usage: null, loading: false, loaded: false, error: null },
  rangeKey = 'all',
  initialActiveTab = 'overview',
  initialModelHoverIndex = null,
  onRangeChange,
  onRefresh
}: {
  state: DailyUsageState
  modelState?: ModelUsageState
  rangeKey?: UsageRangeKey
  initialActiveTab?: UsageTabKey
  initialModelHoverIndex?: number | null
  onRangeChange?: (rangeKey: UsageRangeKey) => void
  onRefresh?: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [activeBucket, setActiveBucket] = useState<DailyUsageBucket | null>(null)
  const [activeTab, setActiveTab] = useState<UsageTabKey>(initialActiveTab)
  const [modelLabel, setModelLabel] = useState('')
  const usage = state.usage
  const buckets = usage?.buckets ?? EMPTY_DAILY_USAGE_BUCKETS
  const metricBuckets = useMemo(() => usageRangeBuckets(buckets, rangeKey), [buckets, rangeKey])
  const heatmapBuckets = useMemo(() => buckets.slice(-USAGE_HEATMAP_GRID_DAYS), [buckets])
  const totals = useMemo(() => usageTotalsFromBuckets(metricBuckets), [metricBuckets])
  const streaks = useMemo(() => usageStreaks(metricBuckets), [metricBuckets])
  const overviewMetrics = [
    { label: t('usageHeatmapSessions'), value: formatCompactNumber(totals.threadCount) },
    { label: t('usageHeatmapMessages'), value: formatCompactNumber(totals.turns) },
    { label: t('usageHeatmapTotalTokens'), value: formatCompactNumber(totals.totalTokens) },
    { label: t('usageHeatmapActiveDays'), value: String(totals.activeDays) },
    { label: t('usageHeatmapCurrentStreak'), value: t('usageHeatmapStreakDays', { count: streaks.current }) },
    { label: t('usageHeatmapLongestStreak'), value: t('usageHeatmapStreakDays', { count: streaks.longest }) },
    { label: t('usageHeatmapCost'), value: formatCost(totals.costUsd, i18n.language, totals.costCny) },
    {
      label: t('usageHeatmapCacheSavings'),
      value: t('usageHeatmapSavedTokensValue', { tokens: formatCompactNumber(totals.cachedTokens) })
    },
    {
      label: t('usageHeatmapContextSavings'),
      value: t('usageHeatmapSavedTokensValue', {
        tokens: formatCompactNumber(totals.tokenEconomySavingsTokens)
      })
    },
    { label: t('usageHeatmapCache'), value: formatPercent(totals.cacheHitRate) }
  ]

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined' || typeof window.RcodeGui?.getSettings !== 'function') return
    void window.RcodeGui.getSettings()
      .then((settings) => {
        if (!cancelled) setModelLabel(settings.agents.Rcode.model.trim())
      })
      .catch(() => {
        if (!cancelled) setModelLabel('')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="ds-initial-usage-heatmap ds-no-drag mx-auto flex min-h-[min(620px,calc(100dvh-220px))] w-full items-center justify-center px-3 py-6 text-left sm:px-5 sm:py-8">
      <div className="ds-chat-content-max-width flex w-full min-w-0 flex-col gap-5">
        <UsagePanelCard>
          <div className="mx-auto flex w-full max-w-[560px] min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex w-fit max-w-full rounded-lg bg-ds-subtle p-1 text-[12.5px] font-medium text-ds-muted">
                <button
                  type="button"
                  className={`min-h-7 rounded-md px-3 transition ${
                    activeTab === 'overview' ? 'bg-ds-card text-ds-ink shadow-sm dark:bg-white/10' : 'hover:text-ds-ink'
                  }`}
                  aria-pressed={activeTab === 'overview'}
                  onClick={() => setActiveTab('overview')}
                >
                  {t('usageHeatmapTabOverview')}
                </button>
                <button
                  type="button"
                  className={`min-h-7 rounded-md px-3 transition ${
                    activeTab === 'models' ? 'bg-ds-card text-ds-ink shadow-sm dark:bg-white/10' : 'hover:text-ds-ink'
                  }`}
                  title={t('usageHeatmapTabModels')}
                  aria-pressed={activeTab === 'models'}
                  onClick={() => setActiveTab('models')}
                >
                  {t('usageHeatmapTabModels')}
                </button>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                <div className="flex min-w-0 items-center gap-1 self-start rounded-lg bg-ds-subtle p-1 text-[12px] font-medium text-ds-muted sm:self-auto">
                  {USAGE_RANGE_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`min-h-7 rounded-md px-2.5 transition ${
                        rangeKey === key ? 'bg-ds-card text-ds-ink shadow-sm dark:bg-white/10' : 'hover:text-ds-ink'
                      }`}
                      aria-pressed={rangeKey === key}
                      onClick={() => onRangeChange?.(key)}
                    >
                      {t(`usageHeatmapRange.${key}`)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="inline-flex min-h-7 items-center justify-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-subtle px-2.5 text-[12px] font-medium text-ds-muted transition hover:text-ds-ink disabled:opacity-60"
                  onClick={onRefresh}
                  disabled={state.loading}
                  title={t('usageHeatmapRefresh')}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${state.loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
                  <span>{t('usageHeatmapRefresh')}</span>
                </button>
              </div>
            </div>
            {activeTab === 'overview' ? (
              <>
                <div className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {overviewMetrics.map((metric) => (
                    <Metric key={metric.label} label={metric.label} value={metric.value} />
                  ))}
                </div>
                <HeatmapGrid
                  buckets={heatmapBuckets}
                  loading={state.loading && heatmapBuckets.length === 0}
                  onSelect={setActiveBucket}
                />
                <p className="text-[11.5px] leading-5 text-ds-faint">
                  {t('usageHeatmapOverviewCaption', {
                    tokens: formatCompactNumber(totals.totalTokens),
                    activeDays: totals.activeDays
                  })}
                </p>
              </>
            ) : (
              <ModelUsagePanel
                state={modelState}
                fallbackModel={modelLabel}
                locale={i18n.language}
                initialActiveDayIndex={initialModelHoverIndex}
              />
            )}
          </div>
        </UsagePanelCard>
      </div>
    </div>
  )
}
