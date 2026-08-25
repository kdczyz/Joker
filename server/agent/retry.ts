/**
 * Unified retry with exponential backoff + jitter for AI provider calls.
 *
 * Covers transient upstream failures beyond HTTP 429: terminated streams,
 * fetch failures, and connection resets. Shared by the main agent loop and
 * the subagent runner so retry policy stays consistent.
 */

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  jitterMs?: number;
  /** Extra predicate on the error message; defaults to isTransientAiError. */
  retryOn?: (message: string) => boolean;
  /** Called before each wait so callers can surface progress to the user. */
  onRetry?: (attempt: number, waitMs: number, message: string) => Promise<void> | void;
  signal?: AbortSignal;
}

export const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, "retryOn" | "onRetry" | "signal">> = {
  retries: 3,
  baseMs: 1500,
  jitterMs: 600
};

/** Error messages worth retrying (transient network / rate-limit class). */
export function isTransientAiError(message: string): boolean {
  if (typeof message !== "string") return false;
  const msg = message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("terminated") ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("stream read failed") ||
    msg.includes("network")
  );
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Operation was aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Operation was aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRY_OPTIONS.retries;
  const baseMs = options.baseMs ?? DEFAULT_RETRY_OPTIONS.baseMs;
  const jitterMs = options.jitterMs ?? DEFAULT_RETRY_OPTIONS.jitterMs;
  const retryOn = options.retryOn ?? isTransientAiError;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= retries || !retryOn(message)) throw error;
      // Exponential backoff + jitter to avoid synchronized thundering herds.
      const waitMs = baseMs * Math.pow(2, attempt) + Math.random() * jitterMs;
      await options.onRetry?.(attempt + 1, waitMs, message);
      await sleep(waitMs, options.signal);
    }
  }
  throw lastError;
}
