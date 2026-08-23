import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthGate'
import {
  ChevronRight,
  Clock3,
  FileQuestion,
  LayoutGrid,
  Moon,
  Plus,
  Puzzle,
  Smartphone,
  Sun,
  Workflow
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import { resolveSddRequirementWorkspace, type SddDraft } from '../../sdd/sdd-draft-store'
import type {
  ClawImChannelV1,
} from '@shared/app-settings'
import {
  ClawSidebarContent
} from './SidebarClaw'
import type { ClawImDialogMode } from './SidebarClawDialogHelpers'
import { ClawAddImDialog } from './SidebarClawDialog'
import { ConnectPhoneSidebarPanel } from './ConnectPhoneView'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import { SidebarConversationsSection } from './SidebarConversationsSection'
import { WorkspaceModeTabs } from './WorkspaceModeTabs'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton
} from '../sidebar/SidebarPrimitives'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  activeView: 'chat' | 'claw' | 'schedule' | 'workflow' | 'subagents'
  connectPhoneSidebarOpen: boolean
  pluginsActive: boolean
  extensionsActive: boolean
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  onThreadSearchChange: (query: string) => void
  onSelectThread: (id: string) => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onPinThread: (id: string, pinned: boolean) => Promise<void>
  onArchiveThread: (id: string) => Promise<void>
  onDeleteThread: (id: string) => Promise<void>
  onRestoreThread: (id: string) => Promise<void>
  onNewChat: () => void
  onNewChatInWorkspace: (workspaceRoot: string) => void
  onNewRequirement: () => void
  onOpenRequirementDraft: (draft: SddDraft) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: () => void
  onOpenExtensions: () => void
  onToggleTheme: () => void
  onToggleConnectPhone: () => void
  onCodeOpen: () => void
  onScheduleOpen: () => void
  onWorkflowOpen: () => void
  onNewConversation: () => void
}

