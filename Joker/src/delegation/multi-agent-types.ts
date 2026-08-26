/**
 * Multi-Agent Collaboration Enhancements — 借鉴 Grok Build + Codex.
 *
 * 1. Depth Nesting Limit（Grok Build）：防止无限递归子代理
 * 2. Structured Completion Message（Codex）：跨代理结构化完成消息
 * 3. Subagent Profile Enhancements：personas + model overrides
 */

import type { ChildRunRecord, ChildReturnFormat } from './delegation-runtime.js'

// ---------------------------------------------------------------------------
// 1. Depth Nesting Limit（借鉴 Grok Build subagents_max_depth）
// ---------------------------------------------------------------------------

/** 子代理最大嵌套深度。0 = 只允许顶层代理，1 = 允许一层子代理。 */
export const DEFAULT_MAX_SUBAGENT_DEPTH = 3

/**
 * 检查当前深度是否允许创建新的子代理。
 * 借鉴 Grok Build 的 `parent_depth + 1 < subagents_max_depth` 模式。
 */
export function canSpawnSubagent(
  currentDepth: number,
  maxDepth: number = DEFAULT_MAX_SUBAGENT_DEPTH
): { allowed: boolean; reason?: string } {
  if (currentDepth >= maxDepth) {
    return {
      allowed: false,
      reason: `Subagent depth limit reached (${currentDepth}/${maxDepth}). Cannot spawn nested subagents beyond this depth.`
    }
  }
  return { allowed: true }
}

/**
 * 嵌套子代理时递增深度。
 * 父代理 depth=0 时创建的子代理 depth=1，以此类推。
 */
export function incrementDepth(parentDepth: number): number {
  return parentDepth + 1
}

// ---------------------------------------------------------------------------
// 2. Structured Completion Message（借鉴 Codex InterAgentCompletionMessage）
// ---------------------------------------------------------------------------

export type InterAgentMessageKind =
  | 'FINAL_ANSWER'     // 子代理完成，返回最终结果
  | 'STATUS_UPDATE'    // 子代理中间状态更新
  | 'ERROR'            // 子代理报告错误
  | 'REQUEST_PARENT'   // 子代理请求父代理操作

export type InterAgentCompletionMessage = {
  /** 消息类型。 */
  kind: InterAgentMessageKind
  /** 子代理 ID。 */
  childId: string
  /** 父线程 ID。 */
  parentThreadId: string
  /** 可选的 label。 */
  label?: string
  /** 可选的 profile。 */
  profile?: string
  /** 消息负载。 */
  payload: string
  /** 使用统计。 */
  usage?: {
    totalTokens: number
    durationMs?: number
    toolInvocations?: number
  }
}

/**
 * 构建结构化的子代理完成消息。
 * 借鉴 Codex 的 InterAgentCompletionMessage 格式。
 */
export function buildInterAgentCompletionMessage(input: {
  childRecord: ChildRunRecord
  format?: ChildReturnFormat
}): InterAgentCompletionMessage {
  const { childRecord, format = 'summary' } = input

  const kind: InterAgentMessageKind =
    childRecord.status === 'completed' ? 'FINAL_ANSWER' :
    childRecord.status === 'failed' ? 'ERROR' :
    'STATUS_UPDATE'

  const payload = format === 'evidence' && childRecord.evidence
    ? [
        childRecord.summary ? `Summary: ${childRecord.summary}` : '',
        '',
        'Evidence:',
        ...childRecord.evidence.map(e => `- ${e}`)
      ].filter(Boolean).join('\n')
    : childRecord.summary ?? childRecord.error ?? '(no output)'

  return {
    kind,
    childId: childRecord.id,
    parentThreadId: childRecord.parentThreadId,
    label: childRecord.label,
    profile: childRecord.profile,
    payload,
    usage: {
      totalTokens: childRecord.usage.totalTokens,
      durationMs: childRecord.durationMs,
      toolInvocations: childRecord.toolInvocations
    }
  }
}

/**
 * 格式化结构化完成消息为模型可读的文本。
 * 注入到父代理的下一次请求中。
 */
export function formatInterAgentMessageForParent(
  message: InterAgentCompletionMessage
): string {
  const lines: string[] = []

  const label = message.label || message.profile || 'subagent'
  const status = message.kind === 'FINAL_ANSWER' ? 'completed' :
    message.kind === 'ERROR' ? 'failed' : 'status update'

  lines.push(`## Sub-agent Result: ${label} (${status})`)
  lines.push(`- Child ID: ${message.childId}`)

  if (message.usage) {
    const parts: string[] = []
    parts.push(`${message.usage.totalTokens.toLocaleString()} tokens`)
    if (message.usage.durationMs) parts.push(`${Math.round(message.usage.durationMs / 1000)}s`)
    if (message.usage.toolInvocations) parts.push(`${message.usage.toolInvocations} tool calls`)
    lines.push(`- Usage: ${parts.join(', ')}`)
  }

  lines.push('')
  lines.push(message.payload)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 3. Enhanced Profile System（借鉴 Grok Build subagent_personas + model overrides）
// ---------------------------------------------------------------------------

export type SubagentPersonality = {
  /** 人格名称。 */
  name: string
  /** 系统提示词追加。 */
  systemPromptAppend?: string
  /** 推荐的 reasoning effort。 */
  reasoningEffort?: string
  /** 工具偏好（allow-list 或 deny-list）。 */
  toolPreferences?: {
    allow?: string[]
    block?: string[]
  }
}

export type ModelOverrideRule = {
  /** 匹配条件：profile 名称或正则。 */
  profilePattern: string
  /** 覆盖的模型。 */
  model: string
  /** 可选的 provider。 */
  providerId?: string
}

/**
 * 解析子代理的 model override。
 * 借鉴 Grok Build 的 subagent_model_overrides 机制。
 */
export function resolveSubagentModelOverride(
  profile: string | undefined,
  rules: readonly ModelOverrideRule[],
  fallbackModel: string,
  fallbackProviderId?: string
): { model: string; providerId?: string } {
  if (!profile) return { model: fallbackModel, providerId: fallbackProviderId }

  for (const rule of rules) {
    // 简单字符串匹配（生产环境可扩展为正则）
    if (profile.toLowerCase() === rule.profilePattern.toLowerCase()) {
      return { model: rule.model, providerId: rule.providerId ?? fallbackProviderId }
    }
  }
  return { model: fallbackModel, providerId: fallbackProviderId }
}

/**
 * 注入人格指令到子代理的 prompt preamble 中。
 */
export function applyPersonality(
  basePrompt: string,
  personality: SubagentPersonality | undefined
): string {
  if (!personality?.systemPromptAppend) return basePrompt
  return `${basePrompt}\n\n${personality.systemPromptAppend}`
}
