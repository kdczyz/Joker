import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  Loader2,
  Monitor,
  Power,
  Smartphone,
  Wifi,
  WifiOff
} from 'lucide-react'
import { useAuth } from '../auth/AuthGate'

type AgentState = 'offline' | 'connecting' | 'online' | 'waiting'

interface CommandLogEntry {
  id: string
  summary?: string
  status: string
  timestamp: number
  events: { type: string; text?: string; message?: string; label?: string }[]
}

const STATE_LABELS: Record<AgentState, string> = {
  offline: '未连接',
  connecting: '连接中…',
  online: '已连接',
  waiting: '等待重连'
}

const STATE_COLORS: Record<AgentState, string> = {
  offline: 'text-ds-muted',
  connecting: 'text-amber-500',
  online: 'text-emerald-500',
  waiting: 'text-amber-500'
}

const AUTH_TOKEN_KEY = 'rcode.auth.session.v1'

export function RemoteAgentPanel(): ReactElement {
  const { user } = useAuth()
  const authenticated = Boolean(user) && !user.isGuest

  const [state, setState] = useState<AgentState>('offline')
  const [message, setMessage] = useState<string | undefined>()
  const [logs, setLogs] = useState<CommandLogEntry[]>([])
  const [busy, setBusy] = useState(false)

  // Subscribe to IPC events
  useEffect(() => {
    const unsubStatus = window.RcodeGui.remoteAgent.onStatus((payload) => {
      setState(payload.state as AgentState)
      setMessage(payload.message)
    })
    const unsubCommand = window.RcodeGui.remoteAgent.onCommand((payload) => {
      const cmd = payload as { id?: string; summary?: string; status?: string; updatedAt?: number }
      const cmdId = cmd.id
      if (!cmdId) return
      setLogs((prev) => {
        const existing = prev.find((e) => e.id === cmdId)
        const entry: CommandLogEntry = {
          id: cmdId,
          summary: cmd.summary ?? existing?.summary,
          status: cmd.status ?? existing?.status ?? 'unknown',
          timestamp: cmd.updatedAt ?? Date.now(),
          events: existing?.events ?? []
        }
        return [entry, ...prev.filter((e) => e.id !== cmdId)].slice(0, 20)
      })
    })
    const unsubEvent = window.RcodeGui.remoteAgent.onEvent((payload) => {
      const { commandId, event } = payload
      setLogs((prev) =>
        prev.map((entry) =>
          entry.id === commandId
            ? { ...entry, events: [...entry.events, { type: event.type as string, text: event.text as string | undefined, message: event.message as string | undefined, label: event.label as string | undefined }].slice(-8) }
            : entry
        )
      )
    })
    return () => {
      unsubStatus()
      unsubCommand()
      unsubEvent()
    }
  }, [])

  // Poll initial status
  useEffect(() => {
    void window.RcodeGui.remoteAgent.getStatus().then((s) => setState(s.state as AgentState))
  }, [])

  const isRunning = state === 'online' || state === 'connecting' || state === 'waiting'

  // Auto-connect when authenticated, auto-disconnect when not
  const autoConnectAttempted = useRef(false)
  useEffect(() => {
    if (authenticated && !autoConnectAttempted.current && state === 'offline') {
      autoConnectAttempted.current = true
      const token = localStorage.getItem(AUTH_TOKEN_KEY)
      if (token) {
        setBusy(true)
        window.RcodeGui.remoteAgent.start(token).then((res: { ok?: boolean; message?: string }) => {
          if (!res?.ok && res?.message) setMessage(res.message)
        }).finally(() => setBusy(false))
      }
    }
    if (!authenticated && isRunning) {
      void window.RcodeGui.remoteAgent.stop()
    }
  }, [authenticated, state, isRunning])

  const handleRetry = useCallback(async () => {
    if (!authenticated) return
    const token = localStorage.getItem(AUTH_TOKEN_KEY)
    if (!token) {
      setMessage('未找到登录凭证，请重新登录')
      return
    }
    setBusy(true)
    setMessage(undefined)
    try {
      await window.RcodeGui.remoteAgent.stop()
      const res = await window.RcodeGui.remoteAgent.start(token) as { ok?: boolean; message?: string }
      if (!res?.ok && res?.message) setMessage(res.message)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '重试失败')
    } finally {
      setBusy(false)
    }
  }, [authenticated])

  const handleToggle = useCallback(async () => {
    if (isRunning) {
      setBusy(true)
      try {
        await window.RcodeGui.remoteAgent.stop()
        setState('offline')
        setMessage(undefined)
      } finally {
        setBusy(false)
      }
    } else {
      if (!authenticated) return
      const token = localStorage.getItem(AUTH_TOKEN_KEY)
      if (!token) {
        setMessage('未找到登录凭证，请重新登录')
        return
      }
      setBusy(true)
      setMessage(undefined)
      try {
        const res = await window.RcodeGui.remoteAgent.start(token) as { ok?: boolean; message?: string }
        if (!res?.ok && res?.message) setMessage(res.message)
      } catch (err) {
        setMessage(err instanceof Error ? err.message : '连接失败')
      } finally {
        setBusy(false)
      }
    }
  }, [state, authenticated, isRunning])

  const stateIcon =
    state === 'online' ? <Wifi className="h-3.5 w-3.5" /> :
    state === 'offline' ? <WifiOff className="h-3.5 w-3.5" /> :
    <Loader2 className="h-3.5 w-3.5 animate-spin" />

  return (
    <div className="rounded-2xl border border-ds-border bg-ds-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
          <h3 className="text-[14px] font-semibold text-ds-ink">远程消息</h3>
          <span className={`flex items-center gap-1 text-[12px] font-medium ${STATE_COLORS[state]}`}>
            {stateIcon}
            {STATE_LABELS[state]}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void handleToggle()}
          disabled={busy || (!authenticated && !isRunning)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-medium transition disabled:opacity-40
            bg-ds-subtle text-ds-ink hover:bg-ds-hover"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
          {isRunning ? '断开' : '连接'}
        </button>
      </div>

      {/* Description */}
      <div className="px-4 pt-2 pb-3">
        <p className="text-[12.5px] text-ds-muted">
          登录后自动连接，手机端 App 登录同一账号即可远程向本机发送 Agent 任务，实时查看执行结果。
        </p>
        {message ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">
            <span className="shrink-0">⚠</span>
            <span className="flex-1 break-words">{message}</span>
            {(state === 'waiting' || state === 'offline') && authenticated ? (
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={busy}
                className="shrink-0 font-medium underline disabled:opacity-40"
              >
                重试
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Device info when online */}
      {state === 'online' ? (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-ds-subtle px-3 py-2 text-[12px] text-ds-muted">
          <Monitor className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>本机已注册为被控端，等待手机端指令</span>
        </div>
      ) : null}

      {/* Activity log */}
      {logs.length > 0 ? (
        <div className="border-t border-ds-border-muted px-4 py-3">
          <div className="mb-2 text-[12.5px] font-medium text-ds-muted">最近任务</div>
          <div className="flex flex-col gap-2">
            {logs.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-medium text-ds-ink">
                    {entry.summary || entry.id.slice(0, 8)}
                  </span>
                  <span className={`shrink-0 text-[11px] font-medium ${
                    entry.status === 'completed' ? 'text-emerald-500' :
                    entry.status === 'failed' ? 'text-red-500' :
                    entry.status === 'running' ? 'text-amber-500' :
                    'text-ds-faint'
                  }`}>
                    {entry.status}
                  </span>
                </div>
                {entry.events.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    {entry.events.slice(-3).map((ev, i) => (
                      <div key={i} className="truncate text-[11.5px] text-ds-faint">
                        {ev.type === 'text_delta' && ev.text ? ev.text.slice(0, 120) :
                         ev.type === 'workflow_state' && ev.label ? ev.label :
                         ev.type === 'error' && ev.message ? `错误: ${ev.message}` :
                         ev.type === 'completed' ? '已完成' :
                         ev.type === 'stopped' ? '已终止' :
                         ev.type}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
