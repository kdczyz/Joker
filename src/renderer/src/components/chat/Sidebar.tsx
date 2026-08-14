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
          <div className="flex items-center gap-1">
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
            >
              <Smartphone className="h-4 w-4" strokeWidth={1.75} />
            </SidebarIconButton>
            <SidebarIconButton
              title={isDarkMode ? t('switchToLight') : t('switchToDark')}
              ariaLabel={t('toggleTheme')}
              onClick={onToggleTheme}
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
      <div className="ds-no-drag flex flex-col px-1">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
        />

        {activeView !== 'claw' && activeView !== 'schedule' && activeView !== 'workflow' ? (
          <>
            <SidebarCommandRow
              icon={<Plus className="h-4 w-4" strokeWidth={2} />}
              label={t('newAgent')}
              onClick={runtimeReady ? onNewChat : undefined}
              disabled={!runtimeReady}
              disabledHint={t('runtimeActionNeedsConnection')}
              variant="accent"
            />
            <SidebarCommandRow
              icon={<FileQuestion className="h-4 w-4" strokeWidth={1.9} />}
              label={t('sddNewRequirement')}
              onClick={runtimeReady ? onNewRequirement : undefined}
              disabled={!runtimeReady}
              disabledHint={t('runtimeActionNeedsConnection')}
              variant="accent"
              trailing={requirementWorkspace ? (
                <span
                  className="max-w-[92px] truncate text-[11.5px] text-ds-faint"
                  title={requirementWorkspace}
                >
                  {workspaceLabelFromPath(requirementWorkspace)}
                </span>
              ) : null}
            />
          </>
        ) : null}
        <SidebarCommandRow
          icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
          label={t('plugins')}
          onClick={onOpenPlugins}
          active={pluginsActive}
        />
        <SidebarCommandRow
          icon={<Puzzle className="h-4 w-4" strokeWidth={1.75} />}
          label={i18n.language.toLowerCase().startsWith('zh') ? '扩展' : 'Extensions'}
          onClick={onOpenExtensions}
          active={extensionsActive}
        />
        <SidebarCommandRow
          icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />}
          label={t('schedule')}
          onClick={onScheduleOpen}
          active={activeView === 'schedule'}
        />
        <SidebarCommandRow
          icon={<Workflow className="h-4 w-4" strokeWidth={1.75} />}
          label={t('workflowCreate')}
          onClick={onWorkflowOpen}
          active={activeView === 'workflow'}
        />
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
      className="ds-sidebar-account-button group flex min-h-[34px] w-full items-center gap-2.5 rounded-[9px] border border-[var(--ds-sidebar-divider)] bg-[color-mix(in_srgb,var(--ds-sidebar-field-bg)_72%,transparent)] px-2.5 py-1.5 text-left transition hover:border-[color-mix(in_srgb,var(--ds-accent)_36%,var(--ds-sidebar-divider))] hover:bg-[color-mix(in_srgb,var(--ds-accent)_6%,var(--ds-sidebar-field-bg))] hover:text-[#1f1f1f] dark:hover:text-white"
      aria-label={`${displayName} · 用户主页`}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8470ed] to-[#5aa7dc] text-[10px] font-semibold text-white shadow-[0_2px_6px_rgba(111,93,221,0.28)]"
        aria-hidden="true"
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[12px] font-semibold text-[#1f1f1f] dark:text-white">
          {displayName}
        </strong>
        <small className="block truncate text-[10px] text-[#9aa5b5] dark:text-white/35">
          用户主页
        </small>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9aa5b5] transition group-hover:translate-x-0.5 group-hover:text-[#1f1f1f] dark:text-white/35 dark:group-hover:text-white" strokeWidth={1.8} />
    </button>
  )
}
