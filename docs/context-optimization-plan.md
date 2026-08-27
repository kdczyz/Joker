# 上下文处理机制优化方案

## 问题诊断

基于完整 pipeline 分析，定位到 6 个核心瓶颈：

| # | 问题 | 影响 | 严重度 |
|---|------|------|--------|
| P1 | Token Economy 默认关闭 | 工具描述/schema 原样发送，~15K+ tokens 未压缩 | 🔴 高 |
| P2 | History Hygiene 只清理当前 Turn | 历史 turn 的工具结果（read/grep/bash 输出）完整保留在发送历史中 | 🔴 高 |
| P3 | Context Instructions 无优先级 | 15+ 来源的指令无条件全部注入，即使大部分当前不相关 | 🟡 中 |
| P4 | Compaction 触发偏晚 | softThreshold=96K（128K 模型），但 tool schema + system prompt 就占 ~15K+ | 🟡 中 |
| P5 | Suppression STICKY 级别过激 | 一次 compaction 失败就 STICKY，阻塞后续所有 turn 的自动压缩 | 🟡 中 |
| P6 | Forced compaction 只重试 1 次 | 超限后尝试一次 forced compaction，失败即放弃 | 🟢 低 |

---

## 方案设计

### 方案 1：默认开启 Token Economy 压缩（P1）

**目标**：降低每个请求的工具 schema + 历史工具结果的 token 开销

**文件**：`Joker/src/loop/token-economy.ts`

```typescript
// 改动前
export const DEFAULT_TOKEN_ECONOMY_CONFIG: NormalizedTokenEconomyConfig = {
  enabled: false,
  compressToolDescriptions: true,
  compressToolResults: true,
  conciseResponses: true,
  historyHygiene: {
    maxCumulativeToolResultTokens: 120_000,
    keepRecentToolResults: 4
  }
}

// 改动后：分层默认值
export const DEFAULT_TOKEN_ECONOMY_CONFIG: NormalizedTokenEconomyConfig = {
  enabled: false,  // 保持关闭（由调用方决定是否启用完整 economy）
  compressToolDescriptions: true,
  compressToolResults: false,   // 历史工具结果不压缩（保留完整上下文给模型）
  conciseResponses: false,      // 不强制简洁（尊重用户风格偏好）
  historyHygiene: {
    maxCumulativeToolResultTokens: 120_000,
    keepRecentToolResults: 4
  }
}
```

**但更重要的是**——在 `model-step-service.ts` 中，**始终启用工具描述压缩**，不受 `tokenEconomy.enabled` 控制：

```typescript
// model-request-composer.ts 改动
export function composeModelRequest(input: ModelRequestComposerInput): ComposedModelRequest {
  const tokenEconomy = normalizeTokenEconomyConfig(input.tokenEconomy)

  // 始终压缩工具描述（schema 是重复发送的最大 token 消耗者）
  const toolsWithCompressedDescriptions = input.tools.map(compactToolSpec)

  const baseRequest: ModelRequest = {
    // ...
    tools: toolsWithCompressedDescriptions,  // 改：始终压缩描述
    // ...
  }
  // ...
}
```

**预期收益**：工具描述压缩可节省 ~30-50% 的 tool schema tokens（35+ 工具的 JSON Schema 描述）。

**风险**：低。`compressProse` 保留了代码标识符、路径、URL 等技术内容，只压缩自然语言描述。

---

### 方案 2：跨 Turn 累积工具结果预算（P2）

**目标**：历史 turn 的大工具结果也能被渐进式裁剪

**文件**：`Joker/src/loop/request-history-hygiene.ts`

**当前问题**：`shouldCleanItem` 只清理 `currentTurnId` 的 item：

```typescript
function shouldCleanItem(item: TurnItem, scope: RequestHistoryHygieneScope): boolean {
  return !scope.currentTurnId || item.turnId === scope.currentTurnId
}
```

**改动方案**：添加跨 turn 的累积预算清理

