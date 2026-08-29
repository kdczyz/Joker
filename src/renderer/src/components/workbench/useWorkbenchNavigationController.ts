import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { NormalizedThread, RuntimeConnectionStatus } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import type { ChatState } from '../../store/chat-store-types'
import type { SddDraft } from '../../sdd/sdd-draft-store'
import { useSddDraftStore } from '../../sdd/sdd-draft-store'
import { markSddAssistantThread } from '../../sdd/sdd-thread-registry'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'

export type WorkbenchSidebarView = 'chat' | 'claw' | 'schedule' | 'workflow' | 'subagents'

type UseWorkbenchNavigationControllerParams = {
  activeSddDraft: boolean
  activeThreadId: string | null
  pluginHostRoute: ChatState['pluginHostRoute']
  rightPanelMode: RightPanelMode
  route: ChatState['route']
  runtimeConnection: RuntimeConnectionStatus
  sddDraftContent: string
  threads: NormalizedThread[]
  useWorktreePool: boolean
  workspaceRoot: string
  worktreeBranch: string
  archiveThread?: ChatState['archiveThread']
  clearFilePreviewTargets: () => void
  createConversation: ChatState['createConversation']
  createThread: ChatState['createThread']
  dismissActiveSddDraft: (options?: { closeAssistant?: boolean }) => void
  findSddDraftForSidebarThread: (
    threadId: string,
    thread: NormalizedThread | null
  ) => Promise<SddDraft | null>
  openClaw: ChatState['openClaw']
  openCode: ChatState['openCode']
  openPlugins: ChatState['openPlugins']
  openSchedule: ChatState['openSchedule']
  openWorkflow: ChatState['openWorkflow']
  openSddRequirementDraftFromHistory: (draft: SddDraft) => Promise<void>
  selectThread: ChatState['selectThread']
  setConnectPhoneSidebarOpen: Dispatch<SetStateAction<boolean>>
  setFilePreviewTarget: (target: WorkspaceFileTarget | null) => void
  setInput: (value: string) => void
  setRightPanelMode: (mode: RightPanelMode) => void
  setRoute: ChatState['setRoute']
  setUseWorktreePool: Dispatch<SetStateAction<boolean>>
}

export type WorkbenchNavigationController = {
  closeRightPanel: () => void
  openCodeMode: () => void
  openDesignMode: () => void
  openPluginsView: () => void
  openExtensionsView: () => void
  openScheduleView: () => void
  openThread: (id: string) => void
  openWorkflowView: () => void
  openClawMode: () => void
  sidebarView: WorkbenchSidebarView
  startNewChat: () => void
  startNewChatInWorkspace: (workspaceRoot: string) => void
  startNewConversation: () => void
  toggleConnectPhone: () => void
}

