import type {
  AttachmentReference,
  ChatBlock,
  NormalizedThread,
  RuntimeConnectionStatus,
  ReviewTarget,
  ThreadGoal,
  ThreadGoalStatus,
  ThreadTodoList,
  ThreadTodoStatus,
  ThreadUsageSnapshot,
  UserFileReference,
  UserInputAnswer
} from '../agent/types'
import type { JokerRuntimeStatusPayload } from '@shared/Joker-gui-api'
import type {
  AppLocale,
  ClawImAgentProfileV1,
  ClawImChannelV1,
  ClawImPlatformCredentialV1,
  ClawImProvider,
  ClawImSettingsV1,
  ClawModel,
  ModelReasoningEffort
} from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/Joker-gui-api'
import type { ComposerContextAttachment } from '@joker-code/extension-api'
import type { ExtensionComposerContextEvent } from '@shared/extension-ipc'

export type QueuedUserMessage = {
  id: string
  text: string
  displayText?: string
  mode?: string
  model?: string
  providerId?: string
  accountId?: string
  modelLabel?: string
  reasoningEffort?: string
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  fileReferences?: UserFileReference[]
  composerContexts?: ComposerContextAttachment[]
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  guiDesignArtifact?: { kind: 'svg'; artifactId: string; relativePath: string }
  /**
   * Optional GUI plan context forwarded to Joker. The renderer
   * attaches it for plan/refine turns so the runtime can advertise
   * the native `create_plan` tool and gate the write to the reserved
   * plan artifact.
   */
  guiPlan?: {
    operation: 'draft' | 'refine'
    workspaceRoot: string
    relativePath: string
    planId: string
    sourceRequest?: string
    title?: string
  }
}

/**
 * GUI plan context attached to a send-message call. Mirrors the
 * Joker `GuiPlanContextSchema` and is forwarded to the runtime
 * request body so plan/refine turns are scoped to a reserved path.
 */
export type GuiPlanMessageContext = {
  operation: 'draft' | 'refine'
  workspaceRoot: string
  relativePath: string
  planId: string
  sourceRequest?: string
  title?: string
}

export type SendMessageOverrides = {
  queued?: QueuedUserMessage
  model?: string
  providerId?: string
  accountId?: string
  modelLabel?: string
  reasoningEffort?: string
  displayText?: string
  guiPlan?: GuiPlanMessageContext
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  fileReferences?: UserFileReference[]
  composerContexts?: ComposerContextAttachment[]
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  guiDesignArtifact?: { kind: 'svg'; artifactId: string; relativePath: string }
}

export type InitialSetupMode = 'required' | 'preview'
export type SettingsRouteSection =
  | 'general'
  | 'providers'
  | 'speechToText'
  | 'agents'
  | 'subagents'
  | 'archives'
  | 'permissions'
  | 'skill'
  | 'mcp'
  | 'profile'
  | 'shortcuts'
  | 'easterEgg'
  | 'claw'
  | 'remote'
  | 'updates'
  | 'dataMigration'
export type AppRoute = 'chat' | 'design' | 'settings' | 'plugins' | 'extensions' | 'claw' | 'schedule' | 'workflow' | 'fileBrowser' | 'connectors'
export type PluginHostRoute = 'chat' | 'claw'

/**
 * Synthetic key used in `composerDrafts` for unsent text captured before any
 * thread exists (e.g. the first message in a workspace). Real thread drafts
 * are keyed by their thread id, which never collides with this value.
 */
export const COMPOSER_DRAFT_PENDING_KEY = '__pending__' as const

/**
 * A side conversation ("by-the-way") running alongside the active
 * thread. It owns its own timeline, composer, busy state, and SSE
 * subscription so it can stream in parallel with the main thread.
 *
 * The slice is namespaced under `sideConversations[threadId]` and
 * MUST NOT mutate any main-thread state (`activeThreadId`, `blocks`,
 * `busy`, etc.) — isolation is structural.
 */
export type SideConversation = {
  threadId: string
  parentThreadId: string
  title: string
  createdAt: string
  /** Timestamp the snapshot was taken from the parent. */
  inheritedAt: string
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  lastSeq: number
  input: string
  model: string
  reasoningEffort: string
  busy: boolean
  turnId: string | null
  userItemId: string | null
  error: string | null
}

export type SidePanelState = {
  open: boolean
  activeSideId: string | null
}

