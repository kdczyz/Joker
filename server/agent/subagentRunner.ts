import { nanoid } from "nanoid";
import { callAiStream, type ThinkingMode } from "../providers/aiProvider";
import { hasBillableProviderUsage, normalizeProviderUsage } from "../providers/providerUsage";
import type { AgentMessage, PermissionMode, StreamEvent, SubagentRunStatus, SubagentRunUpdate, ToolCall, ToolResult } from "../shared/types";
import type { SubagentDefinition } from "./subagents";
import { getSubagentSemaphore, SemaphoreAbortedError, SemaphoreAcquireTimeoutError } from "./concurrency";
import { getRuntimeConfig } from "../runtime/config";
import { recordAgentUsageEvent, type AgentUsageEventInput } from "../storage/database";
import { withRetry } from "./retry";

/**
 * Subagent execution engine.
 *
 * Each subagent runs a bounded, read-only loop: the model may only call tools
 * from `readOnlyToolAllowlist`, cannot delegate further (no delegate_agents in
 * the allowlist → no recursive spawning), and must finish within maxTurns and
 * a total timeout. The final report is size-capped so a subagent can never
 * blow up the parent conversation's context window.
 */

export const readOnlyToolAllowlist = [
  "read_file",
  "list_files",
  "search_text",
  "inspect_tree",
  "project_diagnostics",
  "git_status",
  "git_diff"
] as const;

export interface SubagentRunnerLimits {
  maxTurnsCap: number;
  totalTimeoutMs: number;
  reportMaxChars: number;
  evidenceMaxItems: number;
}

export const DEFAULT_SUBAGENT_RUNNER_LIMITS: SubagentRunnerLimits = {
  maxTurnsCap: 12,
  totalTimeoutMs: 120_000,
  reportMaxChars: 4_000,
  evidenceMaxItems: 12
};

export type SubagentToolExecutor = (
  call: ToolCall,
  projectPath?: string,
  context?: {
    conversationId?: string;
    permissionMode?: PermissionMode;
    permissionEffect?: string;
    permissionReason?: string;
    signal?: AbortSignal;
  }
) => Promise<ToolResult>;

export interface SubagentRunOptions {
  batchId: string;
  projectPath?: string;
  providerId?: string;
  model?: string;
  thinkingMode?: ThinkingMode;
  /** Parent permission mode; effective mode is min(parent, definition ceiling). */
  parentMode: PermissionMode;
  signal?: AbortSignal;
  emit: (event: StreamEvent) => void;
  limits?: Partial<SubagentRunnerLimits>;
  /** Injected to avoid a circular import with runtime/tools.ts. */
  executeTool: SubagentToolExecutor;
}

export interface SubagentReport {
  agentName: string;
  task: string;
  status: SubagentRunStatus;
  summary: string;
  turnsUsed: number;
  error?: string;
}

const PERMISSION_MODE_ORDER: PermissionMode[] = ["plan", "workspace_write", "full_access"];

function clampPermissionMode(parent: PermissionMode, ceiling: PermissionMode | undefined): PermissionMode {
  if (!ceiling) return parent;
  return PERMISSION_MODE_ORDER.indexOf(parent) <= PERMISSION_MODE_ORDER.indexOf(ceiling) ? parent : ceiling;
}

export function buildSubagentSystemPrompt(definition: SubagentDefinition, task: string): string {
  return [
    definition.prompt,
    "",
    "硬性约束：",
    "- 你只能使用只读工具（read_file/list_files/search_text/inspect_tree/project_diagnostics/git_status/git_diff），不能修改任何文件。",
    `- 最多 ${definition.maxTurns ?? DEFAULT_SUBAGENT_RUNNER_LIMITS.maxTurnsCap} 轮，之后必须输出最终报告。`,
    "- 最终报告必须包含两段：`## Summary`（≤200 字结论）和 `## Evidence`（文件路径:行号 + 一句话证据）。"
  ].join("\n");
}

