import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { BrowserStorageLike } from '../lib/browser-storage'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

const applyThemeLibMock = vi.hoisted(() => ({
  applyCursorSpotlight: vi.fn(),
  applyCursorSpotlightColor: vi.fn(),
  applyTheme: vi.fn(),
  applyUiFontScale: vi.fn(),
  applyChatContentMaxWidth: vi.fn(),
  applyDocumentLocale: vi.fn()
}))

vi.mock('../lib/apply-theme', () => applyThemeLibMock)

import { createNavigationActions } from './chat-store-navigation-actions'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-12T00:00:00.000Z',
    model: overrides.model ?? 'deepseek-v4-pro',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function buildHarness(overrides?: {
  subscribeThreadEventsLive?: ReturnType<typeof vi.fn>
  recoverActiveTurn?: ReturnType<typeof vi.fn>
  applyI18nFromSettings?: ReturnType<typeof vi.fn>
  probeRuntime?: ReturnType<typeof vi.fn>
  loadComposerModels?: ReturnType<typeof vi.fn>
}): {
  actions: ReturnType<typeof createNavigationActions>
  state: ChatState
  createThread: ReturnType<typeof vi.fn>
  refreshThreads: ReturnType<typeof vi.fn>
  selectThread: ReturnType<typeof vi.fn>
  subscribeThreadEventsLive: ReturnType<typeof vi.fn>
  recoverActiveTurn: ReturnType<typeof vi.fn>
} {
  const createThread = vi.fn(async () => undefined)
  const refreshThreads = vi.fn(async () => undefined)
  const selectThread = vi.fn(async () => undefined)
  const subscribeThreadEventsLive = overrides?.subscribeThreadEventsLive ?? vi.fn(async () => undefined)
  const recoverActiveTurn = overrides?.recoverActiveTurn ?? vi.fn(async () => true)
  const applyI18nFromSettings = overrides?.applyI18nFromSettings ?? vi.fn(async () => undefined)
  const probeRuntime = overrides?.probeRuntime ?? vi.fn(async () => undefined)
  const loadComposerModels = overrides?.loadComposerModels ?? vi.fn(async () => undefined)
  let state = {
    activeThreadId: 'thr_default',
    applyI18nFromSettings,
    busy: false,
    clawChannels: [],
    codeWorkspaceRoots: ['~/.Joker/default_workspace'],
    composerDrafts: {},
    composerPickList: [],
    createThread,
    currentTurnId: null,
    currentTurnUserId: null,
    error: null,
    loadComposerModels,
    openWrite: vi.fn(async () => undefined),
    probeRuntime,
    refreshThreads,
    route: 'chat',
    runtimeConnection: 'ready',
    selectThread,
    subscribeThreadEventsLive,
    recoverActiveTurn,
    threads: [
      thread({
        id: 'thr_default',
        title: 'Only default thread',
        workspace: '~/.Joker/default_workspace'
      })
    ],
    unreadThreadIds: {},
    watchTurnCompletion: {},
    workspaceLabel: 'default_workspace',
    workspaceRoot: '~/.Joker/default_workspace'
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  const get: ChatStoreGet = () => state
  return {
    actions: createNavigationActions({
      set,
      get,
      sseAbortRef: { current: null }
    }),
    get state() {
      return state
    },
    createThread,
    refreshThreads,
    selectThread,
    subscribeThreadEventsLive,
    recoverActiveTurn
  }
}

describe('chat-store navigation workspace selection', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('does not move the only default thread into a newly picked empty workspace', async () => {
    const provider = {
      updateThreadWorkspace: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const pickWorkspaceDirectory = vi.fn(async () => ({
      canceled: false,
      path: '/Users/zxy/new-project'
    }))
    const setSettings = vi.fn(async () => ({
      workspaceRoot: '/Users/zxy/new-project'
    }))
    vi.stubGlobal('window', {
      JokerGui: {
        pickWorkspaceDirectory,
        setSettings
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.chooseWorkspace()).resolves.toBe('/Users/zxy/new-project')

    expect(pickWorkspaceDirectory).toHaveBeenCalledWith('~/.Joker/default_workspace')
    expect(setSettings).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(provider.updateThreadWorkspace).not.toHaveBeenCalled()
    expect(harness.state.threads.find((item) => item.id === 'thr_default')?.workspace)
      .toBe('~/.Joker/default_workspace')
    expect(harness.createThread).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(harness.selectThread).not.toHaveBeenCalled()
  })

  it('selectWorkspaceRoot persists the directory and lands on a clean new conversation', async () => {
    const setSettings = vi.fn(async () => ({ workspaceRoot: '/Users/zxy/new-project' }))
    vi.stubGlobal('window', { JokerGui: { setSettings } })
    const harness = buildHarness()

    await expect(harness.actions.selectWorkspaceRoot('/Users/zxy/new-project'))
      .resolves.toBe('/Users/zxy/new-project')

    expect(setSettings).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(harness.state.workspaceRoot).toBe('/Users/zxy/new-project')
    expect(harness.state.workspaceLabel).toBe('new-project')
    // Clean empty-hero state so typing starts a fresh thread in the new directory.
    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.blocks).toEqual([])
    expect(harness.state.codeWorkspaceRoots).toContain('/Users/zxy/new-project')
    expect(harness.refreshThreads).toHaveBeenCalled()
    // The default thread is preserved in the listing, just not active.
    expect(harness.selectThread).not.toHaveBeenCalled()
    expect(harness.createThread).not.toHaveBeenCalled()
  })

  it('selectWorkspaceRoot ignores an empty path', async () => {
    const setSettings = vi.fn(async () => ({ workspaceRoot: '' }))
    vi.stubGlobal('window', { JokerGui: { setSettings } })
    const harness = buildHarness()

    await expect(harness.actions.selectWorkspaceRoot('   ')).resolves.toBeNull()
    expect(setSettings).not.toHaveBeenCalled()
    expect(harness.state.activeThreadId).toBe('thr_default')
  })

  it('selectWorkspaceRoot does not warn before the user sends a message', async () => {
    const setSettings = vi.fn(async () => ({ workspaceRoot: '/Volumes/missing/project' }))
    const alertDialog = vi.fn(async () => undefined)
    const workspaceDirectoryExists = vi.fn(async () => false)
    vi.stubGlobal('window', {
      JokerGui: {
        setSettings,
        workspaceDirectoryExists,
        alertDialog
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.selectWorkspaceRoot('/Volumes/missing/project'))
      .resolves.toBe('/Volumes/missing/project')

    expect(setSettings).toHaveBeenCalledOnce()
    expect(workspaceDirectoryExists).not.toHaveBeenCalled()
    expect(alertDialog).not.toHaveBeenCalled()
    expect(harness.state.workspaceRoot).toBe('/Volumes/missing/project')
  })

  it('keeps a missing current workspace without warning during boot', async () => {
    const alertDialog = vi.fn(async () => undefined)
    const workspaceDirectoryExists = vi.fn(async () => false)
    const setSettings = vi.fn()
    vi.stubGlobal('window', {
      JokerGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: 'E:\\missing-project',
          write: {
            defaultWorkspaceRoot: '~/.Joker/write_workspace',
            activeWorkspaceRoot: '~/.Joker/write_workspace',
            workspaces: []
          },
          claw: { channels: [] },
          theme: 'dark',
          uiFontScale: 1,
          chatContentMaxWidthPx: 896,
          locale: 'en',
          agents: { Joker: { apiKey: 'test-key', model: 'deepseek-v4-pro', baseUrl: '' } },
          disabledSkillIds: []
        })),
        setSettings,
        workspaceDirectoryExists,
        alertDialog
      }
    })
    const harness = buildHarness()

    await harness.actions.boot()

    expect(harness.state.workspaceRoot).toBe('E:\\missing-project')
    expect(setSettings).not.toHaveBeenCalled()
    expect(workspaceDirectoryExists).not.toHaveBeenCalled()
    expect(alertDialog).not.toHaveBeenCalled()
    expect(harness.state.error).toBeNull()
  })

  it('clearActiveThreadSelection clears stale blocks and watches a running thread', () => {
    const harness = buildHarness()
    harness.state.activeThreadId = 'thr_old_design'
    harness.state.busy = true
    harness.state.blocks = [
      { kind: 'user', id: 'u1', text: 'old design request' },
      { kind: 'assistant', id: 'a1', text: 'old design answer' }
    ]

    harness.actions.clearActiveThreadSelection()

    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.blocks).toEqual([])
    expect(harness.state.busy).toBe(false)
    expect(harness.state.watchTurnCompletion).toEqual({ thr_old_design: true })
  })
})

