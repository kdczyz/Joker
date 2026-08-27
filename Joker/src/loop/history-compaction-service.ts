import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ModelClient, ModelToolSpec } from '../ports/model-client.js'
import type { SessionStore } from '../ports/session-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { rewriteItemHistoryWithRetry } from '../services/history-commit-coordinator.js'
import type { UsageService } from '../services/usage-service.js'
import {
  hasHooksForPhase,
  runObserverHooks,
  type ResolvedHook
} from '../hooks/hook-engine.js'
import {
  effectiveHistoryAfterLatestCompaction,
  insertCompactionIntoVisibleHistory
} from './compaction-history.js'
import { resolveCompactionModel, summarizeCompactionWithModel } from './compaction-summary.js'
import { ContextCompactor, type CompactionPlan } from './context-compactor.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'
import { recordLifecycleHookWarnings } from './turn-lifecycle-hooks.js'
import type { ContextCompactionConfig } from './model-context-profile.js'
import { estimateRequestOverheadTokens } from './model-request-estimator.js'
import type { LoopTelemetry } from './loop-telemetry.js'
import { extractSkillPins } from './context-compactor.js'
import {
  type SuppressionLevel,
  SUPPRESS_NONE,
  STICKY_SUPPRESSION_TTL_TURNS,
  clearTurnSuppression,
  clearOnSuccess as clearSuppressOnSuccess,
  classifyCompactionFailure,
  isSuppressed
} from './compaction-suppress.js'
import {
  extractCompactionStateSnapshot,
  buildCompactionStateRecoveryPrompt
} from './compaction-state-recovery.js'

export type HistoryCompactionServiceDeps = {
  sessionStore: SessionStore
  compactor: ContextCompactor
  prefix: ImmutablePrefix
  model: ModelClient
  usage: UsageService
  events: RuntimeEventRecorder
  ids: IdGenerator
  telemetry: Pick<LoopTelemetry, 'hydratePromptPressureIfCold' | 'consumePromptPressure'>
  recordGoalUsage: (threadId: string, tokens: number) => Promise<void>
  /** Read live runtime config so hot-apply affects future compactions. */
  getContextCompaction?: () => ContextCompactionConfig | undefined
  /** Read live runtime hooks so hot-apply affects future compactions. */
  getHooks?: () => readonly ResolvedHook[] | undefined
  clearReadTracker?: (threadId?: string) => void
  rewriteThreadItemsFromSession: (threadId: string) => Promise<void>
}

/**
 * Applies automatic history compaction through the revision-aware coordinator.
 * The service never retries model/tool work after a lost history CAS: only the
 * pure heuristic transform is rebuilt from the latest persisted snapshot.
 *
 * Borrowed from Grok Build: auto-compaction is gated by a multi-level
 * suppression state machine that prevents repeated futile compaction attempts
 * after deterministic failures (context overflow, auth expiry, persistent
 * model errors).
 */
export class HistoryCompactionService {
  /** Suppression level carried across calls for a given thread. */
  private suppression: SuppressionLevel = SUPPRESS_NONE
  /** Number of turns since STICKY suppression was activated. */
  private turnsSinceSuppressed = 0
  /** Incremented on each clearTurnSuppression call. */
  private turnCounter = 0

  constructor(private readonly deps: HistoryCompactionServiceDeps) {}

  /** Clear suppression at turn boundary (TURN-level clears automatically). */
  clearTurnSuppression(): void {
    this.turnCounter += 1
    if (this.suppression === SUPPRESS_NONE) {
      this.turnsSinceSuppressed = 0
    } else {
      this.turnsSinceSuppressed += 1
    }
    this.suppression = clearTurnSuppression(this.suppression)
  }

  /** Clear suppression after a successful model response. */
  clearOnSuccess(): void {
    // A healthy model response proves connectivity and credentials, so any
    // suppression level (including STICKY and AUTH) is released. Without this
    // reset a single transient failure would silence auto-compaction forever.
    this.suppression = clearSuppressOnSuccess(this.suppression)
    this.turnsSinceSuppressed = 0
  }

  /** Get the current suppression level for external inspection. */
  getSuppressionLevel(): SuppressionLevel {
    return this.suppression
  }

