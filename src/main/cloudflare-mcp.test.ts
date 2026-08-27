import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpDir = mkdtempSync(join(tmpdir(), 'cloudflare-mcp-test-'))

const { refreshMock, credentialsMock, storeMock, clientIdMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  credentialsMock: vi.fn(),
  storeMock: vi.fn(),
  clientIdMock: vi.fn()
}))

vi.mock('./claw-schedule-mcp-config', () => ({
  resolveJokerMcpJsonPath: () => join(tmpDir, 'mcp.json')
}))

vi.mock('./cloudflare-oauth', () => ({
  refreshCloudflareToken: refreshMock
}))

vi.mock('./services/cloudflare-credential-store', () => ({
  getCloudflareCredentials: credentialsMock,
  storeCloudflareCredentials: storeMock,
  getCloudflareClientId: clientIdMock
}))

import {
  CLOUDFLARE_MCP_SERVER_NAME,
  disableCloudflareMcp,
  enableCloudflareMcp,
  ensureFreshCloudflareAccessToken,
  isCloudflareMcpEnabled
} from './cloudflare-mcp'

const BASE_CREDS = {
  accessToken: 'cf-token-a',
  refreshToken: 'cf-refresh-a',
  scope: 'openid offline_access',
  user: { sub: 'u1', email: 'a@b.c', emailVerified: true, name: null, preferredUsername: null, picture: null }
}

function readMcpJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(tmpDir, 'mcp.json'), 'utf8')) as Record<string, unknown>
}

beforeEach(() => {
  refreshMock.mockReset()
  storeMock.mockReset()
  clientIdMock.mockReset()
  clientIdMock.mockResolvedValue('test-client-id')
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(join(tmpDir, 'mcp.json'), { force: true })
})

describe('enableCloudflareMcp / disableCloudflareMcp / isCloudflareMcpEnabled', () => {
  it('writes the official remote MCP entry with the Bearer token and removes it on disable', async () => {
    credentialsMock.mockResolvedValue(BASE_CREDS)

    const res = await enableCloudflareMcp()
    expect(res).toEqual({ ok: true })

    const json = readMcpJson()
    const servers = json.servers as Record<string, Record<string, unknown>>
    expect(Object.keys(servers)).toEqual([CLOUDFLARE_MCP_SERVER_NAME])
    const entry = servers[CLOUDFLARE_MCP_SERVER_NAME]
    expect(entry.transport).toBe('streamable-http')
    expect(entry.url).toBe('https://mcp.cloudflare.com/mcp')
    expect(entry.headers).toEqual({ Authorization: 'Bearer cf-token-a' })
    expect(entry.trustScope).toBe('user')
    expect(entry.enabled).toBe(true)
    expect(await isCloudflareMcpEnabled()).toBe(true)

    await disableCloudflareMcp()
    expect(await isCloudflareMcpEnabled()).toBe(false)
    expect((readMcpJson().servers as Record<string, unknown>)[CLOUDFLARE_MCP_SERVER_NAME]).toBeUndefined()
  })

  it('preserves other servers when enabling/disabling', async () => {
    writeFileSync(
      join(tmpDir, 'mcp.json'),
      JSON.stringify({ servers: { existing: { transport: 'stdio', command: 'x' } } }, null, 2) + '\n',
      'utf8'
    )
    credentialsMock.mockResolvedValue(BASE_CREDS)

    await enableCloudflareMcp()
    const servers = readMcpJson().servers as Record<string, Record<string, unknown>>
    expect(Object.keys(servers).sort()).toEqual(['cloudflare', 'existing'].sort())

    await disableCloudflareMcp()
    expect((readMcpJson().servers as Record<string, unknown>).existing).toBeDefined()
  })

  it('fails with a hint when the account is not authorized', async () => {
    credentialsMock.mockResolvedValue(null)
    const res = await enableCloudflareMcp()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toContain('Cloudflare')
  })
})

describe('ensureFreshCloudflareAccessToken', () => {
  it('returns the stored token as-is when it is not expired', async () => {
    credentialsMock.mockResolvedValue({ ...BASE_CREDS, expiresAt: Date.now() + 3_600_000 })
    const creds = await ensureFreshCloudflareAccessToken()
    expect(creds?.accessToken).toBe('cf-token-a')
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('refreshes and persists a new token when the access token expired', async () => {
    credentialsMock.mockResolvedValue({ ...BASE_CREDS, expiresAt: Date.now() - 1000 })
    refreshMock.mockResolvedValue({ accessToken: 'cf-token-new', refreshToken: 'cf-refresh-new', expiresAt: Date.now() + 3_600_000 })

    const creds = await ensureFreshCloudflareAccessToken()
    expect(refreshMock).toHaveBeenCalledWith('cf-refresh-a', 'test-client-id')
    expect(creds?.accessToken).toBe('cf-token-new')
    expect(storeMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'cf-token-new', refreshToken: 'cf-refresh-new' })
    )
  })

  it('falls back to the stale token when refresh fails', async () => {
    credentialsMock.mockResolvedValue({ ...BASE_CREDS, expiresAt: Date.now() - 1000 })
    refreshMock.mockRejectedValue(new Error('invalid_grant'))

    const creds = await ensureFreshCloudflareAccessToken()
    expect(creds?.accessToken).toBe('cf-token-a')
    expect(storeMock).not.toHaveBeenCalled()
  })

  it('returns null when no credentials exist', async () => {
    credentialsMock.mockResolvedValue(null)
    expect(await ensureFreshCloudflareAccessToken()).toBeNull()
  })
})
