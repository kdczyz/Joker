import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../agent/registry', () => ({ getProvider: vi.fn() }))
vi.mock('../agent/runtime-client', () => ({
  rendererRuntimeClient: { startSse: vi.fn(), stopSse: vi.fn(), onSseEvent: vi.fn() }
}))
vi.mock('./design-thread-registry', () => ({
  markDesignThread: vi.fn((_ws: string, _doc: string | null, id: string, reg: any) => ({ ...reg, __marked: id })),
  readDesignThreadRegistry: vi.fn(() => ({ version: 1, workspaces: {} }) as any),
  saveDesignThreadRegistry: vi.fn()
}))
vi.mock('./canvas/apply-shape-ops', () => ({
  applyShapeOpsFromText: vi.fn(() => ({ affectedIds: [], errors: [] }))
}))
vi.mock('./canvas/canvas-focus', () => ({ focusViewportOnIds: vi.fn() }))

function makeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      m.set(k, v)
    },
    removeItem: (k: string) => {
      m.delete(k)
    },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size
    }
  } as Storage
}

let store: typeof import('./design-assistant-store')['useDesignAssistantStore']
let getProvider: any
let runtime: any

beforeEach(async () => {
  vi.stubGlobal('localStorage', makeStorage())
  vi.resetModules()
  const mod = await import('./design-assistant-store')
  store = mod.useDesignAssistantStore
  getProvider = (await import('../agent/registry')).getProvider as unknown as ReturnType<typeof vi.fn>
  runtime = (await import('../agent/runtime-client')).rendererRuntimeClient
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function setupProvider(overrides: Record<string, unknown> = {}) {
  const provider = {
    createThread: vi.fn(async () => ({ id: 'thread-x' })),
    sendUserMessage: vi.fn(async () => ({ turnId: 'turn-x' })),
    ...overrides
  }
  getProvider.mockReturnValue(provider)
  return provider
}

describe('design-assistant-store (isolated canvas chat)', () => {
  it('creates a thread and registers it as a design thread (excluded from code sidebar)', async () => {
    const provider = await setupProvider()
    const { threadId, created } = await store.getState().ensureDesignThread('/proj')
    expect(threadId).toBe('thread-x')
    expect(created).toBe(true)
    expect(provider.createThread).toHaveBeenCalledWith({ workspace: '/proj', title: 'Design Assistant' })
    expect((await import('./design-thread-registry')).markDesignThread).toHaveBeenCalled()
    expect((await import('./design-thread-registry')).saveDesignThreadRegistry).toHaveBeenCalled()
  })

  it('reuses an existing design thread and reports created=false', async () => {
    const provider = await setupProvider()
    const first = await store.getState().ensureDesignThread('/proj')
    expect(first.created).toBe(true)
    const second = await store.getState().ensureDesignThread('/proj')
    expect(second).toEqual({ threadId: 'thread-x', created: false })
    expect(provider.createThread).toHaveBeenCalledTimes(1)
  })

  it('scopes conversations per folder and keeps them isolated', async () => {
    await setupProvider()
    await store.getState().sendDesignMessage('a', '/folder-a')
    await store.getState().sendDesignMessage('b', '/folder-b')
    const state = store.getState()
    expect(Object.keys(state.designConversations).sort()).toEqual(['/folder-a', '/folder-b'])
    expect(state.designConversations['/folder-a'][0].text).toBe('a')
    expect(state.designConversations['/folder-b'][0].text).toBe('b')
  })

  it('streams the assistant reply into the active scope and clears busy on complete', async () => {
    await setupProvider()
    let cb: ((payload: any) => void) | undefined
    runtime.onSseEvent.mockImplementation((fn: any) => {
      cb = fn
      return () => {}
    })
    runtime.startSse.mockResolvedValue({ streamId: 's1' })

    const p = store.getState().sendDesignMessage('make a diagram', '/proj')
    await new Promise((r) => setTimeout(r, 0))
    expect(typeof cb).toBe('function')
    cb!({
      streamId: 's1',
      events: [
        { type: 'text_delta', delta: 'Hello ' },
        { type: 'text_delta', delta: 'world' },
        { type: 'turn_complete' }
      ]
    })
    await p

    const blocks = store.getState().designConversations['/proj']
    const assistant = blocks.find((b: any) => b.kind === 'assistant')
    expect(assistant?.text).toBe('Hello world')
    expect(store.getState().designBusy).toBe(false)
    expect(runtime.stopSse).toHaveBeenCalledWith('s1')
  })

  it('does not send when busy or empty', async () => {
    await setupProvider()
    await store.getState().sendDesignMessage('', '/proj')
    const provider = getProvider()
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
  })
})
