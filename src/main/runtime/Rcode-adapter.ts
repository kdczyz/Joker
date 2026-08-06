import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_RCODE_DATA_DIR,
  getRcodeRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  buildRcodeServeArgs,
  resolveRcodeExecutable
} from '../resolve-Rcode-binary'
import {
  isRcodeChildRunning,
  reclaimRcodePort,
  resolveAvailableRcodePort,
  startRcodeChild,
  stopRcodeChildAndWait
} from '../Rcode-process'
import { getRcodeBaseUrl } from '../Rcode-base-url'

const RCODE_RUNTIME_ID = 'Rcode' as const

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

export const RcodeRuntimeAdapter = {
  id: RCODE_RUNTIME_ID,

  async resolveExecutable(settings: AppSettingsV1): Promise<string> {
    const runtime = getRcodeRuntimeSettings(settings)
    const resolution = resolveRcodeExecutable(appRoot(), runtime.binaryPath)
    if (resolution.kind === 'node-script') {
      const scriptPath = resolution.args[0] ?? ''
      return runtime.binaryPath.trim()
        ? `Node.js script (${scriptPath})`
        : `Bundled Rcode (${scriptPath})`
    }
    return resolution.command
  },

  ensureRunning(settings: AppSettingsV1): Promise<void> {
    return startRcodeChild(settings)
  },

  stopAndWait(): Promise<void> {
    return stopRcodeChildAndWait()
  },

  isChildRunning(): boolean {
    return isRcodeChildRunning()
  },

  getBaseUrl(settings: AppSettingsV1): string {
    const runtime = getRcodeRuntimeSettings(settings)
    return getRcodeBaseUrl(runtime.port)
  },

  reclaimPort(port: number): Promise<{ ok: true } | { ok: false; message: string }> {
    return reclaimRcodePort(port)
  },

  resolveAvailablePort(port: number): Promise<{ port: number; changed: boolean; message?: string }> {
    return resolveAvailableRcodePort(port)
  }
}

export function getRuntimeBaseUrlForSettings(settings: AppSettingsV1): string {
  return RcodeRuntimeAdapter.getBaseUrl(settings)
}

/** Build the bearer-token authorization header for Rcode requests. */
export function runtimeAuthHeaders(settings: AppSettingsV1): Headers {
  const runtime = getRcodeRuntimeSettings(settings)
  const headers = new Headers()
  if (runtime.runtimeToken.trim()) {
    headers.set('Authorization', `Bearer ${runtime.runtimeToken.trim()}`)
  }
  return headers
}

export type RuntimeRequestInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}

export async function runtimeRequestViaHost(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: RuntimeRequestInit,
  ensureRuntime: (settings: AppSettingsV1) => Promise<AppSettingsV1 | void>
): Promise<{ ok: boolean; status: number; body: string }> {
  init.signal?.throwIfAborted()
  const ensuredSettings = await ensureRuntime(settings)
  init.signal?.throwIfAborted()
  const requestSettings = ensuredSettings ?? settings
  const method = (init.method ?? 'GET').toUpperCase()
  const base = getRuntimeBaseUrlForSettings(requestSettings)
  const pathNorm = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  try {
    return await fetchRuntimeRequest(requestSettings, base, pathNorm, method, init)
  } catch (error) {
    if (init.signal?.aborted) throw error
    const retrySettings = await ensureRuntime(requestSettings)
    init.signal?.throwIfAborted()
    const nextSettings = retrySettings ?? requestSettings
    const nextBase = getRuntimeBaseUrlForSettings(nextSettings)
    const safeToRetry =
      method === 'GET' ||
      method === 'HEAD' ||
      (nextBase !== base && isRuntimeConnectionFailure(error))
    if (!safeToRetry) throw error
    return fetchRuntimeRequest(nextSettings, nextBase, pathNorm, method, init)
  }
}

async function fetchRuntimeRequest(
  settings: AppSettingsV1,
  base: string,
  pathNorm: string,
  method: string,
  init: RuntimeRequestInit
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${base}${pathNorm}`
  const hdrs = runtimeAuthHeaders(settings)
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    hdrs.set(key, value)
  }
  hdrs.set('Accept', 'application/json')
  if (init.body && !hdrs.has('Content-Type')) {
    hdrs.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    method,
    headers: hdrs,
    body: init.body,
    signal: requestSignal(init.signal, method === 'POST' ? 60_000 : 15_000)
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text }
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function isRuntimeConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = `${error.name} ${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`.toLowerCase()
  return (
    text.includes('fetch failed') ||
    text.includes('econnrefused') ||
    text.includes('econnreset') ||
    text.includes('socket') ||
    text.includes('connect')
  )
}

export { buildRcodeServeArgs, resolveRcodeExecutable }

/**
 * Default data directory used when the user has not provided one.
 * The path lives under the app user-data directory so packaged
 * installs do not need write access to the install folder.
 */
export function defaultRcodeDataDir(): string {
  return DEFAULT_RCODE_DATA_DIR.replace(/^~(?=$|[\\/])/, homedir())
}
