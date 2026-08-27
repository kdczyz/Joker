import { performance } from 'node:perf_hooks'

export type EventLoopMonitorHandle = { stop: () => void }

export type EventLoopMonitorOptions = {
  /** Heartbeat cadence; the smaller this is, the finer the stall resolution. */
  intervalMs?: number
  /** Log when a heartbeat fires this much later than its scheduled interval. */
  stallThresholdMs?: number
  /** Injectable monotonic clock (defaults to performance.now()). */
  now?: () => number
  /** Injectable log sink (defaults to console.warn → captured by the GUI). */
  log?: (line: string) => void
}

const DEFAULT_INTERVAL_MS = 1_000
const DEFAULT_STALL_THRESHOLD_MS = 2_000

/**
 * Logs when the runtime's (single) event loop stalls — i.e. a heartbeat timer
 * fires much later than scheduled because synchronous work blocked the loop in
 * between. A stall is exactly the window during which `/health` probes and SSE
 * time out, so this disambiguates the two failure modes behind a watchdog
 * restart (kdczyz/Joker#621):
 *
 *   - a stall is logged and the runtime keeps going → CPU starvation: a heavy
 *     synchronous step blocked the loop; the magnitude is how long `/health`
 *     was unanswerable.
 *   - the GUI reports the runtime unhealthy but NO stall is ever logged (the
 *     heartbeat never fires again) → a hard hang / deadlock: the loop is wedged,
 *     not merely busy.
 *
 * Cheap: a single `unref`'d timer that only logs above the threshold.
 */
export function startEventLoopMonitor(options: EventLoopMonitorOptions = {}): EventLoopMonitorHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const stallThresholdMs = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS
  const now = options.now ?? (() => performance.now())
  const log = options.log ?? ((line: string) => console.warn(line))

  let last = now()
  const timer = setInterval(() => {
    const current = now()
    const stall = current - last - intervalMs
    last = current
    if (stall >= stallThresholdMs) {
      log(
        `[Joker] event loop stalled for ~${Math.round(stall)}ms — ` +
          `health checks and SSE were unanswerable during this window`
      )
    }
  }, intervalMs)
  // Never keep the process alive for the monitor alone.
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

/** Resolve the stall-log threshold, overridable via `JOKER_EVENT_LOOP_STALL_LOG_MS`. */
export function resolveEventLoopStallThresholdMs(env: NodeJS.ProcessEnv): number {
  const raw = env.JOKER_EVENT_LOOP_STALL_LOG_MS
  if (raw && raw.trim()) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }
  return DEFAULT_STALL_THRESHOLD_MS
}

// ---------------------------------------------------------------------------
// Blocking-call attribution (event loop stall diagnostics)
// ---------------------------------------------------------------------------

type CpuProfileCallFrame = {
  functionName?: string
  url?: string
  lineNumber?: number
  columnNumber?: number
}

type CpuProfileNode = { id: number; callFrame?: CpuProfileCallFrame }

type EventLoopCpuProfile = { nodes: CpuProfileNode[]; samples?: number[] }

export type EventLoopProfileFrame = {
  functionName: string
  location: string
  hits: number
}

/**
 * Reduce a V8 CPU profile to the hottest self-time frames. `profile.samples`
 * is one node id per sampler tick; a tick taken *while the loop was blocked*
 * lands on the very JS function that held the loop, so its node dominates the
 * count. Frames without a JS origin (idle / GC / native C++ frames carry no
 * `url`) are skipped — they are not actionable.
 */
export function summarizeHottestProfileFrames(profile: EventLoopCpuProfile): EventLoopProfileFrame[] {
  const nodes = new Map<number, CpuProfileNode>()
  for (const node of profile.nodes ?? []) nodes.set(node.id, node)

  const hitsByNode = new Map<number, number>()
  for (const sample of profile.samples ?? []) {
    const node = nodes.get(sample)
    if (!node?.callFrame?.url) continue
    hitsByNode.set(sample, (hitsByNode.get(sample) ?? 0) + 1)
  }

  return [...hitsByNode.entries()]
    .map(([id, hits]): EventLoopProfileFrame => {
      const frame = nodes.get(id)!.callFrame!
      const url = frame.url ?? ''
      const functionName = frame.functionName?.trim() || '(anonymous)'
      const file = url.split('/').pop() || url || '<unknown>'
      const line = frame.lineNumber != null ? frame.lineNumber + 1 : 0
      return { functionName, location: `${file}:${line}`, hits }
    })
    .sort((left, right) => right.hits - left.hits)
    .slice(0, 3)
}

export type EventLoopStallDiagnosticsHandle = { stop: () => void }

