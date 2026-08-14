/**
 * CodexUsageBadge
 *
 * 显示当前选中的 codex（ChatGPT / Codex OAuth）账号的速率限额用量徽章。
 *
 * 数据来源：主进程 `codex:account:usage`（→ ChatGPT `backend-api/wham/usage`），
 * 与 sub2api 逆向出的端点一致——返回 `plan_type` + 5h/7d 双窗口用量百分比与重置倒计时。
 *
 * 重要说明：`/wham/usage` 给的是「速率窗口用量百分比」，不是美元余额。
 * 仅当账号为 Codex OAuth 登录（非 API Key）时才显示；未配置 / 非 codex 时不占工具栏空间。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type UsageOk = Extract<
  import('@shared/Rcode-gui-api').CodexAccountUsageResult,
  { ok: true }
>
type UsageState =
  | { status: 'loading' }
  | { status: 'ok'; data: UsageOk }
  | { status: 'hidden' } // 未登录 OAuth / 未配置 / 非 codex
  | { status: 'error'; message: string }

// 这些错误意味着「当前没有可显示的 OAuth 额度」，直接隐藏而非报错。
const HIDDEN_HINTS = ['not configured', 'oauth', 'not an oauth', 'provider']

function isHiddenError(message: string): boolean {
  const lower = message.toLowerCase()
  return HIDDEN_HINTS.some((hint) => lower.includes(hint))
}

function planLabel(planType?: string): string {
  if (!planType || planType === 'unknown') return 'Codex'
  return planType.charAt(0).toUpperCase() + planType.slice(1)
}

function usageColor(pct?: number): string {
  if (pct == null) return 'var(--ds-surface-subtle, #cbd5e1)'
  if (pct < 70) return '#10b981' // emerald-500
  if (pct < 90) return '#f59e0b' // amber-500
  return '#f43f5e' // rose-500
}

function formatReset(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return ''
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function UsageRing({ percent, color }: { percent?: number; color: string }) {
  const size = 16
  const stroke = 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.min(1, Math.max(0, (percent ?? 0) / 100))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ds-surface-subtle, rgba(120,120,120,0.25))"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
      />
    </svg>
  )
}

export interface CodexUsageBadgeProps {
  providerId?: string
}

export function CodexUsageBadge({ providerId }: CodexUsageBadgeProps) {
  const [state, setState] = useState<UsageState>({ status: 'loading' })
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)

  const refresh = useCallback(async (silent = false) => {
    if (typeof window.RcodeGui?.codexAccountUsage !== 'function') {
      setState({ status: 'hidden' })
      return
    }
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (!silent) setState((prev) => (prev.status === 'ok' ? prev : { status: 'loading' }))
    try {
      const result = await window.RcodeGui.codexAccountUsage()
      if (!mountedRef.current) return
      if (result.ok) {
        setState({ status: 'ok', data: result })
      } else if (isHiddenError(result.message)) {
        setState({ status: 'hidden' })
      } else {
        setState({ status: 'error', message: result.message })
      }
    } catch (err) {
      if (!mountedRef.current) return
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (providerId !== 'codex') {
      setState({ status: 'hidden' })
      return
    }
    void refresh()
    const timer = setInterval(() => void refresh(true), 30_000)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, refresh])

  if (state.status === 'hidden') return null

  if (state.status === 'loading') {
    // 首轮加载：极轻量占位，避免空白闪现
    return (
      <span
        className="ds-no-drag inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] text-ds-muted"
        title="正在获取 Codex 额度…"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400 dark:bg-zinc-500" />
      </span>
    )
  }

  if (state.status === 'error') {
    return (
      <button
        type="button"
        onClick={() => void refresh()}
        className="ds-no-drag inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] text-rose-500 transition hover:bg-ds-hover"
        title={`额度获取失败：${state.message}（点击重试）`}
        aria-label="额度获取失败，点击重试"
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
    )
  }

  const { data } = state
  const color = usageColor(data.primaryUsedPercent)
  const primaryReset = formatReset(data.primaryResetAfterSeconds)
  const secondaryReset = formatReset(data.secondaryResetAfterSeconds)
  const titleLines = [
    `套餐：${planLabel(data.planType)}`,
    `主窗口用量：${data.primaryUsedPercent != null ? Math.round(data.primaryUsedPercent) : '—'}%${primaryReset ? `（${primaryReset} 后重置）` : ''}`,
    `次窗口用量：${data.secondaryUsedPercent != null ? Math.round(data.secondaryUsedPercent) : '—'}%${secondaryReset ? `（${secondaryReset} 后重置）` : ''}`,
    '点击刷新'
  ]

  return (
    <button
      type="button"
      onClick={() => void refresh(true)}
      className="ds-no-drag inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium text-ds-ink transition hover:bg-ds-hover"
      title={titleLines.join('\n')}
      aria-label={`Codex 额度：${planLabel(data.planType)}，主窗口用量 ${data.primaryUsedPercent != null ? Math.round(data.primaryUsedPercent) : '未知'}%`}
    >
      <UsageRing percent={data.primaryUsedPercent} color={color} />
      <span className="tabular-nums">{planLabel(data.planType)}</span>
      <span className="tabular-nums text-ds-muted">
        {data.primaryUsedPercent != null ? `${Math.round(data.primaryUsedPercent)}%` : '—'}
      </span>
    </button>
  )
}
