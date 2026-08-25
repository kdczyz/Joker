import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RETRY_OPTIONS,
  isTransientAiError,
  withRetry
} from "./retry";

test("isTransientAiError classifies transient upstream failures", () => {
  assert.equal(isTransientAiError("model stream read failed: terminated"), true);
  assert.equal(isTransientAiError("fetch failed"), true);
  assert.equal(isTransientAiError("AI provider error 429: too many requests"), true);
  assert.equal(isTransientAiError("socket hang up"), true);
  assert.equal(isTransientAiError("ECONNRESET reading response"), true);
  assert.equal(isTransientAiError("Tool read_file failed"), false);
  assert.equal(isTransientAiError("Permission denied"), false);
});

test("withRetry retries transient errors and eventually succeeds", async () => {
  let attempts = 0;
  const attemptsSeen: number[] = [];
  const result = await withRetry(
    async () => {
      attempts += 1;
      attemptsSeen.push(attempts);
      if (attempts < 3) throw new Error("stream terminated");
      return "ok";
    },
    { retries: 3, baseMs: 1, jitterMs: 1 }
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("withRetry does not retry non-transient errors", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("Unknown tool: nope");
        },
        { retries: 3, baseMs: 1, jitterMs: 1 }
      ),
    /Unknown tool/
  );
  assert.equal(attempts, 1);
});

test("withRetry exhausts retries and throws the last error", async () => {
  let attempts = 0;
  const onRetryCalls: number[] = [];
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("fetch failed");
        },
        {
          retries: 2,
          baseMs: 1,
          jitterMs: 1,
          onRetry: (attempt) => {
            onRetryCalls.push(attempt);
          }
        }
      ),
    /fetch failed/
  );
  assert.equal(attempts, 3); // initial + 2 retries
  assert.deepEqual(onRetryCalls, [1, 2]);
});

test("withRetry propagates AbortError without retrying", async () => {
  let attempts = 0;
  const abortError = new DOMException("Operation was aborted", "AbortError");
  await assert.rejects(
    () =>
      withRetry(async () => {
        attempts += 1;
        throw abortError;
      }, { retries: 5, baseMs: 1 }),
    (error: unknown) => error instanceof Error && error.name === "AbortError"
  );
  assert.equal(attempts, 1);
});

test("default retry options are conservative", () => {
  assert.equal(DEFAULT_RETRY_OPTIONS.retries, 3);
  assert.ok(DEFAULT_RETRY_OPTIONS.baseMs >= 1000);
});
