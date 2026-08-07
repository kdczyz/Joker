/**
 * GrokBuildProvider - AgentProvider implementation backed by grok-build.
 *
 * This provider communicates with the grok-build ACP runtime through the
 * preload bridge (window.RcodeGui.grok) and maps GrokBuildEvents to the
 * ThreadEventSink interface that the chat store expects.
 *
 * All model providers configured in Rcode settings are supported — the grok
 * runtime is started with the selected provider's API key, base URL, and model.
 */
import type {
  AgentProvider,
  ChatBlock,
  NormalizedThread,
  ThreadEventSink,
  ThreadListOptions,
  ThreadUsageSnapshot
} from './types'
import type { GrokBuildEvent } from '@shared/Rcode-gui-api'
import type { GrokBuildTurnState } from './grok-build-event-mapper'
import { mapGrokBuildEvent } from './grok-build-event-mapper'

// ---------------------------------------------------------------------------
// Local thread store (grok-build doesn't have persistent threads)
// ---------------------------------------------------------------------------

interface GrokBuildThreadRecord {
  id: string
  title: string
  workspace: string
  createdAt: string
  updatedAt: string
  sessionId: string | null
  blocks: ChatBlock[]
  seq: number
  usage: ThreadUsageSnapshot | null
}

function generateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `grok-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function nowISO(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// GrokBuildProvider
// ---------------------------------------------------------------------------

export class GrokBuildProvider implements AgentProvider {
  readonly id = 'grok-build' as const
  readonly displayName = 'Grok Build'

  private _threads = new Map<string, GrokBuildThreadRecord>()
  private _activeTurn: GrokBuildTurnState | null = null
  private _eventUnsubscribe: (() => void) | null = null
  private _eventBuffer: GrokBuildEvent[] = []
  private _globalEventUnsubscribe: (() => void) | null = null
  private _connected = false
  private _cwd = ''
  private _currentModel = ''

  // ------------------------------------------------------------------
  // AgentProvider implementation
  // ------------------------------------------------------------------

  getCapabilities() {
    return {
      interrupt: true,
      stream: true,
      approvals: false,
      attachFiles: false,
      review: false
    }
  }

  /** Resolve the provider config from Rcode settings. */
  private async _resolveProviderConfig(): Promise<{
    apiKey: string
    baseUrl: string
    model: string
    providerId: string
  }> {
    const settings = await window.RcodeGui.getSettings()
    const providerId = settings.agents?.Rcode?.providerId || settings.provider?.providers?.[0]?.id || ''
    const model = settings.agents?.Rcode?.model || ''

    // Find the selected provider profile
    const provider = settings.provider?.providers?.find(p => p.id === providerId)
    const apiKey = provider?.apiKey ?? ''
    const baseUrl = provider?.baseUrl ?? ''

    return { apiKey, baseUrl, model, providerId }
  }

  async connect(): Promise<void> {
    if (this._connected) return

    const config = await this._resolveProviderConfig()

    if (!config.apiKey) {
      throw new Error('No API key configured. Please set up a model provider in Settings.')
    }

    // Resolve cwd from settings or home directory
    let cwd = ''
    try {
      const settings = await window.RcodeGui.getSettings()
      cwd = settings.workspaceRoot || settings.conversationWorkspaceRoot || window.RcodeGui.homeDir
    } catch {
      cwd = window.RcodeGui.homeDir
    }

    this._currentModel = config.model

    // Connect to the grok-build ACP runtime with the selected provider config
    const result = await window.RcodeGui.grok.connect({
      cwd,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || undefined,
      model: config.model || undefined,
      providerId: config.providerId || undefined
    })
    if (!result.ok) {
      throw new Error(result.error ?? 'Failed to connect to grok-build runtime')
    }

    this._connected = true
    this._cwd = cwd

    // Set up a global event listener that buffers events until a sink is attached
    this._globalEventUnsubscribe = window.RcodeGui.grok.onEvent((event: GrokBuildEvent) => {
      this._eventBuffer.push(event)
    })
  }

  async listThreads(_options?: ThreadListOptions): Promise<NormalizedThread[]> {
    const threads: NormalizedThread[] = []
    for (const record of this._threads.values()) {
      threads.push(this._toNormalizedThread(record))
    }
    threads.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    return threads
  }

  async createThread(input: {
    workspace?: string
    title?: string
    titleAuto?: boolean
    mode?: string
    agentId?: string
    providerId?: string
    accountId?: string
    model?: string
    systemPrompt?: string
  }): Promise<NormalizedThread> {
    const id = generateId()
    const now = nowISO()
    const record: GrokBuildThreadRecord = {
      id,
      title: input.title ?? 'New Chat',
      workspace: input.workspace ?? this._cwd,
      createdAt: now,
      updatedAt: now,
      sessionId: null,
      blocks: [],
      seq: 0,
      usage: null
    }
    this._threads.set(id, record)
    return this._toNormalizedThread(record)
  }

  async getThreadDetail(threadId: string): Promise<{
    blocks: ChatBlock[]
    latestSeq: number
    threadStatus?: string
    latestTurnId?: string
    latestUserMessageId?: string
    turnDurationByUserId?: Record<string, number>
    usage?: ThreadUsageSnapshot
    relation?: 'primary' | 'fork' | 'side'
    parentThreadId?: string
    model?: string
  }> {
    const record = this._threads.get(threadId)
    if (!record) {
      return { blocks: [], latestSeq: 0 }
    }
    return {
      blocks: record.blocks,
      latestSeq: record.seq,
      usage: record.usage ?? undefined
    }
  }

  async sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      mode?: string
      model?: string
      providerId?: string
      accountId?: string
      reasoningEffort?: string
      displayText?: string
      attachmentIds?: string[]
      fileReferences?: unknown[]
      composerContexts?: unknown[]
    }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }> {
    const record = this._threads.get(threadId)
    if (!record) {
      throw new Error(`Thread not found: ${threadId}`)
    }

    const turnId = generateId()
    const userMessageItemId = generateId()
    const displayText = options?.displayText ?? text
    const now = nowISO()

    // Add user message block
    record.blocks = [
      ...record.blocks,
      {
        kind: 'user' as const,
        id: userMessageItemId,
        turnId,
        createdAt: now,
        text: displayText,
        modelLabel: options?.model,
        meta: {
          displayText: displayText !== text ? displayText : undefined,
          turnId
        }
      }
    ]

    // Initialize turn state
    this._activeTurn = {
      turnId,
      userMessageItemId,
      threadId,
      text: '',
      toolCalls: new Map(),
      seq: record.seq,
      startTime: Date.now(),
      inputTokens: 0,
      outputTokens: 0
    }

    // Update record
    record.updatedAt = now
    record.sessionId = record.sessionId ?? threadId

    // Clear any stale buffered events from previous turns
    this._eventBuffer = []

    // Send prompt to grok-build (non-blocking, streaming via events)
    const cwd = record.workspace || this._cwd
    const result = await window.RcodeGui.grok.sendPrompt({
      prompt: text,
      sessionId: record.sessionId,
      cwd
    })

    if (!result.ok) {
      this._activeTurn = null
      throw new Error(result.error ?? 'Failed to send prompt')
    }

    return { turnId, threadId, userMessageItemId }
  }

  async rewindThread(_threadId: string, _turnId: string): Promise<void> {
    // grok-build doesn't support rewinding
  }

  async renameThread(threadId: string, title: string, _auto?: boolean): Promise<void> {
    const record = this._threads.get(threadId)
    if (record) {
      record.title = title
      record.updatedAt = nowISO()
    }
  }

  async interruptTurn(_threadId: string, _turnId: string, options?: { discard?: boolean }): Promise<void> {
    // Clear local turn state; grok-build ACP doesn't support mid-stream cancel,
    // so we just drop the active turn. Subsequent events will be buffered but
    // ignored since there's no active turn to map them to.
    this._activeTurn = null
    this._eventBuffer = []

    // If discard is requested, also cancel the grok process. This is a heavy
    // operation (process restart) and should only be used when necessary.
    if (options?.discard) {
      await window.RcodeGui.grok.cancel().catch(() => undefined)
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this._threads.delete(threadId)
  }

  async subscribeThreadEvents(
    threadId: string,
    _sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    const record = this._threads.get(threadId)
    if (!record) {
      sink.onError(new Error(`Thread not found: ${threadId}`))
      return
    }

    // Only proceed if there's an active turn for THIS thread
    if (!this._activeTurn || this._activeTurn.threadId !== threadId) {
      return
    }

    // Drain buffered events first, then subscribe to live events
    this._drainBuffer(sink)
    this._subscribeToLiveEvents(sink, signal)
  }

  // ------------------------------------------------------------------
  // Event buffering and streaming
  // ------------------------------------------------------------------

  /** Drain buffered events that arrived before the sink was attached. */
  private _drainBuffer(sink: ThreadEventSink): void {
    const buffered = this._eventBuffer
    this._eventBuffer = []

    for (const event of buffered) {
      const turn = this._activeTurn
      if (!turn) break

      const actions = mapGrokBuildEvent(event, turn)
      for (const action of actions) {
        this._dispatchAction(action, sink, turn)
      }

      // Stop draining if the turn completed
      if (event.type === 'turn-complete') break
    }
  }

  /** Subscribe to live grok-build events. */
  private _subscribeToLiveEvents(sink: ThreadEventSink, signal: AbortSignal): void {
    // Unsubscribe from the global listener and set up a dedicated one
    this._globalEventUnsubscribe?.()
    this._globalEventUnsubscribe = null

    const unsubscribe = window.RcodeGui.grok.onEvent((event: GrokBuildEvent) => {
      if (signal.aborted) return

      const turn = this._activeTurn
      if (!turn) return

      const actions = mapGrokBuildEvent(event, turn)

      for (const action of actions) {
        if (signal.aborted) return
        try {
          this._dispatchAction(action, sink, turn)
        } catch (err) {
          console.error('GrokBuildProvider: error dispatching action', err)
        }
      }

      // When the turn completes, clean up the dedicated listener and
      // re-establish the global buffer for future turns.
      if (event.type === 'turn-complete') {
        this._eventUnsubscribe?.()
        this._eventUnsubscribe = null
        this._reconnectGlobalBuffer()
      }
    })

    this._eventUnsubscribe = unsubscribe

    signal.addEventListener('abort', () => {
      this._eventUnsubscribe?.()
      this._eventUnsubscribe = null
      this._reconnectGlobalBuffer()
    }, { once: true })
  }

  /** Re-establish the global event buffer for future turns. */
  private _reconnectGlobalBuffer(): void {
    if (this._globalEventUnsubscribe) return
    this._globalEventUnsubscribe = window.RcodeGui.grok.onEvent((event: GrokBuildEvent) => {
      this._eventBuffer.push(event)
    })
  }

  private _dispatchAction(
    action: ReturnType<typeof mapGrokBuildEvent>[number],
    sink: ThreadEventSink,
    turn: GrokBuildTurnState
  ): void {
    switch (action.kind) {
      case 'delta':
        sink.onDeltas([action.delta])
        break
      case 'tool':
        sink.onTool(action.payload)
        break
      case 'seq':
        sink.onSeq(action.seq)
        break
      case 'turn_complete': {
        const record = this._threads.get(turn.threadId)
        if (record && turn.text) {
          record.blocks = [
            ...record.blocks,
            {
              kind: 'assistant' as const,
              id: generateId(),
              turnId: turn.turnId,
              createdAt: nowISO(),
              text: turn.text
            }
          ]
          record.seq = turn.seq
          record.updatedAt = nowISO()
        }
        sink.onTurnComplete()
        this._activeTurn = null
        break
      }
      case 'usage':
        sink.onUsage?.(action.usage)
        break
      case 'error':
        sink.onError(new Error(action.message))
        break
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private _toNormalizedThread(record: GrokBuildThreadRecord): NormalizedThread {
    return {
      id: record.id,
      title: record.title,
      model: this._currentModel || 'grok',
      mode: 'agent',
      workspace: record.workspace,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      approvalPolicy: 'auto' as const
    }
  }
}