```typescript
// 新增：applyCrossTurnHygiene
export type RequestHistoryHygieneOptions = {
  // ... 现有字段 ...
  /**
   * 累积 token 预算覆盖所有历史 turn 的工具结果。
   * 旧的工具结果（按时间从旧到新）在预算耗尽后被折叠为摘要。
   * 这是防止长 session 历史无限膨胀的安全网。
   */
  maxCrossTurnToolResultTokens?: number
  keepRecentCrossTurnToolResults?: number
}

const DEFAULT_MAX_CROSS_TURN_TOOL_RESULT_TOKENS = 80_000
const DEFAULT_KEEP_RECENT_CROSS_TURN_TOOL_RESULTS = 8

function applyCrossTurnBudget(
  items: TurnItem[],
  limits: Required<RequestHistoryHygieneOptions>,
  scope: RequestHistoryHygieneScope
): TurnItem[] {
  const crossTurnBudget = limits.maxCrossTurnToolResultTokens
  if (crossTurnBudget <= 0) return items

  // 收集所有历史 turn 的 tool_result（排除当前 turn）
  const historicalToolResults: number[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'tool_result' && item.turnId !== scope.currentTurnId) {
      historicalToolResults.push(i)
    }
  }
  if (historicalToolResults.length === 0) return items

  // 保留最近 N 个历史 turn 的结果，其余按预算裁剪
  const alwaysKeep = new Set(historicalToolResults.slice(-limits.keepRecentCrossTurnToolResults))
  let used = 0
  const collapse = new Set<number>()

  // 从最旧到最新遍历（与 applyCumulativeToolResultBudget 相反方向）
  for (const index of historicalToolResults) {
    const item = items[index]
    if (item.kind !== 'tool_result') continue
    if (isModelVisibleImageOutput(item.output)) {
      used += IMAGE_TOOL_RESULT_TOKEN_ESTIMATE
      continue
    }
    const cost = estimateTokens(stringifyOutput(item.output))
    if (alwaysKeep.has(index)) {
      used += cost
      continue
    }
    if (used + cost <= crossTurnBudget) {
      used += cost
      continue
    }
    collapse.add(index)
  }

  if (collapse.size === 0) return items
  return items.map((item, index) => {
    if (!collapse.has(index) || item.kind !== 'tool_result') return item
    return {
      ...item,
      output: digestStaleToolResult(item.toolName, item.isError, item.output)
    }
  })
}
```

**在 `composeModelRequest` 中集成**：

```typescript
// model-request-composer.ts
const request: ModelRequest = {
  ...economyRequest,
  history: applyRequestHistoryHygiene(
    economyRequest.history,
    tokenEconomy.historyHygiene,
    { currentTurnId: input.turnId }
  )
}
// 新增：跨 turn 清理（在 token economy 之后）
const crossTurnCleaned: ModelRequest = {
  ...request,
  history: applyCrossTurnBudget(
    request.history,
    {
      ...tokenEconomy.historyHygiene,
      maxCrossTurnToolResultTokens: 80_000,
      keepRecentCrossTurnToolResults: 8
    },
    { currentTurnId: input.turnId }
  )
}
```

**预期收益**：长 session 中累积的数十个工具结果可从 ~100K+ tokens 降至 ~80K tokens。

**风险**：中。被折叠的旧工具结果无法恢复，但 `digestStaleToolResult` 会生成摘要提示模型"重新运行工具或使用更窄的范围"。

---

### 方案 3：Context Instructions 分级注入（P3）

**目标**：按优先级筛选 context instructions，避免每次都注入全部 15+ 来源

**文件**：`Joker/src/loop/model-step-service.ts`

**当前问题**：所有 context instructions 无条件注入

**改动方案**：引入指令优先级和 token 预算