/** Parse the enforced Summary/Evidence contract out of the model's final text. */
export function parseSubagentReport(content: string): { summary: string; evidence: string[] } {
  const summaryMatch = content.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##\s*Evidence|\n#$|$)/i);
  const evidenceMatch = content.match(/##\s*Evidence\s*\n([\s\S]*)$/i);
  const summary = (summaryMatch?.[1] ?? content).trim();
  const evidence = (evidenceMatch?.[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
  return { summary: summary.slice(0, 500), evidence };
}

export function formatSubagentReport(report: SubagentReport, limits: SubagentRunnerLimits): string {
  const header = `[subagent:${report.agentName}] status=${report.status} turns=${report.turnsUsed}`;
  const errorLine = report.error ? `\nError: ${report.error}` : "";
  let body = `${header}${errorLine}\n\nSummary: ${report.summary}`;
  if (body.length > limits.reportMaxChars) {
    body = `${body.slice(0, limits.reportMaxChars)}\n[truncated: report exceeded ${limits.reportMaxChars} chars]`;
  }
  return body;
}

export async function runSingleSubagent(
  definition: SubagentDefinition,
  task: string,
  options: SubagentRunOptions
): Promise<SubagentReport> {
  let configLimits: Partial<SubagentRunnerLimits> = {};
  try {
    const runtime = getRuntimeConfig();
    configLimits = {
      totalTimeoutMs: runtime.subagents.totalTimeoutMs,
      reportMaxChars: runtime.subagents.reportMaxChars
    };
  } catch {
    // Config unavailable (e.g. tests): fall back to defaults.
  }
  const limits: SubagentRunnerLimits = { ...DEFAULT_SUBAGENT_RUNNER_LIMITS, ...configLimits, ...options.limits };
  const runId = nanoid(8);
  const maxTurns = Math.min(definition.maxTurns ?? limits.maxTurnsCap, limits.maxTurnsCap);
  let semaphoreConfig: { limit?: number; queueTimeoutMs?: number } | undefined;
  try {
    const runtime = getRuntimeConfig();
    semaphoreConfig = { limit: runtime.subagents.maxConcurrency, queueTimeoutMs: runtime.subagents.queueTimeoutMs };
    getSubagentSemaphore(semaphoreConfig);
    semaphoreConfig = undefined; // already applied
  } catch {
    // ignore, use existing semaphore
  }
  const semaphore = getSubagentSemaphore();

  const update = (status: SubagentRunStatus, extra: Partial<SubagentRunUpdate> = {}) => {
    options.emit({
      type: "subagent_update",
      run: {
        id: runId,
        batchId: options.batchId,
        agentName: definition.name,
        task,
        status,
        ...extra
      }
    });
  };

  // Combined timeout: parent abort OR total timeout, whichever first.
  const timeoutSignal = AbortSignal.timeout(limits.totalTimeoutMs);
  const compositeSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const startedAt = Date.now();

  let releaseSlot: (() => void) | undefined;
  try {
    update("queued");
    releaseSlot = await semaphore.acquire(compositeSignal);
  } catch (error) {
    if (error instanceof SemaphoreAcquireTimeoutError || error instanceof SemaphoreAbortedError) {
      const status: SubagentRunStatus = compositeSignal.aborted ? "cancelled" : "failed";
      update(status, { error: error.message, completedAt: new Date().toISOString() });
      return { agentName: definition.name, task, status, summary: "", turnsUsed: 0, error: error.message };
    }
    throw error;
  }

  update("running", { startedAt: new Date().toISOString() });

  const messages: AgentMessage[] = [
    { role: "user", content: `${task}\n\n完成后按约束输出最终报告。` }
  ];
  const effectiveMode = clampPermissionMode(options.parentMode, definition.permissionCeiling as PermissionMode | undefined);
  let turnsUsed = 0;
  let finalText = "";

  try {
    while (turnsUsed < maxTurns && !compositeSignal.aborted) {
      turnsUsed += 1;
      let toolCalls: ToolCall[] = [];
      let contentBuffer = "";

      const streamFactory = () =>
        callAiStream(messages, {
          providerId: options.providerId,
          model: options.model,
          thinkingMode: options.thinkingMode,
          projectPath: options.projectPath,
          mode: effectiveMode,
          sessionId: `subagent-${runId}`,
          signal: compositeSignal,
          allowedTools: [...readOnlyToolAllowlist],
          systemInstructions: buildSubagentSystemPrompt(definition, task)
        });

      // Wrap the stream consumption in retry for transient upstream failures.
      await withRetry(
        async () => {
          contentBuffer = "";
          toolCalls = [];
          for await (const event of streamFactory()) {
            if (event.type === "tool_calls") {
              toolCalls = event.toolCalls.filter((call) =>
                (readOnlyToolAllowlist as readonly string[]).includes(call.name)
              );
              if (event.cleanContent !== undefined) contentBuffer = event.cleanContent;
            } else if (event.type === "text_delta") {
              contentBuffer += event.content;
            }
            // reasoning deltas are intentionally not forwarded: subagent
            // internals stay out of the parent's event stream.
            else if (event.type === "usage" && hasBillableProviderUsage(normalizeProviderUsage(event.usage))) {
              const providerUsage = normalizeProviderUsage(event.usage);
              const usageInput: AgentUsageEventInput = {
                eventType: "ai_call",
                projectPath: options.projectPath,
                conversationId: `subagent-${runId}`,
                requestId: event.requestId,
                model: event.model,
                provider: event.provider,
                rawInputTokens: providerUsage.rawInputTokens,
                promptTokens: providerUsage.inputTokens,
                completionTokens: providerUsage.outputTokens,
                totalTokens: providerUsage.totalTokens,
                cacheReadTokens: providerUsage.cacheReadTokens,
                cacheCreationTokens: providerUsage.cacheCreationTokens,
                source: "subagent"
              };
              try {
                recordAgentUsageEvent(usageInput);
              } catch {
                // Usage persistence must never break a running subagent.
              }
            }
          }
        },
        {
          retries: 2,
          baseMs: 1500,
          signal: compositeSignal,
          onRetry: (attempt, waitMs, message) => {
            console.log(`[Subagent:${definition.name}] transient failure (attempt ${attempt}), retrying in ${Math.round(waitMs)}ms: ${message.slice(0, 120)}`);
          }
        }
      );

      finalText = contentBuffer;
      messages.push({ role: "assistant", content: contentBuffer, ...(toolCalls.length ? { toolCalls } : {}) });

      if (toolCalls.length === 0) break;

      for (const call of toolCalls) {
        const result = await options.executeTool(call, options.projectPath, {
          conversationId: `subagent-${runId}`,
          permissionMode: effectiveMode,
          permissionEffect: "allow",
          permissionReason: `Read-only subagent (${definition.name}) tool call within allowlist.`,
          signal: compositeSignal
        });
        messages.push({ role: "tool", toolCallId: result.toolCallId, content: result.content.slice(0, 8_000) });
      }
    }

    const timedOut = !options.signal?.aborted && timeoutSignal.aborted;
    const cancelled = options.signal?.aborted;
    const status: SubagentRunStatus = cancelled ? "cancelled" : "completed";
    const { summary } = parseSubagentReport(finalText);
    const report: SubagentReport = {
      agentName: definition.name,
      task,
      status,
      summary: summary || finalText.slice(0, 300),
      turnsUsed,
      ...(timedOut ? { error: `Timed out after ${limits.totalTimeoutMs}ms (partial results kept)` } : {})
    };
    update(status, {
      summary: report.summary,
      turns: turnsUsed,
      completedAt: new Date().toISOString(),
      ...(report.error ? { error: report.error } : {})
    });
    return report;
  } catch (error) {
    const isAbort = error instanceof Error && (error.name === "AbortError" || compositeSignal.aborted);
    const message = error instanceof Error ? error.message : String(error);
    const status: SubagentRunStatus = isAbort ? "cancelled" : "failed";
    update(status, { error: message, turns: turnsUsed, completedAt: new Date().toISOString() });
    return {
      agentName: definition.name,
      task,
      status,
      summary: "",
      turnsUsed,
      error: message
    };
  } finally {
    releaseSlot?.();
  }
}

export type DelegateStrategy = "auto" | "parallel" | "sequential";

/**
 * Run a delegate_agents batch: validate names, gate concurrency globally,
 * and merge per-run reports into one size-capped tool result payload.
 */
export async function runSubagentBatch(
  definitionsByName: Map<string, SubagentDefinition>,
  tasks: Array<{ agent: string; task: string }>,
  options: Omit<SubagentRunOptions, "batchId"> & { strategy?: DelegateStrategy }
): Promise<{ reports: SubagentReport[]; content: string }> {
  const limits: SubagentRunnerLimits = { ...DEFAULT_SUBAGENT_RUNNER_LIMITS, ...options.limits };
  const unknown = tasks.map((t) => t.agent).filter((name) => !definitionsByName.has(name));
  const batchId = nanoid(10);

  if (unknown.length > 0) {
    return {
      reports: [],
      content: `Unknown subagent(s): ${[...new Set(unknown)].join(", ")}. Available: ${[...definitionsByName.keys()].join(", ")}.`
    };
  }

  // Security gate: the runner can only execute the read-only allowlist.
  // A custom definition declaring mutating tools is rejected up front instead
  // of being silently filtered, so the parent model gets actionable feedback.
  const isReadOnlyDefinition = (definition: SubagentDefinition) =>
    (definition.tools ?? readOnlyToolAllowlist as readonly string[]).every((tool) =>
      (readOnlyToolAllowlist as readonly string[]).includes(tool)
    );
  const rejected = tasks.filter(
    (t) => !isReadOnlyDefinition(definitionsByName.get(t.agent)!)
  );
  if (rejected.length > 0) {
    const names = [...new Set(rejected.map((t) => t.agent))].join(", ");
    return {
      reports: [],
      content: `Subagent(s) ${names} declare non-read-only tools; delegation is limited to read-only investigation (allowlist: ${readOnlyToolAllowlist.join(", ")}). Remove the tools declaration or investigate directly.`
    };
  }
  const forceSequential = options.strategy === "sequential";

  const reports: SubagentReport[] = new Array(tasks.length);
  const runners = tasks.map((entry, index) => async () => {
    reports[index] = await runSingleSubagent(definitionsByName.get(entry.agent)!, entry.task, {
      ...options,
      batchId
    });
  });

  if (forceSequential) {
    for (const run of runners) await run();
  } else {
    // All surviving tasks are read-only (gate above), so they can run fully
    // concurrently; per-run admission is bounded by the global semaphore
    // inside runSingleSubagent.
    await Promise.all(runners.map((run) => run()));
  }

  const failed = reports.filter((r) => r && r.status === "failed").length;
  const header = `Delegated ${tasks.length} subagent task(s): ${reports.filter((r) => r && r.status === "completed").length} completed, ${failed} failed.`;
  const body = reports
    .filter(Boolean)
    .map((report) => formatSubagentReport(report, limits))
    .join("\n\n---\n\n");
  let content = `${header}\n\n${body}`;
  if (content.length > limits.reportMaxChars * tasks.length) {
    content = `${content.slice(0, limits.reportMaxChars * tasks.length)}\n[truncated: batch report exceeded budget]`;
  }
  return { reports, content };
}
