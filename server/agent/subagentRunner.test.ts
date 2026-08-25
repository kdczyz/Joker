import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCall, ToolResult, SubagentRunUpdate } from "../shared/types";
import type { StreamEvent } from "../shared/types";
import type { SubagentDefinition } from "./subagents";
import {
  DEFAULT_SUBAGENT_RUNNER_LIMITS,
  formatSubagentReport,
  parseSubagentReport,
  runSubagentBatch
} from "./subagentRunner";

function makeDefinition(overrides: Partial<SubagentDefinition> = {}): SubagentDefinition {
  return {
    name: "researcher",
    description: "test researcher",
    path: "builtin:researcher",
    scope: "builtin",
    prompt: "You are a test subagent.",
    tools: ["read_file", "list_files"],
    permissionCeiling: "plan",
    maxTurns: 3,
    ...overrides
  };
}

function makeToolCall(name: string): ToolCall {
  return { id: `call_${name}`, name, arguments: {} } as unknown as ToolCall;
}

const noOpExecutor = async (call: ToolCall): Promise<ToolResult> =>
  ({ toolCallId: call.id, name: call.name, ok: true, content: "tool output" }) as ToolResult;

interface HarnessOptions {
  streamFactory?: () => AsyncGenerator<{ type: string; [key: string]: unknown }>;
  executeTool?: (call: ToolCall) => Promise<ToolResult>;
}

// callAiStream is imported inside subagentRunner; we stub it via module mock.
async function withMockedAiStream(
  impl: () => AsyncGenerator<unknown>,
  fn: () => Promise<void>
) {
  const aiProvider: any = await import("../providers/aiProvider");
  const original = aiProvider.callAiStream;
  aiProvider.callAiStream = impl;
  try {
    await fn();
  } finally {
    aiProvider.callAiStream = original;
  }
}

test("parseSubagentReport extracts Summary and Evidence sections", () => {
  const report = parseSubagentReport(
    "## Summary\n发现两处问题。\n## Evidence\n- src/a.ts:12 有空指针\n- src/b.ts:40 缺少测试"
  );
  assert.match(report.summary, /两处问题/);
  assert.equal(report.evidence.length, 2);
  assert.match(report.evidence[0], /src\/a\.ts:12/);
});

test("parseSubagentReport falls back to raw content without headings", () => {
  const report = parseSubagentReport("plain conclusion text");
  assert.equal(report.summary, "plain conclusion text");
});

test("formatSubagentReport caps length at reportMaxChars", () => {
  const formatted = formatSubagentReport(
    {
      agentName: "r",
      task: "t",
      status: "completed",
      summary: "x".repeat(10_000),
      turnsUsed: 2
    },
    { ...DEFAULT_SUBAGENT_RUNNER_LIMITS, reportMaxChars: 500 }
  );
  assert.ok(formulatedLength(formatted) <= 600);
  assert.match(formatted, /truncated/);
});

function formulatedLength(s: string): number {
  return s.length;
}

test("runSubagentBatch rejects unknown agent names", async () => {
  const definitions = new Map([[makeDefinition().name, makeDefinition()]]);
  const events: StreamEvent[] = [];
  const { reports, content } = await runSubagentBatch(
    definitions,
    [{ agent: "ghost", task: "do things" }],
    {
      parentMode: "plan",
      emit: (event) => events.push(event),
      executeTool: noOpExecutor
    }
  );
  assert.equal(reports.length, 0);
  assert.match(content, /Unknown subagent\(s\): ghost/);
  assert.match(content, /researcher/);
});

test("runSingleSubagent completes a read-only loop and emits lifecycle updates", async () => {
  await withMockedAiStream(
    async function* () {
      yield { type: "text_delta", content: "## Summary\nDone.\n" };
      yield { type: "tool_calls", toolCalls: [] };
    },
    async () => {
      const definition = makeDefinition();
      const definitions = new Map([[definition.name, definition]]);
      const events: StreamEvent[] = [];
      const statuses: string[] = [];

      const { reports } = await runSubagentBatch(
        definitions,
        [{ agent: "researcher", task: "inspect code" }],
        {
          parentMode: "workspace_write",
          limits: { totalTimeoutMs: 5_000 },
          emit: (event) => {
            if (event.type === "subagent_update") {
              statuses.push(event.run.status);
              events.push(event);
            }
          },
          executeTool: noOpExecutor
        }
      );

      assert.equal(reports.length, 1);
      assert.equal(reports[0].status, "completed");
      assert.match(reports[0].summary, /Done/);
      assert.deepEqual(statuses, ["queued", "running", "completed"]);
    }
  );
});

