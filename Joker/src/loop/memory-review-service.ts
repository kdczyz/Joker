/**
 * MemoryReviewService — minimal stub.
 *
 * The original implementation was a LOCAL, UNCOMMITTED file that got removed
 * during a workspace reset (`git clean`), and is not recoverable from git
 * (not present in any branch). This stub restores compilation and the runtime
 * wiring: `agent-loop` calls `reviewTurn` fire-and-forget after each completed
 * turn, and failures are already swallowed upstream, so a no-op implementation
 * never blocks turn cleanup or the next turn.
 *
 * Replace this file with the real implementation if the original source is
 * recovered from a local backup.
 */
export class MemoryReviewService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(
    _deps: {
      model?: unknown
      getMemoryStore?: () => unknown
      sessionStore?: unknown
      config?: () => unknown
      nowIso?: unknown
    }
  ) {}

  async reviewTurn(_input: {
    threadId: string
    turnId: string
    model: string
    providerId?: string
    accountId?: string
    workspace: string
  }): Promise<number> {
    return 0
  }
}
