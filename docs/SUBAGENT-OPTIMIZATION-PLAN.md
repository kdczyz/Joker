# 子代理机制优化方案

> 范围: server/agent、server/runtime、server/shared | 依据: 2025 年子代理机制全面审查
> 参照: openai/codex（分层 exec policy、超时与重试）、grok-build 方向（单任务单报告、事件流进度）

## 目标

1. 让 `delegate_agents` 从"注册了但无法执行"变为真正可用的并行调查能力。
2. 在上游模型服务不稳定（terminated / fetch failed / 429）时仍能可靠完成。
3. 不破坏 prompt cache、不撑爆主上下文、不产生递归失控。

---

## 阶段一：执行引擎 + 可靠性基线（P0，先落地）

### 1.1 新建 `server/agent/subagentRunner.ts`

职责：消费 `delegate_agents` 工具调用，运行子代理并回传结构化报告。

```ts
export interface SubagentRunRequest {
  runId: string;
  agentName: string;
  task: string;
  projectPath?: string;
  signal?: AbortSignal;
}

export async function runSubagents(
  requests: SubagentRunRequest[],
  emit: (event: StreamEvent) => void,
): Promise<SubagentReport[]>
```

核心设计：

- **执行方式**：每个子代理是一个受限的独立循环——`callAiStream` + 只读工具白名单
  （复用 `subagents.ts` 的 `readOnlyTools`），不经过完整 `executeTool` 分发表，
  直接调用对应的只读实现，避免权限面扩大。
- **禁止嵌套**：白名单里不含 `delegate_agents`，从结构上杜绝二层委派（参照 codex：并行靠多个顶层会话，不做深嵌套）。
- **turn 上限**：使用 `SubagentDefinition.maxTurns`（现有字段，硬顶 12）。
- **结果契约**：强制两段式输出，长度预算 ≤ 4KB：
  ```
  ## Summary   （≤ 500 字结论）
  ## Evidence  （文件+行号+一句话证据，每条 ≤ 200 字）
  ```
  超预算时截断 Evidence 并标注 `[truncated]`。主循环只收到这份报告，
  不接收子代理的中间过程——保护主上下文窗口。

### 1.2 接入 `executeTool`（runtime/tools.ts）

在 if/else 链末尾（git_push 之后、`Unknown tool` 之前）增加分支：

```ts
} else if (call.name === "delegate_agents") {
  const agents = await listSubagents(projectPath);
  // 校验每个 task.agent 存在；未知名称直接报错并列出可用名
  // strategy: parallel(默认)/sequential/auto → auto 时全部只读代理走 parallel
  result = await executeDelegateAgents(call.arguments, projectPath, context);
}
```

每启动/结束一个子代理，通过回调向上 emit 已定义但未使用的
`{ type: "subagent_update", run }` 事件（shared/types.ts:293），状态机：
`queued → running → completed | failed | cancelled`。

### 1.3 全局并发闸门（新增 `server/agent/concurrency.ts`）

```ts
// 进程级信号量，默认上限 3（配置化: agent.toml [subagents] max_concurrency）
export class Semaphore {
  constructor(private limit: number) {}
  async acquire(signal?: AbortSignal): Promise<Release>;
}
```

- 主循环 delegate 的所有子代理共享同一个全局信号量（不是每次调用新建）。
- 超出的任务进入**有界队列**（默认等待上限 60s，超时返回降级提示），
  队列位置通过 `subagent_update`(status=queued) 暴露给 UI。
- 教训依据：此前 4 个子代理并发打同一模型服务导致全部 stream terminated。

### 1.4 统一重试策略（改造 aiProvider.ts 的调用方 + agent.ts 现有逻辑）

把现在只针对 429 的线性重试（agent.ts 内 3 次固定 2s/4s）抽成通用函数：

```ts
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseMs: number; jitter: boolean; retryOn: (msg: string) => boolean }
): Promise<T>
```

- 触发条件扩展：429、`stream read failed`、`terminated`、`fetch failed`、ECONNRESET。
- 指数退避 + jitter：`base * 2^n + random(0..500ms)`，最多 3 次。
- 重试期间通过 workflow_event 告知用户（沿用现有"速率受限，等待 N 秒"文案模式）。
- agent.ts 与 subagentRunner 共用同一实现。

### 1.5 超时与取消传播

- `SubagentRunRequest.signal` 来自主循环的 AbortSignal，用 `AbortSignal.any`
  合成一个组合信号：`any([parentSignal, AbortSignal.timeout(totalTimeoutMs)])`。
