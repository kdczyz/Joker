/**
 * Global concurrency gate + bounded queue for subagent runs.
 *
 * All delegated subagent tasks share ONE process-wide semaphore so a burst of
 * delegate_agents calls cannot overwhelm the upstream model provider (lesson
 * from real incidents: 4 parallel streams all died with "stream terminated").
 */

export interface SemaphoreConfig {
  /** Max concurrent holders. */
  limit: number;
  /** Max time (ms) a waiter may sit in the queue before timing out. */
  queueTimeoutMs: number;
}

export const DEFAULT_SEMAPHORE_CONFIG: SemaphoreConfig = {
  limit: 3,
  queueTimeoutMs: 60_000
};

export class SemaphoreAcquireTimeoutError extends Error {
  constructor(waitedMs: number) {
    super(`Subagent queue wait timed out after ${waitedMs}ms`);
    this.name = "SemaphoreAcquireTimeoutError";
  }
}

export class SemaphoreAbortedError extends Error {
  constructor() {
    super("Subagent queue wait was aborted");
    this.name = "SemaphoreAbortedError";
  }
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  onAbort: (() => void) | undefined;
  signal: AbortSignal | undefined;
}

export class Semaphore {
  private available: number;
  private readonly waiters: Waiter[] = [];
  private readonly config: SemaphoreConfig;

  constructor(config?: Partial<SemaphoreConfig>) {
    this.config = { ...DEFAULT_SEMAPHORE_CONFIG, ...config };
    if (!Number.isFinite(this.config.limit) || this.config.limit < 1) {
      throw new Error(`Semaphore limit must be >= 1, got ${this.config.limit}`);
    }
    this.available = this.config.limit;
  }

  get limit(): number {
    return this.config.limit;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  get activeCount(): number {
    return this.config.limit - this.available;
  }

  /**
   * Acquire a slot. Resolves with a release function. Rejects with
   * SemaphoreAbortedError / SemaphoreAcquireTimeoutError when applicable.
   */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new SemaphoreAbortedError();

    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          this.cleanupWaiter(waiter);
          resolve(this.makeRelease());
        },
        reject: (error: unknown) => {
          this.cleanupWaiter(waiter);
          reject(error);
        },
        timer: undefined,
        onAbort: undefined,
        signal
      };
      waiter.timer = setTimeout(() => {
        waiter.reject(new SemaphoreAcquireTimeoutError(this.config.queueTimeoutMs));
        this.pump();
      }, this.config.queueTimeoutMs);
      if (signal) {
        waiter.onAbort = () => {
          waiter.reject(new SemaphoreAbortedError());
          this.pump();
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  /** Run fn while holding a slot; always releases. */
  async runExclusive<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    this.available += 1;
    this.pump();
  }

  /** Hand freed slots to queued waiters in FIFO order. */
  private pump(): void {
    while (this.available > 0 && this.waiters.length > 0) {
      this.available -= 1;
      const waiter = this.waiters.shift()!;
      waiter.resolve();
    }
  }

  private cleanupWaiter(waiter: Waiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) this.waiters.splice(index, 1);
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.onAbort && waiter.signal) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }
}

let globalSemaphore = new Semaphore();
let configuredLimit: number | undefined;

/**
 * Returns the process-wide semaphore. On first call (or when the configured
 * limit changes) it is rebuilt from runtime config defaults.
 */
export function getSubagentSemaphore(config?: { limit?: number; queueTimeoutMs?: number }): Semaphore {
  const limit = config?.limit;
  if (limit !== undefined && limit !== configuredLimit && globalSemaphore.activeCount === 0 && globalSemaphore.queuedCount === 0) {
    configuredLimit = limit;
    globalSemaphore = new Semaphore({ limit, queueTimeoutMs: config?.queueTimeoutMs });
  }
  return globalSemaphore;
}

/** Test/config helper: replace the process-wide semaphore. */
export function setSubagentSemaphore(semaphore: Semaphore): void {
  configuredLimit = semaphore.limit;
  globalSemaphore = semaphore;
}
