import type { NormalizedThread } from '../../agent/types'

/**
 * Persistent conversation-list state derived purely from the thread summary
 * (so it survives restarts and reconnects). The four states map to the
 * colored dots in the conversation sidebar:
 *
 * - `running`       → blue   (a turn is actively executing)
 * - `interrupted`   → red    (the last turn was aborted/failed, not completed)
 * - `needs-review`  → yellow (the runtime is waiting on an approval or a reply)
 * - `completed`     → green  (the last turn completed)
 * - `idle`         → no dot (no turns yet, or an archived/empty thread)
 */
export type ThreadStatusDot =
  | 'running'
  | 'interrupted'
  | 'needs-review'
  | 'completed'
  | 'idle'

export type ThreadStatusDotInput = {
  status?: string
  latestTurnStatus?: string
  awaitingApproval?: boolean
  awaitingUserInput?: boolean
}

export function deriveThreadStatusDot(input: ThreadStatusDotInput): ThreadStatusDot {
  const latest = input.latestTurnStatus?.trim().toLowerCase()

  // A live ask-user prompt or tool-approval request wins over everything else:
  // the agent is paused waiting on the human even if a turn is technically
  // mid-flight.
  if (input.awaitingApproval === true || input.awaitingUserInput === true) {
    return 'needs-review'
  }

  if (input.status?.trim().toLowerCase() === 'running') {
    return 'running'
  }

  if (latest === 'running' || latest === 'queued') {
    return 'running'
  }

  if (latest === 'aborted' || latest === 'failed') {
    return 'interrupted'
  }

  if (latest === 'completed') {
    return 'completed'
  }

  return 'idle'
}

export function threadStatusDotForThread(thread: NormalizedThread): ThreadStatusDot {
  return deriveThreadStatusDot({
    status: thread.status,
    latestTurnStatus: thread.latestTurnStatus,
    awaitingApproval: thread.awaitingApproval,
    awaitingUserInput: thread.awaitingUserInput
  })
}

export const THREAD_STATUS_DOT_COLOR: Record<ThreadStatusDot, string> = {
  running: 'bg-blue-500',
  interrupted: 'bg-red-500',
  'needs-review': 'bg-amber-500',
  completed: 'bg-emerald-500',
  idle: 'bg-transparent'
}

export const THREAD_STATUS_DOT_PULSE: Partial<Record<ThreadStatusDot, string>> = {
  running: 'bg-blue-400',
  'needs-review': 'bg-amber-400',
  completed: 'bg-emerald-400'
}
