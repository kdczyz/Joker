import { create } from 'zustand'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { type OpError } from './canvas/shape-ops'
import { applyShapeOpsFromText } from './canvas/apply-shape-ops'
import { snapshotCanvas, snapshotToCompactJson } from './canvas/canvas-snapshot'
import { useCanvasSelectionStore } from './canvas/canvas-selection-store'
import { useCanvasShapeStore } from './canvas/canvas-shape-store'
import { useDesignWorkspaceStore } from './design-workspace-store'
import { focusViewportOnIds } from './canvas/canvas-focus'
import {
  markDesignThread,
  readDesignThreadRegistry,
  saveDesignThreadRegistry
} from './design-thread-registry'

export type DesignMessageBlock =
  | { kind: 'user'; id: string; text: string; createdAt: string }
  | { kind: 'assistant'; id: string; text: string; createdAt: string }

/**
 * Composite scope key for per-artifact / per-folder isolation.
 * Format: workspace\0docId\0artifactId
 *
 * The 画布 (canvas) chat is always scoped to the *current folder* (workspaceRoot),
 * so each project folder keeps its own isolated canvas conversation that never
 * mixes into the code chat.
 */
function artifactScopeKey(
  workspaceRoot: string,
  docId?: string | null,
  artifactId?: string | null
): string {
  const ws = workspaceRoot.trim()
  const doc = docId?.trim() ?? ''
  const art = artifactId?.trim() ?? ''
  if (doc && art) return `${ws}${String.fromCharCode(0)}${doc}${String.fromCharCode(0)}${art}`
  if (doc) return `${ws}${String.fromCharCode(0)}${doc}`
  return ws
}

type DesignAssistantState = {
  /**
   * Map of scopeKey → threadId. Each folder (and optionally each artifact) gets
   * its own canvas thread, kept out of the code-thread sidebar via the design
   * thread registry.
   */
  designThreadMap: Record<string, string>
  /**
   * Per-scope canvas conversation. Keyed by the same scopeKey so a folder's
   * canvas chat is persisted and isolated from every other folder.
   */
  designConversations: Record<string, DesignMessageBlock[]>
  /** Currently active scope key (which folder's canvas chat is shown). */
  activeScopeKey: string | null
  designInput: string
  designBusy: boolean
  /** IDs the most-recent AI message touched. SelectionOverlay glows these for ~800ms. */
  lastAiAffectedIds: string[]
  /** Timestamp (ms since epoch) when the glow should start. null = no glow. */
  lastAiActionAt: number | null

  setDesignInput: (text: string) => void
  clearDesignConversation: (scopeKey?: string | null) => void
  setActiveScope: (key: string | null) => void
  ensureDesignThread: (
    workspaceRoot: string,
    docId?: string | null,
    artifactId?: string | null
  ) => Promise<{ threadId: string; created: boolean }>
  sendDesignMessage: (
    text: string,
    workspaceRoot: string,
    opts?: { model?: string; reasoningEffort?: string; docId?: string; artifactId?: string }
  ) => Promise<void>
  appendBlock: (block: DesignMessageBlock) => void
  updateAssistantBlock: (id: string, text: string) => void
  /** Parse an assistant message for design_canvas / legacy shapeops blocks and execute them. */
  applyAiShapeOps: (text: string) => { affectedIds: string[]; errors: OpError[] }
  /** Glow + camera-focus the shapes an AI turn just touched. Safe to call from any apply path. */
  markAiAffected: (ids: string[]) => void
  /** Conversation blocks for the active scope (empty when none). */
  activeBlocks: () => DesignMessageBlock[]
}

const DESIGN_THREAD_KEY = 'Joker.design-assistant.threadRegistry.v2'
const DESIGN_CONVERSATIONS_KEY = 'Joker.design-assistant.conversations.v2'

function readDesignAssistantThreadMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DESIGN_THREAD_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

function writeDesignAssistantThreadMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(DESIGN_THREAD_KEY, JSON.stringify(map))
  } catch {
    // non-fatal
  }
}

