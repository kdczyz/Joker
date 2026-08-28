import { useState, type KeyboardEvent, type ReactElement } from 'react'
import {
  ArrowLeft,
  CloudUpload,
  FileEdit,
  GitCommitHorizontal,
  Loader2,
  Maximize2,
  Sparkles
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitDiffStatResult } from '@shared/git-changes'
import { DiffCounter } from './RollingDigit'
import { GitBranchPicker } from './GitBranchPicker'

type Props = {
  workspaceRoot: string
  stat: GitDiffStatResult | null
  onOpenChanges: () => void
  onRefreshStat: () => void
}

type BusyAction = 'commit' | 'commitPush' | 'push' | null

export function GitToolsPanel({
  workspaceRoot,
  stat,
  onOpenChanges,
  onRefreshStat
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [view, setView] = useState<'tools' | 'commit'>('tools')
  const [message, setMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [error, setError] = useState<string | null>(null)

  const diffReady = stat?.ok === true
  const added = diffReady ? stat.added : 0
  const removed = diffReady ? stat.removed : 0
  const unstagedCount = diffReady ? stat.unstagedFiles + stat.untrackedFiles : 0
  const hasDiff = diffReady && stat.fileCount > 0
  const commitDisabled = !diffReady || !hasDiff || (!includeUnstaged && stat.stagedFiles === 0)
  const suggestion = stat?.ok === true ? stat.suggestion : ''

  const runGit = async (action: Exclude<BusyAction, null>): Promise<void> => {
    const api = window.JokerGui
    if (!api?.commitGitChanges || !api.pushGitChanges) return
    setBusy(action)
    setError(null)
    try {
      if (action === 'push') {
        const result = await api.pushGitChanges(workspaceRoot)
        if (!result.ok) {
          setError(result.message)
          return
        }
      } else {
        const result = await api.commitGitChanges({
          workspaceRoot,
          message: message.trim() || undefined,
          includeUnstaged,
          push: action === 'commitPush'
        })
        if (!result.ok) {
          setError(result.message)
          return
        }
        setMessage('')
        if (action === 'commitPush') setView('tools')
      }
      onRefreshStat()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const submitOnModifierEnter = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!commitDisabled && busy === null) void runGit('commit')
    }
  }

  if (view === 'commit') {
    return (
      <div className="w-[340px] max-w-[calc(100vw-24px)] p-3">
        <div className="mb-2 flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setView('tools')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-subtle hover:text-ds-ink"
            aria-label={t('gitToolsBackToTools')}
            title={t('gitToolsBackToTools')}
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1">
            <GitBranchPicker workspaceRoot={workspaceRoot} />
          </div>
          <span className="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-medium">
            <DiffCounter value={added} prefix="+" className="text-ds-diff-added" />
            <DiffCounter value={removed} prefix="-" className="text-ds-diff-removed" />
          </span>
        </div>
        <div className="relative">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={submitOnModifierEnter}
            placeholder={t('gitToolsCommitMessagePlaceholder')}
            rows={5}
            className="w-full resize-none rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2.5 text-[13px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/50"
          />
          <button
            type="button"
            disabled={busy !== null || !suggestion}
            onClick={() => setMessage(suggestion)}
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-subtle hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('gitToolsGenerateMessage')}
            title={t('gitToolsGenerateMessage')}
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        </div>
        <label className="mt-2 flex min-w-0 cursor-pointer items-center gap-2.5 px-1 py-1.5">
          <input
            type="checkbox"
            checked={includeUnstaged}
            onChange={(event) => setIncludeUnstaged(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-zinc-900 dark:accent-white"
          />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ds-ink">
            {t('gitToolsIncludeUnstaged')}
          </span>
          <span className="shrink-0 text-[12.5px] text-ds-faint">
            {t('gitToolsFileCount', { count: unstagedCount })}
          </span>
        </label>
        {error ? (
          <div className="mb-1 mt-1 flex gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/35 dark:text-amber-100">
            <span className="min-w-0 break-words">{error}</span>
          </div>
        ) : null}
        <div className="mt-1 flex flex-col gap-0.5 border-t border-ds-border-muted pt-2">
          <button
            type="button"
            disabled={commitDisabled || busy !== null}
            onClick={() => void runGit('commit')}
            className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {busy === 'commit' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ds-muted" strokeWidth={2} />
            ) : (
              <GitCommitHorizontal className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
            )}
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ds-ink">
              {t('gitToolsCommit')}
            </span>
            <span className="shrink-0 text-[11.5px] text-ds-faint">⌘↩</span>
          </button>
          <button
            type="button"
            disabled={commitDisabled || busy !== null}
            onClick={() => void runGit('commitPush')}
            className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {busy === 'commitPush' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ds-muted" strokeWidth={2} />
            ) : (
              <CloudUpload className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
            )}
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ds-ink">
              {t('gitToolsCommitAndPush')}
            </span>
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void runGit('push')}
            className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {busy === 'push' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ds-muted" strokeWidth={2} />
            ) : (
              <CloudUpload className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
            )}
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ds-ink">
              {t('gitToolsPush')}
            </span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-[320px] max-w-[calc(100vw-24px)] p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ds-ink">{t('gitToolsTitle')}</span>
        <button
          type="button"
          onClick={onOpenChanges}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-subtle hover:text-ds-ink"
          aria-label={t('gitToolsOpenChanges')}
          title={t('gitToolsOpenChanges')}
        >
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="flex flex-col">
        <button
          type="button"
          onClick={onOpenChanges}
          className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-2 text-left transition hover:bg-ds-hover"
          title={t('gitToolsOpenChanges')}
        >
          <FileEdit className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ds-ink">
            {t('gitToolsChanges')}
          </span>
          {hasDiff ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-medium">
              <DiffCounter value={added} prefix="+" className="text-ds-diff-added" />
              <DiffCounter value={removed} prefix="-" className="text-ds-diff-removed" />
            </span>
          ) : (
            <span className="shrink-0 text-[12.5px] text-ds-faint">{t('gitToolsNoChanges')}</span>
          )}
        </button>
        <div className="min-w-0 px-1 py-0.5">
          <GitBranchPicker workspaceRoot={workspaceRoot} />
        </div>
        <button
          type="button"
          onClick={() => setView('commit')}
          className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-2 text-left transition hover:bg-ds-hover"
        >
          <GitCommitHorizontal className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ds-ink">
            {t('gitToolsCommitOrPush')}
          </span>
        </button>
      </div>
    </div>
  )
}
