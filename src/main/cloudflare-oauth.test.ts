import { get as httpGet } from 'node:http'
import { describe, expect, it, vi, afterEach } from 'vitest'

// 必须在模块加载前设置端口（cloudflare-oauth.ts 在 import 时读取 env），
// 因此下面用顶层 await 动态 import。
const TEST_PORT = 43991
process.env.CLOUDFLARE_OAUTH_PORT = String(TEST_PORT)

// credential-store 依赖 electron（safeStorage / app.getPath），测试中 mock 掉。
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/joker-cloudflare-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}))

const { cloudflareCallbackUrl, revokeCloudflareToken, startCloudflareOAuth } = await import('./cloudflare-oauth')

const TOKEN_RESPONSE = {
  access_token: 'cf-access-token-123',
  refresh_token: 'cf-refresh-456',
  scope: 'openid profile email',
  token_type: 'Bearer'
}

const USERINFO = {
  sub: 'user-0001',
  email: 'ada@example.com',
  email_verified: true,
  name: 'Ada Lovelace',
  preferred_username: 'ada'
}

function mockFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/oauth2/token')) {
      return new Response(JSON.stringify(TOKEN_RESPONSE), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/oauth2/userinfo')) {
      return new Response(JSON.stringify(USERINFO), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/oauth2/revoke')) {
      return new Response('{}', { status: 200 })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 用 node:http 把 code 打回 loopback 回调（绕过被 mock 的 fetch）。 */
function hitCallback(callbackUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    httpGet(callbackUrl, (res) => {
      res.resume()
      res.on('end', resolve)
    }).on('error', reject)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.CLOUDFLARE_OAUTH_PORT
})

describe('cloudflareCallbackUrl', () => {
  it('exposes the exact loopback redirect URL users must register', () => {
    expect(cloudflareCallbackUrl()).toBe(`http://127.0.0.1:${TEST_PORT}/cloudflare-oauth/callback`)
  })
})

describe('startCloudflareOAuth', () => {
  it('runs the full PKCE flow and resolves credentials', async () => {
    const fetchMock = mockFetch()

    const result = await startCloudflareOAuth(async (url: string) => {
      // 模拟浏览器：从 authorize URL 提取 state，然后把 code + state 打回 loopback 回调。
      const authorize = new URL(url)
      expect(authorize.hostname).toBe('dash.cloudflare.com')
      expect(authorize.pathname).toBe('/oauth2/auth')
      expect(authorize.searchParams.get('client_id')).toBe('test-client-id')
      expect(authorize.searchParams.get('redirect_uri')).toBe(cloudflareCallbackUrl())
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
      expect(authorize.searchParams.get('code_challenge')).toBeTruthy()
      expect(authorize.searchParams.get('state')).toBeTruthy()

      const state = authorize.searchParams.get('state')!
      await hitCallback(`${cloudflareCallbackUrl()}?code=fake-code&state=${encodeURIComponent(state)}`)
    }, 'test-client-id')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.credentials.accessToken).toBe('cf-access-token-123')
    expect(result.credentials.refreshToken).toBe('cf-refresh-456')
    expect(result.credentials.scope).toContain('openid')
    expect(result.credentials.user.email).toBe('ada@example.com')
    expect(result.credentials.user.sub).toBe('user-0001')

    // token 交换必须带 PKCE verifier（public client，无 client_secret）
    const tokenCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/oauth2/token'))
    expect(tokenCall).toBeTruthy()
    const body = new URLSearchParams(String((tokenCall![1] as RequestInit).body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_id')).toBe('test-client-id')
    expect(body.get('code_verifier')).toBeTruthy()
    expect(body.get('client_secret')).toBeNull()
  })

  it('fails fast when no client id is available', async () => {
    mockFetch()
    const result = await startCloudflareOAuth(async () => {}, undefined)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('Cloudflare OAuth Client ID')
    }
  })
})

describe('revokeCloudflareToken', () => {
  it('POSTs the access token to the revocation endpoint', async () => {
    const fetchMock = mockFetch()
    await revokeCloudflareToken('cf-access-token-123', 'test-client-id')
    const revokeCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/oauth2/revoke'))
    expect(revokeCall).toBeTruthy()
    const body = new URLSearchParams(String((revokeCall![1] as RequestInit).body))
    expect(body.get('token')).toBe('cf-access-token-123')
    expect(body.get('client_id')).toBe('test-client-id')
    expect(body.get('token_type_hint')).toBe('access_token')
  })
})