export function Sidebar({
  threads,
  activeThreadId,
  activeView,
  connectPhoneSidebarOpen,
  pluginsActive,
  extensionsActive,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
  onThreadSearchChange,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onNewChat,
  onNewChatInWorkspace,
  onNewRequirement,
  onOpenRequirementDraft,
  onOpenSettings,
  onOpenPlugins,
  onOpenExtensions,
  onToggleTheme,
  onToggleConnectPhone,
  onCodeOpen,
  onScheduleOpen,
  onWorkflowOpen,
  onNewConversation
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const auth = useAuth()
  const [isDarkMode, setIsDarkMode] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  )
  const accountDisplayName = auth.user.displayName
  const accountInitials = auth.user.displayName.slice(0, 2).toUpperCase()

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const conversationWorkspaceRoot = useChatStore((s) => s.conversationWorkspaceRoot)
  const codeWorkspaceRoots = useChatStore((s) => s.codeWorkspaceRoots)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const deleteWorkspace = useChatStore((s) => s.deleteWorkspace)
  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const selectClawChannel = useChatStore((s) => s.selectClawChannel)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const resetClawChannelSession = useChatStore((s) => s.resetClawChannelSession)
  const [imDialogMode, setImDialogMode] = useState<ClawImDialogMode | null>(null)
  const requirementWorkspace = resolveSddRequirementWorkspace(threads, activeThreadId, workspaceRoot)

  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? clawChannels[0] ?? null,
    [clawChannels, activeClawChannelId]
  )

  return (
    <>
    <SidebarFrame
      title={t('appName')}
      footer={
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <AccountButton
              displayName={accountDisplayName}
              initials={accountInitials}
              onClick={() => onOpenSettings('profile')}
            />
            <SidebarIconButton
              title={t('claw')}
              ariaLabel={t('claw')}
              onClick={onToggleConnectPhone}
              active={connectPhoneSidebarOpen}
              className="h-8 w-8 rounded-[9px] border border-black/[0.06] bg-black/[0.02] shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:bg-black/[0.05] dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:bg-white/[0.08]"
            >
              <Smartphone className="h-4 w-4" strokeWidth={1.75} />
            </SidebarIconButton>
            <SidebarIconButton
              title={isDarkMode ? t('switchToLight') : t('switchToDark')}
              ariaLabel={t('toggleTheme')}
              onClick={onToggleTheme}
              className="h-8 w-8 rounded-[9px] border border-black/[0.06] bg-black/[0.02] shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:bg-black/[0.05] dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:bg-white/[0.08]"
            >
              {isDarkMode ? (
                <Sun className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Moon className="h-4 w-4" strokeWidth={1.75} />
              )}
            </SidebarIconButton>
          </div>
        </div>
      }
    >
      <div className="ds-no-drag flex flex-col gap-1 px-1">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
        />

        {activeView !== 'claw' && activeView !== 'schedule' && activeView !== 'workflow' ? (
          <div className="flex flex-col gap-1 pt-0.5">
            <SidebarCommandRow
              icon={<Plus className="h-4 w-4" strokeWidth={2.2} />}
              label={t('newAgent')}
              shortcut="⌘N"
              onClick={runtimeReady ? onNewChat : undefined}
              disabled={!runtimeReady}
              disabledHint={t('runtimeActionNeedsConnection')}
              variant="hero"
            />
            <SidebarCommandRow
              icon={<FileQuestion className="h-4 w-4" strokeWidth={1.8} />}
              label={t('sddNewRequirement')}
              onClick={runtimeReady ? onNewRequirement : undefined}
              disabled={!runtimeReady}
              disabledHint={t('runtimeActionNeedsConnection')}
              variant="subtle"
              trailing={requirementWorkspace ? (
                <span
                  className="max-w-[88px] truncate rounded-[5px] border border-black/[0.06] bg-black/[0.03] px-1.5 py-0.5 text-[11px] font-medium text-ds-faint dark:border-white/[0.08] dark:bg-white/[0.05]"
                  title={requirementWorkspace}
                >
                  {workspaceLabelFromPath(requirementWorkspace)}
                </span>
              ) : null}
            />
          </div>
        ) : null}

        {/* 紧凑快捷工具网格 */}
        <div className="mt-1 grid grid-cols-2 gap-1 rounded-[10px] border border-black/[0.05] bg-black/[0.02] p-1 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <button
            type="button"
            data-cursor-spotlight-target
            onClick={onOpenPlugins}
            className={`group flex min-h-[30px] items-center gap-1.5 rounded-[7px] px-2 py-1 text-[12px] transition duration-150 ${
              pluginsActive
                ? 'bg-white font-medium text-[#18181b] shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:bg-white/[0.12] dark:text-white'
                : 'text-[#606066] hover:bg-black/[0.04] hover:text-[#18181b] dark:text-[#9e9ea6] dark:hover:bg-white/[0.06] dark:hover:text-white'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-[#606066] transition group-hover:text-[#18181b] dark:text-[#9e9ea6] dark:group-hover:text-white" strokeWidth={1.8} />
            <span className="truncate">{t('plugins')}</span>
          </button>
          <button
            type="button"
            data-cursor-spotlight-target
            onClick={onOpenExtensions}
            className={`group flex min-h-[30px] items-center gap-1.5 rounded-[7px] px-2 py-1 text-[12px] transition duration-150 ${
              extensionsActive
                ? 'bg-white font-medium text-[#18181b] shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:bg-white/[0.12] dark:text-white'
                : 'text-[#606066] hover:bg-black/[0.04] hover:text-[#18181b] dark:text-[#9e9ea6] dark:hover:bg-white/[0.06] dark:hover:text-white'
            }`}
          >
            <Puzzle className="h-3.5 w-3.5 shrink-0 text-[#606066] transition group-hover:text-[#18181b] dark:text-[#9e9ea6] dark:group-hover:text-white" strokeWidth={1.8} />
            <span className="truncate">{i18n.language.toLowerCase().startsWith('zh') ? '扩展' : 'Extensions'}</span>
          </button>
          <button
            type="button"
            data-cursor-spotlight-target
            onClick={onScheduleOpen}
            className={`group flex min-h-[30px] items-center gap-1.5 rounded-[7px] px-2 py-1 text-[12px] transition duration-150 ${
              activeView === 'schedule'
                ? 'bg-white font-medium text-[#18181b] shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:bg-white/[0.12] dark:text-white'
                : 'text-[#606066] hover:bg-black/[0.04] hover:text-[#18181b] dark:text-[#9e9ea6] dark:hover:bg-white/[0.06] dark:hover:text-white'
            }`}
          >
            <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#606066] transition group-hover:text-[#18181b] dark:text-[#9e9ea6] dark:group-hover:text-white" strokeWidth={1.8} />
            <span className="truncate">{t('schedule')}</span>
          </button>
          <button
            type="button"
            data-cursor-spotlight-target
            onClick={onWorkflowOpen}
            className={`group flex min-h-[30px] items-center gap-1.5 rounded-[7px] px-2 py-1 text-[12px] transition duration-150 ${
              activeView === 'workflow'
                ? 'bg-white font-medium text-[#18181b] shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:bg-white/[0.12] dark:text-white'
                : 'text-[#606066] hover:bg-black/[0.04] hover:text-[#18181b] dark:text-[#9e9ea6] dark:hover:bg-white/[0.06] dark:hover:text-white'
            }`}
          >
            <Workflow className="h-3.5 w-3.5 shrink-0 text-[#606066] transition group-hover:text-[#18181b] dark:text-[#9e9ea6] dark:group-hover:text-white" strokeWidth={1.8} />
            <span className="truncate">{t('workflowCreate')}</span>
          </button>
        </div>
      </div>

      <div className="ds-no-drag mx-1 my-1" />

      {connectPhoneSidebarOpen ? (
        <ConnectPhoneSidebarPanel
          channels={clawChannels}
          onAddProvider={async (provider, agentProfile, platformCredential, options) => {
            await addClawChannel(provider, agentProfile, platformCredential, options)
            onToggleConnectPhone()
          }}
          onDisconnect={(channelId) => deleteClawChannel(channelId)}
          onOpenSettings={() => onOpenSettings('claw')}
        />
      ) : activeView === 'claw' ? (
        <ClawSidebarContent
          channels={clawChannels}
          activeChannelId={activeClawChannelId}
          activeThreadId={activeThreadId}
          runtimeReady={runtimeReady}
          onSelectChannel={(channelId) => void selectClawChannel(channelId)}
          onAddChannel={() => setImDialogMode('add')}
          onResetChannel={(channelId) => void resetClawChannelSession(channelId)}
          onOpenSettings={() => setImDialogMode('edit')}
          t={t}
        />
      ) : activeView === 'workflow' ? (
        <div className="ds-no-drag flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Workflow className="h-7 w-7 text-ds-faint" strokeWidth={1.5} />
          <p className="text-[12.5px] leading-5 text-ds-faint">{t('workflowSidebarHint')}</p>
        </div>
      ) : activeView === 'schedule' ? (
        <SidebarProjectsSection
          threads={threads}
          activeView="chat"
          activeThreadId={activeThreadId}
          runtimeReady={runtimeReady}
          searchQuery={threadSearch}
          showArchived={showArchivedThreads}
          workspaceRoot={workspaceRoot}
          workspaceRoots={codeWorkspaceRoots}
          conversationRoot={conversationWorkspaceRoot}
          busy={busy}
          watchTurnCompletion={watchTurnCompletion}
          unreadThreadIds={unreadThreadIds}
          locale={i18n.language}
          onPickWorkspace={() => void chooseWorkspace()}
          onRemoveWorkspace={deleteWorkspace}
          onCreateThreadInWorkspace={onNewChatInWorkspace}
          onOpenRequirementDraft={onOpenRequirementDraft}
          onSelectThread={onSelectThread}
          onRenameThread={onRenameThread}
          onPinThread={onPinThread}
          onArchiveThread={onArchiveThread}
          onDeleteThread={onDeleteThread}
          onRestoreThread={onRestoreThread}
          onSearchQueryChange={onThreadSearchChange}
          t={t}
        />
      ) : (
      <>
      <SidebarProjectsSection
        threads={threads}
        activeView="chat"
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        searchQuery={threadSearch}
        showArchived={showArchivedThreads}
        workspaceRoot={workspaceRoot}
        workspaceRoots={codeWorkspaceRoots}
        conversationRoot={conversationWorkspaceRoot}
        busy={busy}
        watchTurnCompletion={watchTurnCompletion}
        unreadThreadIds={unreadThreadIds}
        locale={i18n.language}
        onPickWorkspace={() => void chooseWorkspace()}
        onRemoveWorkspace={deleteWorkspace}
        onCreateThreadInWorkspace={onNewChatInWorkspace}
        onOpenRequirementDraft={onOpenRequirementDraft}
        onSelectThread={onSelectThread}
        onRenameThread={onRenameThread}
        onPinThread={onPinThread}
        onArchiveThread={onArchiveThread}
        onDeleteThread={onDeleteThread}
        onRestoreThread={onRestoreThread}
        onSearchQueryChange={onThreadSearchChange}
        t={t}
      />
      <SidebarConversationsSection
        threads={threads}
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        conversationRoot={conversationWorkspaceRoot}
        onNewConversation={onNewConversation}
        onSelectThread={onSelectThread}
        onRenameThread={onRenameThread}
        onPinThread={onPinThread}
        onArchiveThread={onArchiveThread}
        onDeleteThread={onDeleteThread}
        onRestoreThread={onRestoreThread}
        t={t}
      />
      </>
      )}

    </SidebarFrame>

    {imDialogMode ? (
      <ClawAddImDialog
        mode={imDialogMode}
        initialProvider={activeClawChannel?.provider}
        initialChannelId={imDialogMode === 'edit' ? activeClawChannel?.id : undefined}
        channels={clawChannels}
        onClose={() => setImDialogMode(null)}
        onAddProvider={(provider, agentProfile, platformCredential, options) =>
          addClawChannel(provider, agentProfile, platformCredential, options)
        }
        onDeleteChannel={(channelId) => deleteClawChannel(channelId)}
        t={t}
      />
    ) : null}
    </>
  )
}

function AccountButton({
  displayName,
  initials,
  onClick
}: {
  displayName: string
  initials: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      data-cursor-spotlight-target
      onClick={onClick}
      className="ds-sidebar-account-button group flex min-h-[36px] w-full items-center gap-2.5 rounded-[10px] border border-transparent px-2 py-1 text-left transition duration-150 hover:border-black/[0.06] hover:bg-black/[0.04] hover:text-[#18181b] dark:hover:border-white/[0.08] dark:hover:bg-white/[0.05] dark:hover:text-white"
      aria-label={`${displayName} · 用户主页`}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] via-[#8b5cf6] to-[#38bdf8] text-[10.5px] font-semibold text-white shadow-[0_2px_8px_rgba(99,102,241,0.35)] transition group-hover:scale-105"
        aria-hidden="true"
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[12.5px] font-medium leading-tight text-[#18181b] dark:text-[#f4f4f5]">
          {displayName}
        </strong>
        <small className="block truncate text-[10.5px] leading-tight text-[#8a8a93] dark:text-[#83838c]">
          用户主页
        </small>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9aa5b5] transition group-hover:translate-x-0.5 group-hover:text-[#18181b] dark:text-white/35 dark:group-hover:text-white" strokeWidth={1.8} />
    </button>
  )
}
