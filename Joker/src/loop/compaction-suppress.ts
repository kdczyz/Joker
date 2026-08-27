/**
 * Multi-level compaction suppression state machine.
 *
 * Ported from Grok Build's `CompactionConfig.auto_compact_suppressed`.
 * Prevents repeated futile compaction attempts after deterministic failures
 * (e.g. context overflow, auth expiry, persistent model errors).
 *
 * Suppression levels (from least to most persistent):
 * - NONE:      normal operation
 * - TURN:      suppressed for the current turn only; cleared at next turn start
 * - STICKY:    survives turn boundaries; cleared only on context budget change
 *              (successful compaction, rewind, or model switch)
 * - AUTH:      survives until login/token refresh or a successful model
 *              response proves credentials work again
 */

export const SUPPRESS_NONE = 0 as const
export const SUPPRESS_TURN = 1 as const
export const SUPPRESS_STICKY = 2 as const
export const SUPPRESS_AUTH = 3 as const

export type SuppressionLevel =
  | typeof SUPPRESS_NONE
  | typeof SUPPRESS_TURN
  | typeof SUPPRESS_STICKY
  | typeof SUPPRESS_AUTH

/**
 * Maximum number of turns a STICKY suppression persists before being
 * automatically released. After this many turns the context may have
 * changed enough (new user messages, different tool results) that a
 * retry is worthwhile. This prevents a single compaction failure from
 * permanently silencing auto-compaction for the rest of the session.
 */
export const STICKY_SUPPRESSION_TTL_TURNS = 3

/**
 * Classifies a compaction failure into the appropriate suppression level.
 */
export function classifyCompactionFailure(error: {
  message?: string
  code?: string
  statusCode?: number
  isContextOverflow?: boolean
  isAuthError?: boolean
}): SuppressionLevel {
  if (error.isAuthError || error.statusCode === 401 || error.statusCode === 403) {
    return SUPPRESS_AUTH
  }
  if (error.isContextOverflow) {
    return SUPPRESS_STICKY
  }
  // Deterministic errors that won't resolve without intervention
  if (
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    error.statusCode !== 429
  ) {
    return SUPPRESS_STICKY
  }
  if (error.code === 'context_length_exceeded' || error.code === 'max_tokens_exceeded') {
    return SUPPRESS_STICKY
  }
  // Transient errors: suppress for this turn only
  return SUPPRESS_TURN
}

/**
 * Returns true when auto-compaction should be suppressed at the given
 * level. Pass `turnsSinceSuppressed` to enable TTL-based expiry for
 * STICKY suppression: after {@link STICKY_SUPPRESSION_TTL_TURNS} turns
 * the suppression is automatically released so that a retry is attempted
 * with the (potentially changed) context.
 */
export function isSuppressed(
  level: SuppressionLevel,
  turnsSinceSuppressed?: number
): boolean {
  if (level === SUPPRESS_NONE) return false
  if (level === SUPPRESS_STICKY && turnsSinceSuppressed !== undefined) {
    return turnsSinceSuppressed < STICKY_SUPPRESSION_TTL_TURNS
  }
  return true
}

/**
 * Clear suppression level after a turn boundary.
 * TURN-level is always cleared; deeper levels persist.
 */
export function clearTurnSuppression(level: SuppressionLevel): SuppressionLevel {
  if (level === SUPPRESS_TURN) return SUPPRESS_NONE
  return level
}

/**
 * Clear suppression after a successful compaction or context budget change.
 * Clears STICKY and TURN; AUTH and UNTIL_SUCCESS persist until their
 * specific resolution.
 */
export function clearOnContextChange(level: SuppressionLevel): SuppressionLevel {
  if (level === SUPPRESS_TURN || level === SUPPRESS_STICKY) return SUPPRESS_NONE
  return level
}

/**
 * Clear suppression after a successful model response. A healthy response
 * proves both connectivity and credentials, so every suppression level is
 * released (including AUTH).
 */
export function clearOnSuccess(_level: SuppressionLevel): SuppressionLevel {
  return SUPPRESS_NONE
}

/**
 * Clear suppression after auth refresh / login.
 * Clears AUTH and TURN.
 */
export function clearOnAuthRefresh(level: SuppressionLevel): SuppressionLevel {
  if (level === SUPPRESS_AUTH || level === SUPPRESS_TURN) return SUPPRESS_NONE
  return level
}
