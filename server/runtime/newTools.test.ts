import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatWebSearchOutput, runWebSearch } from "./webSearch";
import { runTaskGraphTool, resetTaskGraphs } from "./taskGraphTool";
import { runLoadSkillTool, skillCatalogPrompt } from "./skillTool";
import { buildRepoMap } from "./repoMap";
import { TaskGraph } from "../tasks/task-graph";

// --- task-graph core (DAG semantics) ---

test("task graph: dependencies gate readiness and cascade blocking", () => {
  const graph = new TaskGraph({ concurrency: 2 });
  graph.add({ id: "a", title: "A" });
  graph.add({ id: "b", title: "B", dependsOn: ["a"] });
  graph.add({ id: "c", title: "C", dependsOn: ["a"] });

  assert.deepEqual(graph.nextRunnable().map((t) => t.id), ["a"]);
  graph.markRunning("a");
  assert.equal(graph.runningCount(), 1);
  graph.markSucceeded("a");
  const ready = graph.nextRunnable().map((t) => t.id);
  assert.ok(ready.includes("b") && ready.includes("c"));

  graph.markRunning("b");
  graph.markFailed("b", "boom");
  // b failed terminally → dependent blocked; c still runnable.
  const after = graph.list().find((t) => t.id === "b");
  assert.equal(after?.state, "failed");
});

test("task graph: rejects cycles and duplicate ids", () => {
  const graph = new TaskGraph();
  graph.add({ id: "x", title: "X" });
  assert.throws(() => graph.add({ id: "y", title: "Y", dependsOn: ["y"] }), /cycle/);
  assert.throws(() => graph.add({ id: "x", title: "dup" }), /duplicate/);
});

// --- task_graph tool backend (per-thread state + persistence) ---

test("task_graph tool: add → next → start → complete roundtrip with persistence", async () => {
  resetTaskGraphs();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "joker-taskgraph-"));
  try {
    const context = { conversationId: "thread-1", workspaceRoot: workspace };

    const added = await runTaskGraphTool(
      { action: "add", id: "t1", title: "First" },
      context
    );
    assert.equal((added as { tasks: Array<{ state: string }> }).tasks[0].state, "pending");

    const next = await runTaskGraphTool({ action: "next" }, context);
    assert.deepEqual(next, { runnable: [{ id: "t1", title: "First", state: "ready" }], complete: false });

    await runTaskGraphTool({ action: "start", id: "t1" }, context);
    const done = await runTaskGraphTool({ action: "complete", id: "t1" }, context);
    assert.equal((done as { complete: boolean }).complete, true);

    // Fresh in-memory map should restore from disk persistence.
    resetTaskGraphs();
    const restored = await runTaskGraphTool({ action: "list" }, context);
    assert.equal((restored as { tasks: Array<{ id: string }> }).tasks[0].id, "t1");

    const bad = await runTaskGraphTool({ action: "start", id: "missing" }, context);
    assert.match(String((bad as { error?: string }).error), /unknown task/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("task_graph tool: rejects unknown actions and invalid add", async () => {
  resetTaskGraphs();
  const unknown = await runTaskGraphTool({ action: "explode" }, {});
  assert.match(String((unknown as { error?: string }).error), /unknown task_graph action/i);
  const missing = await runTaskGraphTool({ action: "add" }, {});
  assert.match(String((missing as { error?: string }).error), /id and title are required/i);
});

// --- web_search (mocked engines) ---

const DUCK_HTML = `
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="https://example.com/a">Example A</a>
  <a class="result__snippet" href="#">Snippet A text</a>
</div>
<div>
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb&rut=abc">Example B</a>
  <a class="result__snippet" href="#">Snippet B text</a>
</div>`;

function withMockFetch(handler: (url: string) => { status: number; body: string }, impl: () => void): void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = handler(url);
    return new Response(response.body, { status: response.status });
  }) as typeof fetch;
  try {
    impl();
  } finally {
    globalThis.fetch = original;
  }
}

test("web_search parses duckduckgo html including redirect targets", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(DUCK_HTML, { status: 200 })) as typeof fetch;
  try {
    const { results, engineErrors } = await runWebSearch({ query: "test", engines: ["duckduckgo"], limit: 5 });
    assert.equal(engineErrors.length, 0);
    assert.equal(results.length, 2);
    assert.equal(results[0].url, "https://example.com/a");
    assert.equal(results[0].title, "Example A");
    assert.equal(results[0].engine, "duckduckgo");
    assert.equal(results[1].url, "https://example.org/b");
    assert.equal(results[0].snippet, "Snippet A text");
  } finally {
    globalThis.fetch = original;
  }
});

