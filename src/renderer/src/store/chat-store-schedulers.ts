import type { ChatBlock } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'

let startupRuntimeProbeTimer: ReturnType<typeof setTimeout> | null = null
let busyWatchdogTimer: ReturnType<typeof setTimeout> | null = null
let busyRecoveryAttempts = 0
let turnCompletionPollTimer: ReturnType<typeof setInterval> | null = null

type BusyWatchdogOptions = {
  timeoutMs: number
  maxAttempts: number
  finalizeBusyState: (state: ChatState) => Partial<ChatState>
  flushLiveBlocks: (state: ChatState, base: Partial<ChatState>) => Partial<ChatState>
  busyTimeoutMessage: () => string
}

type TurnCompletionPollOptions = {
  loadThreadState: (
    state: ChatState,
    threadId: string
  ) => Promise<{ blocks: ChatBlock[]; threadStatus?: string }>
  threadLooksRunning: (blocks: ChatBlock[], threadStatus?: string) => boolean
  onCompletedThreads: (
    doneIds: string[],
    state: ChatState,
    set: ChatStoreSet,
    get: ChatStoreGet
  ) => void | Promise<void>
}

export function scheduleStartupRuntimeProbe(get: ChatStoreGet): void {
  if (startupRuntimeProbeTimer) {
    clearTimeout(startupRuntimeProbeTimer)
  }
  startupRuntimeProbeTimer = setTimeout(() => {
    startupRuntimeProbeTimer = null
    void get().probeRuntime('user')
  }, 900)
}

export function clearBusyWatchdog(): void {
  if (busyWatchdogTimer) {
    clearTimeout(busyWatchdogTimer)
    busyWatchdogTimer = null
  }
}

export function resetBusyRecoveryAttempts(): void {
  busyRecoveryAttempts = 0
}

export function armBusyWatchdog(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: BusyWatchdogOptions
): void {
  clearBusyWatchdog()
  busyWatchdogTimer = setTimeout(() => {
    const state = get()
    if (!state.busy) return
    busyRecoveryAttempts += 1
    if (busyRecoveryAttempts <= options.maxAttempts && state.activeThreadId) {
      void state.recoverActiveTurn()
      return
    }
    set((snapshot) => {
      const base: Partial<ChatState> = {
        ...options.finalizeBusyState(snapshot),
        busy: false,
        currentTurnId: null,
        error: options.busyTimeoutMessage()
      }
      return options.flushLiveBlocks(snapshot, base)
    })
    // The thread is idle again as far as the UI is concerned; queued
    // messages would otherwise wait for a completion event that will
    // never come.
    void get().drainQueuedMessages?.()
  }, options.timeoutMs)
}

export function stopTurnCompletionPoll(): void {
  if (turnCompletionPollTimer) {
    clearInterval(turnCompletionPollTimer)
    turnCompletionPollTimer = null
  }
  resetTurnCompletionWatchMemory()
}

/**
 * Per-thread memory for the completion watch:
 * - `observedRunningThreadIds`: the watch has actually seen the turn running.
 * - `idleSinceByThreadId`: first consecutive idle sample for a turn that was
 *   never observed running.
 *
 * Both are cleared whenever the poll stops, so nothing leaks between watches.
 */
const observedRunningThreadIds = new Set<string>()
const idleSinceByThreadId = new Map<string, number>()

export function resetTurnCompletionWatchMemory(): void {
  observedRunningThreadIds.clear()
  idleSinceByThreadId.clear()
}

export function syncTurnCompletionPoll(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: TurnCompletionPollOptions
): void {
  const ids = Object.keys(get().watchTurnCompletion).filter((id) => get().watchTurnCompletion[id])
  if (ids.length === 0) {
    stopTurnCompletionPoll()
    return
  }
  if (turnCompletionPollTimer != null) return

  const tick = (): void => {
    void pollTurnCompletionWatch(set, get, options)
  }

  turnCompletionPollTimer = setInterval(tick, 2500)
  void tick()
}

async function pollTurnCompletionWatch(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: TurnCompletionPollOptions
): Promise<void> {
  const state = get()
  if (state.runtimeConnection !== 'ready') {
    stopTurnCompletionPoll()
    return
  }

  const ids = Object.keys(state.watchTurnCompletion).filter((id) => state.watchTurnCompletion[id])
  if (ids.length === 0) {
    stopTurnCompletionPoll()
    return
  }

  const doneIds: string[] = []
  for (const threadId of ids) {
    // The send has left the composer but the runtime has not registered the
    // turn yet (thread creation, settings, Git checkpoint…). Treat that window
    // as busy: the first tick fires immediately on subscribe, so without this
    // guard switching conversations right after pressing send settles the
    // thread as completed — green breathing light, unread badge and a
    // completion notification for a turn that is only just starting.
    if (state.pendingSendThreadIds?.[threadId]) continue
    try {
      const { blocks, threadStatus } = await options.loadThreadState(state, threadId)
      if (options.threadLooksRunning(blocks, threadStatus)) {
        observedRunningThreadIds.add(threadId)
        idleSinceByThreadId.delete(threadId)
        continue
      }
      // Never saw this turn running: require a second consecutive idle sample
      // before calling it done. A thread that is only just being watched can
      // otherwise look idle for one tick purely because of runtime/UI lag.
      if (!observedRunningThreadIds.has(threadId) && !idleSinceByThreadId.has(threadId)) {
        idleSinceByThreadId.set(threadId, Date.now())
        continue
      }
      doneIds.push(threadId)
    } catch {
      /* ignore */
    }
  }

  if (doneIds.length > 0) {
    await options.onCompletedThreads(doneIds, state, set, get)
  }

  const stillWatched = new Set(
    Object.keys(get().watchTurnCompletion).filter((id) => get().watchTurnCompletion[id])
  )
  for (const threadId of [...observedRunningThreadIds]) {
    if (!stillWatched.has(threadId)) observedRunningThreadIds.delete(threadId)
  }
  for (const threadId of [...idleSinceByThreadId.keys()]) {
    if (!stillWatched.has(threadId)) idleSinceByThreadId.delete(threadId)
  }

  if (stillWatched.size === 0) {
    stopTurnCompletionPoll()
  }
}
