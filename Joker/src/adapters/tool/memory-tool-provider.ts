import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import type { MemoryStore } from '../../memory/memory-store.js'

export function buildMemoryToolProviders(store: MemoryStore | undefined): CapabilityToolProvider[] {
  if (!store) return []
  return [{
    id: 'memory',
    kind: 'memory',
    enabled: true,
    available: true,
    tools: [
      LocalToolHost.defineTool({
        name: 'memory_create',
        description: 'Create a memory record. Categories: "long" (persistent, default), "short" (auto-expires ~7d), "session" (auto-expires ~24h). Do NOT use "pinned" — pinned memories are user-curated only. The auto-review service may also create memories without calling this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            scope: { type: 'string', enum: ['user', 'workspace', 'project'] },
            category: { type: 'string', enum: ['long', 'short', 'session'], description: 'Memory lifetime category. Defaults to "long".' },
            tags: { type: 'array', items: { type: 'string' } },
            ttlDays: { type: 'number', minimum: 1, description: 'Optional explicit lifetime in days (overrides category default).' },
            supersedes: { type: 'string', description: 'Optional memory id replaced by this memory.' }
          },
          required: ['content'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          const content = typeof args.content === 'string' ? args.content.trim() : ''
          if (!content) return { output: { error: 'content is required' }, isError: true }
          const category = args.category === 'short' || args.category === 'session' ? args.category : 'long'
          return {
            output: {
              memory: await store.create({
                content,
                scope: args.scope === 'user' || args.scope === 'project' ? args.scope : 'workspace',
                category,
                workspace: context.workspace,
                ...(args.scope === 'project' ? { project: context.workspace } : {}),
                sourceThreadId: context.threadId,
                sourceTurnId: context.turnId,
                provenance: { kind: 'user', turnId: context.turnId, origin: 'memory_create' },
                ...(typeof args.ttlDays === 'number' && Number.isFinite(args.ttlDays) && args.ttlDays > 0
                  ? { ttlMs: Math.round(args.ttlDays * 24 * 60 * 60 * 1_000) }
                  : {}),
                ...(typeof args.supersedes === 'string' && args.supersedes.trim()
                  ? { supersedes: args.supersedes.trim() }
                  : {}),
                tags: Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === 'string') : []
              })
            }
          }
        }
      }),
      LocalToolHost.defineTool({
        name: 'memory_update',
        description: 'Update content, category, or disable an existing memory. Set category to "pinned" to pin a memory (never expires, top-priority injection) or back to "long"/"short"/"session" to unpin.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            category: { type: 'string', enum: ['long', 'short', 'session', 'pinned'] },
            disabled: { type: 'boolean' }
          },
          required: ['id'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          if (typeof args.id !== 'string') return { output: { error: 'id is required' }, isError: true }
          return {
            output: {
              memory: await store.update(args.id, {
                ...(typeof args.content === 'string' ? { content: args.content } : {}),
                ...(args.category === 'long' || args.category === 'short' || args.category === 'session' || args.category === 'pinned'
                  ? { category: args.category }
                  : {}),
                ...(typeof args.disabled === 'boolean' ? { disabled: args.disabled } : {})
              }, { workspace: context.workspace })
            }
          }
        }
      }),
      LocalToolHost.defineTool({
        name: 'memory_delete',
        description: 'Delete a memory by writing a tombstone.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          if (typeof args.id !== 'string') return { output: { error: 'id is required' }, isError: true }
          return { output: { memory: await store.delete(args.id, { workspace: context.workspace }) } }
        }
      }),
      LocalToolHost.defineTool({
        name: 'memory_pin',
        description: 'Pin a memory so it never expires and is always injected with top priority. Reserved for critical, user-curated facts.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false
        },
        policy: 'on-request',
        execute: async (args, context) => {
          if (typeof args.id !== 'string') return { output: { error: 'id is required' }, isError: true }
          return { output: { memory: await store.update(args.id, { category: 'pinned' }, { workspace: context.workspace }) } }
        }
      }),
      LocalToolHost.defineTool({
        name: 'memory_unpin',
        description: 'Unpin a previously pinned memory, reverting it to the "long" category with normal decay.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false
        },
        policy: 'on-request',
        execute: async (args, context) => {
          if (typeof args.id !== 'string') return { output: { error: 'id is required' }, isError: true }
          return { output: { memory: await store.update(args.id, { category: 'long' }, { workspace: context.workspace }) } }
        }
      })
    ]
  }]
}