```typescript
// 新文件：Joker/src/loop/context-instruction-priority.ts

export type ContextInstructionPriority = 'critical' | 'high' | 'medium' | 'low'

export type PrioritizedInstruction = {
  text: string
  priority: ContextInstructionPriority
  source: string
}

/**
 * 按优先级和 token 预算筛选 context instructions。
 * critical 和 high 总是注入；medium 和 low 在 token 预算充足时注入。
 */
export function selectInstructionsByBudget(
  instructions: PrioritizedInstruction[],
  budgetTokens: number
): string[] {
  const sorted = [...instructions].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 }
    return order[a.priority] - order[b.priority]
  })

  const selected: string[] = []
  let usedTokens = 0
  let budgetExhausted = false

  for (const inst of sorted) {
    if (inst.priority === 'critical' || inst.priority === 'high') {
      selected.push(inst.text)
      usedTokens += estimateInstructionTokens(inst.text)
      continue
    }
    // medium 和 low 受预算约束
    if (budgetExhausted) continue
    const cost = estimateInstructionTokens(inst.text)
    if (usedTokens + cost <= budgetTokens) {
      selected.push(inst.text)
      usedTokens += cost
    } else {
      budgetExhausted = true
    }
  }
  return selected
}
```

**在 `model-step-service.ts` 中重构 contextInstructions 构建**：

```typescript
const prioritizedInstructions: PrioritizedInstruction[] = [
  // critical: 始终注入
  { text: runtimeContextInstruction, priority: 'critical', source: 'runtime_context' },
  { text: activeGoalInstruction, priority: 'critical', source: 'active_goal' },
  { text: activeTodoInstruction, priority: 'critical', source: 'active_todo' },

  // high: 几乎总是注入
  { text: instructionResolution.instruction, priority: 'high', source: 'instructions' },
  { text: memoryInstructions(memories), priority: 'high', source: 'memories' },
  { text: skillResolution.catalogInstruction, priority: 'high', source: 'skill_catalog' },
  ...skillResolution.instructions.map(i => ({
    text: i, priority: 'high' as const, source: 'skill_instruction'
  })),

  // medium: 条件性注入
  { text: buildToolPreferenceInstruction(requestToolSpecs), priority: 'medium', source: 'tool_preference' },
  { text: shellRuntimeInstruction(), priority: 'medium', source: 'shell_runtime' },
  { text: buildWebSearchProactiveInstruction(), priority: 'medium', source: 'web_search' },

  // low: 预算充足时注入
  { text: goalRecoveryInstruction, priority: 'low', source: 'goal_recovery' },
  { text: emptyPostToolRecoveryInstruction(emptyPostToolRecoveryStep), priority: 'low', source: 'tool_recovery' },
  { text: verificationSuggestionInstruction(), priority: 'low', source: 'verification' },
  { text: toolCatalogDriftMessage, priority: 'low', source: 'tool_drift' },
  { text: buildExtensionProfileInstruction(...), priority: 'medium', source: 'extension_profile' },
]

// 被截断的指令记录到 telemetry
const contextInstructions = selectInstructionsByBudget(
  prioritizedInstructions,
  4_000  // 4K token 预算给 context instructions
)
```

**预期收益**：context instructions 从 ~5K+ tokens 降至 ~3K tokens。

**风险**：低。critical/high 优先级保证了核心功能不受影响。

---

### 方案 4：更早触发 Compaction（P4）

**目标**：在 context 增长到 softThreshold 之前就开始预压缩

**文件**：`Joker/src/loop/context-compactor.ts`

**当前问题**：softThreshold=96K，但 overhead（system prompt + tools + prefix）可能已经占了 15K+

**改动方案**：降低 softThreshold 并引入"预压缩"模式

```typescript
// model-context-profile.ts 改动
const DEFAULT_CONTEXT_THRESHOLDS: ContextProfileThresholds = {
  softThreshold: Math.floor(DEFAULT_CONTEXT_WINDOW_TOKENS * 0.65),  // 从 0.75 降至 0.65 = 83,200
  hardThreshold: Math.floor(DEFAULT_CONTEXT_WINDOW_TOKENS * 0.80)   // 从 0.85 降至 0.80 = 102,400
}

// 对 DeepSeek V4 也相应调整
const DEEPSEEK_V4_SOFT_THRESHOLD_RATIO = 0.65  // 从 0.75 降至 0.65
const DEEPSEEK_V4_HARD_THRESHOLD_RATIO = 0.80  // 从 0.85 降至 0.80
```

