import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { getCloudflareClientId } from './services/cloudflare-credential-store'

/**
 * Cloudflare OAuth (authorization code + PKCE, desktop loopback flow).
 *
 * Mirrors the GitHub OAuth in `github-oauth.ts` and the Codex browser auth in
 * `codex-auth.ts`: we spin up a one-shot local HTTP server on 127.0.0.1, open
 * the system browser to Cloudflare's authorize page, capture the `code` on the
 * loopback callback, exchange it for an access token, and fetch the
 * authenticated user's profile from the OIDC userinfo endpoint.
 *
 * Cloudflare specifics (verified against dash.cloudflare.com/oauth2):
 * - Endpoints: authorize /oauth2/auth, token /oauth2/token (POST only),
 *   userinfo /oauth2/userinfo, revoke /oauth2/revoke.
 * - Public clients (desktop/CLI) MUST use PKCE S256 and do NOT send a client
 *   secret. Token endpoint auth method: `none`.
 * - Redirect URI must match the registered value EXACTLY, including host, port
 *   and trailing path. Loopback `http://127.0.0.1:<port>/callback` is allowed.
 * - OAuth clients are created per-account in Cloudflare's dashboard
 *   (Manage Account → OAuth clients); there is no global public client we can
 *   embed, so the user must supply their own `client_id` (or set
 *   `CLOUDFLARE_OAUTH_CLIENT_ID` at build/run time).
 * - Identity scope `openid` returns subject (sub) at userinfo. Cloudflare's
 *   OAuth server ONLY supports scopes_supported: ["openid", "offline_access",
 *   "offline"] (confirmed via /.well-known/openid-configuration). The `email`
 *   and `profile` scopes are NOT supported and will trigger:
 *   "The OAuth 2.0 Client is not allowed to request scope 'email'".
 *   We request `openid` (sub) + `offline_access` (refresh_token grant).
 *   User profile (email, name, avatar) is fetched from the Cloudflare API
 *   `/client/v4/user` which the access token can call directly.
 */

const CLOUDFLARE_AUTHORIZE_URL = 'https://dash.cloudflare.com/oauth2/auth'
const CLOUDFLARE_TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token'
const CLOUDFLARE_REVOKE_URL = 'https://dash.cloudflare.com/oauth2/revoke'
const CLOUDFLARE_OAUTH_HOST = '127.0.0.1'
const CLOUDFLARE_OAUTH_PORT = Number(process.env.CLOUDFLARE_OAUTH_PORT ?? 41824)
const CLOUDFLARE_OAUTH_CALLBACK_PATH = '/cloudflare-oauth/callback'
const CLOUDFLARE_OAUTH_TIMEOUT_MS = 120 * 1000
// 身份 scope：Cloudflare 的 OAuth 服务端只支持 openid / offline_access / offline
// （确认来源：/.well-known/openid-configuration → scopes_supported）。
// 请求 email / profile 会报 "scope ... not allowed"，因为后端根本不认识。
// 所以只请求 openid（拿到 sub）+ offline_access（拿到 refresh_token 用于续期）。
// email / name / avatar 通过 Cloudflare API /client/v4/user 获取（access token
// 本身就是 API 的 Bearer token，无需额外授权）。
const CLOUDFLARE_OAUTH_SCOPE = 'openid offline_access'

// 当前正在运行的回调 server（一对一）。用于用户在授权途中关闭浏览器后，
// 再次点击登录时能强制清理上一轮的残留监听，避免端口被占用而无法再次登录。
let activeServer: Server | null = null

function closeActiveServer(): void {
  if (!activeServer) return
  const s = activeServer
  activeServer = null
  try {
    ;(s as Server & { closeAllConnections?: () => void }).closeAllConnections?.()
  } catch {
    /* ignore */
  }
  try {
    s.close(() => {})
  } catch {
    /* ignore */
  }
}

export interface CloudflareUser {
  /** OIDC subject — stable unique id. */
  sub: string
  email: string | null
  emailVerified: boolean
  name: string | null
  preferredUsername: string | null
  picture: string | null
}

export interface CloudflareOAuthCredentials {
  kind: 'cloudflare-oauth'
  accessToken: string
  /** 仅当 client 启用了 Refresh Token grant 时返回。 */
  refreshToken?: string | null
  scope: string
  user: CloudflareUser
  /** Epoch ms when the access token expires (undefined when the token response lacks expires_in). */
  expiresAt?: number
}

export type CloudflareOAuthResult =
  | { ok: true; credentials: CloudflareOAuthCredentials }
  | { ok: false; message: string }