test("runSingleSubagent enforces maxTurns cap and filters non-allowlisted tools", async () => {
  let turnCount = 0;
  let executedTools: string[] = [];
  await withMockedAiStream(
    async function* () {
      turnCount += 1;
      if (turnCount <= 99) {
        yield {
          type: "tool_calls",
          toolCalls: [
            makeToolCall("read_file"),
            makeToolCall("run_shell"),
            makeToolCall("delegate_agents")
          ]
        };
      } else {
        yield { type: "text_delta", content: "final" };
        yield { type: "tool_calls", toolCalls: [] };
      }
    },
    async () => {
      const definition = makeDefinition({ maxTurns: 2 });
      const definitions = new Map([[definition.name, definition]]);
      const { reports } = await runSubagentBatch(
        definitions,
        [{ agent: "researcher", task: "loop forever" }],
        {
          parentMode: "plan",
          limits: { totalTimeoutMs: 5_000 },
          emit: () => {},
          executeTool: async (call) => {
            executedTools.push(call.name as string);
            return { toolCallId: call.id, name: call.name, ok: true, content: "out" } as ToolResult;
          }
        }
      );
      // Only allowlisted tools executed; delegate_agents/run_shell filtered out.
      assert.ok(executedTools.every((name) => name === "read_file"));
      assert.ok(turnCount <= 3); // maxTurns 2 + final answer turn
      assert.equal(reports[0].status, "completed");
    }
  );
});

test("runSingleSubagent reports failure when the model errors permanently", async () => {
  await withMockedAiStream(
    async function* () {
      yield { type: "text_delta", content: "" };
      throw new Error("AI provider error 500: internal");
    },
    async () => {
      const definition = makeDefinition();
      const definitions = new Map([[definition.name, definition]]);
      const updates: SubagentRunUpdate[] = [];
      const { reports } = await runSubagentBatch(
        definitions,
        [{ agent: "researcher", task: "will fail" }],
        {
          parentMode: "plan",
          limits: { totalTimeoutMs: 5_000 },
          emit: (event) => {
            if (event.type === "subagent_update") updates.push(event.run);
          },
          executeTool: noOpExecutor
        }
      );
      assert.equal(reports[0].status, "failed");
      const lastUpdate = updates[updates.length - 1];
      assert.equal(lastUpdate.status, "failed");
      assert.ok(lastUpdate.error);
    }
  );
});

test("runSubagentBatch rejects definitions declaring non-read-only tools", async () => {
  const mutating = makeDefinition({
    name: "writer",
    tools: ["read_file", "write_file"]
  });
  const definitions = new Map([
    [makeDefinition().name, makeDefinition()],
    [mutating.name, mutating]
  ]);
  const { reports, content } = await runSubagentBatch(
    definitions,
    [{ agent: "writer", task: "try to write" }],
    {
      parentMode: "plan",
      emit: () => {},
      executeTool: noOpExecutor
    }
  );
  assert.equal(reports.length, 0);
  assert.match(content, /writer/);
  assert.match(content, /non-read-only/);
});

test("runSubagentBatch accepts read-only custom definitions unchanged", async () => {
  const custom = makeDefinition({ name: "custom-reader", tools: ["search_text", "git_status"] });
  await withMockedAiStream(
    async function* () {
      yield { type: "text_delta", content: "## Summary\nok" };
      yield { type: "tool_calls", toolCalls: [] };
    },
    async () => {
      const definitions = new Map([[custom.name, custom]]);
      const { reports } = await runSubagentBatch(
        definitions,
        [{ agent: "custom-reader", task: "look around" }],
        {
          parentMode: "workspace_write",
          limits: { totalTimeoutMs: 5_000 },
          emit: () => {},
          executeTool: noOpExecutor
        }
      );
      assert.equal(reports[0].status, "completed");
    }
  );
});
