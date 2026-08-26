/**
 * Compaction summary cleaning pipeline.
 *
 * Ported from Grok Build's `xai-grok-compaction::code_compaction::summary`.
 * Strips drafting scratchpad (`<analysis>…</analysis>`), unwraps
 * `<summary>…</summary>` tags, neutralizes control tokens so they cannot
 * prime the next turn to re-emit stray blocks, and collapses excessive
 * blank lines.
 */

/**
 * Minimum cleaned summary length (chars) before it is considered degenerate.
 * Catches empty, whitespace-only, or single-word responses. Low threshold
 * because short conversations can legitimately produce compact summaries;
 * the real signal is truly empty or garbage output, not brevity.
 */
export const MIN_SUMMARY_SEED_CHARS = 20

/**
 * Clean the compaction model's raw output into a plain-text summary.
 *
 * Steps:
 * 1. Strip leading `<analysis>…</analysis>` drafting blocks.
 * 2. Unwrap `<summary>…</summary>` → `Summary:\n{inner}`.
 * 3. Neutralize control tokens echoed inside the body.
 * 4. Collapse excessive blank lines (3+ → 2).
 */
export function cleanCompactionSummary(raw: string): string {
  let result = raw

  // Step 1: Remove leading <analysis>…</analysis> drafting blocks.
  // A block is only stripped when it is genuinely LEADING (top-level, before
  // any <summary>, or immediately after <summary> open modulo whitespace).
  // An <analysis> quoted mid-body is NOT leading and is left for step 3 to
  // neutralize. The loop peels successive leading blocks should the model
  // emit more than one.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = result.indexOf('<analysis>')
    if (start === -1) break

    const summaryPos = result.indexOf('<summary>')
    const isLeading =
      summaryPos === -1
        ? result.slice(0, start).trim().length === 0
        : start < summaryPos ||
          result.slice(summaryPos + '<summary>'.length, start).trim().length === 0

    if (!isLeading) break

    const closePos = result.indexOf('</analysis>', start)
    if (closePos !== -1) {
      const end = closePos + '</analysis>'.length
      result = result.slice(0, start) + result.slice(end)
    } else {
      // Unclosed leading <analysis>: drop up to the next <summary> or end.
      const dropTo = result.indexOf('<summary>', start)
      if (dropTo !== -1) {
        result = result.slice(0, start) + result.slice(dropTo)
      } else {
        result = result.slice(0, start)
      }
      break
    }
  }

  // Step 2: Unwrap <summary>…</summary> → "Summary:\n{inner}".
  const summaryOpen = result.indexOf('<summary>')
  const summaryClose = result.lastIndexOf('</summary>')
  if (summaryOpen !== -1 && summaryClose !== -1 && summaryClose > summaryOpen) {
    const before = result.slice(0, summaryOpen)
    const after = result.slice(summaryClose + '</summary>'.length)
    const inner = stripLeadingScratchpad(
      result.slice(summaryOpen + '<summary>'.length, summaryClose).trim()
    )
    result = `${before}Summary:\n${inner}${after}`
  }

  // Step 3: Neutralize control tokens echoed inside the body.
  result = neutralizeControlTokens(result)

  // Step 4: Collapse excessive blank lines.
  while (result.includes('\n\n\n')) {
    result = result.replace(/\n\n\n+/g, '\n\n')
  }

  return result.trim()
}

/**
 * True when the cleaned summary seed is too small to plausibly carry the
 * task state of the conversation it would replace. Callers should retry
 * like a transient failure.
 */
export function isDegenerateSummary(rawSummary: string): boolean {
  return cleanCompactionSummary(rawSummary).length < MIN_SUMMARY_SEED_CHARS
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Peel leading drafting scratchpad off an extracted `<summary>` block.
 * A markdown `**Analysis**`-style header has no opening `<analysis>` tag for
 * step 1 to catch; it ends at an orphan `</analysis>`. Everything up to and
 * including the *last* `</analysis>` is dropped.
 */
function stripLeadingScratchpad(inner: string): string {
  let s = inner.trim()
  const lead = s.replace(/^[\s#*\->\t]+/, '')
  if (!lead.match(/^\d/) && s.lastIndexOf('</analysis>') !== -1) {
    const pos = s.lastIndexOf('</analysis>')
    s = s.slice(pos + '</analysis>'.length).trimStart()
  }
  if (s.startsWith('<summary>')) {
    s = s.slice('<summary>'.length).trimStart()
  }
  return s
}

/**
 * Neutralize compaction-control tokens echoed inside a summary body by
 * inserting a zero-width space after `<`, so they can't be read as live
 * tags by the next turn. Closers first so the inserted sentinel never
 * re-matches.
 */
function neutralizeControlTokens(text: string): string {
  return text
    .replace(/<\/summary>/g, '<\u200B/summary>')
    .replace(/<summary>/g, '<\u200Bsummary>')
    .replace(/<\/analysis>/g, '<\u200B/analysis>')
    .replace(/<analysis>/g, '<\u200Banalysis>')
    .replace(/<\/summary_request>/g, '<\u200B/summary_request>')
    .replace(/<summary_request>/g, '<\u200Bsummary_request>')
}
