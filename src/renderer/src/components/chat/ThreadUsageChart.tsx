import { useEffect, useMemo, useRef, useState, type ReactElement, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  cumulativeCacheHitRate,
  formatCompactNumber,
  formatCost,
  formatPercent,
  type ThreadUsageSeriesPoint
} from '../../hooks/use-thread-usage'

const CHART_W = 340
const CHART_H = 176
const PAD = { left: 44, right: 12, top: 14, bottom: 26 }
const PLOT_W = CHART_W - PAD.left - PAD.right
const PLOT_H = CHART_H - PAD.top - PAD.bottom
const TURNS_PER_PAGE = 20
/** Pointer drag beyond this many px is treated as a swipe, not a click. */
const DRAG_THRESHOLD = 6

type SeriesKey = 'total' | 'cached' | 'miss'

const SERIES: ReadonlyArray<{
  key: SeriesKey
  labelKey: string
  color: string
}> = [
  { key: 'total', labelKey: 'usageChartLegendTotal', color: '#3b82f6' },
  { key: 'cached', labelKey: 'usageChartLegendCached', color: '#10b981' },
  { key: 'miss', labelKey: 'usageChartLegendMiss', color: '#f59e0b' }
]

function yFor(value: number, maxY: number): number {
  if (maxY <= 0) return PAD.top + PLOT_H
  return PAD.top + (1 - value / maxY) * PLOT_H
}

function xFor(index: number, count: number): number {
  if (count <= 1) return PAD.left + PLOT_W / 2
  return PAD.left + (index / (count - 1)) * PLOT_W
}

function seriesValue(point: ThreadUsageSeriesPoint, key: SeriesKey): number {
  if (key === 'cached') return point.cachedTokens
  if (key === 'miss') return point.cacheMissTokens
  return point.totalTokens
}

function xTickIndexesFor(count: number): number[] {
  if (count <= 6) return Array.from({ length: count }, (_, i) => i)
  return Array.from(
    new Set([
      0,
      Math.floor((count - 1) / 4),
      Math.floor((count - 1) / 2),
      Math.floor((3 * (count - 1)) / 4),
      count - 1
    ])
  )
}

/**
 * Hand-rolled SVG line chart of the session-live token-usage series. No chart
 * library is used. Plots cumulative total / cached / cache-miss tokens across
 * conversation turns with a hover guide + tooltip.
 *
 * The series is split into pages of up to 20 turns. The pages live on a
 * horizontally swipeable track (drag, touch, or trackpad). The track opens on
 * the newest page so the latest turns are shown first.
 */
