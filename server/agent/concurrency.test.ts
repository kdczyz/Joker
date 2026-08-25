import assert from "node:assert/strict";
import test from "node:test";
import {
  Semaphore,
  SemaphoreAbortedError,
  SemaphoreAcquireTimeoutError,
  getSubagentSemaphore,
  setSubagentSemaphore
} from "./concurrency";

test("Semaphore allows up to limit concurrent holders", async () => {
  const semaphore = new Semaphore({ limit: 2, queueTimeoutMs: 1_000 });
  const release1 = await semaphore.acquire();
  const release2 = await semaphore.acquire();
  assert.equal(semaphore.activeCount, 2);
  assert.equal(semaphore.queuedCount, 0);
  release1();
  release2();
  assert.equal(semaphore.activeCount, 0);
});

test("Semaphore queues excess acquirers in FIFO order", async () => {
  const semaphore = new Semaphore({ limit: 1, queueTimeoutMs: 5_000 });
  const order: number[] = [];
  const release = await semaphore.acquire();
  const p1 = semaphore.acquire().then((r) => {
    order.push(1);
    return r;
  });
  const p2 = semaphore.acquire().then((r) => {
    order.push(2);
    return r;
  });
  assert.equal(semaphore.queuedCount, 2);
  release();
  (await p1)();
  assert.deepEqual(order, [1]);
  (await p2)();
  assert.deepEqual(order, [1, 2]);
});

test("Semaphore queue wait times out", async () => {
  const semaphore = new Semaphore({ limit: 1, queueTimeoutMs: 30 });
  const release = await semaphore.acquire();
  await assert.rejects(
    () => semaphore.acquire(),
    (error: unknown) => error instanceof SemaphoreAcquireTimeoutError
  );
  release();
});

test("Semaphore acquire rejects immediately when signal already aborted", async () => {
  const semaphore = new Semaphore({ limit: 1, queueTimeoutMs: 1_000 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => semaphore.acquire(controller.signal),
    (error: unknown) => error instanceof SemaphoreAbortedError
  );
});

test("Semaphore queued waiter is cancelled by abort", async () => {
  const semaphore = new Semaphore({ limit: 1, queueTimeoutMs: 5_000 });
  const controller = new AbortController();
  const release = await semaphore.acquire();
  const waiter = semaphore.acquire(controller.signal);
  controller.abort();
  await assert.rejects(() => waiter, (error: unknown) => error instanceof SemaphoreAbortedError);
  // Release the held slot, then confirm a fresh acquire succeeds immediately
  // (the aborted waiter must have been removed from the queue).
  release();
  const next = await semaphore.acquire();
  next();
});

test("runExclusive always releases even when fn throws", async () => {
  const semaphore = new Semaphore({ limit: 1, queueTimeoutMs: 100 });
  await assert.rejects(() => semaphore.runExclusive(async () => {
    throw new Error("boom");
  }), /boom/);
  const release = await semaphore.acquire();
  release();
});

test("global semaphore can be swapped for tests", async () => {
  const replacement = new Semaphore({ limit: 4, queueTimeoutMs: 1_000 });
  setSubagentSemaphore(replacement);
  assert.equal(getSubagentSemaphore(), replacement);
});