export function useWorkbenchNavigationController({
  activeSddDraft,
  activeThreadId,
  pluginHostRoute,
  rightPanelMode,
  route,
  runtimeConnection,
  sddDraftContent,
  threads,
  useWorktreePool,
  workspaceRoot,
  worktreeBranch,
  clearFilePreviewTargets,
  createConversation,
  createThread,
  dismissActiveSddDraft,
  findSddDraftForSidebarThread,
  openClaw,
  openCode,
  openPlugins,
  openSchedule,
  openWorkflow,
  openSddRequirementDraftFromHistory,
  selectThread,
  setConnectPhoneSidebarOpen,
  setFilePreviewTarget,
  setInput,
  setRightPanelMode,
  setRoute,
  setUseWorktreePool
}: UseWorkbenchNavigationControllerParams): WorkbenchNavigationController {
  const connectPhoneReturnRouteRef = useRef<ChatState['route']>('chat')

  useEffect(() => {
    if (route !== 'claw') connectPhoneReturnRouteRef.current = route
  }, [route])

  const sidebarView: WorkbenchSidebarView = useMemo(() => {
    if (route === 'claw' || (route === 'plugins' && pluginHostRoute === 'claw')) return 'claw'
    if (route === 'schedule') return 'schedule'
    if (route === 'workflow') return 'workflow'
    return 'chat'
  }, [pluginHostRoute, route])

  const openThread = useCallback((id: string): void => {
    setConnectPhoneSidebarOpen(false)
    void (async () => {
      const thread = threads.find((item) => item.id === id) ?? null
      const sddDraft = await findSddDraftForSidebarThread(id, thread)
      if (sddDraft) {
        markSddAssistantThread(sddDraft, id)
        await openSddRequirementDraftFromHistory(sddDraft)
        void useChatStore.getState().refreshThreads()
        return
      }
      if (useSddDraftStore.getState().activeDraft) dismissActiveSddDraft({ closeAssistant: true })
      setRoute('chat')
      await selectThread(id)
    })()
  }, [
    dismissActiveSddDraft,
    findSddDraftForSidebarThread,
    openSddRequirementDraftFromHistory,
    selectThread,
    setConnectPhoneSidebarOpen,
    setRoute,
    threads
  ])

  const startNewChat = useCallback((): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createThread({ useWorktreePool, worktreeBranch })
    if (useWorktreePool) setUseWorktreePool(false)
  }, [
    activeSddDraft,
    createThread,
    dismissActiveSddDraft,
    setConnectPhoneSidebarOpen,
    setRoute,
    setUseWorktreePool,
    useWorktreePool,
    worktreeBranch
  ])

  const startNewChatInWorkspace = useCallback((targetWorkspaceRoot: string): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createThread({ workspaceRoot: targetWorkspaceRoot, useWorktreePool, worktreeBranch })
    if (useWorktreePool) setUseWorktreePool(false)
  }, [
    activeSddDraft,
    createThread,
    dismissActiveSddDraft,
    setConnectPhoneSidebarOpen,
    setRoute,
    setUseWorktreePool,
    useWorktreePool,
    worktreeBranch
  ])

  const startNewConversation = useCallback((): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createConversation()
  }, [activeSddDraft, createConversation, dismissActiveSddDraft, setConnectPhoneSidebarOpen, setRoute])

  const openCodeMode = useCallback((): void => {
    setConnectPhoneSidebarOpen(false)
    void openCode()
  }, [openCode, setConnectPhoneSidebarOpen])

  const openDesignMode = useCallback((): void => {
    setConnectPhoneSidebarOpen(false)
    setRoute('design')
  }, [setConnectPhoneSidebarOpen, setRoute])

  const openClawMode = useCallback((): void => {
    setConnectPhoneSidebarOpen(false)
    openClaw()
  }, [openClaw, setConnectPhoneSidebarOpen])

  const openPluginsView = useCallback((): void => {
    setConnectPhoneSidebarOpen(false)
    openPlugins(sidebarView === 'claw' ? 'claw' : 'chat')
  }, [openPlugins, setConnectPhoneSidebarOpen, sidebarView])

  const openExtensionsView = useCallback((): void => {
    setConnectPhoneSidebarOpen(false)
    setRoute('extensions')
  }, [setConnectPhoneSidebarOpen, setRoute])

  const openScheduleView = useCallback((): void => {
    setConnectPhoneSidebarOpen(false)
    openSchedule()
  }, [openSchedule, setConnectPhoneSidebarOpen])

  const openWorkflowView = useCallback((): void => {
    setConnectPhoneSidebarOpen(false)
    openWorkflow()
  }, [openWorkflow, setConnectPhoneSidebarOpen])

  const toggleConnectPhone = useCallback((): void => {
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    if (route === 'claw') {
      setConnectPhoneSidebarOpen(false)
      setRoute(connectPhoneReturnRouteRef.current === 'claw' ? 'chat' : connectPhoneReturnRouteRef.current)
      return
    }
    connectPhoneReturnRouteRef.current = route
    openClaw()
    setConnectPhoneSidebarOpen(true)
  }, [activeSddDraft, dismissActiveSddDraft, openClaw, route, setConnectPhoneSidebarOpen, setRoute])

  const closeRightPanel = useCallback((): void => {
    if (rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.file) clearFilePreviewTargets()
    setRightPanelMode(null)
    setFilePreviewTarget(null)
  }, [
    clearFilePreviewTargets,
    rightPanelMode,
    setFilePreviewTarget,
    setRightPanelMode
  ])

  return {
    closeRightPanel,
    openCodeMode,
    openDesignMode,
    openClawMode,
    openPluginsView,
    openExtensionsView,
    openScheduleView,
    openThread,
    openWorkflowView,
    sidebarView,
    startNewChat,
    startNewChatInWorkspace,
    startNewConversation,
    toggleConnectPhone
  }
}