- 配置默认值（写入 runtime/config.ts，可在 agent.toml 覆盖）：
  - 单个子代理总时长 `total_timeout_ms = 300_000`（5 分钟）
  - 单步 AI 流空闲超时 `step_idle_timeout_ms = 120_000`
  - 工具执行沿用各工具现有超时
- 取消时：正在运行的子代理收到 abort，工具调用链已传 signal 的直接生效；
  报告状态 `cancelled`，主循环继续处理其余子代理的结果（部分成功也算成功）。

---

## 阶段二：上下文效率与缓存（P1）

### 2.1 `listSubagents` 加缓存（agent/subagents.ts）

- 以 `(workspaceRoot, ~/.agent/agents)` 两目录的 mtime+size 为指纹做进程内缓存。
- `getToolDefinitions`（tools.ts:311）每轮对话都调 listSubagents —— 缓存后消除每步文件 IO。
- 提供 `invalidateSubagentCache()` 供 Settings 修改定义文件后手动失效。

### 2.2 工具定义字节稳定（保护 prompt cache）

现状问题：tools.ts:316-334 把代理列表动态拼进 `delegate_agents` 的 description 和 enum，
代理文件一变，整个工具数组字节变化，provider prompt cache 前缀全失效。

改法：

- description 改为静态文本："Available agents are listed in the agent enum."（不再拼接列表）
- enum 仅保留动态部分，其余工具定义对象整体冻结缓存；
  只有 `delegate_agents` 一项在代理列表变化时重建——cache 失效范围从"全部工具"
  缩小到"最后一个工具"，前缀仍然命中。

### 2.3 结果注入方式

子代理报告以 tool_result 内容回传（现有 appendToolResultMessage 路径），
同时落一条 audit event（toolName=delegate_agents，outputSummary=Summary 段），
保证审批/审计链路可见。

---

## 阶段三：健壮性收尾（P2）

1. **graceful degradation**：所有子代理失败时，返回明确错误摘要 +
   提示主模型"可自行直接调查"，而不是让整轮 turn 报错。
2. **frontmatter 解析升级**：引入轻量 YAML 解析（项目已有依赖则复用），
   支持多行 `prompt: |` 块和带引号的 tools 列表；解析失败的 .md 打日志跳过而非静默。
3. **permissionCeiling 字段**：`SubagentDefinition` 增加
   `permissionCeiling: "plan" | "default" | ...`，执行时取 `min(parentMode, ceiling)`，
   把 permissionRules.ts:186 里"继承父边界"的文案承诺变成代码约束。
4. **观测性**：usage 事件区分 parent/subagent 来源（recordAgentUsageEvent 加 source 字段），
   用量面板能分别显示委派开销。

---

## 测试计划

| 测试 | 位置 |
|---|---|
| 并发闸门：6 任务/上限 3 → 峰值并发=3，队列顺序正确 | 新增 concurrency.test.ts |
| 重试：模拟 terminated/fetch failed → 指数退避后成功；3 次失败→降级 | withRetry 单测 |
| 超时：子代理挂起 → totalTimeout 触发 cancelled，父流程继续 | subagentRunner.test.ts |
| 结果预算：超长 Evidence 截断且标记 truncated | subagentRunner.test.ts |
| 嵌套防护：子代理请求 delegate_agents → 工具不可见 | subagentRunner.test.ts |
| 缓存：listSubagents 二次调用无磁盘读（mock fs 计数） | subagents.test.ts 扩展 |
| 工具定义稳定性：代理列表不变时 JSON.stringify 字节一致 | tools 相关测试 |
| 端到端：delegate_agents 两个只读任务并行返回合并报告 | agent.test.ts 扩展 |

## 验收标准

- [ ] 模型调用 `delegate_agents` 不再出现 `Unknown tool` 错误
- [ ] 4 个并行任务在上游限流时至少部分成功，UI 能看到 queued/running 状态并可取消
- [ ] 代理列表未变化时，连续两轮对话发出的工具定义字节完全一致（prompt cache 可命中）
- [ ] 子代理报告进入主上下文的体积 ≤ 4KB/个
- [ ] 现有 63 个服务端测试 + 新增测试全部通过

## 实施顺序与工作量估计

| 步骤 | 内容 | 规模 |
|---|---|---|
| 1 | concurrency.ts + withRetry 抽取 | 小 |
| 2 | subagentRunner.ts + executeTool 分支 + subagent_update 事件 | 中 |
| 3 | 超时/cancel 传播 + 配置项 | 小 |
| 4 | listSubagents 缓存 + 工具定义稳定化 | 小 |
| 5 | P2 收尾（YAML、ceiling、usage source、degradation） | 中 |

建议按 1→2→3 一个 PR（核心可用），4→5 第二个 PR（性能与收尾）。