export type ChatState = {
  route: AppRoute
  settingsReturnRoute: Exclude<AppRoute, 'settings'>
  settingsReturnThreadId: string | null
  pluginHostRoute: PluginHostRoute
  settingsSection: SettingsRouteSection
  initialSetupOpen: boolean
  initialSetupMode: InitialSetupMode
  workspaceRoot: string
  workspaceLabel: string
  /** 对话会话的工作目录根(默认 ~/Documents/Joker),供侧边栏对话区块和项目保护使用。 */
  conversationWorkspaceRoot: string
  runtimeConnection: RuntimeConnectionStatus
  runtimeStatus: JokerRuntimeStatusPayload | null
  codeWorkspaceRoots: string[]
  threads: NormalizedThread[]
  threadSearch: string
  showArchivedThreads: boolean
  activeThreadId: string | null
  /** Relationship of the active thread (e.g. `side` for a subagent's own session). */
  activeThreadRelation: 'primary' | 'fork' | 'side' | null
  /** Parent thread of the active thread, when it is a `side`/`fork` branch. */
  activeThreadParentId: string | null
  activeThreadGoal: ThreadGoal | null
  activeThreadTodos: ThreadTodoList | null
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  /** Start timestamp of the current live reasoning segment (first delta); null when idle. */
  liveReasoningStartedAt: number | null
  /** Last reasoning-delta timestamp of the current live reasoning segment. */
  liveReasoningEndedAt: number | null
  lastSeq: number
  /**
   * Highest delta `seq` (per-thread, monotonic) already folded into the live
   * buffers. Unlike the per-sink `appliedDeltaSeqFloor` closure — which only
   * dedups within ONE subscription — this lives in the store and is shared
   * across every sink. When a long, tool-heavy turn loses its SSE stream and
   * more than one sink is briefly live (recovery / re-subscribe), the per-sink
   * floors are independent and each re-appends the same replayed deltas; the
   * shared floor serializes them so a given seq folds into `liveAssistant` at
   * most once. Reset to the new subscription's `sinceSeq` in lockstep with
   * every `liveAssistant` reset (send / select / recover / live / clear) — and
   * because seqs are per-thread, the reset is what keeps a thread switch from
   * dropping the new thread's low seqs. A genuine new delta always has seq >
   * sinceSeq, so this never drops live text.
   */
  liveDeltaSeqFloor: number
  usageRefreshKey: number
  /**
   * Latest turn's usage snapshot, tagged with the thread it belongs to. Used by
   * the context-capacity gauge: the last turn's prompt tokens ≈ what currently
   * occupies the window. Null until a live turn reports usage.
   */
  lastTurnUsage: { threadId: string; snapshot: ThreadUsageSnapshot } | null
  busy: boolean
  error: string | null
  runtimeErrorDetail: string | null
  currentTurnId: string | null
  currentTurnUserId: string | null
  turnStartedAtByUserId: Record<string, number>
  turnDurationByUserId: Record<string, number>
  turnReasoningFirstAtByUserId: Record<string, number>
  turnReasoningLastAtByUserId: Record<string, number>
  /**
   * Time-to-first-token (ms) per turn, keyed by the turn's user-block id. Set
   * when the first assistant *text* delta arrives for that turn. Used by the
   * composer token chip (session-average TTFT) and the usage line chart.
   */
  turnTtftMsByUserId: Record<string, number>
  inspectorSelectedId: string | null
  composerMode: 'plan' | 'agent'
  composerModel: string
  composerProviderId: string
  composerReasoningEffort: ModelReasoningEffort
  composerPickList: string[]
  composerModelGroups: ModelProviderModelGroup[]
  /**
   * Optional subagent profile id selected as the persona for the next new
   * thread / next-turn override. Empty = use the runtime default.
   */
  composerAgentId: string
  disabledSkillIds: string[]
  queuedMessages: QueuedUserMessage[]
  /**
   * Unsent composer text keyed by thread id. Persists across view/route
   * switches (including navigation to Settings, which unmounts Workbench) and
   * lets each session keep its own draft text. The active thread's draft is
   * surfaced through the composer input; clearing the input on send removes
   * the corresponding entry.
   */
  composerDrafts: Record<string, string>
  /**
   * Per-thread composer attachments that survive route/unmount switches.
   * Mirrors the text-only `composerDrafts` pattern so images and documents
   * persist alongside unsent text when navigating away (e.g. to Settings).
   */
  composerDraftAttachments: Record<string, AttachmentReference[]>
  /** Host-authenticated, workspace-scoped context awaiting one main-chat turn. */
  extensionComposerContexts: ExtensionComposerContextEvent[]
  watchTurnCompletion: Record<string, boolean>
  /**
   * Thread ids whose send request has left the composer but has not been
   * registered by the runtime yet. Between those two moments the runtime
   * still reports the thread as idle, so the completion watch must not read
   * that idle snapshot as "the turn finished" — doing so paints the green
   * completed breathing light (plus unread badge and completion
   * notification) for a turn that is only just starting.
   */
  pendingSendThreadIds: Record<string, boolean>
  unreadThreadIds: Record<string, boolean>
  /**
   * Thread ids whose terminal status-dot (completed / interrupted /
   * needs-review) has been "read" by the user (thread was active while
   * in that state). The breathing light is suppressed until a new turn
   * starts and clears this flag.
   */
  acknowledgedStatusDotThreadIds: Record<string, boolean>
  /**
   * Side conversations opened via `/btw`. The main thread selection
   * and subscription are never touched by these entries.
   */
  sideConversations: Record<string, SideConversation>
  sidePanel: SidePanelState
  clawChannels: ClawImChannelV1[]
  activeClawChannelId: string
  appendLocalClawTurn: (userText: string, replyText: string) => void
  setError: (message: string | null) => void
  setComposerMode: (mode: 'plan' | 'agent') => void
  setComposerModel: (modelId: string, providerId?: string) => void
  setComposerReasoningEffort: (effort: ModelReasoningEffort) => void
  setComposerAgentId: (agentId: string) => void
  loadComposerModels: () => Promise<void>
  /**
   * Update the unsent composer draft for a thread. Pass an empty string to
   * clear it (e.g. after the message is sent).
   */
  setComposerDraft: (threadId: string, text: string) => void
  /** Update the unsent composer attachments for a thread. */
  setComposerDraftAttachments: (threadId: string, attachments: AttachmentReference[]) => void
  setRoute: (r: AppRoute) => void
  openCode: () => Promise<void>
  openSettings: (section?: SettingsRouteSection) => void
  openPlugins: (host?: PluginHostRoute) => void
  openConnectors: () => void
  openClaw: () => void
  openSchedule: () => void
  openWorkflow: () => void
  clearActiveThreadSelection: () => void
  refreshClawChannels: () => Promise<void>
  addClawChannel: (
    provider: ClawImProvider,
    agentProfile?: Partial<ClawImAgentProfileV1>,
    platformCredential?: ClawImPlatformCredentialV1,
    options?: {
      channelId?: string
      model?: string
      workspaceRoot?: string
      enabled?: boolean
      im?: Partial<ClawImSettingsV1>
      preserveRoute?: boolean
    }
  ) => Promise<void>
  selectClawChannel: (channelId: string) => Promise<void>
  selectClawConversation: (channelId: string, threadId: string) => Promise<void>
  deleteClawChannel: (channelId: string) => Promise<void>
  resetClawChannelSession: (channelId: string) => Promise<void>
  setClawChannelModel: (channelId: string, model: string, providerId?: string) => Promise<void>
  openInitialSetup: (mode?: InitialSetupMode) => void
  closeInitialSetup: () => void
  boot: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background', options?: { restart?: boolean }) => Promise<void>
  chooseWorkspace: (options?: { createThreadAfter?: boolean; selectThreadAfter?: boolean }) => Promise<string | null>
  selectWorkspaceRoot: (workspaceRoot: string) => Promise<string | null>
  clearWorkspace: () => Promise<void>
  deleteWorkspace: (workspacePath: string) => Promise<void>
  refreshThreads: () => Promise<void>
  setThreadSearch: (query: string) => void
  setShowArchivedThreads: (show: boolean) => void
  createThread: (options?: {
    workspaceRoot?: string
    forceNew?: boolean
    /** When true, checkout the selected branch into an isolated worktree. */
    useWorktreePool?: boolean
    worktreeBranch?: string
    /**
     * Optional subagent profile id to bind the new thread to. When set
     * and the profile mode is 'primary' or 'all', the agent's
     * providerId / model / systemPrompt are snapshotted onto the thread.
     */
    agentId?: string
    /**
     * 创建一条不绑定项目文件夹的对话会话:在 conversationWorkspaceRoot 下
     * 自动创建一个时间戳子目录作为工作目录。
     */
    conversation?: boolean
  }) => Promise<void>
  createConversation: () => Promise<void>
  selectThread: (id: string, options?: { skipDetail?: boolean }) => Promise<void>
  /**
   * 打开 SSE 订阅一条 thread(不预先拉 getThreadDetail)。
   * 用于:onClawChannelActivity 自动切到 bot thread,让流式 deltas 立即可见。
   * 与 selectThread 的区别:selectThread 先做 HTTP getThreadDetail 拉元数据,
   * subscribeThreadEventsLive 直接开 SSE (sinceSeq=0),跳过 HTTP 抢在 SSE 之前。
   */
  subscribeThreadEventsLive: (threadId: string) => Promise<void>
  recoverActiveTurn: () => Promise<boolean>
  sendMessage: (text: string, mode?: string, overrides?: SendMessageOverrides) => Promise<boolean>
  reviewActiveThread: (target: ReviewTarget) => Promise<boolean>
  drainQueuedMessages: () => Promise<void>
  removeQueuedMessage: (id: string) => void
  guideQueuedMessage: (id: string) => Promise<boolean>
  attachExtensionComposerContext: (event: ExtensionComposerContextEvent) => void
  removeExtensionComposerContext: (attachmentId: string) => void
  rewindAndResend: (userBlockId: string, newText: string) => Promise<void>
  rollbackWorkspaceToCheckpoint: (checkpointId: string) => Promise<void>
  interrupt: (options?: { discard?: boolean }) => Promise<void>
  renameActiveThread: (title: string) => Promise<void>
  renameThread: (threadId: string, title: string) => Promise<void>
  pinThread: (threadId: string, pinned: boolean) => Promise<void>
  archiveThread: (threadId: string, archived: boolean) => Promise<void>
  compactActiveThread: (reason?: string) => Promise<void>
  forkActiveThread: () => Promise<void>
  forkThreadFromTurn: (turnId: string) => Promise<void>
  setActiveThreadGoal: (objective: string) => Promise<boolean>
  setActiveThreadGoalStatus: (status: ThreadGoalStatus) => Promise<boolean>
  clearActiveThreadGoal: () => Promise<boolean>
  setActiveThreadTodoStatus: (todoId: string, status: ThreadTodoStatus) => Promise<boolean>
  clearActiveThreadTodos: () => Promise<boolean>
  syncPlanTodosFromMarkdown: (
    plan: { id: string; relativePath: string },
    markdown: string
  ) => Promise<boolean>
  /**
   * Spawn a side conversation from the active thread. Available even
   * while the active thread is running. Does not change `activeThreadId`.
   * If `seedText` is provided, immediately sends it as the first turn.
   */
  spawnSideConversation: (seedText?: string) => Promise<string | null>
  /**
   * Open the side chat surface without creating an underlying side
   * thread. The first draft send will create the side thread.
   */
  openSideConversationDraft: () => void
  sendSideMessage: (sideId: string, text: string) => Promise<boolean>
  interruptSide: (sideId: string) => Promise<void>
  setSideInput: (sideId: string, text: string) => void
  setSideModel: (sideId: string, model: string) => void
  setSideReasoningEffort: (sideId: string, effort: string) => void
  selectSideConversation: (sideId: string) => void
  setSidePanelOpen: (open: boolean) => void
  closeSideConversation: (sideId: string) => Promise<void>
  discardSideConversation: (sideId: string) => Promise<void>
  promoteSideConversation: (sideId: string) => Promise<void>
  resumeSessionIntoThread: (
    sessionId: string,
    options?: { model?: string; mode?: string }
  ) => Promise<string | null>
  deleteThread: (threadId: string) => Promise<void>
  resolveApproval: (blockId: string, decision: 'allow' | 'deny') => Promise<void>
  resolveUserInput: (
    blockId: string,
    action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
  ) => Promise<void>
  selectInspectorItem: (id: string | null) => void
  applyI18nFromSettings: (locale: AppLocale) => Promise<void>
  reloadUiSettings: () => Promise<void>
}

export type ChatStoreSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)
) => void

export type ChatStoreGet = () => ChatState
