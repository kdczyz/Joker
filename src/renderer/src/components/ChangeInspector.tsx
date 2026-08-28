import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileEdit,
  Loader2,
  PanelRightClose,
  RefreshCw
} from 'lucide-react'
import type { GitDiffStatFile, GitDiffStatResult } from '@shared/git-changes'
import { useChatStore } from '../store/chat-store'
import { badgeFor } from './DiffView'
import { InspectorFileDiff } from './InspectorFileDiff'

/**
 * Right-side change inspector styled like an editor review pane: a list of
 * changed files (badge, name, dimmed folder, +/- stats) where the selected
 * file expands inline into a syntax-highlighted diff with collapsible runs
 * of unmodified lines.
 */
export function ChangeInspector({
  className,
  onCollapse
}: {
  className?: string
  onCollapse: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const selectedId = useChatStore((s) => s.inspectorSelectedId)
  const selectInspectorItem = useChatStore((s) => s.selectInspectorItem)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)

  const [stat, setStat] = useState<GitDiffStatResult | null>(null)
  const [patch, setPatch] = useState<string | null>(null)
  const [patchLoading, setPatchLoading] = useState(false)
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const patchRequestRef = useRef(0)

  const files = useMemo(() => (stat?.ok === true ? stat.files : []), [stat])

  const refresh = useCallback(async (): Promise<void> => {
    if (!workspaceRoot || typeof window.JokerGui?.getGitDiffStat !== 'function') return
    try {
      const next = await window.JokerGui.getGitDiffStat(workspaceRoot)
      setStat(next)
    } catch {
      // Keep the previous listing on transient IPC failures.
    }
  }, [workspaceRoot])

  const handleRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }, [refresh])

  useEffect(() => {
    setStat(null)
    setPatch(null)
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10_000)
    return () => window.clearInterval(interval)
  }, [refresh])

  // Follow store selection: picking a file expands its inline diff.
  useEffect(() => {
    setExpandedPath(selectedId)
  }, [selectedId])

  useEffect(() => {
    const path = selectedId
    if (!path || !files.some((file) => file.path === path)) {
      const fallback = files[files.length - 1]?.path ?? null
      if (fallback !== path) selectInspectorItem(fallback)
      return
    }
    const request = ++patchRequestRef.current
    setPatchLoading(true)
    setPatch(null)
    void window.JokerGui
      ?.getGitFileDiff({ workspaceRoot, path })
      .then((result) => {
        if (patchRequestRef.current !== request) return
        setPatch(result.ok ? result.patch : null)
      })
      .catch(() => {
        if (patchRequestRef.current === request) setPatch(null)
      })
      .finally(() => {
        if (patchRequestRef.current === request) setPatchLoading(false)
      })
  }, [files, selectInspectorItem, selectedId, workspaceRoot])

  const active = files.find((file) => file.path === selectedId) ?? files[files.length - 1] ?? null
  const hasChanges = files.length > 0

  const toggleRow = (file: GitDiffStatFile): void => {
    if (expandedPath === file.path) {
      setExpandedPath(null)
      return
    }
    selectInspectorItem(file.path)
  }

  const copyPatch = async (file: GitDiffStatFile): Promise<void> => {
    if (file.path !== active?.path || !patch) return
    try {
      await navigator.clipboard.writeText(patch)
      setCopiedPath(file.path)
      window.setTimeout(() => setCopiedPath((current) => (current === file.path ? null : current)), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <aside
      className={`ds-no-drag ds-panel-ghost flex flex-col border-l border-ds-border-muted backdrop-blur-xl ${className ?? ''}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted px-3 py-2.5">
        <button
          type="button"
          onClick={onCollapse}
          className="ds-sidebar-toggle-button shrink-0"
          aria-label={t('rightPanelCollapse')}
          title={t('rightPanelCollapse')}
        >
          <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
        </button>
        <div
          className="flex items-center gap-2 rounded-lg bg-ds-hover px-2.5 py-1.5 text-[12px] text-ds-muted"
          title={t('inspectorSummaryFiles', { count: files.length })}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ds-diff-added" />
          {t('inspectorUncommitted')}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void handleRefresh()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            strokeWidth={1.85}
          />
          {t('inspectorRefresh')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!hasChanges ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
            <div>
              <FileEdit className="mx-auto h-7 w-7 text-ds-faint" strokeWidth={1.25} />
              <div className="mt-3 text-[12px] font-medium text-ds-muted">
                {t('inspectorEmptyTitle')}
              </div>
              <div className="mt-1 text-[11px] leading-6 text-ds-faint">{t('inspectorEmpty')}</div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {files.map((file) => {
              const selected = active?.path === file.path
              const expanded = expandedPath === file.path
              const badge = badgeFor(file.path)
              const name = file.path.split(/[/\\]/).pop() ?? file.path
              const nameIndex = file.path.lastIndexOf(name)
              const dir = nameIndex > 0 ? file.path.slice(0, nameIndex) : ''
              const copied = copiedPath === file.path
              return (
                <div key={file.path}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => selectInspectorItem(file.path)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        selectInspectorItem(file.path)
                      }
                    }}
                    className={`group flex w-full cursor-pointer items-center gap-2 px-3 py-2 transition ${
                      selected ? 'bg-ds-hover' : 'hover:bg-ds-hover/60'
                    }`}
                    title={file.path}
                  >
                    <span
                      className={`flex h-5 w-6 shrink-0 items-center justify-center rounded text-[9px] font-bold ${badge.tone}`}
                    >
                      {badge.label}
                    </span>
                    <span className="max-w-[45%] shrink-0 truncate text-[12.5px] text-ds-ink">
                      {name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ds-faint">{dir}</span>
                    {file.added > 0 || file.removed > 0 ? (
                      <span className="flex shrink-0 gap-2 font-mono text-[12px] tabular-nums">
                        <span className="text-ds-diff-added">+{file.added}</span>
                        <span className="text-ds-diff-removed">-{file.removed}</span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-ds-faint">
                        {t('inspectorNewFile')}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void copyPatch(file)
                      }}
                      className={`shrink-0 rounded p-0.5 text-ds-faint transition hover:text-ds-ink ${
                        selected && patch ? 'opacity-0 group-hover:opacity-100' : 'invisible'
                      }`}
                      aria-label="Copy diff"
                      title="Copy diff"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-ds-diff-added" strokeWidth={2} />
                      ) : (
                        <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleRow(file)
                      }}
                      className="shrink-0 rounded p-0.5 text-ds-faint transition hover:text-ds-ink"
                      aria-label={file.path}
                      aria-expanded={expanded}
                    >
                      {expanded ? (
                        <ChevronUp className="h-4 w-4" strokeWidth={2} />
                      ) : (
                        <ChevronDown className="h-4 w-4" strokeWidth={2} />
                      )}
                    </button>
                  </div>

                  {expanded && selected ? (
                    patchLoading ? (
                      <div className="flex items-center justify-center gap-2 border-y border-ds-border-muted/60 px-4 py-6 text-[11px] text-ds-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                      </div>
                    ) : patch ? (
                      <InspectorFileDiff patch={patch} filePath={file.path} />
                    ) : (
                      <div className="border-y border-ds-border-muted/60 px-4 py-5 text-center text-[11px] text-ds-faint">
                        {t('inspectorSelectHint')}
                      </div>
                    )
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
