import {
  useEffect,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FolderPlus,
  GitBranch,
  Loader2,
  MoreVertical,
  Pin,
  PinOff,
  RotateCcw,
  Trash2
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { formatRelativeTime } from '../../lib/format-relative-time'
import type { SddDraftHistoryItem } from '../../sdd/sdd-draft-history'
import type { SddDraft } from '../../sdd/sdd-draft-store'
import { SidebarIconButton, SidebarTreeRow } from '../sidebar/SidebarPrimitives'
import type { SidebarThreadWorktreeRecord } from './sidebar-project-selectors'
import type { SidebarDropPosition } from './sidebar-order'
import {
  THREAD_STATUS_DOT_COLOR,
  THREAD_STATUS_DOT_PULSE,
  threadStatusDotForThread,
  type ThreadStatusDot
} from './thread-status-dot'

const DRAFT_HISTORY_PAGE_SIZE = 3

export function SddDraftHistoryRows({
  items,
  activeDraftId,
  onOpen,
  onDelete,
  deletingDraftIds = {},
  error = '',
  t
}: {
  items: SddDraftHistoryItem[]
  activeDraftId: string
  onOpen: (draft: SddDraft) => void
  onDelete?: (draft: SddDraftHistoryItem) => void
  deletingDraftIds?: Record<string, boolean>
  error?: string
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement | null {
  const itemKey = items.map((item) => item.id).join('\n')
  const [collapsed, setCollapsed] = useState(true)
  const [visibleCount, setVisibleCount] = useState(DRAFT_HISTORY_PAGE_SIZE)

  useEffect(() => {
    setCollapsed(true)
    setVisibleCount(DRAFT_HISTORY_PAGE_SIZE)
  }, [itemKey])

  if (items.length === 0) return null
  const visibleItems = items.slice(0, visibleCount)
  const remainingCount = Math.max(0, items.length - visibleItems.length)
  const nextCount = Math.min(DRAFT_HISTORY_PAGE_SIZE, remainingCount)

  return (
    <div className="mb-1.5 rounded-lg border border-transparent bg-[var(--ds-sidebar-row-hover)]/35 px-1 py-1">
      <SidebarTreeRow
        title={t('sddDraftHistoryTitle')}
        ariaLabel={collapsed ? t('sddDraftHistoryExpand') : t('sddDraftHistoryCollapse')}
        onClick={() => setCollapsed((current) => !current)}
        className="min-h-[28px]"
        buttonClassName="items-center gap-1.5 px-2 py-1.5"
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
          : <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ds-faint">
          {t('sddDraftHistoryTitle')}
        </span>
        <span className="shrink-0 rounded-md bg-ds-card/70 px-1.5 py-0.5 text-[10.5px] text-ds-faint tabular-nums">
          {items.length}
        </span>
      </SidebarTreeRow>
      {error ? <div className="px-2 py-1 text-[11.5px] leading-4 text-red-600 dark:text-red-300">{error}</div> : null}
      {!collapsed ? (
        <div className="space-y-[2px] pt-1">
          {visibleItems.map((item) => (
            <SidebarTreeRow
              key={item.id}
              active={activeDraftId === item.id}
              activeVariant="outline"
              actionsVisibility={deletingDraftIds[item.id] ? 'visible' : 'hidden'}
              actionsLayout="overlay"
              actions={onDelete ? (
                <SidebarIconButton
                  onClick={() => onDelete(item)}
                  disabled={deletingDraftIds[item.id] === true}
                  tone="danger"
                  title={t('sddDraftHistoryDelete')}
                  ariaLabel={t('sddDraftHistoryDelete')}
                  stopPropagation
                >
                  {deletingDraftIds[item.id]
                    ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                    : <Trash2 className="h-3 w-3" strokeWidth={1.9} />}
                </SidebarIconButton>
              ) : null}
              className="min-h-[32px]"
              buttonClassName="items-center gap-2 px-2 py-1.5"
              title={item.relativePath}
              ariaLabel={t('sddDraftHistoryOpen', { title: item.title })}
              onClick={() => onOpen(item)}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition ${
                  activeDraftId === item.id
                    ? 'border-accent/25 bg-accent/10 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]'
                    : 'border-ds-border-muted bg-ds-card/70 text-ds-faint group-hover:border-accent/20 group-hover:bg-accent/10 group-hover:text-accent'
                }`}
                aria-hidden="true"
              >
                <ClipboardList className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-4 text-ds-ink">{item.title}</span>
                <span className="block truncate text-[11.5px] leading-4 text-ds-faint">{item.relativePath}</span>
              </span>
              <span className="shrink-0 rounded-md bg-ds-card/70 px-1.5 py-0.5 text-[10.5px] text-ds-faint transition group-hover:opacity-0 group-focus-within:opacity-0">
                {item.source === 'remembered' ? t('sddDraftHistoryRemembered') : t('sddDraftHistoryDisk')}
              </span>
            </SidebarTreeRow>
          ))}
        </div>
      ) : null}
      {!collapsed && remainingCount > 0 ? (
        <button
          type="button"
          data-cursor-spotlight-target
          onClick={() => setVisibleCount((count) => Math.min(items.length, count + DRAFT_HISTORY_PAGE_SIZE))}
          className="ml-1 mt-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
        >
          {t('sddDraftHistoryShowMore', { count: nextCount })}
        </button>
      ) : null}
    </div>
  )
}

type ThreadRowProps = {
  thread: NormalizedThread
  worktreeRecord?: SidebarThreadWorktreeRecord
  active: boolean
  deleting: boolean
  locale: string
  showRunning: boolean
  showUnread: boolean
  statusDotAcknowledged: boolean
  onSelect: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
  onPreviewOpen: (
    event: ReactMouseEvent<HTMLDivElement>,
    worktreeRecord?: SidebarThreadWorktreeRecord
  ) => void
  onPreviewClose: () => void
  draggable?: boolean
  dragging?: boolean
  dropPosition?: SidebarDropPosition | null
  onDragStart?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragLeave?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void
  onPin: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
  onOpenMenu?: (x: number, y: number) => void
}

export function ThreadRow({
  thread,
  worktreeRecord,
  active,
  deleting,
  locale,
  showRunning,
  showUnread,
  statusDotAcknowledged,
  onSelect,
  onContextMenu,
  onPreviewOpen,
  onPreviewClose,
  draggable = false,
  dragging = false,
  dropPosition = null,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onPin,
  onArchive,
  onDelete,
  onRestore,
  onOpenMenu
}: ThreadRowProps): ReactElement {
  const { t } = useTranslation('common')
  const showUnreadDot = showUnread && !showRunning
  const archived = thread.archived === true
  const pinned = thread.pinned === true
  const worktreeLabel = worktreeRecord
    ? t('sidebarThreadWorktree', { branch: worktreeRecord.branch || 'worktree' })
    : ''
  const updatedLabel = formatRelativeTime(thread.updatedAt, locale)
  const statusDot = threadStatusDotForThread(thread)
  const statusDotLabel =
    statusDot === 'running'
      ? t('sidebarThreadStatusRunning')
      : statusDot === 'interrupted'
        ? t('sidebarThreadStatusInterrupted')
        : statusDot === 'needs-review'
          ? t('sidebarThreadStatusNeedsReview')
          : statusDot === 'completed'
            ? t('sidebarThreadStatusCompleted')
            : ''
  const ariaLabel = [
    thread.title,
    updatedLabel,
    pinned ? t('sidebarThreadPinned') : '',
    showRunning ? t('sidebarThreadRunning') : statusDotLabel,
    showUnreadDot ? t('sidebarThreadUnread') : '',
    worktreeLabel
  ].filter(Boolean).join(' - ')

  return (
    <SidebarTreeRow
      active={active}
      activeVariant="outline"
      actionsVisibility={deleting ? 'visible' : 'hidden'}
      actionsLayout="overlay"
      actions={(
        <div className="flex items-center gap-0.5 rounded-[6px] bg-white/70 p-0.5 backdrop-blur-[3px] dark:bg-white/[0.06]">
        <button
            type="button"
            data-cursor-spotlight-target
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              if (onOpenMenu) {
                const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                onOpenMenu(rect.left, rect.bottom + 4)
              }
            }}
            disabled={deleting}
            title={t('sidebarThreadMoreActions')}
            aria-label={t('sidebarThreadMoreActions')}
            className={`flex h-5.5 w-5.5 items-center justify-center rounded-[5px] transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:hover:text-white ${
              deleting ? 'opacity-60' : ''
            }`}
          >
            <MoreVertical className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      )}
      className={`min-h-[32px] ${
        dragging ? 'opacity-50' : ''
      } ${
        dropPosition === 'before'
          ? "before:absolute before:inset-x-2 before:top-0 before:z-10 before:h-0.5 before:rounded-full before:bg-[#18181b] dark:before:bg-white before:content-['']"
          : dropPosition === 'after'
            ? "after:absolute after:bottom-0 after:inset-x-2 after:z-10 after:h-0.5 after:rounded-full after:bg-[#18181b] dark:after:bg-white after:content-['']"
            : ''
      }`}
      buttonClassName="items-center gap-2 px-2 py-1.5"
      disabled={deleting}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      ariaLabel={ariaLabel}
      title={[thread.title, thread.summary?.trim(), worktreeLabel].filter(Boolean).join('\n')}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={(event) => onPreviewOpen(event, worktreeRecord)}
      onMouseLeave={onPreviewClose}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span aria-hidden className="grid w-3.5 shrink-0 place-items-center">
          {pinned ? (
            <Pin className="h-3 w-3 text-[#18181b] dark:text-white" strokeWidth={2.2} />
          ) : (
            <ThreadActivityDot
              status={statusDot}
              statusLabel={statusDotLabel}
              running={showRunning}
              unread={showUnreadDot}
              unreadLabel={t('sidebarThreadUnread')}
              acknowledged={statusDotAcknowledged}
            />
          )}
        </span>
        {worktreeRecord ? (
          <span
            className="inline-grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full border border-black/10 bg-black/[0.04] text-ds-muted dark:border-white/15 dark:bg-white/[0.06]"
            title={worktreeLabel}
            aria-label={worktreeLabel}
          >
            <GitBranch className="h-2.5 w-2.5" strokeWidth={2} />
          </span>
        ) : null}
        <span className={`min-w-0 flex-1 truncate text-[13px] leading-tight ${
          active
            ? 'font-medium text-[#18181b] dark:text-white'
            : showUnreadDot
              ? 'font-semibold text-[#18181b] dark:text-white'
              : 'text-[#4b4b52] dark:text-[#d4d4d8]'
        }`}>
          {thread.title}
        </span>
        <span className={`ml-auto flex min-w-[3rem] shrink-0 items-center justify-end gap-1.5 transition duration-150 ${
          deleting ? 'opacity-0' : 'group-hover:opacity-0 group-focus-within:opacity-0'
        }`}>
          <span className="shrink-0 text-right text-[11px] leading-tight text-[#8a8a93] tabular-nums dark:text-[#83838c]">
            {updatedLabel}
          </span>
          {pinned ? (
            <ThreadActivityDot
              status={statusDot}
              statusLabel={statusDotLabel}
              running={showRunning}
              unread={showUnreadDot}
              unreadLabel={t('sidebarThreadUnread')}
              acknowledged={statusDotAcknowledged}
            />
          ) : null}
        </span>
      </span>
    </SidebarTreeRow>
  )
}

function ThreadActivityDot({
  status,
  statusLabel,
  running,
  unread,
  unreadLabel,
  acknowledged
}: {
  status: ThreadStatusDot
  statusLabel: string
  running: boolean
  unread: boolean
  unreadLabel: string
  acknowledged: boolean
}): ReactElement | null {
  // Live execution is the authoritative signal for the pulsing blue dot: an
  // active turn (active+busy) or a background turn still finishing
  // (watchTurnCompletion). Relying on this instead of the persisted
  // `thread.status === 'running'` keeps the blue light from getting stuck on
  // after a turn completes (the summary can lag behind the local state).
  if (running) {
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
      </span>
    )
  }
  // Terminal derived states (completed / interrupted / needs-review) show a
  // colored breathing light until the user acknowledges (已读 / clicks the
  // thread). When acknowledged, the breathing light is suppressed.
  if ((status === 'interrupted' || status === 'needs-review' || status === 'completed') && !acknowledged) {
    const pulse = THREAD_STATUS_DOT_PULSE[status]
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
        {pulse ? (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${pulse} opacity-75`} />
        ) : null}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${THREAD_STATUS_DOT_COLOR[status]}${
            status === 'needs-review' ? ' shadow-[0_0_0_2px_rgba(245,158,11,0.22)]' : ''
          }`}
          title={statusLabel}
          aria-label={statusLabel}
        />
      </span>
    )
  }
  if (unread) {
    return (
      <span
        className="block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.2)]"
        title={unreadLabel}
      />
    )
  }
  return null
}

export function SidebarEmpty({
  runtimeReady,
  hasWorkspace,
  onPickWorkspace,
  t
}: {
  runtimeReady: boolean
  hasWorkspace: boolean
  onPickWorkspace: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  if (!hasWorkspace && runtimeReady) {
    return (
      <button
        type="button"
        onClick={onPickWorkspace}
        className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg border border-dashed border-black/10 px-3 py-2 text-left text-ds-muted transition hover:border-black/20 hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink dark:border-white/10 dark:hover:border-white/20"
      >
        <FolderPlus className="h-4 w-4 shrink-0 text-[#18181b] dark:text-white" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t('selectWorkspace')}</span>
      </button>
    )
  }
  return (
    <div className="mx-1 mt-2 rounded-lg border border-black/[0.04] bg-black/[0.02] px-3 py-3 text-center dark:border-white/[0.05] dark:bg-white/[0.02]">
      <p className="text-[13.5px] font-medium text-ds-muted">{t('sidebarEmptyTitle')}</p>
      <p className="mt-1 text-[12px] leading-5 text-ds-faint">
        {runtimeReady ? t('sidebarEmptySub') : t('sidebarEmptySubOffline')}
      </p>
    </div>
  )
}
