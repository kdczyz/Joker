import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  designThreadBelongsToDocument,
  designThreadSelectionSyncForDocument,
  designThreadToSelectForDocument,
  designThreadsForDocument,
  switchDesignThreadForDocument
} from './design-thread-workbench'
import {
  emptyDesignThreadRegistry,
  markDesignThread
} from './design-thread-registry'

function thread(id: string, updatedAt: string, archived = false): NormalizedThread {
  return {
    id,
    title: id,
    workspace: '/workspace',
    model: 'deepseek-chat',
    mode: 'agent',
    updatedAt,
    archived
  }
}

describe('design thread workbench helpers', () => {
  it('selects visible design threads for the active document sorted by update time', () => {
    const registry = markDesignThread(
      '/workspace',
      'doc',
      'thr_1',
      markDesignThread('/workspace', 'doc', 'thr_2', emptyDesignThreadRegistry())
    )
    const threads = [
      thread('thr_1', '2026-07-01T00:00:00.000Z'),
      thread('thr_2', '2026-07-02T00:00:00.000Z'),
      thread('thr_archived', '2026-07-03T00:00:00.000Z', true),
      thread('other', '2026-07-04T00:00:00.000Z')
    ]

    expect(designThreadsForDocument({
      threads,
      workspaceRoot: '/workspace',
      docId: 'doc',
      registry
    }).map((item) => item.id)).toEqual(['thr_2', 'thr_1'])
  })

  it('checks whether the active thread belongs to the selected design document', () => {
    const registry = markDesignThread(
      '/workspace',
      'doc',
      'thr_1',
      markDesignThread('/workspace', 'other-doc', 'thr_2', emptyDesignThreadRegistry())
    )
    const threads = [
      thread('thr_1', '2026-07-02T00:00:00.000Z'),
      thread('thr_2', '2026-07-02T00:00:00.000Z')
    ]

    expect(designThreadBelongsToDocument({
      threads,
      workspaceRoot: '/workspace',
      docId: 'doc',
      activeThreadId: 'thr_1',
      registry
    })).toBe(true)
    expect(designThreadBelongsToDocument({
      threads,
      workspaceRoot: '/workspace',
      docId: 'doc',
      activeThreadId: 'thr_2',
      registry
    })).toBe(false)
  })

  it('returns the registered active thread to select when switching design documents', () => {
    const registry = markDesignThread('/workspace', 'doc', 'thr_1', emptyDesignThreadRegistry())

    expect(designThreadToSelectForDocument({
      route: 'design',
      activeThreadId: 'other',
      threads: [thread('thr_1', '2026-07-02T00:00:00.000Z')],
      workspaceRoot: '/workspace',
      docId: 'doc',
      registry
    })).toBe('thr_1')

    expect(designThreadToSelectForDocument({
      route: 'chat',
      activeThreadId: 'other',
      threads: [thread('thr_1', '2026-07-02T00:00:00.000Z')],
      workspaceRoot: '/workspace',
      docId: 'doc',
      registry
    })).toBeNull()
  })

  it('selects the latest design drawing when entering a document with no active thread', () => {
    const registry = markDesignThread(
      '/workspace',
      'doc',
      'thr_old',
      markDesignThread('/workspace', 'doc', 'thr_latest', emptyDesignThreadRegistry())
    )
    const threads = [
      thread('thr_old', '2026-07-01T00:00:00.000Z'),
      thread('thr_latest', '2026-07-03T00:00:00.000Z')
    ]

    expect(designThreadToSelectForDocument({
      route: 'design',
      activeThreadId: null,
      threads,
      workspaceRoot: '/workspace',
      docId: 'doc',
      registry
    })).toBe('thr_latest')
    expect(designThreadSelectionSyncForDocument({
      route: 'design',
      activeThreadId: null,
      threads,
      workspaceRoot: '/workspace',
      docId: 'doc',
      registry
    })).toEqual({ action: 'select', threadId: 'thr_latest' })
  })

  it('asks the workbench to clear a stale active thread when the selected design document has no session', () => {
    const registry = markDesignThread('/workspace', 'other-doc', 'thr_other', emptyDesignThreadRegistry())

    expect(designThreadSelectionSyncForDocument({
      route: 'design',
      activeThreadId: 'thr_other',
      threads: [thread('thr_other', '2026-07-02T00:00:00.000Z')],
      workspaceRoot: '/workspace',
      docId: 'doc',
      registry
    })).toEqual({ action: 'clear' })
  })

  it('keeps the active thread when it belongs to the selected design document', () => {
    const registry = markDesignThread('/workspace', 'doc', 'thr_1', emptyDesignThreadRegistry())

    expect(designThreadSelectionSyncForDocument({
      route: 'design',
      activeThreadId: 'thr_1',
      threads: [thread('thr_1', '2026-07-02T00:00:00.000Z')],
      workspaceRoot: '/workspace',
      docId: 'doc',
      registry
    })).toEqual({ action: 'none' })
  })

  it('keeps a freshly registered design thread on the first canvas send (not yet in the threads list)', () => {
    // ensureDesignThread registers the thread in the registry before the chat
    // store has refreshed `threads`, so the sync must not clear the selection —
    // otherwise the first canvas turn would fall through to a new code thread.
    const registry = markDesignThread('/workspace', 'doc', 'thr_new', emptyDesignThreadRegistry())

    expect(designThreadBelongsToDocument({
      threads: [],
      workspaceRoot: '/workspace',
      docId: 'doc',
      activeThreadId: 'thr_new',
      registry
    })).toBe(true)
    expect(designThreadSelectionSyncForDocument({
      route: 'design',
      activeThreadId: 'thr_new',
      threads: [],
      workspaceRoot: '/workspace',
      docId: 'doc',
      registry
    })).toEqual({ action: 'none' })
  })

  it('keeps a freshly registered artifact-scoped design thread on the first canvas send', () => {
    const registry = markDesignThread(
      '/workspace',
      'doc',
      'thr_new',
      emptyDesignThreadRegistry(),
      'artifact-1'
    )

    expect(designThreadBelongsToDocument({
      threads: [],
      workspaceRoot: '/workspace',
      docId: 'doc',
      artifactId: 'artifact-1',
      activeThreadId: 'thr_new',
      registry
    })).toBe(true)
    expect(designThreadSelectionSyncForDocument({
      route: 'design',
      activeThreadId: 'thr_new',
      threads: [],
      workspaceRoot: '/workspace',
      docId: 'doc',
      artifactId: 'artifact-1',
      registry
    })).toEqual({ action: 'none' })
  })

  it('marks the switched thread, persists metadata, and selects it', async () => {
    const saveRegistry = vi.fn()
    const persistMeta = vi.fn(async () => true)
    const selectThread = vi.fn(async () => undefined)

    await expect(switchDesignThreadForDocument({
      workspaceRoot: '/workspace',
      docId: 'doc',
      threadId: 'thr_1',
      registry: emptyDesignThreadRegistry(),
      saveRegistry,
      persistMeta,
      selectThread
    })).resolves.toBe(true)

    expect(saveRegistry).toHaveBeenCalledWith(expect.objectContaining({
      workspaces: expect.objectContaining({
        ['/workspace\u0000doc']: { activeThreadId: 'thr_1', threadIds: ['thr_1'] }
      })
    }))
    expect(persistMeta).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      docId: 'doc',
      stampThreadId: 'thr_1'
    })
    expect(selectThread).toHaveBeenCalledWith('thr_1')
  })
})
