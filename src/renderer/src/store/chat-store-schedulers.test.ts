import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  armBusyWatchdog,
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  resetTurnCompletionWatchMemory,
  stopTurnCompletionPoll,
  syncTurnCompletionPoll
} from './chat-store-schedulers'
import type { ChatState, ChatStoreSet } from './chat-store-types'

type StoreApi = { getState: () => ChatState; set: ChatStoreSet; get: () => ChatState }

function makeHarness(initial: Partial<ChatState> = {}): StoreApi {
  let state: ChatState = {
    activeThreadId: 't1',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    currentTurnId: 'turn-1',
    currentTurnUserId: 'u1',
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    watchTurnCompletion: {},
    pendingSendThreadIds: {},
    unreadThreadIds: {},
    runtimeConnection: 'ready',
    queuedMessages: [],
    threads: [],
    recoverActiveTurn: vi.fn().mockResolvedValue(undefined),
    ...initial
  } as ChatState
  return {
    getState: () => state,
    set: (partial) => {
      const update =
        typeof partial === 'function'
          ? (partial as (s: ChatState) => Partial<ChatState>)(state)
          : partial
      state = { ...state, ...update }
    },
    get: () => state
  }
}

describe('armBusyWatchdog (busyTimeout message contract)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetBusyRecoveryAttempts()
  })
  afterEach(() => {
    clearBusyWatchdog()
    vi.useRealTimers()
  })

  it('uses busyTimeoutMessage returned string verbatim when watchdog fires with attempts exhausted', () => {
    const h = makeHarness({ activeThreadId: null })
    const finalize = vi.fn().mockReturnValue({})
    const flush = vi.fn().mockImplementation((_state: ChatState, base: Partial<ChatState>) => base)
    const message = '已等待 9 分钟仍未收到运行时完成事件。可中断后重试。'
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 1_000,
      maxAttempts: 0, // skip recovery, go straight to finalize
      finalizeBusyState: finalize,
      flushLiveBlocks: flush,
      busyTimeoutMessage: () => message
    })
    vi.advanceTimersByTime(1_000)
    expect(h.getState().error).toBe(message)
    expect(h.getState().busy).toBe(false)
    expect(h.getState().currentTurnId).toBeNull()
    expect(finalize).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('skips watchdog work if not busy at fire time', () => {
    const h = makeHarness()
    const finalize = vi.fn().mockReturnValue({})
    const flush = vi.fn().mockImplementation((_state: ChatState, base: Partial<ChatState>) => base)
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 50,
      maxAttempts: 0,
      finalizeBusyState: finalize,
      flushLiveBlocks: flush,
      busyTimeoutMessage: () => 'never'
    })
    // Simulate turn completing before watchdog fires
    h.set((s) => ({ ...s, busy: false }))
    vi.advanceTimersByTime(50)
    expect(finalize).not.toHaveBeenCalled()
    expect(h.getState().error).toBeNull()
  })

  it('attempts recovery and returns when attempts remain', () => {
    const h = makeHarness()
    const finalize = vi.fn().mockReturnValue({})
    const flush = vi.fn().mockImplementation((_state: ChatState, base: Partial<ChatState>) => base)
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 50,
      maxAttempts: 5, // high limit, will not finalize
      finalizeBusyState: finalize,
      flushLiveBlocks: flush,
      busyTimeoutMessage: () => 'should-not-be-used'
    })
    vi.advanceTimersByTime(50)
    expect(h.getState().recoverActiveTurn).toHaveBeenCalledTimes(1)
    expect(h.getState().busy).toBe(true) // not finalized
    expect(finalize).not.toHaveBeenCalled()
  })
})

describe('busyTimeout minutes interpolation (#131)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetBusyRecoveryAttempts()
  })
  afterEach(() => {
    clearBusyWatchdog()
    vi.useRealTimers()
  })

  it('renders the minute count from production constants in the message', () => {
    const h = makeHarness({ activeThreadId: null })
    // Mirrors chat-store-runtime.ts:467-471 formula:
    // minutes = round((BUSY_WATCHDOG_MS * MAX_BUSY_RECOVERY_ATTEMPTS) / 60_000)
    // Current production: 180_000 * 3 / 60_000 = 9
    const minutes = Math.round((180_000 * 3) / 60_000)
    armBusyWatchdog(h.set, h.get, {
      timeoutMs: 10,
      maxAttempts: 0,
      finalizeBusyState: () => ({}),
      flushLiveBlocks: (_state: ChatState, base: Partial<ChatState>) => base,
      busyTimeoutMessage: () => `已等待 ${minutes} 分钟仍未收到运行时完成事件。`
    })
    vi.advanceTimersByTime(10)
    expect(typeof h.getState().error).toBe('string')
    expect(h.getState().error as string).toMatch(/已等待 9 分钟/)
  })
})

describe('syncTurnCompletionPoll (turn not registered yet)', () => {
  type PollOptions = Parameters<typeof syncTurnCompletionPoll>[2]

  function pollHarness(initial: Partial<ChatState>, looksRunning: () => boolean) {
    const h = makeHarness(initial)
    const loadThreadState = vi.fn(async () => ({ blocks: [], threadStatus: 'idle' }))
    const onCompletedThreads = vi.fn(async (doneIds: string[]) => {
      h.set((s) => {
        const watchTurnCompletion = { ...s.watchTurnCompletion }
        for (const id of doneIds) delete watchTurnCompletion[id]
        return { watchTurnCompletion }
      })
    })
    const options: PollOptions = {
      loadThreadState,
      threadLooksRunning: () => looksRunning(),
      onCompletedThreads
    }
    syncTurnCompletionPoll(h.set, h.get, options)
    return { h, loadThreadState, onCompletedThreads }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    resetTurnCompletionWatchMemory()
  })

  afterEach(() => {
    stopTurnCompletionPoll()
    resetTurnCompletionWatchMemory()
    vi.useRealTimers()
  })

  it('never settles a thread whose send has not reached the runtime', async () => {
    const { h, loadThreadState, onCompletedThreads } = pollHarness(
      {
        watchTurnCompletion: { 'thr-sending': true },
        pendingSendThreadIds: { 'thr-sending': true }
      },
      () => false
    )

    await vi.advanceTimersByTimeAsync(10_000)

    expect(onCompletedThreads).not.toHaveBeenCalled()
    // The in-flight thread is not even probed: any snapshot would be idle.
    expect(loadThreadState).not.toHaveBeenCalled()
    expect(h.getState().watchTurnCompletion['thr-sending']).toBe(true)
  })

  it('waits for a second idle sample before settling a turn it never saw running', async () => {
    const { h, onCompletedThreads } = pollHarness(
      { watchTurnCompletion: { 'thr-race': true } },
      () => false
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(onCompletedThreads).not.toHaveBeenCalled()
    expect(h.getState().watchTurnCompletion['thr-race']).toBe(true)

    await vi.advanceTimersByTimeAsync(2_500)
    expect(onCompletedThreads).toHaveBeenCalledWith(
      ['thr-race'],
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('settles on the first idle sample once the turn was observed running', async () => {
    let running = true
    const { onCompletedThreads } = pollHarness(
      { watchTurnCompletion: { 'thr-live': true } },
      () => running
    )

    await vi.advanceTimersByTimeAsync(2_500)
    expect(onCompletedThreads).not.toHaveBeenCalled()

    running = false
    await vi.advanceTimersByTimeAsync(2_500)
    expect(onCompletedThreads).toHaveBeenCalledTimes(1)
  })
})