describe('onClawChannelActivity routes through subscribeThreadEventsLive (not selectThread)', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('calls subscribeThreadEventsLive when activeThreadId differs from the bot thread', async () => {
    const subscribeThreadEventsLive = vi.fn(async () => undefined)
    const selectThread = vi.fn(async () => undefined)
    const recoverActiveTurn = vi.fn(async () => true)

    // Capture the callback registered via window.JokerGui.onClawChannelActivity
    let capturedClawActivityCallback: ((payload: { channelId: string; threadId: string }) => void) | null = null
    const onClawChannelActivity = vi.fn((cb: (payload: { channelId: string; threadId: string }) => void) => {
      capturedClawActivityCallback = cb
      return () => {}
    })
    const onRuntimeStatus = vi.fn(() => () => {})
    let capturedTrayActionCallback: ((payload: { type: 'new-chat' } | { type: 'open-thread'; threadId: string }) => void) | null = null
    const onTrayAction = vi.fn((cb: typeof capturedTrayActionCallback) => {
      capturedTrayActionCallback = cb
      return () => {}
    })
    const getSettings = vi.fn(async () => ({
      workspaceRoot: '~/.Joker/default_workspace',
      write: {
        defaultWorkspaceRoot: '~/.Joker/default_workspace',
        activeWorkspaceRoot: '~/.Joker/default_workspace',
        workspaces: []
      },
      claw: {
        channels: [
          { id: 'ch_1', enabled: true, label: 'Feishu Agent01', provider: 'feishu' }
        ]
      },
      theme: 'dark',
      uiFontScale: 1,
    chatContentMaxWidthPx: 896,
      locale: 'en',
      agents: { Joker: { apiKey: 'test-key', model: 'deepseek-v4-pro', baseUrl: '' } },
      disabledSkillIds: []
    }))
    vi.stubGlobal('window', {
      JokerGui: {
        getSettings,
        onClawChannelActivity,
        onTrayAction,
        onRuntimeStatus
      }
    })

    const harness = buildHarness({ subscribeThreadEventsLive, recoverActiveTurn })
    await harness.actions.boot()
    expect(typeof capturedClawActivityCallback).toBe('function')
    expect(onClawChannelActivity).toHaveBeenCalledTimes(1)
    expect(onTrayAction).toHaveBeenCalledTimes(1)

    harness.state.route = 'settings'
    capturedTrayActionCallback!({ type: 'open-thread', threadId: 'thr_recent' })
    expect(harness.state.route).toBe('chat')
    expect(harness.selectThread).toHaveBeenCalledWith('thr_recent')

    harness.state.route = 'settings'
    capturedTrayActionCallback!({ type: 'new-chat' })
    expect(harness.state.route).toBe('chat')
    expect(harness.createThread).toHaveBeenCalledWith({ forceNew: true })

    // Set state conditions AFTER boot so they survive the boot's set() calls:
    // route is claw, activeClawChannelId matches incoming channelId,
    // activeThreadId differs from incoming threadId — so we should auto-switch.
    harness.state.route = 'claw'
    harness.state.activeClawChannelId = 'ch_1'
    harness.state.activeThreadId = 'thr_default'

    // Trigger the captured callback with a Feishu bot event.
    await capturedClawActivityCallback!({ channelId: 'ch_1', threadId: 'thr_bot' })
    // Allow the void(async()) microtask inside the callback to flush.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(subscribeThreadEventsLive).toHaveBeenCalledWith('thr_bot')
    expect(selectThread).not.toHaveBeenCalled()
  })
})

describe('setComposerDraft', () => {
  it('stores unsent text keyed by thread id', () => {
    const harness = buildHarness()
    harness.actions.setComposerDraft('thr_1', 'draft text')
    expect(harness.state.composerDrafts).toEqual({ thr_1: 'draft text' })
  })

  it('keeps drafts for other threads when updating one', () => {
    const harness = buildHarness()
    harness.actions.setComposerDraft('thr_1', 'first')
    harness.actions.setComposerDraft('thr_2', 'second')
    expect(harness.state.composerDrafts).toEqual({ thr_1: 'first', thr_2: 'second' })
  })

  it('clears the draft when given an empty string', () => {
    const harness = buildHarness()
    harness.actions.setComposerDraft('thr_1', 'first')
    harness.actions.setComposerDraft('thr_2', 'second')
    harness.actions.setComposerDraft('thr_1', '')
    expect(harness.state.composerDrafts).toEqual({ thr_2: 'second' })
  })

  it('ignores empty thread ids', () => {
    const harness = buildHarness()
    harness.actions.setComposerDraft('', 'orphan text')
    expect(harness.state.composerDrafts).toEqual({})
  })
})
