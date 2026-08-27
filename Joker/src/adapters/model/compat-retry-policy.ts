import {
  DEFAULT_MODEL_REQUEST_RETRY_CONFIG,
  type ModelRequestRetryConfig
} from '../../config/Joker-config.js'

export type NormalizedModelRequestRetryConfig = {
  maxAttempts: number
  initialDelayMs: number
  httpStatusCodes: number[]
}

export function normalizeModelRequestRetryConfig(
  input: ModelRequestRetryConfig | undefined
): NormalizedModelRequestRetryConfig {
  const defaults = DEFAULT_MODEL_REQUEST_RETRY_CONFIG
  return {
    maxAttempts: boundedNonNegativeInteger(input?.maxAttempts, defaults.maxAttempts, 10),
    initialDelayMs: boundedNonNegativeInteger(input?.initialDelayMs, defaults.initialDelayMs, 600_000),
    httpStatusCodes: normalizeRetryHttpStatusCodes(input?.httpStatusCodes, defaults.httpStatusCodes)
  }
}

export function retryDelayMs(
  response: Response,
  initialDelayMs: number,
  attempt: number,
  options: { now?: () => number; random?: () => number } = {}
): number {
  // Fixed retry interval: every retry waits exactly `initialDelayMs`
  // (5s by default) regardless of the attempt count or Retry-After headers.
  return Math.max(0, Math.round(initialDelayMs))
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(600_000, Math.round(seconds * 1000))
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isFinite(dateMs)) return undefined
  return Math.min(600_000, Math.max(0, dateMs - now))
}

export function sleepWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(false)
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function normalizeRetryHttpStatusCodes(input: unknown, fallback: readonly number[]): number[] {
  const values = Array.isArray(input) ? input : fallback
  const codes = new Set<number>()
  for (const raw of values) {
    const code = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isInteger(code) || code < 400 || code > 599) continue
    codes.add(code)
  }
  return codes.size > 0 ? [...codes].sort((a, b) => a - b) : [...fallback]
}

function boundedNonNegativeInteger(value: unknown, fallback: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(0, Math.round(number)))
}