  async compactIfNeeded(input: {
    items: TurnItem[]
    model: string
    providerId?: string
    accountId?: string
    signal: AbortSignal
    threadId: string
    turnId: string
    toolSpecs?: readonly ModelToolSpec[]
    reserveModelRequest?: () => Promise<{ allowed: boolean; reason?: string }>
    /**
     * When set, force compaction toward this token budget even if the
     * estimate/threshold heuristics would not trigger (and regardless of the
     * suppression state). This is the "measured context overflow" safety net:
     * the loop composes a request, detects the real input exceeding the model
     * window, and re-issues a forced compaction before giving up.
     */
    forceBudgetTokens?: number
  }): Promise<TurnItem[]> {
    // Skip compaction when suppressed by a previous deterministic failure,
    // unless this is an explicit forced compaction for an overflow budget.
    // STICKY-level suppression auto-expires after STICKY_SUPPRESSION_TTL_TURNS
    // turns so that a retry is attempted once the context has changed.
    if (input.forceBudgetTokens === undefined && isSuppressed(this.suppression, this.turnsSinceSuppressed)) {
      return input.items
    }
    try {
    await this.deps.telemetry.hydratePromptPressureIfCold(input.threadId, input.model)
    const pressure = this.deps.telemetry.consumePromptPressure(input.threadId, input.model)
    const thresholdModel = pressure?.model || input.model
    const overheadTokens = estimateRequestOverheadTokens({
      systemPrompt: this.deps.prefix.systemPrompt,
      prefix: this.deps.prefix.fewShots,
      tools: input.toolSpecs
    })
    // Forced compaction ignores the soft/hard estimate thresholds and always
    // runs an aggressive keep-recent=1 pass to reclaim as much history as
    // possible within the requested budget.
    const plan = input.forceBudgetTokens !== undefined
      ? {
          mode: 'force',
          keepRecent: 1,
          reason: `forced compaction: request must fit a ${input.forceBudgetTokens}-token context window`
        } as CompactionPlan
      : this.deps.compactor.planCompaction(input.items, {
          model: thresholdModel,
          promptTokens: pressure?.promptTokens,
          overheadTokens
        })
    if (!plan) return input.items
    const hooks = this.deps.getHooks?.()
    if (hasHooksForPhase(hooks, 'PreCompact')) {
      const observed = await runObserverHooks(hooks, {
        phase: 'PreCompact',
        threadId: input.threadId,
        turnId: input.turnId,
        reason: String(plan.reason),
        mode: String(plan.mode)
      })
      await recordLifecycleHookWarnings(
        this.deps.events,
        { threadId: input.threadId, turnId: input.turnId },
        observed.warnings
      )
    }
    const summaryItemId = this.deps.ids.next('compaction')
    const committed = await rewriteItemHistoryWithRetry<{
      history: TurnItem[]
      result: ReturnType<ContextCompactor['compact']> | null
      foldedItems: TurnItem[]
    }>({
      sessionStore: this.deps.sessionStore,
      threadId: input.threadId,
      maxAttempts: 2,
      build: async (snapshot, attempt) => {
        const currentItems = repairModelHistoryItems(
          effectiveHistoryAfterLatestCompaction(snapshot.items)
        )
        const currentPlan = attempt === 1 || input.forceBudgetTokens !== undefined
          ? plan
          : this.deps.compactor.planCompaction(currentItems, {
              model: thresholdModel,
              overheadTokens
            })
        if (!currentPlan) {
          return {
            changed: false,
            items: snapshot.items,
            value: { history: currentItems, result: null, foldedItems: [] }
          }
        }
        let result = this.deps.compactor.compact({
          threadId: input.threadId,
          turnId: input.turnId,
          history: currentItems,
          prefix: this.deps.prefix,
          reason: currentPlan.reason,
          mode: currentPlan.mode,
          keepRecent: currentPlan.keepRecent,
          ...(input.forceBudgetTokens !== undefined
            ? { budgetTokens: input.forceBudgetTokens }
            : {}),
          summaryItemId
        })
        if (result.replacedTokens === 0) {
          return {
            changed: false,
            items: snapshot.items,
            value: { history: currentItems, result: null, foldedItems: [] }
          }
        }
        // A model summary generated for a stale snapshot must not be applied
        // to newer history. On retry the deterministic heuristic is used
        // instead of issuing a duplicate summarizer request.
        const contextCompaction = this.deps.getContextCompaction?.()
        // Forced overflow compaction must not issue a model summarizer request:
        // the summarizer could itself exceed the window. Heuristic summary only.
        const shouldUseModelSummary =
          attempt === 1 &&
          contextCompaction?.summaryMode === 'model' &&
          input.forceBudgetTokens === undefined
        if (shouldUseModelSummary) {
          if (input.signal.aborted) {
            return {
              changed: false,
              items: snapshot.items,
              value: { history: currentItems, result: null, foldedItems: [] }
            }
          }
          const compactionModel = resolveCompactionModel({
            contextCompaction,
            fallbackModel: input.model,
            fallbackProviderId: input.providerId,
            fallbackAccountId: input.accountId
          })
          const recordFallback = async (message: string): Promise<void> => {
            await this.deps.events.record({
              kind: 'error',
              threadId: input.threadId,
              turnId: input.turnId,
              message,
              code: 'compaction_summary_fallback',
              severity: 'warning'
            })
          }
          let modelSummary: string | undefined
          if (compactionModel.bindingError) {
            await recordFallback(compactionModel.bindingError)
          } else {
            const reservation = await input.reserveModelRequest?.() ?? { allowed: true }
            if (!reservation.allowed) {
              await recordFallback(
                reservation.reason
                  ? `${reservation.reason} Model compaction summary was not sent; using heuristic summary.`
                  : 'Model compaction summary skipped because its model-request budget is exhausted; using heuristic summary.'
              )
            } else {
              const foldedItemIds = new Set(
                result.summaryItem.kind === 'compaction'
                  ? result.summaryItem.sourceItemIds ?? []
                  : []
              )
              // The compaction summary is sent alongside the retained tail in
              // the main request. Feed only the folded source items to the
              // summarizer so the latest user instruction is not reproduced
              // inside both the summary and the verbatim tail.
              const summaryItems = currentItems.filter((item) => foldedItemIds.has(item.id))
              if (summaryItems.length === 0) {
                await recordFallback(
                  'Model compaction summary skipped because no folded source items were available; using heuristic summary.'
                )
              } else {
                modelSummary = await summarizeCompactionWithModel({
                  threadId: input.threadId,
                  turnId: input.turnId,
                  model: compactionModel.model,
                  ...(compactionModel.providerId ? { providerId: compactionModel.providerId } : {}),
                  ...(compactionModel.accountId ? { accountId: compactionModel.accountId } : {}),
                  modelClient: this.deps.model,
                  prefix: this.deps.prefix,
                  contextCompaction,
                  items: summaryItems,
                  pinnedSkillPins: extractSkillPins(summaryItems),
                  heuristicSummary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
                  signal: input.signal,
                  recordUsage: async (usageSnapshot) => {
                    const usage = this.deps.usage.record(input.threadId, usageSnapshot)
                    await this.deps.recordGoalUsage(input.threadId, usageSnapshot.totalTokens)
                    await this.deps.events.record({
                      kind: 'usage',
                      threadId: input.threadId,
                      turnId: input.turnId,
                      model: compactionModel.model,
                      usage
                    })
                  },
                  recordFallback
                })
              }
            }
          }
          if (input.signal.aborted) {
            return {
              changed: false,
              items: snapshot.items,
              value: { history: currentItems, result: null, foldedItems: [] }
            }
          }
          if (modelSummary) {
            result = this.deps.compactor.compact({
              threadId: input.threadId,
              turnId: input.turnId,
              history: currentItems,
              prefix: this.deps.prefix,
              reason: currentPlan.reason,
              mode: currentPlan.mode,
              keepRecent: currentPlan.keepRecent,
              summaryOverride: modelSummary,
              summaryItemId
            })
          }
        }
        // Keep the folded source items so the post-compaction state recovery
        // snapshot can be extracted from what was actually summarized.
        const foldedItemIds = new Set(
          result.summaryItem.kind === 'compaction' ? result.summaryItem.sourceItemIds ?? [] : []
        )
        const foldedItems = currentItems.filter((item) => foldedItemIds.has(item.id))
        return {
          changed: true,
          items: insertCompactionIntoVisibleHistory({
            visibleItems: snapshot.items,
            compactedItems: result.next,
            summaryItem: result.summaryItem
          }),
          value: { history: result.next, result, foldedItems }
        }
      }
    })
    if (committed.status === 'applied') {
      const result = committed.value.result
      if (result) {
        this.deps.clearReadTracker?.(input.threadId)
        await this.deps.rewriteThreadItemsFromSession(input.threadId)
        // Build state recovery prompt from the folded source items so the
        // first post-compaction request has key context (borrowed from Grok
        // Build's CompactionStateContext / <system-reminder> pattern).
        const snapshot = extractCompactionStateSnapshot(committed.value.foldedItems)
        const recoveryPrompt = buildCompactionStateRecoveryPrompt(
          snapshot,
          result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : ''
        )
        await this.deps.events.record({
          kind: 'compaction_completed',
          threadId: input.threadId,
          turnId: input.turnId,
          itemId: result.summaryItem.id,
          summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
          replacedTokens: result.replacedTokens,
          pinnedConstraints: this.deps.prefix.pinnedConstraints,
          ...(recoveryPrompt ? { stateRecovery: recoveryPrompt } : {}),
          ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceDigest
            ? { sourceDigest: result.summaryItem.sourceDigest }
            : {}),
          ...(result.summaryItem.kind === 'compaction' && result.summaryItem.digestMarker
            ? { digestMarker: result.summaryItem.digestMarker }
            : {}),
          ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
            ? { sourceItemIds: result.summaryItem.sourceItemIds }
            : {})
        })
      }
      return committed.value.history
    }
    if (committed.status === 'unchanged') return committed.value.history
    // Do not fall back to the stale input after a lost CAS race. The next
    // loop step can retry compaction from this current safe history.
    return repairModelHistoryItems(
      effectiveHistoryAfterLatestCompaction(await this.deps.sessionStore.loadItems(input.threadId))
    )
    } catch (error) {
      // Classify the failure and suppress auto-compaction accordingly.
      const message = error instanceof Error ? error.message : String(error)
      const isContextOverflow = /context.*(length|window|exceed|overflow)/i.test(message)
      const isAuthError = /\b(401|403|auth|unauthorized|forbidden)\b/i.test(message)
      this.suppression = classifyCompactionFailure({ message, isContextOverflow, isAuthError })
      this.turnsSinceSuppressed = 0
      await this.deps.events.record({
        kind: 'error',
        threadId: input.threadId,
        turnId: input.turnId,
        message: `Compaction failed (suppression level ${this.suppression}): ${message}`,
        code: 'compaction_suppressed',
        severity: 'warning'
      })
      return input.items
    }
  }
}