**同时改进 overhead 估算**：

```typescript
// context-compactor.ts planCompaction 改进
planCompaction(items: readonly TurnItem[], options: CompactionTriggerOptions): CompactionPlan | null {
  const overhead = options.overheadTokens ?? 0
  const providerTokens = options.promptTokens

  // 新增：使用 overhead 调整后的阈值
  // 如果 overhead 很大（>10K），实际可用的 history 空间更小
  const adjustedSoft = Math.max(
    this.softThreshold,
    Math.floor(overhead + (this.softThreshold - overhead) * 0.85)
  )
  const adjustedHard = Math.max(
    this.hardThreshold,
    Math.floor(overhead + (this.hardThreshold - overhead) * 0.85)
  )

  const estimatedTokens = this.estimate(items) + overhead
  const trustFactor = providerTokens / (this.estimate(items) || 1)

  let effectiveTokens = estimatedTokens
  if (providerTokens > 0 && trustFactor < PROMPT_TOKEN_TRUST_FACTOR) {
    effectiveTokens = providerTokens
  }

  // 使用调整后的阈值
  if (effectiveTokens <= adjustedSoft) return null
  if (effectiveTokens <= adjustedHard) {
    return { mode: 'normal', keepRecent: 4, reason: `estimated ${effectiveTokens} tokens ≥ soft threshold ${adjustedSoft}` }
  }
  return { mode: 'aggressive', keepRecent: 2, reason: `estimated ${effectiveTokens} tokens ≥ hard threshold ${adjustedHard}` }
}
```

**预期收益**：compaction 提前 ~13K tokens 触发，避免"刚好超限"的边缘情况。

**风险**：中。更早压缩意味着更频繁的 compaction 调用，但压缩本身很快（heuristic 模式不需要模型调用）。

---

### 方案 5：改进 Suppression 状态机（P5）

**目标**：减少 STICKY 抑制的持续时间，加速恢复

**文件**：`Joker/src/loop/compaction-suppress.ts`

**改动方案**：为 STICKY 增加 TTL（最大存活 turn 数）

```typescript
// compaction-suppress.ts 改动
export type SuppressionState = {
  level: SuppressionLevel
  sinceTurn: number    // 被抑制时的 turn 计数
  suppressedCount: number  // 连续被抑制的次数
}

const MAX_STICKY_TURNS = 3  // STICKY 最多存活 3 个 turn

export function shouldSuppress(state: SuppressionState, currentTurn: number): boolean {
  if (state.level === SUPPRESS_NONE) return false
  if (state.level === SUPPRESS_TURN) {
    // TURN 级别在 turn 边界自动清除（已有逻辑）
    return true
  }
  if (state.level === SUPPRESS_STICKY) {
    // STICKY 级别有 TTL：最多存活 MAX_STICKY_TURNS 个 turn
    const turnsSince = currentTurn - state.sinceTurn
    if (turnsSince >= MAX_STICKY_TURNS) {
      return false  // TTL 到期，恢复自动压缩
    }
    return true
  }
  if (state.level === SUPPRESS_AUTH) {
    // AUTH 级别保持现有逻辑（需要 auth 刷新或成功响应）
    return true
  }
  return false
}
```

**在 `HistoryCompactionService` 中集成**：

