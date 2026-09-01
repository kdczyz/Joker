import type { ReviewTarget } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  showWorkspaceMissingDialog,
  workspaceDirectoryExists,
  workspaceMissingError
} from '../lib/workspace-availability'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import {
  deriveThreadTitleFromPrompt,
  getDefaultThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import { threadStatusDotForThread } from '../components/chat/thread-status-dot'
import {
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import {
  markThreadWorktree,
  saveThreadWorktreeRegistry
} from '../lib/thread-worktree-registry'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import {
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootScopeKey
} from '../lib/workspace-path'
import {
  buildClawRuntimePrompt,
  buildCodeRuntimePrompt,
  getActiveAgentApiKey
} from '@shared/app-settings'
import type {
  ChatState,
  ChatStoreGet,
  ChatStoreSet
} from './chat-store-types'
import { canGuideQueuedMessage } from './queued-message-guidance'
import {
  accountIdForComposerSelection,
  activeClawChannel,
  compactCodeWorkspaceRoots,
  composerReasoningEffortForSelection,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  composerModeForThread,
  readThreadComposerMode,
  rememberCodeWorkspaceRoots,
  rememberThreadComposerSelection,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  markThreadTurnRunning,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadHasPendingRuntimeWork,
  threadSnapshotLooksRunning,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildFollowupMessageFromUserInput,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeThread,
  latestThread,
  looksLikeActiveTurnError,
  rememberPendingClawFeishuMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import {
  composerSelectionForThread,
  ensureRuntimeProviderForSend,
  fallbackComposerProviderIdForSend,
  subscribeThreadEventsWithRecovery
} from './chat-store-thread-action-helpers'
import { GitCheckpointAvailabilityCache } from '../lib/git-checkpoint-availability'
import type { ComposerContextAttachment } from '@joker-code/extension-api'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

let drainingQueuedMessages = false
const guidingQueuedMessageIds = new Set<string>()
const checkpointGitAvailability = new GitCheckpointAvailabilityCache()

function activeChatWorkspaceRoot(state: ChatState): string {
  const activeThread = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)
    : undefined
  return activeThread?.workspace?.trim() || state.workspaceRoot?.trim() || ''
}

function pendingComposerContexts(state: ChatState): ComposerContextAttachment[] {
  if (state.route !== 'chat') return []
  const workspaceRoot = activeChatWorkspaceRoot(state)
  return state.extensionComposerContexts
    .filter((event) => workspaceRootScopeKey(event.workspaceRoot) === workspaceRootScopeKey(workspaceRoot))
    .map((event) => event.attachment)
}

function withoutConsumedComposerContexts(
  state: ChatState,
  consumed: readonly ComposerContextAttachment[]
): ChatState['extensionComposerContexts'] {
  if (consumed.length === 0) return state.extensionComposerContexts
  const consumedRevisions = new Set(consumed.map((attachment) => [
    attachment.attachmentId,
    attachment.revision,
    attachment.generation
  ].join(':')))
  return state.extensionComposerContexts.filter((event) => !consumedRevisions.has([
    event.attachment.attachmentId,
    event.attachment.revision,
    event.attachment.generation
  ].join(':')))
}

export function createThreadActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'createThread' | 'createConversation' | 'recoverActiveTurn' | 'selectThread' | 'subscribeThreadEventsLive' | 'drainQueuedMessages' | 'removeQueuedMessage' | 'guideQueuedMessage' | 'sendMessage' | 'reviewActiveThread'> {
  // A detail request is intentionally independent from the SSE subscription.
  // Keep its own generation so a late response from a previously selected
  // thread cannot restore stale content after the user has moved on.
  let threadSelectionGeneration = 0
  return {
  createThread: async (options = {}) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    try {
      const p = getProvider()
      const settings = await rendererRuntimeClient.getSettings()
      const activeThread = get().activeThreadId
        ? get().threads.find((thread) => thread.id === get().activeThreadId)
        : null

      // 对话会话:不绑定项目文件夹,在 conversationWorkspaceRoot 下自动创建
      // 一个时间戳子目录作为工作目录(主进程负责实际建目录)。
      if (options.conversation) {
        if (typeof window.JokerGui === 'undefined' || typeof window.JokerGui.createConversationWorkspace !== 'function') {
          set({ error: i18n.t('common:workspacePickerUnavailable') })
          return
        }
        const created = await window.JokerGui.createConversationWorkspace(
          settings.conversationWorkspaceRoot || undefined
        )
        if (!created.ok || !created.path) {
          set({ error: created.error || i18n.t('common:worktreeAcquireFailed') })
          return
        }
        const pickedAgentId = options.agentId?.trim() || get().composerAgentId?.trim() || ''
        const personaProfile = pickedAgentId
          ? settings.agents?.Joker?.subagents?.profiles?.find(
            (profile) => profile.id === pickedAgentId &&
              profile.enabled &&
              (profile.mode === 'primary' || profile.mode === 'all')
          )
          : undefined
        const t = await p.createThread({
          workspace: created.path,
          title: getDefaultThreadTitle(),
          mode: 'agent',
          ...(personaProfile ? {
            agentId: personaProfile.id,
            ...(personaProfile.providerId ? { providerId: personaProfile.providerId } : {}),
            ...(personaProfile.model ? { model: personaProfile.model } : {}),
            ...(personaProfile.systemPrompt ? { systemPrompt: personaProfile.systemPrompt } : {})
          } : {})
        })
        set((s) => ({
          activeThreadId: t.id,
          threads: s.threads.some((thread) => thread.id === t.id) ? s.threads : [t, ...s.threads]
        }))
        await get().selectThread(t.id)
        await get().refreshThreads()
        return
      }

      let workspaceRoot =
        normalizeWorkspaceRoot(options.workspaceRoot) ||
        (activeThread && !isInternalTemporaryWorkspace(activeThread.workspace)
          ? normalizeWorkspaceRoot(activeThread.workspace)
          : '') ||
        normalizeWorkspaceRoot(settings.workspaceRoot)
      if (!workspaceRoot) {
        await get().chooseWorkspace({ createThreadAfter: true })
        return
      }
      if (!(await workspaceDirectoryExists(workspaceRoot))) {
        set({ error: workspaceMissingError() })
        await showWorkspaceMissingDialog(workspaceRoot)
        return
      }
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
      set({ codeWorkspaceRoots })
      // Worktree pool mode always needs a fresh thread bound to a fresh pool
      // slot, so never reuse an existing main-workspace thread in that case.
      const reusableThreadId = options.forceNew || options.useWorktreePool
        ? null
        : await findReusableEmptyThreadId(
            get(),
            p,
            workspaceRoot,
            (thread) => isCodeThread(thread, get().clawChannels)
          )
      if (reusableThreadId) {
        if (get().activeThreadId !== reusableThreadId) {
          await get().selectThread(reusableThreadId)
        } else {
          set({ error: null })
        }
        return
      }
      // Worktree mode: checkout the selected branch into an isolated worktree
      // and bind the new thread to that workspace.
      let acquiredWorktree: { projectPath: string; path: string; branch: string } | null = null
      if (options.useWorktreePool) {
        try {
          let branch = options.worktreeBranch?.trim() ?? ''
          if (!branch) {
            const branches = await window.JokerGui.getGitBranches(workspaceRoot)
            if (branches.ok) branch = branches.currentBranch ?? ''
          }
          if (!branch) {
            throw new Error(i18n.t('common:worktreeBranchRequired'))
          }
          const wt = await window.JokerGui.checkoutGitBranchWorktree(workspaceRoot, branch)
          if (!wt.ok) {
            throw new Error(wt.message)
          }
          acquiredWorktree = {
            projectPath: wt.sourceRepositoryRoot,
            path: wt.worktreePath,
            branch: wt.currentBranch ?? branch
          }
          workspaceRoot = wt.worktreePath
        } catch (err) {
          set({ error: err instanceof Error ? err.message : i18n.t('common:worktreeAcquireFailed') })
          return
        }
      }
      // Primary-agent persona snapshot: bind this thread to the picked
      // subagent profile and freeze its providerId / model / systemPrompt
      // at create time so later agent edits don't drift the thread.
      const pickedAgentId = options.agentId?.trim() || get().composerAgentId?.trim() || ''
      const personaProfile = pickedAgentId
        ? settings.agents?.Joker?.subagents?.profiles?.find(
            (profile) => profile.id === pickedAgentId &&
              profile.enabled &&
              (profile.mode === 'primary' || profile.mode === 'all')
          )
        : undefined
      const t = await p.createThread({
        workspace: workspaceRoot,
        title: getDefaultThreadTitle(),
        mode: 'agent',
        ...(personaProfile ? {
          agentId: personaProfile.id,
          ...(personaProfile.providerId ? { providerId: personaProfile.providerId } : {}),
          ...(personaProfile.model ? { model: personaProfile.model } : {}),
          ...(personaProfile.systemPrompt ? { systemPrompt: personaProfile.systemPrompt } : {})
        } : {})
      })
      // Register + activate optimistically before refreshing. A freshly created
      // Joker thread may not be listed until the first message is written.
      // Setting it active first lets refreshThreads preserve it in the sidebar.
      set((s) => ({
        activeThreadId: t.id,
        codeWorkspaceRoots: rememberCodeWorkspaceRoots(
          s.codeWorkspaceRoots,
          [acquiredWorktree?.projectPath ?? workspaceRoot]
        ),
        threads: s.threads.some((thread) => thread.id === t.id) ? s.threads : [t, ...s.threads]
      }))
      await get().selectThread(t.id)
      if (acquiredWorktree) {
        saveThreadWorktreeRegistry(
          markThreadWorktree(t.id, {
            projectPath: acquiredWorktree.projectPath,
            worktreePath: acquiredWorktree.path,
            branch: acquiredWorktree.branch,
            createdAt: new Date().toISOString()
          })
        )
      }
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  createConversation: async () => {
    await get().createThread({ conversation: true })
  },

  recoverActiveTurn: async () => {
    const state = get()
    if (!state.activeThreadId) return false
    const { activeThreadId } = state
    const p = getProvider()
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    set({ error: runtimeStreamRecoveringMessage() })
    try {
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        goal,
        todos
      } = await p.getThreadDetail(activeThreadId)
      const loaded = hydrateBlockModelLabels(activeThreadId, rawBlocks)
      const busy = threadSnapshotLooksRunning(loaded, threadStatus)
      // The server has settled but a tool/approval/user_input block may still be
      // open (e.g. a delegate_task interrupted by a runtime restart). Settle it,
      // otherwise threadHasPendingRuntimeWork stays true and the queued message
      // we are recovering re-queues forever instead of draining (kdczyz/Joker#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? state.currentTurnUserId ?? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const currentTurnId = busy ? state.currentTurnId ?? latestTurnId ?? null : null

      set((s) => ({
        activeThreadId,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        blocks,
        lastSeq: latestSeq,
        // Re-baseline the shared delta floor to this subscription's since_seq,
        // in lockstep with the liveAssistant reset below.
        liveDeltaSeqFloor: latestSeq,
        liveReasoning: '',
        liveAssistant: '',
        error: busy ? runtimeStreamRecoveringMessage() : null,
        busy,
        currentTurnId,
        currentTurnUserId,
        turnDurationByUserId,
        queuedMessages: s.queuedMessages
      }))

      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: latestSeq })
      void p.subscribeThreadEvents(activeThreadId, latestSeq, sink, ac.signal)
      if (busy) {
        armBusyWatchdog(set, get)
      } else {
        resetBusyRecoveryAttempts()
        if (get().queuedMessages.length > 0) {
          void get().drainQueuedMessages()
        }
      }
      return busy
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      if (state.busy) armBusyWatchdog(set, get)
      return state.busy
    }
  },

  selectThread: async (id, options) => {
    const skipDetail = options?.skipDetail === true
    const selectionGeneration = ++threadSelectionGeneration
    const isLatestSelection = () => selectionGeneration === threadSelectionGeneration
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const prevId = get().activeThreadId
    const prevBusy = get().busy
    let nextWatch = { ...get().watchTurnCompletion }
    delete nextWatch[id]
    clearWatchedCompletionNotification(id)
    if (prevId && prevId !== id && prevBusy) {
      nextWatch[prevId] = true
      watchTurnCompletionNotification(prevId)
    }
    const nextUnread = { ...get().unreadThreadIds }
    delete nextUnread[id]
    // Acknowledge the terminal status-dot so the breathing light
    // (completed / interrupted / needs-review) disappears on click.
    let nextAcknowledged = { ...get().acknowledgedStatusDotThreadIds }
    const selectThreadTarget = get().threads.find((t) => t.id === id)
    if (selectThreadTarget) {
      const dot = threadStatusDotForThread(selectThreadTarget)
      if (dot === 'completed' || dot === 'interrupted' || dot === 'needs-review') {
        nextAcknowledged[id] = true
      }
    }

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    // Switch the visible selection before fetching its history. Previously the
    // old conversation stayed on screen until getThreadDetail resolved, making
    // a valid Claw sidebar click look like it had done nothing.
    set({
      activeThreadId: id,
      blocks: [],
      liveReasoning: '',
      liveAssistant: '',
      error: null,
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      inspectorSelectedId: null,
      queuedMessages: []
    })
    const p = getProvider()
    if (skipDetail) {
      // Freshly created thread (e.g. the first canvas/design send): there is no
      // persisted history to fetch, so skip the getThreadDetail HTTP round-trip
      // and the SSE subscription — they would otherwise add a noticeable delay
      // between clicking send and the message appearing. sendMessage opens its
      // own SSE stream with sinceSeq = lastSeq (0 for a brand-new thread).
      clearBusyWatchdog()
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        acknowledgedStatusDotThreadIds: nextAcknowledged,
        activeThreadId: id,
        activeThreadRelation: 'primary',
        activeThreadParentId: null,
        activeThreadGoal: null,
        activeThreadTodos: null,
        blocks: [],
        lastSeq: 0,
        liveDeltaSeqFloor: 0,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        busy: false,
        currentTurnId: null,
        currentTurnUserId: null,
        turnStartedAtByUserId: {},
        turnDurationByUserId: {},
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {},
        turnTtftMsByUserId: {},
        inspectorSelectedId: null,
        queuedMessages: []
      })
      return
    }
    try {
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        usage: threadUsage,
        relation: threadRelation,
        parentThreadId: threadParentId,
        model: threadModel,
        goal,
        todos
      } = await p.getThreadDetail(id)
      if (!isLatestSelection()) return
      // A subagent's `side` thread has no locally-stored per-turn model labels
      // (it was never sent through the composer). Backfill the user blocks with
      // the child thread's resolved model so the session shows "which model",
      // matching the main conversation. Safe: a child runs on a single model.
      const labeledBlocks =
        threadRelation === 'side' && threadModel
          ? rawBlocks.map((block) =>
              block.kind === 'user' && !block.modelLabel
                ? { ...block, modelLabel: threadModel }
                : block
            )
          : rawBlocks
      const loaded = hydrateBlockModelLabels(id, labeledBlocks)
      // A send that has not reached the runtime yet has no running turn for
      // the snapshot to show, but the thread is still busy — keep it busy so
      // re-selecting it mid-submit doesn't flicker back to idle.
      const sending = get().pendingSendThreadIds?.[id] === true
      const busy = sending || threadSnapshotLooksRunning(loaded, threadStatus)
      // Settle blocks left open by an interrupted turn when the server has
      // already settled, so selecting the thread doesn't keep it wedged (#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const threadSnap = get().threads.find((thread) => thread.id === id) ?? null
      const composerSelection = composerSelectionForThread(get(), threadSnap)
      const composerMode = composerModeForThread(threadSnap, readThreadComposerMode(id))
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        acknowledgedStatusDotThreadIds: nextAcknowledged,
        activeThreadId: id,
        activeThreadRelation: threadRelation ?? 'primary',
        activeThreadParentId: threadParentId ?? null,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        blocks,
        lastSeq: latestSeq,
        liveDeltaSeqFloor: latestSeq,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnUserId,
        turnStartedAtByUserId: {},
        turnDurationByUserId,
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {},
        turnTtftMsByUserId: {},
        inspectorSelectedId: null,
        queuedMessages: [],
        composerMode,
        ...(composerSelection
          ? {
              composerModel: composerSelection.model,
              composerProviderId: composerSelection.providerId,
              composerReasoningEffort: composerReasoningEffortForSelection(
                get().composerModelGroups,
                composerSelection.model,
                composerSelection.providerId
              )
            }
          : {})
      })
      syncTurnCompletionPoll(set, get)
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: id, signal: ac.signal, sinceSeq: latestSeq })
      subscribeThreadEventsWithRecovery(p, id, latestSeq, sink, ac.signal, get)
      if (busy) armBusyWatchdog(set, get)
    } catch (e) {
      if (!isLatestSelection()) return
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  subscribeThreadEventsLive: async (threadId) => {
    if (get().runtimeConnection !== 'ready') return
    const targetThreadId = threadId.trim()
    if (!targetThreadId) return
    // Live-only entry point for claw channel events (e.g. Feishu / Lark
    // bot replies). Three things happen in parallel:
    //   1. Synchronously switch the chat view to this thread + mark busy
    //      so the user sees the bot's deltas arrive as they stream in,
    //      not blocked by the HTTP fetch.
    //   2. Open the SSE stream immediately with `sinceSeq: 0` to capture
    //      any deltas that arrive during the fetch window.
    //   3. Pre-fetch the thread's persisted history so the user is not
    //      left staring at an empty view if the thread had prior turns.
    // On fetch success we merge the persisted blocks into the store
    // while preserving the liveAssistant/liveReasoning buffers (which
    // may have accumulated SSE deltas during the fetch) and bumping
    // `lastSeq` to `Math.max(fetched, current)` so no deltas are lost.
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    const p = getProvider()
    const prevState = get()
    // Same-thread case: keep the existing blocks/lastSeq so the user does
    // not see the view blank out for a turn that is already streaming.
    // Cross-thread case: start empty (the fetch will populate history).
    const keepExistingBlocks = prevState.activeThreadId === targetThreadId
    resetBusyRecoveryAttempts()
    clearBusyWatchdog()
    set({
      activeThreadId: targetThreadId,
      blocks: keepExistingBlocks ? prevState.blocks : [],
      lastSeq: keepExistingBlocks ? prevState.lastSeq : 0,
      // This live entry point subscribes from since_seq=0, so the floor starts
      // at 0 too (matching the per-sink floor) — the buffer is reset to '' here.
      liveDeltaSeqFloor: 0,
      liveReasoning: '',
      liveAssistant: '',
      unreadThreadIds: { ...prevState.unreadThreadIds, [targetThreadId]: false },
      busy: true,
      currentTurnId: null,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      turnTtftMsByUserId: {},
      inspectorSelectedId: null,
      queuedMessages: []
    })
    const ac = new AbortController()
    sseAbortRef.current = ac
    const sink = buildThreadEventSink(set, get, { threadId: targetThreadId, signal: ac.signal, sinceSeq: 0 })
    subscribeThreadEventsWithRecovery(p, targetThreadId, 0, sink, ac.signal, get)
    armBusyWatchdog(set, get)
    // Pre-fetch persisted history in parallel. The SSE is already open
    // and may have started accumulating deltas; the merge step below
    // must not stomp on those buffers.
    try {
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        goal,
        todos
      } = await p.getThreadDetail(targetThreadId)
      if (ac.signal.aborted) return
      const loaded = hydrateBlockModelLabels(targetThreadId, rawBlocks)
      const busy = threadSnapshotLooksRunning(loaded, threadStatus)
      // Settle blocks left open by an interrupted turn when the server has
      // already settled, so the thread doesn't stay wedged on load (#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      set((s) => ({
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        blocks,
        // Bump lastSeq to the max of fetched and current so deltas
        // received during the fetch window are not lost.
        lastSeq: Math.max(latestSeq, s.lastSeq),
        busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnUserId,
        turnDurationByUserId
        // Note: `liveAssistant` and `liveReasoning` are intentionally
        // NOT touched here. They may contain deltas that arrived during
        // the fetch and must be preserved for `flushLiveBlocks` to pick
        // them up at turn boundaries.
      }))
      if (!busy && get().queuedMessages.length > 0) {
        void get().drainQueuedMessages()
      }
    } catch (e) {
      // Fetch failure: keep the SSE open so the user still sees the
      // streaming deltas, but surface the error in the UI.
      if (ac.signal.aborted) return
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  drainQueuedMessages: async () => {
    if (drainingQueuedMessages) return
    drainingQueuedMessages = true
    try {
      while (true) {
        const state = get()
        const queuedMessages = state.queuedMessages.filter((message) => !message.guiPlan)
        if (queuedMessages.length !== state.queuedMessages.length) {
          set({ queuedMessages })
        }
        const next = queuedMessages[0]
        if (!next || state.busy) return
        const started = await get().sendMessage(next.text, next.mode, { queued: next })
        if (!started) return
      }
    } finally {
      drainingQueuedMessages = false
    }
  },

  removeQueuedMessage: (id) =>
    set((s) => ({
      queuedMessages: s.queuedMessages.filter((message) => message.id !== id)
    })),

  guideQueuedMessage: async (id) => {
    if (guidingQueuedMessageIds.has(id)) return false
    const state = get()
    const message = state.queuedMessages.find((candidate) => candidate.id === id)
    if (!message) return false
    if (!canGuideQueuedMessage(message)) {
      set({ error: i18n.t('common:guideQueuedMessageTextOnly') })
      return false
    }
    if (!state.busy || !state.activeThreadId || !state.currentTurnId) {
      set({ error: i18n.t('common:guideQueuedMessageNoActiveTurn') })
      if (!state.busy) void get().drainQueuedMessages()
      return false
    }
    const provider = getProvider()
    if (typeof provider.steerUserMessage !== 'function') {
      set({ error: i18n.t('common:guideQueuedMessageUnsupported') })
      return false
    }

    guidingQueuedMessageIds.add(id)
    try {
      await provider.steerUserMessage(
        state.activeThreadId,
        state.currentTurnId,
        message.text,
        message.displayText ? { displayText: message.displayText } : undefined
      )
      set((current) => ({
        queuedMessages: current.queuedMessages.filter((candidate) => candidate.id !== id),
        error: null
      }))
      return true
    } catch (error) {
      const messageText = formatRuntimeError(error)
      set({
        error: i18n.t('common:guideQueuedMessageFailed', { message: messageText })
      })
      if (!get().busy) void get().drainQueuedMessages()
      return false
    } finally {
      guidingQueuedMessageIds.delete(id)
    }
  },

  sendMessage: async (text, mode, overrides) => {
    const trimmedText = text.trim()
    if (!trimmedText) return false
    const queued = overrides?.queued
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    if (get().route !== 'claw') {
      const state = get()
      const activeThread = state.activeThreadId
        ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
        : null
      let workspaceRoot = normalizeWorkspaceRoot(activeThread?.workspace)
      if (!workspaceRoot) {
        workspaceRoot = normalizeWorkspaceRoot((await rendererRuntimeClient.getSettings()).workspaceRoot)
      }
      if (workspaceRoot && !(await workspaceDirectoryExists(workspaceRoot))) {
        set({ error: workspaceMissingError() })
        await showWorkspaceMissingDialog(workspaceRoot)
        return false
      }
    }
    const p = getProvider()
    const hasPendingActiveTurn = threadHasPendingRuntimeWork(get().blocks)
    if (get().busy || hasPendingActiveTurn) {
      if (overrides?.guiPlan) {
        set({ error: i18n.t('common:composerQueuePlaceholder') })
        return false
      }
      const now = Date.now()
      const activeThreadId = get().activeThreadId
      const threadSnap = activeThreadId
        ? get().threads.find((thread) => thread.id === activeThreadId)
        : undefined
      const overrideModel = overrides?.model?.trim()
      // Claw/IM composer picker writes to the desktop default
      // (`settings.agents.Joker.model`) via setComposerModel, so the channel's
      // bound model is always stale and must NOT shadow the global default.
      // Ignore `channel.model` here; only an explicit override or the global
      // composer model should drive the runtime call.
      const composerModel = overrideModel ?? get().composerModel.trim()
      const composerProviderId =
        overrides?.providerId?.trim() || fallbackComposerProviderIdForSend(get())
      const composerAccountId = overrides?.accountId?.trim() || accountIdForComposerSelection(
        get().composerModelGroups,
        composerProviderId,
        composerModel
      )
      const userModelChip =
        overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
      const displayText = overrides?.displayText?.trim()
      const reasoningEffort = overrides?.reasoningEffort?.trim()
      const attachmentIds = overrides?.attachmentIds?.filter((id) => id.trim().length > 0)
      const attachments = overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0)
      const fileReferences = overrides?.fileReferences?.filter((reference) =>
        reference.path.trim().length > 0 &&
        reference.relativePath.trim().length > 0 &&
        reference.name.trim().length > 0
      )
      const composerContexts = get().route === 'chat'
        ? overrides?.composerContexts ?? pendingComposerContexts(get())
        : []
      set((s) => ({
        queuedMessages: [
          ...s.queuedMessages,
          {
            id: `q-${now}-${s.queuedMessages.length}`,
            text: trimmedText,
            ...(displayText ? { displayText } : {}),
            ...(mode ? { mode } : {}),
            ...(composerModel ? { model: composerModel } : {}),
            ...(composerProviderId ? { providerId: composerProviderId } : {}),
            ...(composerAccountId ? { accountId: composerAccountId } : {}),
            ...(userModelChip ? { modelLabel: userModelChip } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(overrides?.guiPlan ? { guiPlan: overrides.guiPlan } : {}),
            ...(overrides?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
            ...(overrides?.guiDesignMode ? { guiDesignMode: true } : {}),
            ...(overrides?.guiDesignArtifact ? { guiDesignArtifact: overrides.guiDesignArtifact } : {}),
            ...(attachmentIds?.length ? { attachmentIds } : {}),
            ...(attachments?.length ? { attachments } : {}),
            ...(fileReferences?.length ? { fileReferences } : {}),
            ...(composerContexts.length ? { composerContexts } : {})
          }
        ],
        extensionComposerContexts: withoutConsumedComposerContexts(s, composerContexts),
        error: null
      }))
      // UI/runtime can briefly drift (busy=false while runtime still has an active turn).
      // Kick recovery so queued input drains as soon as the in-flight turn settles.
      if (!get().busy && hasPendingActiveTurn) {
        void get().recoverActiveTurn()
      }
      return true
    }
    const now = Date.now()
    // The runtime only marks the thread as running once `sendUserMessage`
    // lands, but the composer goes busy right now (settings, Git checkpoint,
    // thread creation still have to run). Record that in-flight window: the
    // completion watch armed by a conversation switch reads thread snapshots,
    // and a pre-turn snapshot looks exactly like "the turn already finished".
    const markSendPending = (threadId: string | null): void => {
      if (!threadId) return
      set((s) => ({
        pendingSendThreadIds: { ...(s.pendingSendThreadIds ?? {}), [threadId]: true },
        threads: markThreadTurnRunning(s.threads, threadId, now)
      }))
    }
    const clearSendPending = (threadId: string | null): void => {
      if (!threadId) return
      set((s) => {
        if (!s.pendingSendThreadIds?.[threadId]) return {}
        const pendingSendThreadIds = { ...s.pendingSendThreadIds }
        delete pendingSendThreadIds[threadId]
        return { pendingSendThreadIds }
      })
    }
    const userBlockId = queued?.id ?? `u-${now}`
    const attachmentIds =
      queued?.attachmentIds ??
      overrides?.attachmentIds?.filter((id) => id.trim().length > 0) ??
      []
    const attachments =
      queued?.attachments ??
      overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0) ??
      []
    const fileReferences =
      queued?.fileReferences ??
      overrides?.fileReferences?.filter((reference) =>
        reference.path.trim().length > 0 &&
        reference.relativePath.trim().length > 0 &&
        reference.name.trim().length > 0
      ) ??
      []
    const composerContexts = queued?.composerContexts ?? (get().route === 'chat'
      ? overrides?.composerContexts ?? pendingComposerContexts(get())
      : [])
    let activeThreadId = get().activeThreadId
    const displayText = queued?.displayText ?? overrides?.displayText?.trim() ?? trimmedText
    const userDisplayText = displayText !== trimmedText ? displayText : undefined
    const generatedTitle = deriveThreadTitleFromPrompt(displayText)
    const shouldAutoRenameForRoute = get().route === 'chat'
    const activeThread = activeThreadId
      ? get().threads.find((thread) => thread.id === activeThreadId) ?? null
      : null
    let shouldRenameThreadAfterSend =
      shouldAutoRenameForRoute &&
      !!activeThreadId &&
      get().blocks.every((block) => block.kind !== 'user') &&
      shouldAutoTitleThread(activeThread)
    const threadSnap = get().threads.find((thread) => thread.id === activeThreadId)
    const overrideModel = overrides?.model?.trim()
    // Claw/IM composer picker writes to the desktop default
    // (`settings.agents.Joker.model`) via setComposerModel, so the channel's
    // bound model is always stale and must NOT shadow the global default.
    // Only an explicit override (queued or call-site), or the global composer
    // model, should drive the runtime call.
    const composerModel =
      queued?.model ?? overrideModel ?? get().composerModel.trim()
    const composerProviderId =
      queued?.providerId ?? overrides?.providerId?.trim() ?? fallbackComposerProviderIdForSend(get())
    const composerAccountId =
      queued?.accountId ??
      overrides?.accountId?.trim() ??
      accountIdForComposerSelection(get().composerModelGroups, composerProviderId, composerModel)
    const reasoningEffort = queued?.reasoningEffort ?? overrides?.reasoningEffort?.trim()
    const guiDesignCanvas = (queued?.guiDesignCanvas ?? overrides?.guiDesignCanvas) === true
    const guiDesignMode = (queued?.guiDesignMode ?? overrides?.guiDesignMode) === true
    const userModelChip =
      queued?.modelLabel ?? overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
    const previousBlocks = get().blocks
    const previousActiveThreadId = get().activeThreadId
    const previousLastSeq = get().lastSeq
    const previousCurrentTurnId = get().currentTurnId
    const previousCurrentTurnUserId = get().currentTurnUserId
    const previousTurnStartedAtByUserId = get().turnStartedAtByUserId
    const previousTurnDurationByUserId = get().turnDurationByUserId
    const previousTurnReasoningFirstAtByUserId = get().turnReasoningFirstAtByUserId
    const previousTurnReasoningLastAtByUserId = get().turnReasoningLastAtByUserId
    const previousTurnTtftMsByUserId = get().turnTtftMsByUserId
    const previousQueuedMessages = get().queuedMessages
    resetBusyRecoveryAttempts()
    set((s) => ({
      busy: true,
      blocks: [
        ...s.blocks,
        {
          kind: 'user' as const,
          id: userBlockId,
          createdAt: new Date(now).toISOString(),
          text: displayText,
          ...(userModelChip ? { modelLabel: userModelChip } : {}),
          ...(userDisplayText || guiDesignCanvas || guiDesignMode || attachmentIds.length || attachments.length || fileReferences.length || composerContexts.length
            ? {
                meta: {
                  ...(userDisplayText ? { displayText: userDisplayText } : {}),
                  ...(guiDesignCanvas ? { guiDesignCanvas: true } : {}),
                  ...(guiDesignMode ? { guiDesignMode: true } : {}),
                  ...(attachmentIds.length ? { attachmentIds } : {}),
                  ...(attachments.length ? { attachments } : {}),
                  ...(fileReferences.length ? { fileReferences } : {}),
                  ...(composerContexts.length ? { composerContexts } : {})
                }
              }
            : {})
        }
      ],
      liveReasoning: '',
      liveAssistant: '',
      error: null,
      currentTurnUserId: userBlockId,
      turnStartedAtByUserId: { ...s.turnStartedAtByUserId, [userBlockId]: now },
      queuedMessages: queued ? s.queuedMessages.filter((message) => message.id !== queued.id) : s.queuedMessages
    }))
    markSendPending(activeThreadId)
    if (!activeThreadId) {
      try {
        const settings = await rendererRuntimeClient.getSettings()
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        if (!workspaceRoot) {
          set({
            blocks: previousBlocks,
            busy: false,
            currentTurnId: previousCurrentTurnId,
            currentTurnUserId: previousCurrentTurnUserId,
            turnStartedAtByUserId: previousTurnStartedAtByUserId,
            turnDurationByUserId: previousTurnDurationByUserId,
            turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
            turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
            queuedMessages: previousQueuedMessages,
            error: i18n.t('common:workspaceRequiredToCreateThread')
          })
          return false
        }
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
        set({ codeWorkspaceRoots })
        const reusableThreadId = await findReusableEmptyThreadId(
          get(),
          p,
          workspaceRoot,
          (thread) => isCodeThread(thread, get().clawChannels)
        )
        const reusableThread = reusableThreadId
          ? get().threads.find((thread) => thread.id === reusableThreadId) ?? null
          : null
        shouldRenameThreadAfterSend =
          shouldAutoRenameForRoute &&
          reusableThreadId != null && shouldAutoTitleThread(reusableThread)
        const createdThread =
          reusableThreadId == null
            ? await p.createThread({
                workspace: workspaceRoot,
                title: generatedTitle,
                // Provisional first-message title; let the backend LLM titler upgrade it.
                titleAuto: true,
                ...(composerModel ? { model: composerModel } : {}),
                ...(composerProviderId ? { providerId: composerProviderId } : {}),
                ...(composerAccountId ? { accountId: composerAccountId } : {}),
                mode: mode ?? 'agent'
              })
            : null
        const threadId = reusableThreadId ?? createdThread?.id ?? null
        if (!threadId) {
          throw new Error('Failed to resolve target thread id.')
        }
        activeThreadId = threadId
        markSendPending(threadId)
        if (composerModel) {
          rememberThreadComposerSelection(threadId, composerModel, composerProviderId)
        }
        set((s) => ({
          activeThreadId: threadId,
          // Freshly created threads are always primary — clear any side-session
          // relation carried over from the previously active thread.
          activeThreadRelation: 'primary',
          activeThreadParentId: null,
          codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, createdThread?.workspace]),
          lastSeq: 0,
          inspectorSelectedId: null,
          threads:
            createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
              ? [createdThread, ...s.threads]
              : s.threads
        }))
        void get().refreshThreads()
      } catch (e) {
        void window.JokerGui.logError('create-thread', 'Failed to create thread', {
          message: e instanceof Error ? e.message : String(e)
        }).catch(() => undefined)
        set({
          activeThreadId: previousActiveThreadId,
          blocks: previousBlocks,
          lastSeq: previousLastSeq,
          busy: false,
          currentTurnId: previousCurrentTurnId,
          currentTurnUserId: previousCurrentTurnUserId,
          turnStartedAtByUserId: previousTurnStartedAtByUserId,
          turnDurationByUserId: previousTurnDurationByUserId,
          turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
          turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
          turnTtftMsByUserId: previousTurnTtftMsByUserId,
          queuedMessages: previousQueuedMessages,
          error: formatRuntimeError(e),
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
        return false
      }
    }
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    try {
      const seqAtSend = get().lastSeq
      const channel = get().route === 'claw' ? activeClawChannel(get()) : null
      if (!channel && composerModel) {
        rememberThreadComposerSelection(activeThreadId, composerModel, composerProviderId)
      }
      await ensureRuntimeProviderForSend({
        providerId: composerProviderId,
        model: composerModel
      })
      const settings = await rendererRuntimeClient.getSettings()
      let workspaceCheckpointId: string | undefined
      const checkpointThread = get().threads.find((thread) => thread.id === activeThreadId)
      const checkpointWorkspaceRoot = normalizeWorkspaceRoot(checkpointThread?.workspace) || normalizeWorkspaceRoot(settings.workspaceRoot)
      const checkpointWorkspaceKey = checkpointWorkspaceRoot.replaceAll('\\', '/').toLowerCase()
      if (
        checkpointWorkspaceRoot &&
        checkpointGitAvailability.canAttempt(checkpointWorkspaceKey) &&
        typeof window.JokerGui.createGitCheckpoint === 'function'
      ) {
        const checkpoint = await window.JokerGui.createGitCheckpoint({
          workspaceRoot: checkpointWorkspaceRoot,
          threadId: activeThreadId
        }).catch((error) => ({
          ok: false as const,
          reason: 'error' as const,
          message: error instanceof Error ? error.message : String(error)
        }))
        if (checkpoint.ok) {
          workspaceCheckpointId = checkpoint.checkpointId
        } else if (checkpoint.reason !== 'not_git_repo' && checkpoint.reason !== 'no_workspace') {
          if (checkpoint.reason === 'git_unavailable') {
            checkpointGitAvailability.markUnavailable(checkpointWorkspaceKey)
          }
          void window.JokerGui.logError(
            'git-checkpoint',
            checkpoint.reason === 'git_unavailable'
              ? 'Git checkpoint disabled for this workspace because Git was not found'
              : 'Failed to create Git checkpoint',
            {
              message: checkpoint.message,
              reason: checkpoint.reason,
              workspaceRoot: checkpointWorkspaceRoot
            }
          ).catch(() => undefined)
        }
      }
      let runtimeText: string
      if (channel) {
        runtimeText = buildClawRuntimePrompt(settings, trimmedText, { channel })
      } else {
        runtimeText = buildCodeRuntimePrompt(settings, trimmedText)
      }
      const runtimeDisplayText = channel ? displayText : (userDisplayText ?? trimmedText)
      const { turnId, userMessageItemId } = await p.sendUserMessage(activeThreadId, runtimeText, {
        mode,
        ...(composerModel ? { model: composerModel } : {}),
        ...(composerProviderId ? { providerId: composerProviderId } : {}),
        ...(!channel && composerAccountId ? { accountId: composerAccountId } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(runtimeDisplayText ? { displayText: runtimeDisplayText } : {}),
        ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
        ...(guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(guiDesignMode ? { guiDesignMode: true } : {}),
        ...((queued?.guiDesignArtifact ?? overrides?.guiDesignArtifact)
          ? { guiDesignArtifact: queued?.guiDesignArtifact ?? overrides?.guiDesignArtifact }
          : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(workspaceCheckpointId ? { workspaceCheckpointId } : {}),
        ...(fileReferences.length ? { fileReferences } : {}),
        ...(composerContexts.length ? { composerContexts } : {}),
        ...(channel ? { imContext: true } : {})
      })
      // The turn is registered on the runtime now — thread status and turn
      // status flip together — so the idle snapshot can no longer be a race.
      clearSendPending(activeThreadId)
      if (!queued && composerContexts.length > 0) {
        set((state) => ({
          extensionComposerContexts: withoutConsumedComposerContexts(state, composerContexts)
        }))
      }
      // Mirror the composer model selection against the runtime's stable
      // user_message item id so the badge survives page refresh / thread
      // re-selection. The runtime itself doesn't persist per-turn metadata.
      if (userMessageItemId && userModelChip) {
        rememberTurnModel(activeThreadId, userMessageItemId, userModelChip)
      }
      if (userMessageItemId && userMessageItemId !== userBlockId) {
        set((s) => ({
          blocks: reconcileOptimisticUserBlock(
            s.blocks,
            userBlockId,
            userMessageItemId,
            displayText,
            userModelChip
          ).map((block) =>
            block.kind === 'user' && block.id === userMessageItemId
              ? {
                  ...block,
                  meta: {
                    ...(block.meta ?? {}),
                    turnId,
                    ...(workspaceCheckpointId ? { workspaceCheckpointId } : {})
                  }
                }
              : block
          ),
          currentTurnUserId: s.currentTurnUserId === userBlockId ? userMessageItemId : s.currentTurnUserId,
          turnStartedAtByUserId: (() => {
            if (s.turnStartedAtByUserId[userBlockId] === undefined) return s.turnStartedAtByUserId
            const next = { ...s.turnStartedAtByUserId, [userMessageItemId]: s.turnStartedAtByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnDurationByUserId: (() => {
            if (s.turnDurationByUserId[userBlockId] === undefined) return s.turnDurationByUserId
            const next = { ...s.turnDurationByUserId, [userMessageItemId]: s.turnDurationByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningFirstAtByUserId: (() => {
            if (s.turnReasoningFirstAtByUserId[userBlockId] === undefined) return s.turnReasoningFirstAtByUserId
            const next = {
              ...s.turnReasoningFirstAtByUserId,
              [userMessageItemId]: s.turnReasoningFirstAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningLastAtByUserId: (() => {
            if (s.turnReasoningLastAtByUserId[userBlockId] === undefined) return s.turnReasoningLastAtByUserId
            const next = {
              ...s.turnReasoningLastAtByUserId,
              [userMessageItemId]: s.turnReasoningLastAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })(),
          turnTtftMsByUserId: (() => {
            if (s.turnTtftMsByUserId[userBlockId] === undefined) return s.turnTtftMsByUserId
            const next = {
              ...s.turnTtftMsByUserId,
              [userMessageItemId]: s.turnTtftMsByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })()
        }))
      }
      if (channel && typeof window.JokerGui?.mirrorClawChannelMessage === 'function') {
        const userMirror = await window.JokerGui.mirrorClawChannelMessage(
          activeThreadId,
          trimmedText,
          'user'
        )
        if (userMirror.ok) {
          rememberPendingClawFeishuMirror(turnId, {
            threadId: activeThreadId,
            userBlockId: userMessageItemId ?? userBlockId,
            userText: trimmedText
          })
        }
      }
      // Re-baseline the shared delta floor to this send's since_seq right before
      // the sink opens, so a replayed backlog can't re-append text. Subscribe to the
      // turn's event stream BEFORE the cosmetic title rename so a slow/blocked title
      // write never delays the conversation.
      set({ currentTurnId: turnId, liveDeltaSeqFloor: seqAtSend })
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: seqAtSend })
      subscribeThreadEventsWithRecovery(p, activeThreadId, seqAtSend, sink, ac.signal, get)
      armBusyWatchdog(set, get)
      if (shouldRenameThreadAfterSend) {
        // Provisional first-message title; the backend LLM titler upgrades it
        // later (fire-and-forget on the runtime). Awaited here only to land the
        // title before refreshThreads re-reads the list — never blocks the stream.
        const renamed = await p.renameThread(activeThreadId, generatedTitle, true).then(() => true).catch(() => {
          /* keep message delivery successful even if auto-title update fails */
          return false
        })
        if (renamed) {
          set((s) => ({
            threads: s.threads.map((thread) =>
              thread.id === activeThreadId ? { ...thread, title: generatedTitle, titleAuto: true } : thread
            )
          }))
        }
      }
      await get().refreshThreads()
      return true
    } catch (e) {
      clearBusyWatchdog()
      clearSendPending(activeThreadId)
      void window.JokerGui.logError('send-message', 'Failed to send message', {
        message: e instanceof Error ? e.message : String(e),
        threadId: activeThreadId
      }).catch(() => undefined)
      if (looksLikeActiveTurnError(e)) {
        set({
          blocks: previousBlocks,
          busy: false,
          currentTurnId: previousCurrentTurnId,
          currentTurnUserId: previousCurrentTurnUserId,
          turnStartedAtByUserId: previousTurnStartedAtByUserId,
          turnDurationByUserId: previousTurnDurationByUserId,
          turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
          turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
          turnTtftMsByUserId: previousTurnTtftMsByUserId,
          queuedMessages: previousQueuedMessages,
          error: i18n.t('common:runtimeActiveTurn')
        })
        await get().recoverActiveTurn()
        await get().refreshThreads()
        return false
      }
      set({
        error: formatRuntimeError(e),
        busy: false,
        currentTurnId: null,
        queuedMessages: previousQueuedMessages,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
      return false
    }
  },

  reviewActiveThread: async (target: ReviewTarget) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.reviewThread !== 'function') {
      set({ error: i18n.t('common:reviewUnavailable') })
      return false
    }
    if (get().busy || threadHasPendingRuntimeWork(get().blocks)) {
      set({ error: i18n.t('common:composerQueuePlaceholder') })
      return false
    }
    const composerModel = get().composerModel.trim()
    const composerProviderId = get().composerProviderId.trim()
    const composerAccountId = accountIdForComposerSelection(
      get().composerModelGroups,
      composerProviderId,
      composerModel
    )
    let activeThreadId = get().activeThreadId
    try {
      if (!activeThreadId) {
        const settings = await rendererRuntimeClient.getSettings()
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        if (!workspaceRoot) {
          set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
          return false
        }
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
        set({ codeWorkspaceRoots })
        const reusableThreadId = await findReusableEmptyThreadId(
          get(),
          p,
          workspaceRoot,
          (thread) => isCodeThread(thread, get().clawChannels)
        )
        const createdThread =
          reusableThreadId == null
            ? await p.createThread({
                workspace: workspaceRoot,
                title: i18n.t('common:slashCommandReviewTitle'),
                ...(composerModel ? { model: composerModel } : {}),
                ...(composerProviderId ? { providerId: composerProviderId } : {}),
                ...(composerAccountId ? { accountId: composerAccountId } : {}),
                mode: 'agent'
              })
            : null
        activeThreadId = reusableThreadId ?? createdThread?.id ?? null
        if (!activeThreadId) throw new Error('Failed to resolve target thread id.')
        set((s) => ({
          activeThreadId,
          codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, createdThread?.workspace]),
          lastSeq: 0,
          inspectorSelectedId: null,
          threads:
            createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
              ? [createdThread, ...s.threads]
              : s.threads
        }))
      }
      const threadSnap = get().threads.find((thread) => thread.id === activeThreadId)
      const userModelChip = optimisticUserModelLabel(composerModel, threadSnap?.model)
      const seqAtSend = get().lastSeq
      resetBusyRecoveryAttempts()
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
      set({
        busy: true,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        currentTurnId: null,
        currentTurnUserId: null
      })
      await ensureRuntimeProviderForSend({
        providerId: composerProviderId,
        model: composerModel
      })
      const { turnId, userMessageItemId } = await p.reviewThread(activeThreadId, target, {
        ...(composerModel ? { model: composerModel } : {}),
        ...(composerProviderId ? { providerId: composerProviderId } : {}),
        ...(composerAccountId ? { accountId: composerAccountId } : {})
      })
      if (userMessageItemId && userModelChip) {
        rememberTurnModel(activeThreadId, userMessageItemId, userModelChip)
      }
      // Re-baseline the shared delta floor to this send's since_seq right
      // before the sink opens, so a replayed backlog can't re-append text.
      set({ currentTurnId: turnId, liveDeltaSeqFloor: seqAtSend })
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: seqAtSend })
      subscribeThreadEventsWithRecovery(p, activeThreadId, seqAtSend, sink, ac.signal, get)
      armBusyWatchdog(set, get)
      await get().refreshThreads()
      return true
    } catch (e) {
      clearBusyWatchdog()
      set({
        error: formatRuntimeError(e),
        busy: false,
        currentTurnId: null,
        currentTurnUserId: null,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
      return false
    }
  },
  }
}
