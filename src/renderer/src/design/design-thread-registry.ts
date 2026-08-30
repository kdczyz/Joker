import type { NormalizedThread } from '../agent/types'
import { browserStorage, type BrowserStorageLike } from '../lib/browser-storage'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

/**
 * Thin design-thread registry — keeps design-assistant threads out of the
 * code-thread sidebar and lets each 画布文件 (design artifact) reuse its own
 * thread. Records are keyed by a composite (workspace + 设计稿 + artifact)
 * scope so that switching 画布文件 switches the conversation.
 *
 * Scope key hierarchy:
 *   3-level: workspace\0docId\0artifactId  (per-artifact isolation)
 *   2-level: workspace\0docId              (legacy, per-document)
 *   1-level: workspace                     (legacy, pre-document)
 */

export const DESIGN_ASSISTANT_THREAD_TITLE = 'Design Assistant'
const MAX_DESIGN_THREAD_IDS_PER_WORKSPACE = 20
const MAX_DESIGN_REGISTRY_WORKSPACES = 80
const DESIGN_THREAD_REGISTRY_KEY = 'Joker.design.threadRegistry.v1'
const LEGACY_DESIGN_ASSISTANT_THREAD_REGISTRY_KEY = 'Joker.design-assistant.threadRegistry.v1'

export type DesignThreadWorkspaceRecord = {
  activeThreadId: string
  threadIds: string[]
}

export type DesignThreadRegistry = {
  version: 1
  workspaces: Record<string, DesignThreadWorkspaceRecord>
}

export type DesignDocThreadRef = {
  workspaceRoot: string
  docId: string
  artifactId?: string
}

export function designWorkspaceKey(workspaceRoot: string | undefined | null): string {
  return normalizeWorkspaceRoot(workspaceRoot ?? '')
}

/**
 * Scope separator joining a workspace key and a 设计稿 id into one registry key.
 * A NUL byte can never appear in a filesystem path, so a composite scope key is
 * unambiguous to split and a plain workspace key (legacy, pre-migration) never
 * collides with a composite one.
 */
const DOC_SCOPE_SEP = String.fromCharCode(0)

/**
 * Composite registry key.
 * 3 args → per-artifact scope: workspace\0docId\0artifactId
 * 2 args → per-document scope: workspace\0docId
 * 0 args → workspace scope (legacy)
 */
export function designDocKey(
  workspaceRoot: string | undefined | null,
  docId: string | undefined | null,
  artifactId?: string | undefined | null
): string {
  const ws = designWorkspaceKey(workspaceRoot)
  const doc = (docId ?? '').trim()
  const art = (artifactId ?? '').trim()
  if (doc && art) return `${ws}${DOC_SCOPE_SEP}${doc}${DOC_SCOPE_SEP}${art}`
  return doc ? `${ws}${DOC_SCOPE_SEP}${doc}` : ws
}

/** Shortcut: explicitly build a 3-level per-artifact scope key. */
export function designArtifactScopeKey(
  workspaceRoot: string | undefined | null,
  docId: string | undefined | null,
  artifactId: string | undefined | null
): string {
  return designDocKey(workspaceRoot, docId, artifactId)
}

export function splitDesignDocKey(scopeKey: string): DesignDocThreadRef | null {
  const key = normalizeScopeKey(scopeKey)
  const i = key.indexOf(DOC_SCOPE_SEP)
  if (i === -1) return null
  const workspaceRoot = key.slice(0, i)
  const rest = key.slice(i + DOC_SCOPE_SEP.length)
  const sepIdx = rest.indexOf(DOC_SCOPE_SEP)
  const docId = (sepIdx === -1 ? rest : rest.slice(0, sepIdx)).trim()
  const artifactId = sepIdx === -1 ? undefined : rest.slice(sepIdx + DOC_SCOPE_SEP.length).trim()
  if (!workspaceRoot || !docId) return null
  return { workspaceRoot, docId, ...(artifactId ? { artifactId } : {}) }
}

/** Normalize a stored key, preserving the 设计稿 suffix of a composite scope key. */
function normalizeScopeKey(key: string): string {
  const i = key.indexOf(DOC_SCOPE_SEP)
  if (i === -1) return designWorkspaceKey(key)
  const ws = designWorkspaceKey(key.slice(0, i))
  if (!ws) return ''
  return `${ws}${DOC_SCOPE_SEP}${key.slice(i + DOC_SCOPE_SEP.length)}`
}

export function emptyDesignThreadRegistry(): DesignThreadRegistry {
  return { version: 1, workspaces: {} }
}

function normalizeThreadIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const ordered = new Set<string>()
  for (const id of ids) {
    if (typeof id === 'string' && id.trim()) ordered.add(id.trim())
  }
  return [...ordered].slice(0, MAX_DESIGN_THREAD_IDS_PER_WORKSPACE)
}

