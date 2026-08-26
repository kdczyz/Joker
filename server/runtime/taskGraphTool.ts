/**
 * Built-in `task_graph` tool backend (P1).
 *
 * Per-thread in-memory graphs so a multi-step plan persists across turns
 * within the conversation, with optional JSON persistence under
 * <workspace>/.rcode/tasks/<threadId>.json (atomic rename writes).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { TaskGraph, type TaskNode } from "../tasks/task-graph.js";

const graphs = new Map<string, TaskGraph>();

function tasksDir(workspaceRoot?: string): string | undefined {
  return workspaceRoot ? join(workspaceRoot, ".rcode", "tasks") : undefined;
}

async function loadGraph(dir: string, threadId: string): Promise<TaskGraph | null> {
  try {
    const raw = await readFile(join(dir, `${threadId}.json`), "utf8");
    return TaskGraph.fromJSON(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function saveGraph(dir: string, threadId: string, graph: TaskGraph): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${threadId}.json`);
  const temp = join(dir, `.${threadId}.${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(graph.toJSON(), null, 2), "utf8");
  await rename(temp, target);
}

function snapshot(graph: TaskGraph) {
  return {
    tasks: graph.list().map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state,
      dependsOn: t.dependsOn,
      priority: t.priority,
      attempts: t.attempts,
      maxAttempts: t.maxAttempts,
      ...(t.lastError ? { lastError: t.lastError } : {})
    })),
    runnable: graph.nextRunnable().map((t) => t.id),
    complete: graph.isComplete()
  };
}

function errorOutput(message: string) {
  return { error: message };
}

export interface TaskGraphToolInput {
  action: string;
  id?: unknown;
  title?: unknown;
  dependsOn?: unknown;
  priority?: unknown;
  maxAttempts?: unknown;
  error?: unknown;
  concurrency?: unknown;
}

export async function runTaskGraphTool(
  input: TaskGraphToolInput,
  context: { conversationId?: string; projectPath?: string; workspaceRoot?: string }
): Promise<Record<string, unknown>> {
  const threadId = context.conversationId || "__default__";
  const dir = tasksDir(context.workspaceRoot);
  let graph = graphs.get(threadId);
  if (!graph) {
    graph = (dir ? await loadGraph(dir, threadId) : null) ?? new TaskGraph({ concurrency: 1 });
    graphs.set(threadId, graph);
  }

  const persist = async (): Promise<void> => {
    if (dir) await saveGraph(dir, threadId, graph!).catch(() => { /* persistence is best-effort */ });
  };

  const action = input.action;
  const id = typeof input.id === "string" ? input.id.trim() : "";

  switch (action) {
    case "add": {
      if (!id || typeof input.title !== "string" || !input.title.trim()) {
        return errorOutput("id and title are required for add");
      }
      try {
        graph.add({
          id,
          title: input.title.trim(),
          ...(Array.isArray(input.dependsOn) ? { dependsOn: input.dependsOn.filter((d): d is string => typeof d === "string") } : {}),
          ...(typeof input.priority === "number" ? { priority: input.priority } : {}),
          ...(typeof input.maxAttempts === "number" ? { maxAttempts: input.maxAttempts } : {})
        });
      } catch (err) {
        return errorOutput(err instanceof Error ? err.message : String(err));
      }
      await persist();
      return snapshot(graph);
    }
    case "list":
      return snapshot(graph);
    case "next": {
      const runnable = graph.nextRunnable();
      return { runnable: runnable.map((t: TaskNode) => ({ id: t.id, title: t.title, state: t.state })), complete: graph.isComplete() };
    }
    case "start": {
      if (!id) return errorOutput("id is required");
      try {
        graph.markRunning(id);
      } catch (err) {
        return errorOutput(err instanceof Error ? err.message : String(err));
      }
      await persist();
      return snapshot(graph);
    }
    case "complete": {
      if (!id) return errorOutput("id is required");
      try {
        graph.markSucceeded(id);
      } catch (err) {
        return errorOutput(err instanceof Error ? err.message : String(err));
      }
      await persist();
      return snapshot(graph);
    }
    case "fail": {
      if (!id) return errorOutput("id is required");
      const message = typeof input.error === "string" && input.error.trim() ? input.error.trim() : "unspecified failure";
      try {
        const outcome = graph.markFailed(id, message);
        await persist();
        return { retried: outcome.retried, ...snapshot(graph) };
      } catch (err) {
        return errorOutput(err instanceof Error ? err.message : String(err));
      }
    }
    case "pause":
    case "resume":
    case "cancel": {
      if (!id) return errorOutput(`id is required for ${action}`);
      if (action === "pause") graph.pause(id);
      else if (action === "resume") graph.resume(id);
      else graph.cancel(id);
      await persist();
      return snapshot(graph);
    }
    case "set_concurrency": {
      if (typeof input.concurrency !== "number" || !Number.isFinite(input.concurrency)) {
        return errorOutput("concurrency must be a number");
      }
      graph.setConcurrency(input.concurrency);
      await persist();
      return snapshot(graph);
    }
    default:
      return errorOutput(`unknown task_graph action: ${action}`);
  }
}

/** Test hook: drop all in-memory graphs. */
export function resetTaskGraphs(): void {
  graphs.clear();
}
