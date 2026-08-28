import { describe, expect, it } from 'vitest'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import type { ChatState } from './chat-store-types'
import { reduceChatProjection } from './chat-projection-reducer'

const NOW = Date.parse('2026-07-11T00:00:00.000Z')
const context = {
  now: NOW,
  clearRecoveringError: (error: string | null) => error === 'recovering' ? null : error,
  goalTimelineText: (goal: ChatState['activeThreadGoal'], cleared?: boolean) =>
    cleared || !goal ? 'Goal cleared' : `Goal ${goal.status}: ${goal.objective}`,
  runtimeStatusText: () => 'Runtime status',
  runtimeErrorView: (event: { message: string; code?: string }) => ({
    summary: event.message,
    ...(event.code ? { code: event.code } : {})
  }),
  upsertRuntimeError: (blocks: ChatState['blocks'], block: ChatState['blocks'][number]) => {
    const index = blocks.findIndex((candidate) => candidate.id === block.id)
    if (index < 0) return [...blocks, block]
    const next = [...blocks]
    next[index] = block
    return next
  },
  formatRuntimeError: (error: unknown) => error instanceof Error ? error.message : String(error),
  runtimeErrorDetail: () => '',
  isInterruptSettledError: () => false,
  settlePendingRuntimeWork: (blocks: ChatState['blocks']) => blocks,
  threadSnapshotLooksRunning: () => false,
  hasAssistantTextForCompletedTurn: () => false
}

function state(): ChatState {
  return {
    activeThreadId: 'thread_1',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    threads: [{
      id: 'thread_1', title: 'Thread', updatedAt: '2026-07-10T00:00:00.000Z', model: 'model', mode: 'agent'
    }],
    usageRefreshKey: 0,
    error: 'recovering'
  } as unknown as ChatState
}

function project(initial: ChatState, actions: RuntimeProjectionAction[]): ChatState {
  return actions.reduce(
    (current, action) => ({ ...current, ...reduceChatProjection(current, action, context) }),
    initial
  )
}