export function normalizeDesignThreadRegistry(raw: unknown): DesignThreadRegistry {
  if (!raw || typeof raw !== 'object') return emptyDesignThreadRegistry()
  const source = raw as { workspaces?: unknown }
  if (!source.workspaces || typeof source.workspaces !== 'object') return emptyDesignThreadRegistry()

  const workspaces: DesignThreadRegistry['workspaces'] = {}
  for (const [scopeKey, value] of Object.entries(source.workspaces as Record<string, unknown>)) {
    const key = normalizeScopeKey(scopeKey)
    if (!key || !value || typeof value !== 'object') continue
    const record = value as { activeThreadId?: unknown; threadIds?: unknown }
    const threadIds = normalizeThreadIds(record.threadIds)
    if (threadIds.length === 0) continue
    const activeThreadId =
      typeof record.activeThreadId === 'string' && threadIds.includes(record.activeThreadId.trim())
        ? record.activeThreadId.trim()
        : threadIds[0]
    workspaces[key] = { activeThreadId, threadIds }
  }
  const unique = enforceUniqueThreadScopes(workspaces)
  const trimmed = Object.fromEntries(
    Object.entries(unique).slice(-MAX_DESIGN_REGISTRY_WORKSPACES)
  )
  return { version: 1, workspaces: trimmed }
}

function enforceUniqueThreadScopes(
  records: DesignThreadRegistry['workspaces']
): DesignThreadRegistry['workspaces'] {
  const seen = new Set<string>()
  const workspaces: DesignThreadRegistry['workspaces'] = {}
  for (const [scopeKey, record] of Object.entries(records)) {
    const threadIds = record.threadIds.filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (threadIds.length === 0) continue
    workspaces[scopeKey] = {
      activeThreadId: threadIds.includes(record.activeThreadId) ? record.activeThreadId : threadIds[0],
      threadIds
    }
  }
  return workspaces
}

export function readDesignThreadRegistry(
  storage: BrowserStorageLike | null = browserStorage()
): DesignThreadRegistry {
  if (!storage) return emptyDesignThreadRegistry()
  try {
    const raw = storage.getItem(DESIGN_THREAD_REGISTRY_KEY)
    const registry = normalizeDesignThreadRegistry(raw ? JSON.parse(raw) : null)
    return mergeLegacyDesignAssistantThreads(registry, readLegacyDesignAssistantRegistry(storage))
  } catch {
    return emptyDesignThreadRegistry()
  }
}

export function saveDesignThreadRegistry(
  registry: DesignThreadRegistry,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(DESIGN_THREAD_REGISTRY_KEY, JSON.stringify(normalizeDesignThreadRegistry(registry)))
  } catch {
    /* ignore storage failures */
  }
}

export function designThreadIds(
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): Set<string> {
  const ids = new Set<string>()
  for (const record of Object.values(registry.workspaces)) {
    for (const id of record.threadIds) ids.add(id)
  }
  return ids
}

function mergeLegacyDesignAssistantThreads(
  registry: DesignThreadRegistry,
  raw: unknown
): DesignThreadRegistry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return registry
  let next = registry
  for (const [workspaceRoot, value] of Object.entries(raw as Record<string, unknown>)) {
    const threadId = typeof value === 'string' ? value.trim() : ''
    if (!threadId) continue
    if (designThreadIds(next).has(threadId)) continue
    next = markDesignThread(workspaceRoot, '', threadId, next)
  }
  return next
}

