/**
 * Token Budget Context — 借鉴 Codex 的 TokenBudgetContext / TokenBudgetRemainingContext.
 *
 * 在每次 model request 中注入剩余 token 数，让模型感知 context 空间，
 * 主动控制输出长度。Codex 的研究表明这是最简单且高价值的改进。
 */

import type { ModelRequest } from '../ports/model-client.js'

export type TokenBudgetContextOptions = {
  /** 上下文窗口总大小（tokens）。 */
  contextWindowTokens: number
  /** 已用的 input tokens（含 system prompt、prefix、history、tools）。 */
  inputTokens: number
  /** 分配给 output 的 token 预算。 */
  outputBudgetTokens: number
  /** 当前 turn 编号（从 0 开始）。 */
  turnIndex?: number
  /** 是否是压缩后的第一个 turn。 */
  isFirstAfterCompaction?: boolean
}

/**
 * 计算剩余 token 并生成提示文本。
 * 返回 `undefined` 当剩余空间充裕（> 30%）时不注入，避免噪音。
 */
export function buildTokenBudgetHint(options: TokenBudgetContextOptions): string | undefined {
  const { contextWindowTokens, inputTokens, outputBudgetTokens, isFirstAfterCompaction } = options

  if (contextWindowTokens <= 0) return undefined

  const totalBudget = inputTokens + outputBudgetTokens
  const remaining = Math.max(0, contextWindowTokens - totalBudget)
  const usagePercent = Math.round((totalBudget / contextWindowTokens) * 100)

  // 只在空间紧张（> 70% 已用）或压缩后第一个 turn 时注入
  if (usagePercent < 70 && !isFirstAfterCompaction) return undefined

  const lines: string[] = []

  if (isFirstAfterCompaction) {
    lines.push(
      `This context window has been compacted. You have approximately ${formatTokens(remaining)} tokens remaining.`
    )
    lines.push('Previous conversation history has been summarized above. Continue the work from where it left off.')
  } else if (usagePercent >= 90) {
    lines.push(
      `Context usage is at ${usagePercent}%. Approximately ${formatTokens(remaining)} tokens remaining. ` +
      'Be concise. Prefer essential details over exhaustive explanations.'
    )
  } else {
    lines.push(
      `Context usage: ${usagePercent}%. Approximately ${formatTokens(remaining)} tokens remaining.`
    )
  }

  return lines.join(' ')
}

/**
 * 将 token budget hint 注入到 model request 的 contextInstructions 中。
 * 不修改原始 request，返回新对象。
 */
export function injectTokenBudgetContext(
  request: ModelRequest,
  options: TokenBudgetContextOptions
): ModelRequest {
  const hint = buildTokenBudgetHint(options)
  if (!hint) return request

  return {
    ...request,
    contextInstructions: [...(request.contextInstructions ?? []), hint]
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}