describe('chat projection reducer', () => {
  it('produces identical state for live and replayed normalized actions', () => {
    const actions: RuntimeProjectionAction[] = [
      {
        type: 'approval_received',
        payload: { approvalId: 'approval_1', summary: 'Run tests', toolName: 'exec_command' }
      },
      {
        type: 'user_input_requested',
        payload: {
          itemId: 'input_item_1',
          requestId: 'input_1',
          questions: [{ header: 'Mode', id: 'mode', question: 'Choose', options: [] }]
        }
      },
      {
        type: 'goal_changed',
        payload: {
          threadId: 'thread_1',
          goal: {
            threadId: 'thread_1', objective: 'Finish reducer', status: 'active',
            tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0,
            createdAt: '2026-07-11T00:00:00.000Z', updatedAt: '2026-07-11T00:00:00.000Z'
          },
          createdAt: '2026-07-11T00:00:00.000Z'
        }
      }
    ]

    const live = project(state(), actions)
    const replay = project(state(), structuredClone(actions))

    expect(replay).toEqual(live)
    expect(live.blocks.map((block) => block.kind)).toEqual(['approval', 'user_input', 'system'])
    expect(live.activeThreadGoal?.objective).toBe('Finish reducer')
    expect(live.error).toBeNull()
  })

  it('deduplicates approval and user-input replay by stable runtime identity', () => {
    const approval: RuntimeProjectionAction = {
      type: 'approval_received',
      payload: { approvalId: 'approval_1', summary: 'Run tests' }
    }
    const input: RuntimeProjectionAction = {
      type: 'user_input_requested',
      payload: { itemId: 'input_item_1', requestId: 'input_1', questions: [] }
    }
    const projected = project(state(), [approval, input, approval, input])
    expect(projected.blocks).toHaveLength(2)
  })

  it('reconciles a delayed stable user event with its optimistic bubble', () => {
    const createdAt = '2026-07-11T00:00:00.000Z'
    const initial = {
      ...state(),
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      blocks: [
        {
          kind: 'user' as const,
          id: 'u-optimistic',
          createdAt,
          text: '检查一下脚本并优化执行进度'
        },
        {
          kind: 'compaction' as const,
          id: 'compaction_1',
          status: 'success' as const,
          summary: 'Existing summary'
        }
      ]
    }

    const projected = project(initial, [{
      type: 'user_message_received',
      payload: {
        itemId: 'item_turn_1_user',
        turnId: 'turn_1',
        createdAt,
        text: '分析脚本是否存在问题，并优化执行过程和进度。',
        meta: { displayText: '检查一下脚本并优化执行进度' }
      }
    }])

    expect(projected.blocks).toHaveLength(2)
    expect(projected.blocks[0]).toMatchObject({
      kind: 'user',
      id: 'item_turn_1_user',
      meta: { displayText: '检查一下脚本并优化执行进度' }
    })
    expect(projected.blocks[1]).toMatchObject({ kind: 'compaction', id: 'compaction_1' })
  })

  it('keeps only the latest automatic compaction marker for a turn', () => {
    const projected = project(state(), [
      {
        type: 'compaction_updated',
        payload: {
          itemId: 'compaction_1',
          turnId: 'turn_1',
          summary: 'first summary',
          status: 'success',
          auto: true
        }
      },
      {
        type: 'compaction_updated',
        payload: {
          itemId: 'compaction_2',
          turnId: 'turn_1',
          summary: 'new summary',
          status: 'success',
          auto: true
        }
      }
    ])

    expect(projected.blocks).toEqual([
      expect.objectContaining({
        kind: 'compaction',
        id: 'compaction_2',
        turnId: 'turn_1',
        summary: 'new summary'
      })
    ])
  })

  it('retires a pending approval after its runtime resolution is projected', () => {
    const projected = project(state(), [
      {
        type: 'approval_received',
        payload: { approvalId: 'approval_1', summary: 'Run tests' }
      },
      {
        type: 'approval_status_changed',
        payload: {
          approvalId: 'approval_1',
          status: 'expired',
          errorMessage: 'turn aborted while awaiting approval'
        }
      }
    ])

    expect(projected.blocks).toContainEqual(expect.objectContaining({
      kind: 'approval',
      approvalId: 'approval_1',
      status: 'expired',
      errorMessage: 'turn aborted while awaiting approval'
    }))
  })

  it.each(['allowed', 'denied'] as const)(
    'clears stale approval errors when the runtime resolves it as %s',
    (status) => {
      const initial = {
        ...state(),
        blocks: [{
          kind: 'approval' as const,
          id: 'approval-approval_1',
          approvalId: 'approval_1',
          summary: 'Run tests',
          status: 'error' as const,
          errorMessage: 'response was lost'
        }]
      }

      const projected = project(initial, [{
        type: 'approval_status_changed',
        payload: { approvalId: 'approval_1', status }
      }])
      const approval = projected.blocks[0]

      expect(approval).toMatchObject({ kind: 'approval', status })
      expect(approval).not.toHaveProperty('errorMessage')
    }
  )

  it('reconciles a persisted completion through the same projection reducer', () => {
    const initial = {
      ...state(),
      busy: false,
      currentTurnId: null,
      lastSeq: 4,
      liveAssistant: ''
    }
    const blocks = [{
      kind: 'assistant' as const,
      id: 'assistant_1',
      createdAt: '2026-07-11T00:00:00.000Z',
      text: 'Persisted answer'
    }]
    const projected = project(initial, [{
      type: 'thread_snapshot_reconciled',
      payload: { threadId: 'thread_1', blocks, latestSeq: 8 }
    }])

    expect(projected.blocks).toEqual(blocks)
    expect(projected.lastSeq).toBe(8)
    expect(projected.error).toBeNull()
  })

  it('measures each reasoning segment when live work flushes around tool calls', () => {
    const initial: ChatState = {
      ...state(),
      busy: true,
      currentTurnUserId: 'user_1',
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      turnTtftMsByUserId: {}
    }
    const at = (ms: number) => ({ ...context, now: NOW + ms })
    let current: ChatState = initial
    const step = (action: RuntimeProjectionAction, ms: number): void => {
      current = { ...current, ...reduceChatProjection(current, action, at(ms)) }
    }

    step({ type: 'deltas_received', deltas: [{ text: 'first thought', kind: 'agent_reasoning' }] }, 0)
    step({ type: 'deltas_received', deltas: [{ text: ' continues', kind: 'agent_reasoning' }] }, 4000)
    // A tool event flushes the live reasoning segment into a durable block.
    step({
      type: 'tool_updated',
      payload: { itemId: 'tool_1', summary: 'read: a.ts', status: 'success', toolKind: 'tool_call' }
    }, 5000)
    step({ type: 'deltas_received', deltas: [{ text: 'second thought', kind: 'agent_reasoning' }] }, 6000)
    step({ type: 'turn_completed' }, 9000)

    const reasoningBlocks = current.blocks.filter((block) => block.kind === 'reasoning')
    expect(reasoningBlocks).toHaveLength(2)
    const [first, second] = reasoningBlocks as Array<Extract<typeof reasoningBlocks[number], { kind: 'reasoning' }>>
    expect(first.text).toBe('first thought continues')
    expect(first.durationMs).toBe(4000)
    expect(second.text).toBe('second thought')
    expect(second.durationMs).toBe(3000)
  })

  it('settles the sidebar thread summary to completed when a turn completes', () => {
    const initial: ChatState = {
      ...state(),
      busy: true,
      currentTurnId: 'turn_1',
      threads: [{ ...state().threads[0]!, status: 'running', latestTurnStatus: 'running' }]
    }
    const next = project(initial, [{ type: 'turn_completed' }])
    const thread = next.threads.find((candidate) => candidate.id === 'thread_1')
    expect(thread?.status).toBe('idle')
    expect(thread?.latestTurnStatus).toBe('completed')
    expect(thread?.latestTurnId).toBe('turn_1')
  })

  it.each([
    { label: 'interrupted', error: new Error('interrupted'), isInterrupt: true, expected: 'aborted' },
    { label: 'failed', error: new Error('boom'), isInterrupt: false, expected: 'failed' }
  ])('settles the sidebar thread summary to $expected when a turn fails ($label)', ({
    error,
    isInterrupt,
    expected
  }) => {
    const initial: ChatState = {
      ...state(),
      busy: true,
      currentTurnId: 'turn_1',
      threads: [{ ...state().threads[0]!, status: 'running', latestTurnStatus: 'running' }]
    }
    const failedContext = { ...context, isInterruptSettledError: () => isInterrupt }
    const next = { ...initial, ...reduceChatProjection(initial, { type: 'turn_failed', error, options: { terminal: true } }, failedContext) }
    const thread = next.threads.find((candidate) => candidate.id === 'thread_1')
    expect(thread?.status).toBe('idle')
    expect(thread?.latestTurnStatus).toBe(expected)
  })
})
