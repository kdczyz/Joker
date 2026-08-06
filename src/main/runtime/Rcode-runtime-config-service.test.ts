import { describe, expect, it } from 'vitest'
import {
  defaultRcodeRuntimeSettings,
  defaultModelProviderSettings,
  normalizeAppSettings,
  resolveRcodeRuntimeSettings
} from '../../shared/app-settings'
import { RcodeConfigSchema } from '../../../Rcode/src/config/Rcode-config.js'
import {
  RuntimeConfigApplyRequest,
  type RuntimeConfigApplyRequest as RuntimeConfigApplyPayload
} from '../../../Rcode/src/contracts/runtime-config.js'
import { applyRuntimeConfig } from '../../../Rcode/src/server/routes/runtime-config.js'
import type { ServerRuntime } from '../../../Rcode/src/server/routes/server-runtime.js'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  buildManagedRuntimeHotApplyBody,
  classifyManagedRuntimeHotApplyResponse
} from './Rcode-runtime-config-service'

describe('Rcode runtime config service', () => {
  it('projects canonical runtime fields into a hot-apply body without restart-only config', async () => {
    const runtime = {
      ...defaultRcodeRuntimeSettings(),
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      model: 'model-next',
      approvalPolicy: 'never' as const,
      sandboxMode: 'read-only' as const
    }
    const base = normalizeAppSettings({} as AppSettingsV1)
    const settings = normalizeAppSettings({
      ...base,
      provider: defaultModelProviderSettings(),
      agents: { Rcode: runtime }
    })
    const body = buildManagedRuntimeHotApplyBody(settings, RcodeConfigSchema.parse({
      serve: {
        host: '127.0.0.1',
        port: 18899,
        dataDir: '/tmp/Rcode-data',
        runtimeToken: 'runtime-token',
        insecure: false,
        storage: { backend: 'hybrid' },
        providers: {}
      }
    }))

    expect(body.serve).toMatchObject({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      model: resolveRcodeRuntimeSettings(settings).model,
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      providers: {}
    })
    expect(body.serve).not.toHaveProperty('host')
    expect(body.serve).not.toHaveProperty('port')
    expect(body.serve).not.toHaveProperty('dataDir')
    expect(body.serve).not.toHaveProperty('runtimeToken')
    expect(body.serve).not.toHaveProperty('insecure')
    expect(body.serve).not.toHaveProperty('storage')
    expect(RuntimeConfigApplyRequest.safeParse(body).success).toBe(true)

    const received: RuntimeConfigApplyPayload[] = []
    const serverRuntime: Pick<ServerRuntime, 'applyConfig'> = {
      applyConfig: async (request) => {
        received.push(request)
        return { ok: true as const }
      }
    }
    const response = await applyRuntimeConfig(
      serverRuntime as ServerRuntime,
      new Request('http://127.0.0.1/v1/runtime/config/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    )

    expect(response).not.toBeInstanceOf(Response)
    if (response instanceof Response) throw new Error('expected JSON response')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
    expect(received).toHaveLength(1)
    const applied = received[0]!
    expect(applied).toEqual(body)
    expect(applied.serve).not.toHaveProperty('host')
    expect(applied.serve).not.toHaveProperty('port')
    expect(applied.serve).not.toHaveProperty('dataDir')
    expect(applied.serve).not.toHaveProperty('runtimeToken')
    expect(applied.serve).not.toHaveProperty('insecure')
    expect(applied.serve).not.toHaveProperty('storage')
  })

  it('classifies compatibility fallback, success, restart, and failure responses', () => {
    expect(classifyManagedRuntimeHotApplyResponse(404, false, '')).toMatchObject({
      result: 'restart_required'
    })
    expect(classifyManagedRuntimeHotApplyResponse(200, true, '{"ok":true}')).toEqual({
      result: 'applied', message: ''
    })
    expect(classifyManagedRuntimeHotApplyResponse(
      409, false, '{"code":"restart_required","message":"process field changed"}'
    )).toEqual({ result: 'restart_required', message: 'process field changed' })
    expect(classifyManagedRuntimeHotApplyResponse(500, false, 'broken')).toEqual({
      result: 'failed', message: 'broken'
    })
  })
})