function readDesignConversations(): Record<string, DesignMessageBlock[]> {
  try {
    const raw = localStorage.getItem(DESIGN_CONVERSATIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, DesignMessageBlock[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeDesignConversations(conversations: Record<string, DesignMessageBlock[]>): void {
  try {
    localStorage.setItem(DESIGN_CONVERSATIONS_KEY, JSON.stringify(conversations))
  } catch {
    // non-fatal
  }
}

/**
 * Legacy migration: read old v1 per-workspace records and fold them
 * into the new per-artifact map so existing conversations survive the upgrade.
 */
function migrateLegacyThreadRegistry(): Record<string, string> {
  const v2 = readDesignAssistantThreadMap()
  if (Object.keys(v2).length > 0) return v2
  try {
    const raw = localStorage.getItem('Joker.design-assistant.threadRegistry.v1')
    if (!raw) return {}
    const v1 = JSON.parse(raw) as Record<string, string>
    for (const [ws, threadId] of Object.entries(v1)) {
      if (threadId) v2[ws] = threadId
    }
    if (Object.keys(v2).length > 0) {
      writeDesignAssistantThreadMap(v2)
      localStorage.removeItem('Joker.design-assistant.threadRegistry.v1')
    }
  } catch {
    // ignore
  }
  return v2
}

let nextBlockId = 0
function makeBlockId(): string {
  return `design-block-${++nextBlockId}`
}

/**
 * Build a canvas-aware prompt: tell the agent it is managing the current
 * folder's canvas (whiteboard) and can drive it directly through the dedicated
 * canvas tools — not just write files. When `takeover` is set, the agent is
 * expected to act autonomously and proactively reshape the board.
 */
function buildCanvasPrompt(
  userText: string,
  workspaceRoot: string,
  opts?: { snapshotJson?: string; takeover?: boolean }
): string {
  const root = workspaceRoot.trim()
  const scopeLine = root
    ? `你正在接管【当前项目文件夹 "${root}"】里的画布（canvas 白板）。`
    : '你正在接管当前项目的画布（canvas 白板）。'
  const lines = [
    '【画布接管模式】',
    scopeLine,
    '你拥有这块画布的完整控制权：可以读取它、创建/移动/删除/重排形状、生成屏幕、套用设计系统。不要只写说明，要直接用下面的工具去改动画布，让用户看到结果。',
    '',
    '你可以用的画布工具（在回复里以 ```design_canvas 围栏 JSON 块 的形式发出，渲染器会立即执行）：',
    '- 创建屏幕：```design_canvas { "action": "add_screen", "name": "登录页", "brief": "..." , "devicePreset": "mobile" }```，或一次创建多个：{ "action": "add_screen", "screens": [ {"name": "首页"}, {"name": "设置"} ] }。',
    '- 编辑/创建形状：```design_canvas { "action": "update_shapes", "ops": [ { "op": "add", "shape": { "type": "rect", "x": 100, "y": 100, "width": 200, "height": 120, "fills": [{"type":"solid","color":"#3b82d8","opacity":1}] } }, { "op": "update", "id": "<已有形状id>", "patch": { "fills": [...] } }, { "op": "delete", "id": "<id>" } ] }```',
    '- 对齐/分布/堆叠/网格/响应式回流：在 update_shapes 的 ops 里使用 "align" / "distribute" / "stack" / "grid" / "responsive-reflow" 等 op（ids 为目标形状 id 数组）。',
    '- 设计系统：在 ops 里使用 "define-token" / "apply-token" / "define-component" / "instantiate" 等 op。',
    '- 校验：在 ops 里使用 { "op": "lint-design-system" } 检查配色、对比度、点击区域。',
    'op 的坐标都是画布绝对坐标（1 单位≈1px）。创建形状后渲染器会返回新形状的 id，后续可用该 id 引用。',
    '尽量把相关改动合并到同一个 ops 数组里，少发多次。',
    ...(opts?.takeover
      ? [
          '',
          '【接管指令】你正处于"交给 Agent 接管画布"模式。请基于用户的需求主动、连续地完成任务：规划→创建/组织形状→（必要时）生成屏幕→润色。不要每次都停下来向用户确认，直接把画布做到大致可用，最后用一句话总结你做了什么。'
        ]
      : ['']),
    ...(opts?.snapshotJson
      ? [
          '',
          '当前画布快照（形状 id、名称、类型、位置、尺寸、填充、选中状态）。用它来定位形状、避免重叠、并确认你的改动是否生效：',
          '```json',
          opts.snapshotJson,
          '```'
        ]
      : ['（当前画布为空或快照不可用，可直接从空白开始创建。）']),
    '',
    `用户需求：${userText}`
  ]
  return lines.join('\n')
}

export const useDesignAssistantStore = create<DesignAssistantState>((set, get) => ({
  designThreadMap: migrateLegacyThreadRegistry(),
  designConversations: readDesignConversations(),
  activeScopeKey: null,
  designInput: '',
  designBusy: false,
  lastAiAffectedIds: [],
  lastAiActionAt: null,

  setDesignInput: (text) => set({ designInput: text }),

  setActiveScope: (key) => set({ activeScopeKey: key }),

  activeBlocks: () => {
    const { activeScopeKey, designConversations } = get()
    if (!activeScopeKey) return []
    return designConversations[activeScopeKey] ?? []
  },

  clearDesignConversation: (scopeKey) => {
    const key = scopeKey ?? get().activeScopeKey
    if (!key) {
      set({ designBusy: false, lastAiAffectedIds: [], lastAiActionAt: null })
      return
    }
    const nextMap = { ...get().designThreadMap }
    delete nextMap[key]
    const nextConversations = { ...get().designConversations }
    delete nextConversations[key]
    writeDesignAssistantThreadMap(nextMap)
    writeDesignConversations(nextConversations)
    set({
      designThreadMap: nextMap,
      designConversations: nextConversations,
      designBusy: false,
      lastAiAffectedIds: [],
      lastAiActionAt: null
    })
  },

  appendBlock: (block) => {
    const key = get().activeScopeKey
    if (!key) return
    const current = get().designConversations[key] ?? []
    const nextConversations = { ...get().designConversations, [key]: [...current, block] }
    writeDesignConversations(nextConversations)
    set({ designConversations: nextConversations })
  },

  updateAssistantBlock: (id, text) => {
    const key = get().activeScopeKey
    if (!key) return
    const current = get().designConversations[key] ?? []
    const nextConversations = {
      ...get().designConversations,
      [key]: current.map((block) => (block.id === id ? { ...block, text } : block))
    }
    writeDesignConversations(nextConversations)
    set({ designConversations: nextConversations })
  },

  applyAiShapeOps: (text) => {
    const { affectedIds, errors } = applyShapeOpsFromText(text)
    if (affectedIds.length > 0) get().markAiAffected(affectedIds)
    return { affectedIds, errors }
  },

  markAiAffected: (ids) => {
    if (ids.length === 0) return
    set({ lastAiAffectedIds: ids, lastAiActionAt: Date.now() })
    focusViewportOnIds(ids)
  },

  ensureDesignThread: async (workspaceRoot, docId, artifactId) => {
    const scope = artifactScopeKey(workspaceRoot, docId, artifactId)
    const existing = get().designThreadMap[scope]
    if (existing) {
      set({ activeScopeKey: scope })
      return { threadId: existing, created: false }
    }

    const provider = getProvider()
    const thread = await provider.createThread({
      workspace: workspaceRoot,
      title: 'Design Assistant'
    })
    const threadId = thread.id
    const nextMap = { ...get().designThreadMap, [scope]: threadId }
    writeDesignAssistantThreadMap(nextMap)
    set({ designThreadMap: nextMap, activeScopeKey: scope })

    // Keep this canvas thread out of the code-thread sidebar: register it as a
    // design thread so isDesignThreadId() excludes it everywhere.
    try {
      const registry = readDesignThreadRegistry()
      saveDesignThreadRegistry(markDesignThread(workspaceRoot, docId ?? '', threadId, registry, artifactId))
    } catch {
      // non-fatal — isolation from the sidebar is best-effort
    }
    return { threadId, created: true }
  },

  sendDesignMessage: async (text, workspaceRoot, opts) => {
    const state = get()
    if (state.designBusy) return
    const trimmed = text.trim()
    if (!trimmed) return
    const docId = opts?.docId
    const artifactId = opts?.artifactId
    const scope = artifactScopeKey(workspaceRoot, docId, artifactId)

    set({ designBusy: true, designInput: '', activeScopeKey: scope })
    get().appendBlock({
      kind: 'user',
      id: makeBlockId(),
      text: trimmed,
      createdAt: new Date().toISOString()
    })

    try {
      const { threadId } = await get().ensureDesignThread(workspaceRoot, docId, artifactId)
      const provider = getProvider()
      const model = opts?.model?.trim()
      const reasoningEffort = opts?.reasoningEffort?.trim()
      const liveDocument = useCanvasShapeStore.getState().document
      const selectedIds = new Set(useCanvasSelectionStore.getState().selectedIds)
      const snapshotJson = snapshotToCompactJson(
        snapshotCanvas(liveDocument, selectedIds, { maxShapes: 150 })
      )
      const takeover = useDesignWorkspaceStore.getState().agentTakeoverMode
      const prompt = buildCanvasPrompt(trimmed, workspaceRoot, { snapshotJson, takeover })
      const assistantId = makeBlockId()
      get().appendBlock({
        kind: 'assistant',
        id: assistantId,
        text: '',
        createdAt: new Date().toISOString()
      })

      const { turnId } = await provider.sendUserMessage(threadId, prompt, {
        displayText: trimmed,
        mode: 'agent',
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {})
      })

      const sseStreamId = `design-rail-${threadId}-${turnId}`
      const { streamId } = await rendererRuntimeClient.startSse(threadId, 0, sseStreamId, {
        acknowledgedBatches: true
      })

      let assistantText = ''
      const unsubscribe = rendererRuntimeClient.onSseEvent((payload) => {
        if (payload.streamId !== streamId) return
        try {
          for (const rawEvent of payload.events) {
            const event = rawEvent as { type?: string; delta?: string; text?: string }
            if (event.type === 'text_delta' && event.delta) {
              assistantText += event.delta
              get().updateAssistantBlock(assistantId, assistantText)
            } else if (event.type === 'turn_complete') {
              unsubscribe()
              rendererRuntimeClient.stopSse(streamId)
              get().updateAssistantBlock(assistantId, assistantText)
              // Auto-apply ShapeOps blocks the AI emitted (round-trip without a manual step).
              try {
                get().applyAiShapeOps(assistantText)
              } catch {
                // ignore — the executor logs its own errors in result.errors
              }
              set({ designBusy: false })
            }
          }
        } finally {
          if (payload.batchId) void rendererRuntimeClient.ackSse(streamId, payload.batchId)
        }
      })
    } catch {
      set({ designBusy: false })
      get().appendBlock({
        kind: 'assistant',
        id: makeBlockId(),
        text: '发送画布消息失败。',
        createdAt: new Date().toISOString()
      })
    }
  }
}))
