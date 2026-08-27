import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCompactNumber } from '../hooks/use-thread-usage'
import {
  type DailyUsageBucket,
  useDailyUsageState
} from '../hooks/use-daily-usage'
import { HeatmapGrid } from './chat/InitialSessionUsageHeatmap'

function computeStats(buckets: DailyUsageBucket[]) {
  let totalTokens = 0
  let peakTokens = 0
  let totalTurns = 0

  for (const b of buckets) {
    totalTokens += b.totalTokens
    if (b.totalTokens > peakTokens) peakTokens = b.totalTokens
    totalTurns += b.turns
  }

  // Current consecutive days (from the end, backwards)
  let currentStreak = 0
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i].totalTokens > 0) currentStreak++
    else break
  }

  // Longest consecutive days
  let longestStreak = 0
  let streak = 0
  for (const b of buckets) {
    if (b.totalTokens > 0) {
      streak++
      if (streak > longestStreak) longestStreak = streak
    } else {
      streak = 0
    }
  }

  return { totalTokens, peakTokens, totalTurns, currentStreak, longestStreak }
}

function StatCard({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl bg-ds-subtle px-4 py-3">
      <span className="truncate text-center text-[20px] font-bold tabular-nums text-ds-ink">
        {value}
      </span>
      <span className="truncate text-center text-[12px] leading-tight text-ds-muted">
        {label}
      </span>
    </div>
  )
}

export function ProfileTokenUsage(): ReactElement {
  const { t } = useTranslation('settings')
  const state = useDailyUsageState(true, undefined, 365)

  const buckets = useMemo(
    () => state.usage?.buckets ?? [],
    [state.usage]
  )

  const stats = useMemo(() => computeStats(buckets), [buckets])

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard
          label={t('tokenStatTotalTokens')}
          value={formatCompactNumber(stats.totalTokens)}
        />
        <StatCard
          label={t('tokenStatPeakTokens')}
          value={formatCompactNumber(stats.peakTokens)}
        />
        <StatCard
          label={t('tokenStatTotalTurns')}
          value={formatCompactNumber(stats.totalTurns)}
        />
        <StatCard
          label={t('tokenStatCurrentStreak')}
          value={`${stats.currentStreak}`}
        />
        <StatCard
          label={t('tokenStatLongestStreak')}
          value={`${stats.longestStreak}`}
        />
      </div>

      {/* Heatmap section */}
      <div className="rounded-2xl border border-ds-border bg-ds-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-ds-ink">{t('tokenActivity')}</h3>
        </div>
        <div className="-mx-2">
          <HeatmapGrid
            buckets={buckets}
            loading={state.loading && buckets.length === 0}
            onSelect={() => {}}
          />
        </div>
      </div>
    </div>
  )
}