export type EventLoopStallDiagnosticsOptions = {
  /** How often the diagnosis heartbeat checks event-loop responsiveness. */
  heartbeatMs?: number
  /** Only attribute stalls at least this long to a blocking frame. */
  stallThresholdMs?: number
  /** V8 sampling interval in microseconds (50_000 == every 50ms). */
  profileIntervalUs?: number
  /** Injectable log sink (defaults to console.warn → captured by the GUI). */
  log?: (line: string) => void
  /** Injectable monotonic clock. */
  now?: () => number
  /** Force-disable (default honours JOKER_DISABLE_EVENT_LOOP_PROFILER=1). */
  disable?: boolean
}

const DEFAULT_DIAGNOSTICS_HEARTBEAT_MS = 200
const DEFAULT_DIAGNOSTICS_STALL_MS = 2_000
const DEFAULT_PROFILE_INTERVAL_US = 50_000

/**
 * Attribute event-loop stalls to the offending synchronous code.
 *
 * The plain stall monitor can only say *how long* the loop blocked — by the
 * time its heartbeat timer fires, the blocking call has returned and its stack
 * is gone. This diagnostic instead runs a long-lived V8 sampling CPU profiler
 * (the sampler runs on the inspector thread, so it records samples *into the
 * middle of* a synchronous block on the main thread). When the loop then
 * stalls, we stop the profiler and report the hottest frame — i.e. the
 * function that held the loop. Best-effort: any inspector failure degrades to
 * a no-op rather than compounding the stall.
 */
export function startEventLoopStallDiagnostics(
  options: EventLoopStallDiagnosticsOptions = {}
): EventLoopStallDiagnosticsHandle {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_DIAGNOSTICS_HEARTBEAT_MS
  const stallThresholdMs = options.stallThresholdMs ?? DEFAULT_DIAGNOSTICS_STALL_MS
  const profileIntervalUs = options.profileIntervalUs ?? DEFAULT_PROFILE_INTERVAL_US
  const logLine = options.log ?? ((line: string) => console.warn(line))
  const now = options.now ?? (() => performance.now())

  if (options.disable === true || process.env.JOKER_DISABLE_EVENT_LOOP_PROFILER === '1') {
    return { stop: () => {} }
  }

  let disposed = false
  let session: {
    post: (method: string, params: Record<string, unknown>, cb: (err: unknown, res?: unknown) => void) => void
    disconnect: () => void
  } | null = null
  let analyzing = false
  let lastReportedLabel = ''

  const post = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (!session) return reject(new Error('no inspector session'))
      session.post(method, params, (err, result) => (err ? reject(err) : resolve(result)))
    })

  async function ensureProfiler(): Promise<void> {
    if (session) return
    const inspector = await import('node:inspector')
    const created = new inspector.Session()
    created.connect()
    session = created
    await post('Profiler.enable')
    await post('Profiler.setSamplingInterval', { interval: profileIntervalUs })
    await post('Profiler.start')
  }

  async function reportStall(stallMs: number): Promise<void> {
    if (disposed || analyzing) return
    analyzing = true
    try {
      if (!session) await ensureProfiler()
      const { profile } = (await post('Profiler.stop')) as { profile: EventLoopCpuProfile }
      await post('Profiler.start')
      const hottest = summarizeHottestProfileFrames(profile)
      if (hottest.length === 0) return
      const top = hottest[0]!
      const label = `${top.functionName} @ ${top.location} (${top.hits} samples)`
      if (label === lastReportedLabel) return // dedupe a repeating blocker
      lastReportedLabel = label
      const near = hottest.length > 1 ? `; near ${hottest.slice(1).map((f) => `${f.functionName} @ ${f.location}`).join(', ')}` : ''
      logLine(
        `[Joker] event loop blocked for ~${Math.round(stallMs)}ms — ${label}` +
          `${near}\n(health checks and SSE were unanswerable during this window)`
      )
    } catch {
      // Profiling is best-effort; never let a diagnostic failure mask the stall.
    } finally {
      analyzing = false
    }
  }

  // Start collecting samples immediately so the first stall is already covered.
  void ensureProfiler().catch(() => {})

  let last = now()
  const timer = setInterval(() => {
    const current = now()
    const stall = current - last - heartbeatMs
    last = current
    if (stall >= stallThresholdMs) void reportStall(stall)
  }, heartbeatMs)
  timer.unref?.()

  return {
    stop: () => {
      if (disposed) return
      disposed = true
      clearInterval(timer)
      if (session) {
        try {
          session.disconnect()
        } catch {
          // best effort
        }
      }
    }
  }
}
