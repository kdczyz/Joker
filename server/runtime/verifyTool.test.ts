import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  adjacentTestCandidates,
  buildVerifyPlan,
  changedWorkspaceFiles,
  runVerify
} from "./verifyTool";

test("verify plan: full scope lists every available quality script", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "rcode-verify-full-"));
  try {
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc", lint: "eslint .", test: "vitest run", build: "vite build" } })
    );
    const { steps, notes } = await buildVerifyPlan(cwd, "full");
    assert.deepEqual(steps.map((step) => step.label), ["typecheck", "lint", "test", "build"]);
    for (const step of steps) assert.match(step.command!, /^npm run /);
    assert.equal(notes.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("verify plan: focused scope adds targeted tests for changed sources", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "rcode-verify-focused-"));
  try {
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc", test: "vitest run" } })
    );
    // Simulate a git repo with one changed source file.
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init"], { cwd });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd });
    execFileSync("git", ["config", "user.name", "t"], { cwd });
    await writeFile(path.join(cwd, ".gitignore"), "node_modules\n");
    await writeFile(path.join(cwd, "src", "auth.ts"), "export const a = 1;\n");
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd });
    await writeFile(path.join(cwd, "src", "auth.ts"), "export const a = 2;\n");

    const changed = await changedWorkspaceFiles(cwd);
    assert.deepEqual(changed, ["src/auth.ts"]);

    const candidates = adjacentTestCandidates(changed);
    assert.ok(candidates.includes("src/auth.test.ts"));

    // Create the adjacent test so the plan picks it up.
    await writeFile(path.join(cwd, "src", "auth.test.ts"), "import test from 'node:test'; test('x', () => {});\n");
    const { steps, notes } = await buildVerifyPlan(cwd, "focused");
    const labels = steps.map((step) => step.label);
    assert.ok(labels.includes("typecheck"));
    const targeted = steps.find((step) => step.label.startsWith("targeted tests"));
    assert.ok(targeted, "targeted test step present");
    assert.match(targeted!.command!, /vitest run.*src\/auth\.test\.ts/);
    assert.ok(notes.length >= 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("verify plan: no quality scripts yields an explicit note and no steps", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "rcode-verify-empty-"));
  try {
    await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "bare" }));
    const { steps, notes } = await buildVerifyPlan(cwd, "focused");
    assert.equal(steps.length, 0);
    assert.match(notes[0] ?? "", /No typecheck\/lint\/test\/build scripts/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runVerify stops at the first failing check and reports it", async () => {
  const calls: string[] = [];
  const outcome = await runVerify(
    { cwd: "/unused", scope: "full" },
    async (command) => {
      calls.push(command);
      if (command === "npm run typecheck") return { ok: false, output: "error TS2321 in auth.ts" };
      return { ok: true, output: "ok" };
    }
  );
  assert.equal(outcome.ok, false);
  assert.match(outcome.content, /Verification FAILED/);
  assert.match(outcome.content, /FAIL[\s\S]*TS2321/);
  // Later steps must not run after the failure.
  assert.ok(!calls.includes("npm run build"));
});

test("runVerify passes when every step succeeds", async () => {
  const outcome = await runVerify(
    { cwd: "/unused", scope: "focused" },
    async () => ({ ok: true, output: "all good" })
  ).catch(() => null);
  // With a fake cwd the plan may be empty; only assert on the success path shape
  // via a controlled plan by using a temp dir with real scripts.
  const cwd = await mkdtemp(path.join(os.tmpdir(), "rcode-verify-pass-"));
  try {
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { typecheck: "true" } })
    );
    const result = await runVerify({ cwd, scope: "focused" }, async () => ({ ok: true, output: "clean" }));
    assert.equal(result.ok, true);
    assert.match(result.content, /All verification checks passed/);
    assert.match(result.content, /PASS/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