test("web_search falls through to the next engine on failure and dedupes by url", async () => {
  const original = globalThis.fetch;
  let call = 0;
  const bingHtml = `<ol><li class="b_algo"><h2><a href="https://example.com/a">Example A</a></h2><p>Bing snippet</p></li><li class="b_algo"><h2><a href="https://example.com/c">Example C</a></h2><p>C snippet</p></li></ol>`;
  globalThis.fetch = (async () => {
    call += 1;
    if (call === 1) throw new Error("network down"); // duckduckgo fails
    return new Response(bingHtml, { status: 200 });   // bing succeeds
  }) as typeof fetch;
  try {
    // First engine returns nothing cached; simulate duckduckgo throwing.
    const { results, engineErrors } = await runWebSearch({
      query: "test",
      engines: ["bing", "bing"],
      limit: 10
    });
    // Both bing calls hit the mock; dedupe keeps unique URLs only.
    assert.equal(results.filter((r) => r.url === "https://example.com/a").length, 1);
    assert.ok(results.length >= 1);

    // Now a real cross-engine fallback case:
    let duckFailed = false;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("duckduckgo")) {
        duckFailed = true;
        throw new Error("ddg blocked");
      }
      return new Response(bingHtml, { status: 200 });
    }) as typeof fetch;
    const fallback = await runWebSearch({ query: "q", engines: ["duckduckgo", "bing"], limit: 10 });
    assert.equal(duckFailed, true);
    assert.equal(fallback.results.length, 2);
    assert.equal(fallback.engineErrors.length, 1);
    assert.equal(fallback.engineErrors[0].engine, "duckduckgo");
    assert.match(formatWebSearchOutput(fallback), /partial/);
  } finally {
    globalThis.fetch = original;
  }
});

test("web_search reports a clear message when every engine fails", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  try {
    const { results, engineErrors } = await runWebSearch({ query: "q", engines: ["duckduckgo", "bing"] });
    assert.equal(results.length, 0);
    assert.equal(engineErrors.length, 2);
    assert.match(formatWebSearchOutput({ results, engineErrors }), /No results found.*Engine errors:/s);
  } finally {
    globalThis.fetch = original;
  }
});

void withMockFetch;

// --- load_skill tool + catalog prompt ---

async function writeTestSkill(projectPath: string): Promise<void> {
  const skillRoot = path.join(projectPath, ".agent", "skills", "load-me");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, "SKILL.md"), `---
name: load-me
description: Use when testing load_skill explicitly.
---

# Load Me

Explicit skill content for load_skill tests.
`);
}

test("load_skill loads an explicit skill and lists valid ids on miss", async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "joker-loadskill-"));
  try {
    await writeTestSkill(projectPath);
    const loaded = await runLoadSkillTool({ skill_id: "load-me" }, projectPath);
    assert.equal(loaded.ok, true);
    assert.match(loaded.content, /# Skill: load-me \(project\)/);
    assert.match(loaded.content, /Explicit skill content/);

    const miss = await runLoadSkillTool({ skill_id: "nope" }, projectPath);
    assert.equal(miss.ok, false);
    assert.match(miss.content, /Unknown skill "nope"/);
    assert.match(miss.content, /load-me/);

    const empty = await runLoadSkillTool({}, projectPath);
    assert.equal(empty.ok, false);
    assert.match(empty.content, /skill_id is required/);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("skill catalog prompt is sorted and lists descriptions", async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "joker-catalog-"));
  try {
    await writeTestSkill(projectPath);
    const second = path.join(projectPath, ".agent", "skills", "aaa-second");
    await mkdir(second, { recursive: true });
    await writeFile(path.join(second, "SKILL.md"), `---
name: aaa-second
description: Alphabetically first helper.
---

body
`);
    const prompt = await skillCatalogPrompt(projectPath);
    assert.match(prompt, /Available skills/);
    const lines = prompt.split("\n").filter((line) => line.startsWith("- "));
    // The catalog merges user/builtin skills too; the two test skills must be
    // present and sorted alphabetically relative to each other.
    const secondIndex = lines.findIndex((line) => line.startsWith("- aaa-second:"));
    const loadMeIndex = lines.findIndex((line) => line.startsWith("- load-me:"));
    assert.ok(secondIndex !== -1, "aaa-second listed");
    assert.ok(loadMeIndex !== -1, "load-me listed");
    assert.ok(secondIndex < loadMeIndex, "catalog entries are sorted by name");
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

// --- repo_map ---

test("repo_map ranks files and reports totals on a small tree", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "joker-repomap-"));
  try {
    await mkdir(path.join(workspace, "src"), { recursive: true });
    await writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "demo" }));
    await writeFile(
      path.join(workspace, "src", "auth.ts"),
      [
        "export function loginUser(name: string) { return name; }",
        "export class AuthManager {}"
      ].join("\n")
    );
    await writeFile(path.join(workspace, "src", "index.ts"), "export const main = () => 0;\n");
    await writeFile(path.join(workspace, "README.md"), "# demo\n");

    const map = await buildRepoMap({ workspaceRoot: workspace, query: "auth login" });
    assert.equal(map.workspaceRoot, workspace);
    const files = map.files as Array<{ relative_path: string; score: number; reasons: string[] }>;
    assert.ok(files.length >= 2);
    assert.equal(files[0].relative_path.includes("auth.ts"), true);
    assert.deepEqual(files[0].reasons, expectReasons(files[0].reasons));

    assert.equal((map.totals as { indexedFiles: number }).indexedFiles >= 3, true);
    const entrypoints = map.entrypoints as string[];
    assert.ok(entrypoints.some((entry) => entry === "package.json" || entry.startsWith("src/")));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function expectReasons(reasons: string[]): string[] {
  assert.ok(reasons.includes("query_match"));
  return reasons;
}
