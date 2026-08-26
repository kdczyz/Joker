/**
 * Built-in `verify_changes` tool backend (P2).
 *
 * Project-aware acceptance checks scoped to what actually changed:
 * - "focused": typecheck + targeted test run for files changed in the
 *   workspace (git status/diff), falling back to plain typecheck when no
 *   changed files or no matching tests are found.
 * - "full": every available quality script (typecheck, lint, test, build).
 *
 * Command construction is separated from execution so tests can assert the
 * plan without running npm.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type VerifyScope = "focused" | "full";

const QUALITY_SCRIPTS = ["typecheck", "lint", "test", "build"] as const;

const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

async function readPackageScripts(cwd: string): Promise<Record<string, string>> {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!existsSync(packageJsonPath)) return {};
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
    return packageJson.scripts ?? {};
  } catch {
    return {};
  }
}

function spawnCapture(command: string, args: string[], cwd: string): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.on("error", () => resolve({ exitCode: 1, stdout }));
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}

/** Changed workspace files from git (staged + unstaged + untracked). */
export async function changedWorkspaceFiles(cwd: string): Promise<string[]> {
  const out = new Set<string>();
  for (const args of [
    ["diff", "--name-only", "HEAD"],
    ["ls-files", "--others", "--exclude-standard"]
  ]) {
    const result = await spawnCapture("git", args, cwd);
    if (result.exitCode !== 0) continue;
    for (const line of result.stdout.split(/\r?\n/)) {
      const file = line.trim();
      if (file) out.add(file.split(path.sep).join("/"));
    }
  }
  return [...out];
}

/** Source files whose behavior a changed file's tests should cover. */
export function adjacentTestCandidates(changedFiles: string[]): string[] {
  const candidates = new Set<string>();
  for (const changed of changedFiles) {
    if (TEST_FILE_PATTERN.test(changed)) {
      candidates.add(changed);
      continue;
    }
    const parsed = path.parse(changed);
    const stem = parsed.name.replace(/\.[cm]?[jt]sx?$/, "");
    for (const candidate of [
      `${parsed.dir}/${parsed.name}.test.ts`,
      `${parsed.dir}/${stem}.test.ts`,
      `${parsed.dir}/__tests__/${parsed.name}.test.ts`,
      `${parsed.dir}/${parsed.name}.test.js`
    ]) {
      candidates.add(candidate.split(path.sep).join("/").replace(/\/\//g, "/").replace(/^\//, ""));
    }
  }
  return [...candidates];
}

export interface VerifyPlanStep {
  label: string;
  command: string | null;
}

/**
 * Build the ordered verification steps for the requested scope.
 * A step with command:null means "script not available" and is skipped at run time.
 */
export async function buildVerifyPlan(cwd: string, scope: VerifyScope): Promise<{ steps: VerifyPlanStep[]; notes: string[] }> {
  const scripts = await readPackageScripts(cwd);
  const notes: string[] = [];
  const steps: VerifyPlanStep[] = [];

  const has = (name: string) => typeof scripts[name] === "string";

  if (!has("typecheck") && !has("test") && !has("lint") && !has("build")) {
    notes.push("No typecheck/lint/test/build scripts found in package.json; nothing to verify.");
    return { steps, notes };
  }

  if (scope === "full") {
    for (const name of QUALITY_SCRIPTS) {
      steps.push({ label: name, command: has(name) ? `npm run ${name}` : null });
      if (!has(name)) notes.push(`Skip ${name}: no package script.`);
    }
    return { steps, notes };
  }

  // Focused scope: typecheck first.
  if (has("typecheck")) {
    steps.push({ label: "typecheck", command: "npm run typecheck" });
  } else {
    notes.push("Skip typecheck: no package script.");
  }

  // Then targeted tests for changed files when the test runner is vitest-like
  // (accepts explicit file paths). Plain `npm test` cannot take file filters,
  // so we only target files when the script invokes a path-aware runner.
  const changed = await changedWorkspaceFiles(cwd);
  if (changed.length === 0) {
    notes.push("No changed files detected via git; skipping targeted tests.");
  } else if (has("test") && /vitest|node --test|jest/.test(scripts.test ?? "")) {
    const candidates = adjacentTestCandidates(changed);
    const existing = candidates.filter((candidate) => existsSync(path.join(cwd, candidate)));
    if (existing.length > 0 && existing.length <= 20) {
      const runner = scripts.test!.includes("vitest") ? "npx vitest run" : scripts.test!.includes("jest") ? "npx jest" : "node --test";
      steps.push({ label: `targeted tests (${existing.length} files)`, command: `${runner} ${existing.map((file) => `"${file}"`).join(" ")}` });
    } else {
      notes.push(existing.length === 0
        ? "No adjacent test files found for the changed sources."
        : `Too many candidate test files (${existing.length}); falling back to full test script.`);
      if (existing.length > 20 && has("test")) steps.push({ label: "test", command: "npm run test" });
    }
  } else if (has("test")) {
    notes.push("Test script is not path-aware; running full test suite instead.");
    steps.push({ label: "test", command: "npm run test" });
  }

  return { steps, notes };
}

export interface VerifyRunContext {
  cwd: string;
  scope: VerifyScope;
  signal?: AbortSignal;
}

export async function runVerify(
  context: VerifyRunContext,
  execute: (command: string) => Promise<{ ok: boolean; output: string }>
): Promise<{ ok: boolean; content: string }> {
  const { steps, notes } = await buildVerifyPlan(context.cwd, context.scope);
  if (steps.length === 0) {
    return { ok: false, content: ["Verification failed: no checks available.", ...notes].join("\n") };
  }
  const sections: string[] = [];
  let allOk = true;
  for (const step of steps) {
    if (!step.command) continue;
    const outcome = await execute(step.command);
    sections.push(`## ${step.label} — ${outcome.ok ? "PASS" : "FAIL"}\n${outcome.output.slice(0, 4000)}`);
    if (!outcome.ok) {
      allOk = false;
      break; // Stop at the first failing check; later steps depend on earlier ones.
    }
  }
  const header = `${allOk ? "All verification checks passed" : "Verification FAILED"} (scope: ${context.scope}).`;
  return { ok: allOk, content: [header, ...notes.map((note) => `- ${note}`), "", ...sections].join("\n").trim() };
}