```typescript
// history-compaction-service.ts
export class HistoryCompactionService {
  private suppression: SuppressionState = {
    level: SUPPRESS_NONE,
    sinceTurn: 0,
    suppressedCount: 0
  }

  private turnCounter = 0

  clearTurnSuppression(): void {
    this.turnCounter += 1
    if (this.suppression.level === SUPPRESS_TURN) {
      this.suppression = { level: SUPPRESS_NONE, sinceTurn: this.turnCounter, suppressedCount: 0 }
    }
  }

  async compactIfNeeded(input: { ... }): Promise<TurnItem[]> {
    // 使用 shouldSuppress 替代 isSuppressed
    if (input.forceBudgetTokens === undefined && shouldSuppress(this.suppression, this.turnCounter)) {
      return input.items
    }
    // ...
  }

  private classifyAndRecord(error: { ... }): void {
    const level = classifyCompactionFailure(error)
    this.suppression = {
      level,
      sinceTurn: this.turnCounter,
      suppressedCount: this.suppression.suppressedCount + 1
    }
  }
}
```

**预期收益**：STICKY 抑制最多持续 3 个 turn，而非无限期。

**风险**：低。如果 compaction 确实失败（如 context overflow），STICKY 恢复后可能再次失败，但 suppressedCount 可用于诊断。

---

### 方案 6：增加 Forced Compaction 重试次数（P6）

**目标**：给 forced compaction 更多机会缩小 context

**文件**：`Joker/src/loop/model-step-service.ts`

**当前问题**：`for (let attempt = 0; attempt < 2; attempt++)` — 只重试 1 次

**改动方案**：

```typescript
// model-step-service.ts
const MAX_FORCED_COMPACTION_ATTEMPTS = 3  // 从 2 改为 3

for (let attempt = 0; attempt < MAX_FORCED_COMPACTION_ATTEMPTS; attempt++) {
  // ... 现有逻辑 ...

  if (attempt === MAX_FORCED_COMPACTION_ATTEMPTS - 1) {
    // 最后一次尝试失败
    await this.deps.events.record({
      kind: 'error',
      threadId,
      turnId,
      message: `request still exceeds the ${hardCap}-token context cap after ${MAX_FORCED_COMPACTION_ATTEMPTS} forced compaction attempts (${measuredInput} input + ${outputTokens} output budget)`,
      code: 'context_window_exceeded',
      severity: 'warning'
    })
    return 'failed'
  }

  // First overflow: force one compaction toward the model's window
  await this.deps.events.record({
    kind: 'error',
    // ... 现有日志 ...
  })
  activeHistory = await this.deps.historyCompaction.compactIfNeeded({
    items: activeHistory,
    model,
    ...(providerId ? { providerId } : {}),
    ...(accountId ? { accountId } : {}),
    signal,
    threadId,
    turnId,
    toolSpecs: requestToolSpecs,
    reserveModelRequest: () => this.deps.budgetGate.reserveAdditionalModelRequest(threadId, turnId),
    forceBudgetTokens: hardCap
  })
  if (activeHistory.length === history.length) {
    // 没有进展，提前退出
    await this.deps.events.record({
      kind: 'error',
      // ... 现有日志 ...
    })
    return 'failed'
  }
}
```

**预期收益**：给 forced compaction 更多机会，特别是当第一次 compaction 只部分缩减时。

**风险**：低。每次 compaction 都是幂等的，不会造成数据损坏。

---

## 实施优先级

| 优先级 | 方案 | 预期收益 | 实施复杂度 | 风险 |
|--------|------|----------|------------|------|
| P0 | 方案 4：更早触发 Compaction | 减少"刚好超限"边缘情况 | 低 | 中 |
| P1 | 方案 2：跨 Turn 累积预算 | 长 session 历史膨胀 | 中 | 中 |
| P2 | 方案 1：始终压缩工具描述 | 每次请求节省 ~5K tokens | 低 | 低 |
| P3 | 方案 3：Context Instructions 分级 | 减少 ~2K tokens 指令开销 | 中 | 低 |
| P4 | 方案 5：改进 Suppression 状态机 | 加速自动压缩恢复 | 低 | 低 |
| P5 | 方案 6：增加重试次数 | 给 forced compaction 更多机会 | 低 | 低 |

---

## 验证方案

### 单元测试