/** The exact loopback callback URL users must register on the OAuth client. */
export function cloudflareCallbackUrl(): string {
  return `http://${CLOUDFLARE_OAUTH_HOST}:${CLOUDFLARE_OAUTH_PORT}${CLOUDFLARE_OAUTH_CALLBACK_PATH}`
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function generatePkce(): { verifier: string; challenge: string } {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const verifier = Array.from(randomBytes(43), (byte) => chars[byte % chars.length]).join('')
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function redirectUri(): string {
  return `http://${CLOUDFLARE_OAUTH_HOST}:${CLOUDFLARE_OAUTH_PORT}${CLOUDFLARE_OAUTH_CALLBACK_PATH}`
}

function authorizeUrl(challenge: string, state: string, clientId: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: CLOUDFLARE_OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  })
  return `${CLOUDFLARE_AUTHORIZE_URL}?${params.toString()}`
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString()
  })
  const text = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = {}
  }
  if (!res.ok || typeof data.error === 'string') {
    const desc = typeof data.error_description === 'string' ? ` - ${data.error_description}` : ''
    throw new Error(`Cloudflare OAuth: ${(data.error as string) ?? `HTTP ${res.status}`}${desc}`)
  }
  return data
}

async function fetchCloudflareUser(accessToken: string): Promise<CloudflareUser> {
  // OIDC /oauth2/userinfo 只返回 { sub }（claims_supported: ["sub"]）。
  // 用 access token 直接调 Cloudflare REST API 拿完整资料：email / name / avatar。
  const res = await fetch('https://api.cloudflare.com/client/v4/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  })
  if (!res.ok) {
    throw new Error(`Cloudflare 用户信息获取失败 (${res.status})`)
  }
  const data = (await res.json()) as Record<string, unknown>
  const result = (data.result && typeof data.result === 'object' ? data.result : data) as Record<string, unknown>
  const str = (key: string): string | null => (typeof result[key] === 'string' && result[key] ? (result[key] as string) : null)
  const firstName = str('first_name') ?? str('firstName')
  const lastName = str('last_name') ?? str('lastName')
  const fullName = [firstName, lastName].filter(Boolean).join(' ')
  return {
    sub: str('id') ?? str('sub') ?? String(result.user_id ?? ''),
    email: str('email'),
    emailVerified: typeof result.email_verified === 'boolean' ? result.email_verified : true,
    name: str('name') ?? str('full_name') ?? (fullName || null),
    preferredUsername: str('username') ?? str('login'),
    picture: str('picture') ?? str('avatar_url')
  }
}

/**
 * Begin the Cloudflare browser OAuth flow. Resolves once the loopback callback
 * returns a valid token (or rejects/returns an error on timeout/cancel).
 *
 * `clientId` lets the UI / IPC layer inject the OAuth client id at runtime
 * (e.g. the user pasted one into Settings → Cloudflare). Priority:
 *   UI arg → env var → persisted (userData cloudflare-client-id.json)
 * Cloudflare has no embeddable global client (OAuth clients are created
 * per-account), so at least one source must be available.
 */
export async function startCloudflareOAuth(
  openBrowser: (url: string) => void | Promise<void>,
  clientId?: string
): Promise<CloudflareOAuthResult> {
  const resolvedClientId =
    clientId?.trim() ||
    process.env.CLOUDFLARE_OAUTH_CLIENT_ID ||
    (await getCloudflareClientId())
  if (!resolvedClientId) {
    return {
      ok: false,
      message:
        '未配置 Cloudflare OAuth Client ID：请在 Cloudflare 后台（Manage Account → OAuth clients）创建客户端，' +
        `并把 Redirect URL 填为 ${cloudflareCallbackUrl()}，然后在设置页粘贴 Client ID` +
        '（或设置环境变量 CLOUDFLARE_OAUTH_CLIENT_ID）'
    }
  }

  // 清理上一轮可能残留的回调 server（用户授权途中关闭浏览器且尚未超时）
  closeActiveServer()

  const pkce = generatePkce()
  const state = base64UrlEncode(randomBytes(32))
  let server: Server | null = null

  const cleanup = (): void => {
    if (server && server === activeServer) {
      activeServer = null
    }
    if (server) {
      try {
        ;(server as Server & { closeAllConnections?: () => void }).closeAllConnections?.()
      } catch {
        /* ignore */
      }
      try {
        server.close(() => {})
      } catch {
        /* server may not have finished binding */
      }
      server = null
    }
  }

  try {
    const credentials = await new Promise<CloudflareOAuthCredentials>((resolve, reject) => {
      let settled = false
      let listening = false
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('授权超时，请重试'))
      }, CLOUDFLARE_OAUTH_TIMEOUT_MS)

      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        cleanup()
        reject(error)
      }
      const settleResolve = (creds: CloudflareOAuthCredentials): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        cleanup()
        resolve(creds)
      }

      server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${CLOUDFLARE_OAUTH_HOST}:${CLOUDFLARE_OAUTH_PORT}`)
        if (url.pathname !== CLOUDFLARE_OAUTH_CALLBACK_PATH) {
          res.writeHead(404).end('Not found')
          return
        }
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        const oauthError = url.searchParams.get('error')
        if (oauthError) {
          const message = url.searchParams.get('error_description') || oauthError
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(cloudflareErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        if (!code || returnedState !== state) {
          const message = !code ? '缺少授权码' : '状态校验失败（可能的 CSRF）'
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(cloudflareErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        const tokenBody: Record<string, string> = {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri(),
          client_id: resolvedClientId,
          code_verifier: pkce.verifier
        }
        void postForm(CLOUDFLARE_TOKEN_URL, tokenBody)
          .then(async (tokens) => {
            const accessToken = tokens.access_token as string | undefined
            if (!accessToken) {
              throw new Error(`令牌交换返回的数据不完整：${JSON.stringify(tokens).slice(0, 400)}`)
            }
            const scope = (tokens.scope as string | undefined) ?? CLOUDFLARE_OAUTH_SCOPE
            const refreshToken =
              typeof tokens.refresh_token === 'string' && tokens.refresh_token
                ? (tokens.refresh_token as string)
                : null
            const expiresIn =
              typeof tokens.expires_in === 'number' && Number.isFinite(tokens.expires_in)
                ? tokens.expires_in
                : typeof tokens.expires_in === 'string' && Number.isFinite(Number(tokens.expires_in))
                  ? Number(tokens.expires_in)
                  : undefined
            const expiresAt = expiresIn && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined
            const user = await fetchCloudflareUser(accessToken)
            res
              .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
              .end(CLOUDFLARE_BROWSER_SUCCESS_HTML)
            settleResolve({
              kind: 'cloudflare-oauth',
              accessToken,
              refreshToken,
              scope,
              user,
              expiresAt
            })
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(cloudflareErrorHtml(message))
            settleReject(new Error(message))
          })
      })

      const beginListen = (): void => {
        if (listening) return
        listening = true
        activeServer = server
        void Promise.resolve(openBrowser(authorizeUrl(pkce.challenge, state, resolvedClientId))).catch(
          (err: unknown) => {
            settleReject(err instanceof Error ? err : new Error(String(err)))
          }
        )
      }

      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // 端口仍被占用（上一轮回调 server 尚未完全释放）。强制清理后延迟重试一次。
          closeActiveServer()
          setTimeout(() => {
            try {
              server?.listen(CLOUDFLARE_OAUTH_PORT, CLOUDFLARE_OAUTH_HOST, beginListen)
            } catch (e) {
              settleReject(e instanceof Error ? e : new Error(String(e)))
            }
          }, 500)
          return
        }
        settleReject(new Error(err.message))
      })

      server.listen(CLOUDFLARE_OAUTH_PORT, CLOUDFLARE_OAUTH_HOST, beginListen)
    })
    return { ok: true, credentials }
  } catch (error) {
    cleanup()
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Refresh a Cloudflare OAuth access token via the `refresh_token` grant
 * (RFC 6749 §6). Requires the OAuth client to have the Refresh Token grant
 * enabled and the original authorization to include `offline_access`.
 *
 * @returns the fresh access token (and rotated refresh token when the server
 * returns one), or throws on failure.
 */
export async function refreshCloudflareToken(
  refreshToken: string,
  clientId: string
): Promise<{ accessToken: string; refreshToken?: string | null; expiresAt?: number }> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId
  }
  const tokens = await postForm(CLOUDFLARE_TOKEN_URL, body)
  const accessToken = tokens.access_token as string | undefined
  if (!accessToken) {
    throw new Error(`Cloudflare OAuth 刷新令牌失败：${JSON.stringify(tokens).slice(0, 400)}`)
  }
  const nextRefresh =
    typeof tokens.refresh_token === 'string' && tokens.refresh_token
      ? (tokens.refresh_token as string)
      : null
  const expiresIn =
    typeof tokens.expires_in === 'number' && Number.isFinite(tokens.expires_in)
      ? tokens.expires_in
      : typeof tokens.expires_in === 'string' && Number.isFinite(Number(tokens.expires_in))
        ? Number(tokens.expires_in)
        : undefined
  const expiresAt = expiresIn && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined
  return { accessToken, refreshToken: nextRefresh, expiresAt }
}

/**
 * Best-effort revocation of a Cloudflare access token (RFC 7009). Cloudflare
 * does not require client authentication for public clients, but passing the
 * client_id when known helps it attribute the request. Failures are swallowed:
 * revoking is a courtesy, local credentials are cleared regardless.
 */
export async function revokeCloudflareToken(
  accessToken: string,
  clientId?: string
): Promise<void> {
  if (!accessToken) return
  const body: Record<string, string> = {
    token: accessToken,
    token_type_hint: 'access_token'
  }
  if (clientId?.trim()) body.client_id = clientId.trim()
  try {
    await fetch(CLOUDFLARE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString()
    })
  } catch {
    /* best-effort */
  }
}

const CLOUDFLARE_BROWSER_SUCCESS_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Cloudflare 登录</title><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0d1117;color:#e6edf3}.box{text-align:center;padding:2rem}h1{margin-bottom:.5rem}p{color:#8b949e}</style></head><body><div class="box"><h1>登录成功</h1><p>可以关闭此窗口并返回 Joker。</p></div><script>setTimeout(()=>window.close(),1500)</script></body></html>'

function cloudflareErrorHtml(message: string): string {
  const safe = message.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
  )
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cloudflare 登录</title></head><body style="font-family:system-ui;padding:2rem;color:#f85149"><h1>登录失败</h1><p>${safe}</p></body></html>`
}