export function ThreadUsageChart({
  series,
  locale
}: {
  series: ThreadUsageSeriesPoint[]
  locale: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [hover, setHover] = useState<{ page: number; index: number } | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ active: boolean; moved: boolean; startX: number; startScroll: number }>({
    active: false,
    moved: false,
    startX: 0,
    startScroll: 0
  })

  const count = series.length
  const pages = useMemo(() => {
    const chunks: ThreadUsageSeriesPoint[][] = []
    for (let i = 0; i < series.length; i += TURNS_PER_PAGE) {
      chunks.push(series.slice(i, i + TURNS_PER_PAGE))
    }
    return chunks
  }, [series])
  const pageCount = pages.length

  // Open on the newest page (latest turns) when the data or page count changes.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      const node = scrollRef.current
      if (node) node.scrollLeft = node.scrollWidth
    })
  }, [pageCount])

  if (count === 0) {
    return (
      <div className="grid min-h-[150px] place-items-center rounded-lg bg-ds-subtle px-4 text-center text-[12.5px] leading-5 text-ds-faint">
        {t('usageChartEmpty')}
      </div>
    )
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el) return
    drag.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startScroll: el.scrollLeft
    }
    setHover(null)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || !drag.current.active) return
    const delta = event.clientX - drag.current.startX
    if (Math.abs(delta) > DRAG_THRESHOLD) drag.current.moved = true
    el.scrollLeft = drag.current.startScroll - delta
  }

  const endDrag = () => {
    drag.current.active = false
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const page = Math.round(el.scrollLeft / Math.max(1, el.clientWidth))
    setCurrentPage(Math.min(pageCount - 1, Math.max(0, page)))
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        {SERIES.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5 text-[12px] text-ds-muted">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: entry.color }} aria-hidden />
            {t(entry.labelKey)}
          </span>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory select-none overflow-x-auto overscroll-x-contain cursor-grab active:cursor-grabbing"
        style={{ scrollbarWidth: 'none', touchAction: 'pan-x' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onScroll={onScroll}
      >
        {pages.map((pagePoints, pageIndex) => (
          <div key={pageIndex} className="w-full min-w-0 shrink-0 snap-center px-1">
            <ChartPage
              points={pagePoints}
              locale={locale}
              hoverIndex={hover && hover.page === pageIndex ? hover.index : null}
              dragging={drag.current.active && drag.current.moved}
              onHoverMove={(index) =>
                setHover(index == null ? null : { page: pageIndex, index })
              }
            />
          </div>
        ))}
      </div>

      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {pages.map((_, index) => (
            <span
              key={index}
              className={`h-1.5 rounded-full transition-colors ${
                index === currentPage ? 'w-4 bg-accent' : 'w-1.5 bg-ds-border'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ChartPage({
  points,
  locale,
  hoverIndex,
  dragging,
  onHoverMove
}: {
  points: ThreadUsageSeriesPoint[]
  locale: string
  hoverIndex: number | null
  dragging: boolean
  onHoverMove: (index: number | null) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const count = points.length
  const maxY = useMemo(() => Math.max(1, ...points.map((point) => point.totalTokens)), [points])
  const gridValues = useMemo(
    () => [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(maxY * fraction)),
    [maxY]
  )
  const xTickIndexes = xTickIndexesFor(count)
  const active = hoverIndex != null && hoverIndex >= 0 && hoverIndex < count ? points[hoverIndex] : null

  return (
    <div
      className="relative w-full"
      onMouseMove={(event) => {
        if (dragging) return
        const rect = event.currentTarget.getBoundingClientRect()
        const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
        onHoverMove(Math.round(fraction * (count - 1)))
      }}
      onMouseLeave={() => onHoverMove(null)}
    >
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" role="img" aria-label={t('usageChartTitle')}>
        {gridValues.map((value, index) => {
          const y = yFor(value, maxY)
          return (
            <g key={index}>
              <line
                x1={PAD.left}
                y1={y}
                x2={CHART_W - PAD.right}
                y2={y}
                stroke="var(--ds-border-muted)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                style={{ fill: 'var(--ds-faint)' }}
              >
                {formatCompactNumber(value)}
              </text>
            </g>
          )
        })}

        {xTickIndexes.map((index) => (
          <text
            key={index}
            x={xFor(index, count)}
            y={CHART_H - 9}
            textAnchor="middle"
            fontSize={9}
            style={{ fill: 'var(--ds-faint)' }}
          >
            {points[index].turn}
          </text>
        ))}

        {SERIES.map((entry) => (
          <polyline
            key={entry.key}
            points={points
              .map((point, index) => `${xFor(index, count)},${yFor(seriesValue(point, entry.key), maxY)}`)
              .join(' ')}
            fill="none"
            stroke={entry.color}
            strokeWidth={entry.key === 'total' ? 2 : 1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {points.map((point, index) => (
          <g key={index}>
            <circle cx={xFor(index, count)} cy={yFor(point.totalTokens, maxY)} r={2.5} fill="#3b82f6" />
            <circle cx={xFor(index, count)} cy={yFor(point.cachedTokens, maxY)} r={2} fill="#10b981" />
            <circle cx={xFor(index, count)} cy={yFor(point.cacheMissTokens, maxY)} r={2} fill="#f59e0b" />
          </g>
        ))}

        {active ? (
          <line
            x1={xFor(hoverIndex as number, count)}
            y1={PAD.top}
            x2={xFor(hoverIndex as number, count)}
            y2={PAD.top + PLOT_H}
            stroke="var(--accent)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ) : null}
      </svg>

      {active ? (() => {
        const xPercent = (xFor(hoverIndex as number, count) / CHART_W) * 100
        const yPercent = (yFor(active.totalTokens, maxY) / CHART_H) * 100
        const isNearTop = yPercent < 48
        const isNearLeft = (hoverIndex as number) <= 1 && count > 3
        const isNearRight = (hoverIndex as number) >= count - 2 && count > 3

        const xTransform = isNearLeft ? 'translate-x-0' : isNearRight ? '-translate-x-full' : '-translate-x-1/2'
        const yTransform = isNearTop ? 'translate-y-3' : '-translate-y-[calc(100%+8px)]'

        return (
          <div
            className={`pointer-events-none absolute z-10 w-[min(14.5rem,80%)] ${xTransform} ${yTransform} rounded-xl border border-ds-border bg-white/98 dark:bg-[#212322] p-2.5 text-[12px] shadow-[0_14px_38px_rgba(20,47,95,0.16)] backdrop-blur-xl transition-transform duration-75`}
            style={{
              left: `${xPercent}%`,
              top: `${yPercent}%`
            }}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="font-semibold text-ds-ink">
                {t('usageChartTurnLabel', { turn: active.turn })}
              </span>
              <span className="tabular-nums text-ds-muted">
                {formatCost(active.costUsd, locale, active.costCny)}
              </span>
            </div>
            <div className="grid gap-1">
              <ChartTooltipRow
                color="#3b82f6"
                label={t('sessionUsageTokens', { tokens: formatCompactNumber(active.totalTokens) })}
              />
              <ChartTooltipRow
                color="#10b981"
                label={t('sessionUsageCached', { tokens: formatCompactNumber(active.cachedTokens) })}
              />
              <ChartTooltipRow
                color="#f59e0b"
                label={t('sessionUsageMiss', { tokens: formatCompactNumber(active.cacheMissTokens) })}
              />
              <ChartTooltipRow
                color="#94a3b8"
                label={t('sessionUsageCache', { cache: formatPercent(cumulativeCacheHitRate(active)) })}
              />
            </div>
          </div>
        )
      })() : null}
    </div>
  )
}

function ChartTooltipRow({ color, label }: { color: string; label: string }): ReactElement {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-2">
      <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: color }} aria-hidden />
      <span className="min-w-0 truncate text-ds-muted">{label}</span>
    </div>
  )
}