1. **方案 1**：`token-economy.test.ts`
   - 测试 `compactToolSpec` 对所有内置工具描述的压缩效果
   - 验证压缩后保留代码标识符、路径、URL
   - 测量压缩前后的 token 差异

2. **方案 2**：`request-history-hygiene.test.ts`
   - 构造 20+ 个 turn 的工具结果历史
   - 验证跨 turn 预算清理后，旧结果被折叠为摘要
   - 验证最近 N 个结果保持完整

3. **方案 3**：`context-instruction-priority.test.ts`
   - 测试优先级排序和预算筛选
   - 验证 critical/high 指令始终保留
   - 验证低优先级指令在预算耗尽时被截断

4. **方案 4**：`context-compactor.test.ts`
   - 验证新的 soft/hard threshold 触发行为
   - 测试 overhead 调整后的阈值计算

5. **方案 5**：`compaction-suppress.test.ts`
   - 测试 STICKY TTL 到期后恢复
   - 测试 suppressedCount 递增

6. **方案 6**：`model-step-service.test.ts`
   - 测试 3 次重试的行为
   - 测试提前退出（无进展时）

### 集成测试

1. **端到端 context 大小测试**
   - 模拟 50+ turn 的长 session
   - 验证每个请求的 sentInputTokens 不超过 hardCap
   - 验证 compaction 在 softThreshold 之前触发

2. **Suppression 恢复测试**
   - 触发一次 compaction 失败
   - 验证 3 个 turn 后自动恢复
   - 验证 suppressedCount 正确记录

### 性能监控

1. **新增 telemetry 指标**
   - `context_instruction_budget_exceeded` — 指令预算耗尽事件
   - `cross_turn_budget_collapsed` — 跨 turn 清理的工具结果数
   - `compaction_early_trigger` — 提前触发 compaction 的次数
   - `forced_compaction_retry_count` — forced compaction 重试次数

2. **现有指标增强**
   - `compaction_completed` 增加 `tokensBeforeCompaction` 和 `tokensAfterCompaction` 字段
   - `error` 事件增加 `suppressionLevel` 和 `suppressionDuration` 字段

---

## 回滚方案

每个方案都是独立的 feature flag 控制：

```typescript
// runtime-config.ts
export type ContextOptimizationConfig = {
  enableCrossTurnBudget?: boolean        // 方案 2
  enableInstructionPriority?: boolean    // 方案 3
  enableEarlyCompaction?: boolean        // 方案 4
  enableSuppressionTTL?: boolean         // 方案 5
  forcedCompactionMaxAttempts?: number   // 方案 6
}
```

默认值：

```typescript
export const DEFAULT_CONTEXT_OPTIMIZATION: ContextOptimizationConfig = {
  enableCrossTurnBudget: false,      // 默认关闭，灰度开启
  enableInstructionPriority: false,  // 默认关闭，灰度开启
  enableEarlyCompaction: true,       // 默认开启（低风险）
  enableSuppressionTTL: true,        // 默认开启（低风险）
  forcedCompactionMaxAttempts: 2     // 保持现有值
}
```

---

## 实施时间线

| 阶段 | 方案 | 时间 | 里程碑 |
|------|------|------|--------|
| Phase 1 | 方案 4 + 5 + 6 | 1-2 天 | 低风险改进上线 |
| Phase 2 | 方案 1 | 1 天 | 工具描述压缩上线 |
| Phase 3 | 方案 2 | 2-3 天 | 跨 turn 预算上线 |
| Phase 4 | 方案 3 | 2 天 | 指令分级上线 |
| Phase 5 | 监控 + 调优 | 持续 | 根据 telemetry 调整参数 |

---

## 参考资料

- Grok Build: `CompactionConfig.auto_compact_suppressed`
- Codex: WorldState diff + reference_context_item baseline
- Reasonix: send-time history hygiene
- DeepSeek V4: 1M context window, soft=750K, hard=850K
- 35 builtin tools + dynamic MCP tools
- 15+ context instruction sources
