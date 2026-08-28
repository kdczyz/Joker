import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileEdit, Loader2, PanelRightClose } from 'lucide-react'
import type { GitDiffStatResult } from '@shared/git-changes'
import { formatFilePathForDisplay } from '../lib/diff-stats'
import { useChatStore } from '../store/chat-store'
import { DiffView } from './DiffView'

/**
 * Right-side change inspector — every file that differs from the remote
 * (upstream) branch, straight from git. Selecting a row reveals the file's
 * unified patch, whether the change came from this session or elsewhere.
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

  useEffect(() => {
    setStat(null)
    setPatch(null)
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10_000)
    return () => window.clearInterval(interval)
  }, [refresh])

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

  return (
    <aside
      className={`ds-no-drag ds-panel-ghost flex flex-col border-l border-ds-border-muted backdrop-blur-xl ${className ?? ''}`}
    >
      <div className="flex min-h-[58px] shrink-0 items-center gap-3 border-b border-ds-border-muted px-3 py-3">
        <button
          type="button"
          onClick={onCollapse}
          className="ds-sidebar-toggle-button shrink-0"
          aria-label={t('rightPanelCollapse')}
          title={t('rightPanelCollapse')}
        >
          <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide text-ds-muted">
            {t('inspectorTitle')}
          </div>
          <div className="mt-1 truncate text-[11px] text-ds-faint">
            {hasChanges
              ? t('inspectorSummaryFiles', { count: files.length })
              : t('inspectorEmpty')}
          </div>
        </div>
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
          <>
            <div className="max-h-[42%] min-h-0 overflow-y-auto py-2">
              <ul className="divide-y divide-ds-border-muted/60">
                {files.map((file) => {
                  const displayPath = formatFilePathForDisplay(file.path, workspaceRoot)
                  const selected = active?.path === file.path
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        onClick={() => selectInspectorItem(file.path)}
                        className={`flex w-full items-start gap-2 px-4 py-2.5 text-left transition ${
                          selected ? 'bg-ds-hover text-ds-ink' : 'text-ds-ink hover:bg-ds-hover/70'
                        }`}
                        title={file.path}
                      >
                        <FileEdit
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-muted"
                          strokeWidth={1.75}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] text-ds-ink">
                            {displayPath ?? file.path}
                          </div>
                          {file.added > 0 || file.removed > 0 ? (
                            <div className="mt-0.5 flex gap-2 text-[10px] font-mono">
                              <span className="text-ds-diff-added">+{file.added}</span>
                              <span className="text-ds-diff-removed">-{file.removed}</span>
                            </div>
                          ) : (
                            <div className="mt-0.5 text-[10px] text-ds-faint">
                              {t('inspectorNewFile')}
                            </div>
                          )}
                        </div>
                        {selected && patchLoading ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ds-faint" strokeWidth={2} />
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="ds-panel-strip flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-ds-border-muted">
              {patch ? (
                <DiffView patch={patch} maxHeight={9999} className="h-full min-w-0 rounded-none border-0" />
              ) : (
                <div className="ds-surface-soft flex h-full items-center justify-center border border-dashed border-ds-border-muted px-4 py-6 text-center text-[11px] leading-6 text-ds-muted">
                  {patchLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-ds-faint" strokeWidth={2} />
                  ) : (
                    t('inspectorSelectHint')
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
