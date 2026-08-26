/**
 * Context Fragment — 借鉴 Codex 的 ContextualUserFragment trait.
 *
 * 将上下文注入从扁平字符串数组升级为类型化片段管理。
 * 每个片段有独立的类型标记、角色、生命周期和优先级。
 *
 * 这是向 Codex 的 trait 系统靠拢的第一步：保持向后兼容
 * （现有 `contextInstructions: string[]` 仍然工作），同时引入
 * fragment 概念以支持未来的 state diff 和生命周期管理。
 */

/** 上下文片段的生命周期。 */
export type FragmentLifecycle =
  /** 仅当前 turn 有效（如 token budget hint）。 */
  | 'turn'
  /** 整个 session 有效（如 skill instructions）。 */
  | 'session'
  /** 跨 session 持久化（如 pinned constraints）。 */
  | 'persistent'

/** 上下文片段的类型标记。 */
export type FragmentKind =
  | 'token_budget'
  | 'compaction_state'
  | 'runtime_context'
  | 'skill'
  | 'memory'
  | 'goal'
  | 'plan_mode'
  | 'tool_catalog'
  | 'design_mode'
  | 'extension_profile'
  | 'verification'
  | 'user_input_disabled'
  | 'shell_instruction'
  | 'web_search_instruction'
  | 'error_recovery'
  | 'other'

/** 类型化的上下文片段。 */
export interface ContextFragment {
  /** 片段类型标记。 */
  kind: FragmentKind
  /** 片段内容（纯文本）。 */
  text: string
  /** 生命周期。 */
  lifecycle: FragmentLifecycle
  /** 注入优先级（数字越小越靠前）。 */
  priority: number
}

/**
 * 从上下文片段数组和/或传统字符串数组生成最终的 contextInstructions。
 * 向后兼容：如果只有 strings，行为不变。
 */
export function renderContextFragments(
  fragments: readonly ContextFragment[],
  legacyInstructions?: readonly string[]
): string[] {
  // 按优先级排序
  const sorted = [...fragments].sort((a, b) => a.priority - b.priority)
  const result: string[] = []
  for (const f of sorted) {
    if (f.text.trim().length > 0) {
      result.push(f.text)
    }
  }
  // 传统字符串追加到末尾（保持向后兼容）
  if (legacyInstructions) {
    result.push(...legacyInstructions)
  }
  return result
}

// ---------------------------------------------------------------------------
// 预定义优先级常量
// ---------------------------------------------------------------------------

export const PRIORITY_FIRST = 0
export const PRIORITY_RUNTIME_CONTEXT = 10
export const PRIORITY_TOKEN_BUDGET = 15
export const PRIORITY_COMPACTION_STATE = 20
export const PRIORITY_EXTENSION_PROFILE = 30
export const PRIORITY_GOAL = 40
export const PRIORITY_SKILL = 50
export const PRIORITY_MEMORY = 60
export const PRIORITY_PLAN_MODE = 70
export const PRIORITY_VERIFICATION = 80
export const PRIORITY_TOOL_CATALOG = 90
export const PRIORITY_INSTRUCTIONS = 100
export const PRIORITY_ERROR_RECOVERY = 110
export const PRIORITY_LAST = 999

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

export function createTokenBudgetFragment(text: string): ContextFragment {
  return { kind: 'token_budget', text, lifecycle: 'turn', priority: PRIORITY_TOKEN_BUDGET }
}

export function createCompactionStateFragment(text: string): ContextFragment {
  return { kind: 'compaction_state', text, lifecycle: 'turn', priority: PRIORITY_COMPACTION_STATE }
}

export function createRuntimeContextFragment(text: string): ContextFragment {
  return { kind: 'runtime_context', text, lifecycle: 'turn', priority: PRIORITY_RUNTIME_CONTEXT }
}

export function createSkillFragment(text: string): ContextFragment {
  return { kind: 'skill', text, lifecycle: 'session', priority: PRIORITY_SKILL }
}

export function createGoalFragment(text: string): ContextFragment {
  return { kind: 'goal', text, lifecycle: 'session', priority: PRIORITY_GOAL }
}

export function createMemoryFragment(text: string): ContextFragment {
  return { kind: 'memory', text, lifecycle: 'session', priority: PRIORITY_MEMORY }
}
