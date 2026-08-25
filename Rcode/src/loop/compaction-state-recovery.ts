/**
 * Compaction State Recovery — 借鉴 Grok Build 的 CompactionStateContext / system-reminder.
 *
 * 压缩后重建关键运行状态：编辑过的文件、活跃 goals、TODO、skills。
 * Grok Build 通过 `<system-reminder>` 动态 state diff 实现；
 * Codex 通过 WorldState diff + reference_context_item baseline 实现。
 *
 * Rcode 的实现：从被折叠的 history items 中提取关键状态，
 * 生成结构化的 state reminder 注入到压缩后的第一个请求中。
 */

import type { TurnItem } from '../contracts/items.js'

/** 压缩后需要恢复的关键状态。 */
export type CompactionStateSnapshot = {
  /** 本轮中被编辑/创建的文件路径。 */
  editedFiles: string[]
  /** 最近的 error 信息（帮助模型避免重复错误）。 */
  recentErrors: string[]
  /** 最近的 tool 调用摘要。 */
  recentToolCalls: string[]
  /** 用户消息摘要（保留意图）。 */
  userMessageSummary: string[]
}

/**
 * 从被压缩的 history items 中提取关键状态快照。
 * 在 compaction 完成后调用，为下一个请求生成 state recovery prompt。
 */
export function extractCompactionStateSnapshot(
  items: readonly TurnItem[]
): CompactionStateSnapshot {
  const editedFiles = new Set<string>()
  const recentErrors: string[] = []
  const recentToolCalls: string[] = []
  const userMessageSummary: string[] = []

  for (const item of items) {
    switch (item.kind) {
      case 'tool_call': {
        // 只统计真正的写操作：read ≠ modified，把 read 路径混入会误导后续
        // 模型去“继续编辑”只读过的文件。
        if (item.toolName === 'write' || item.toolName === 'edit') {
          const path = extractPathFromArguments(item.arguments)
          if (path) editedFiles.add(path)
        }
        // 保留最近的 tool 调用摘要
        if (item.summary) {
          recentToolCalls.push(`${item.toolName}: ${item.summary.slice(0, 200)}`)
        }
        break
      }
      case 'tool_result': {
        if (item.isError) {
          const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output)
          recentErrors.push(`${item.toolName}: ${output.slice(0, 300)}`)
        }
        break
      }
      case 'user_message': {
        // 保留用户消息的第一行作为意图摘要
        const firstLine = item.text.split('\n')[0]?.trim()
        if (firstLine) {
          userMessageSummary.push(clipText(firstLine, 300))
        }
        break
      }
    }
  }

  return {
    editedFiles: [...editedFiles].slice(-10), // 只保留最近 10 个
    recentErrors: recentErrors.slice(-5),
    recentToolCalls: recentToolCalls.slice(-8),
    userMessageSummary
  }
}

/**
 * 从被压缩的历史中生成 state recovery prompt。
 * 注入到压缩后第一个请求的 contextInstructions 中。
 */
export function buildCompactionStateRecoveryPrompt(
  snapshot: CompactionStateSnapshot,
  summaryText: string
): string | undefined {
  const lines: string[] = []

  // 关键：提取摘要中的文件路径和决策
  const extractedFiles = extractFilesFromSummary(summaryText)
  if (extractedFiles.length > 0) {
    lines.push(`Files involved in prior work: ${extractedFiles.join(', ')}`)
  }

  // 提取摘要中的错误/问题
  const extractedErrors = extractErrorsFromSummary(summaryText)
  if (extractedErrors.length > 0) {
    lines.push(`Known issues from prior work: ${extractedErrors.join('; ')}`)
  }

  // 最近的 tool 调用上下文
  if (snapshot.recentToolCalls.length > 0) {
    lines.push(`Last actions before compaction: ${snapshot.recentToolCalls.slice(-3).join(' → ')}`)
  }

  // 编辑过的文件
  if (snapshot.editedFiles.length > 0) {
    lines.push(`Files modified in this session: ${snapshot.editedFiles.join(', ')}`)
  }

  // 用户原始意图：压缩后最容易被丢失的信息，优先保留。
  if (snapshot.userMessageSummary.length > 0) {
    lines.push(
      `User instructions from before compaction: ${snapshot.userMessageSummary.slice(-5).join(' | ')}`
    )
  }

  if (lines.length === 0) return undefined

  return [
    '## Prior Session State (recovered after compaction)',
    ...lines,
    'Continue the work from where it left off. Do not re-do work already completed.'
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractPathFromArguments(args: unknown): string | undefined {
  if (typeof args === 'string') {
    const pathMatch = args.match(/(?:\/[\w./-]+\.\w{1,10}|\.\/[\w./-]+)/)
    return pathMatch?.[0]
  }
  if (args && typeof args === 'object') {
    const record = args as Record<string, unknown>
    for (const key of ['path', 'file_path', 'target_file', 'filePath', 'filename']) {
      if (typeof record[key] === 'string' && record[key]) {
        return record[key] as string
      }
    }
  }
  return undefined
}

function extractFilesFromSummary(summary: string): string[] {
  const files = new Set<string>()
  const backtickPaths = summary.matchAll(/`([^`]*\/[^`]+\.\w{1,10})`/g)
  for (const match of backtickPaths) {
    files.add(match[1])
  }
  const standalonePaths = summary.matchAll(/(?:^|\s)([\/\.][\w./-]+\.\w{1,10})\b/gm)
  for (const match of standalonePaths) {
    files.add(match[1])
  }
  return [...files].slice(0, 15)
}

function extractErrorsFromSummary(summary: string): string[] {
  const errors: string[] = []
  const lines = summary.split('\n')
  for (const line of lines) {
    if (/\b(?:error|failed|exception|bug|issue|problem)\b/i.test(line)) {
      const clipped = clipText(line.trim(), 200)
      if (clipped.length > 10) {
        errors.push(clipped)
      }
    }
  }
  return errors.slice(0, 5)
}

function clipText(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
}