function readLegacyDesignAssistantRegistry(storage: BrowserStorageLike): unknown {
  try {
    const raw = storage.getItem(LEGACY_DESIGN_ASSISTANT_THREAD_REGISTRY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function isDesignThreadId(
  threadId: string | null | undefined,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): boolean {
  return Boolean(threadId && designThreadIds(registry).has(threadId))
}

export function markDesignThread(
  workspaceRoot: string,
  docId: string,
  threadId: string,
  registry: DesignThreadRegistry = readDesignThreadRegistry(),
  artifactId?: string | null
): DesignThreadRegistry {
  const key = designDocKey(workspaceRoot, docId, artifactId)
  const id = threadId.trim()
  if (!key || !id) return registry
  const workspaces: DesignThreadRegistry['workspaces'] = {}
  for (const [scopeKey, existing] of Object.entries(registry.workspaces)) {
    const threadIds = existing.threadIds.filter((item) => item !== id)
    if (scopeKey !== key && threadIds.length === 0) continue
    workspaces[scopeKey] = {
      activeThreadId: existing.activeThreadId === id ? threadIds[0] ?? '' : existing.activeThreadId,
      threadIds
    }
  }
  const record = workspaces[key] ?? { activeThreadId: '', threadIds: [] }
  const threadIds = [id, ...record.threadIds.filter((item) => item !== id)]
  return normalizeDesignThreadRegistry({
    ...registry,
    workspaces: { ...workspaces, [key]: { activeThreadId: id, threadIds } }
  })
}

export function forgetDesignThread(
  threadId: string,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): DesignThreadRegistry {
  const id = threadId.trim()
  if (!id) return registry
  const workspaces: DesignThreadRegistry['workspaces'] = {}
  for (const [scopeKey, record] of Object.entries(registry.workspaces)) {
    const threadIds = record.threadIds.filter((item) => item !== id)
    if (threadIds.length === 0) continue
    workspaces[scopeKey] = {
      activeThreadId: record.activeThreadId === id ? threadIds[0] : record.activeThreadId,
      threadIds
    }
  }
  return normalizeDesignThreadRegistry({ version: 1, workspaces })
}

export function designDocRefForThreadId(
  threadId: string | null | undefined,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): DesignDocThreadRef | null {
  const id = threadId?.trim()
  if (!id) return null
  for (const [scopeKey, record] of Object.entries(registry.workspaces)) {
    if (!record.threadIds.includes(id)) continue
    const ref = splitDesignDocKey(scopeKey)
    if (ref) return ref
  }
  return null
}

export function activeDesignThreadForWorkspace(
  workspaceRoot: string,
  docId: string,
  threads: NormalizedThread[],
  registry: DesignThreadRegistry = readDesignThreadRegistry(),
  artifactId?: string | null
): NormalizedThread | null {
  // Prefer per-artifact scope when artifactId is provided
  const artifactKey = artifactId ? designDocKey(workspaceRoot, docId, artifactId) : null
  if (artifactKey) {
    const artifactRecord = registry.workspaces[artifactKey]
    if (artifactRecord) {
      const candidates = artifactRecord.threadIds
        .map((id) => threads.find((thread) => thread.id === id) ?? null)
        .filter((thread): thread is NormalizedThread => Boolean(thread))
        .filter((thread) => thread.archived !== true)
      const result = candidates.find((thread) => thread.id === artifactRecord.activeThreadId) ?? candidates[0] ?? null
      if (result) return result
    }
  }
  // Fall back to document-level scope
  const key = designDocKey(workspaceRoot, docId)
  if (!key) return null
  const record = registry.workspaces[key]
  if (!record) return null
  const candidates = record.threadIds
    .map((id) => threads.find((thread) => thread.id === id) ?? null)
    .filter((thread): thread is NormalizedThread => Boolean(thread))
    .filter((thread) => thread.archived !== true)
  return candidates.find((thread) => thread.id === record.activeThreadId) ?? candidates[0] ?? null
}

/**
 * One-time migration: re-key a workspace's legacy per-workspace record (written
 * before 设计稿 existed) onto the default 设计稿's composite scope key, so the
 * existing conversation stays attached after the hierarchy upgrade. Idempotent —
 * once the plain workspace key is gone, subsequent calls are no-ops.
 */
export function migrateRegistryToDoc(
  registry: DesignThreadRegistry,
  workspaceRoot: string,
  docId: string
): DesignThreadRegistry {
  const wsKey = designWorkspaceKey(workspaceRoot)
  if (!wsKey) return registry
  const legacy = registry.workspaces[wsKey]
  if (!legacy) return registry
  const docKey = designDocKey(workspaceRoot, docId)
  const workspaces = { ...registry.workspaces }
  delete workspaces[wsKey]
  const existing = workspaces[docKey]
  const threadIds = existing ? [...existing.threadIds, ...legacy.threadIds] : [...legacy.threadIds]
  workspaces[docKey] = {
    activeThreadId: legacy.activeThreadId || existing?.activeThreadId || threadIds[0] || '',
    threadIds
  }
  return normalizeDesignThreadRegistry({ version: 1, workspaces })
}

/**
 * Migrate existing document-level threads into a per-artifact scope.
 * The first artifact of a document inherits the document's threads; subsequent
 * artifacts start with empty thread lists.
 */
export function migrateDocThreadsToArtifact(
  registry: DesignThreadRegistry,
  workspaceRoot: string,
  docId: string,
  artifactId: string
): DesignThreadRegistry {
  if (!artifactId) return registry
  const artifactKey = designDocKey(workspaceRoot, docId, artifactId)
  if (registry.workspaces[artifactKey]) return registry // already migrated
  const docKey = designDocKey(workspaceRoot, docId)
  const docRecord = registry.workspaces[docKey]
  if (!docRecord || docRecord.threadIds.length === 0) return registry
  // Check if any other artifact already claimed these threads
  const anyArtifactHasThreads = Object.entries(registry.workspaces).some(
    ([key, rec]) => key !== docKey && key !== artifactKey && rec.threadIds.length > 0 && key.startsWith(docKey + DOC_SCOPE_SEP)
  )
  if (anyArtifactHasThreads) return registry // another artifact already claimed
  const workspaces = { ...registry.workspaces }
  delete workspaces[docKey]
  workspaces[artifactKey] = { ...docRecord }
  return normalizeDesignThreadRegistry({ version: 1, workspaces })
}
