import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import {
  getGithubClientId,
  getGithubClientSecret
} from './services/github-credential-store'

/**
 * GitHub OAuth (authorization code + PKCE, desktop loopback flow).
 *
 * Mirrors the existing Codex browser auth in `codex-auth.ts`: we spin up a
 * one-shot local HTTP server on 127.0.0.1, open the system browser to GitHub's
 * authorize page, capture the `code` on the loopback callback, exchange it for
 * an access token, and fetch the authenticated user's profile.
 *
 * No client secret is used — PKCE (S256) is sufficient for public desktop
 * clients and keeps the credential out of the bundle. The GitHub OAuth App's
 * `client_id` is supplied via `GITHUB_OAUTH_CLIENT_ID`.
 */

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_API_URL = 'https://api.github.com'
const GITHUB_OAUTH_HOST = '127.0.0.1'
const GITHUB_OAUTH_PORT = Number(process.env.GITHUB_OAUTH_PORT ?? 41823)
const GITHUB_OAUTH_CALLBACK_PATH = '/github-oauth/callback'
const GITHUB_OAUTH_TIMEOUT_MS = 120 * 1000
const GITHUB_OAUTH_SCOPE = 'repo read:user user:email'

// 当前正在运行的回调 server（一对一）。用于用户在授权途中关闭浏览器后，
// 再次点击登录时能强制清理上一轮的残留监听，避免端口 41823 被占用而无法再次登录。
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

/**
 * 应用内置的 GitHub OAuth Client ID（公开信息，不含 secret）。
 * 由开发者（本项目）注册 GitHub OAuth App 后填入此处一次即可，
 * 终端用户无需填写，直接点「使用 GitHub 登录」就能走通授权。
 * 仍可被环境变量 GITHUB_OAUTH_CLIENT_ID（构建/打包时注入）或
 * 设置页「开发者覆盖」覆盖。留空表示未内置，需由上述方式提供。
 */
const GITHUB_BUILTIN_CLIENT_ID = 'Ov23liGvSIiyqwS7cUcs'

/**
 * 应用内置的 GitHub OAuth Client Secret（机密信息，仅机密型 App 需要）。
 * 若你的 OAuth App 是「公共客户端」（在 App 设置里从未生成过 client secret），
 * 此处留空即可，PKCE 流程不需要 secret。
 * 若 App 是「机密客户端」（生成过 client secret），则必须在此填入，否则换 token
 * 时会返回 incorrect_client_credentials。也可通过环境变量 GITHUB_OAUTH_CLIENT_SECRET 注入。
 * 注意：把 secret 烤进客户端并非最佳实践，仅供个人或受信任分发场景使用。
 */
const GITHUB_BUILTIN_CLIENT_SECRET = 'd38de5edb56051be0e3358b42ca06fd04b70e52c'

export interface GithubUser {
  login: string
  id: number
  name: string | null
  email: string | null
  avatarUrl: string | null
}

export interface GithubOAuthCredentials {
  kind: 'github-oauth'
  accessToken: string
  scope: string
  user: GithubUser
}

export type GithubOAuthResult =
  | { ok: true; credentials: GithubOAuthCredentials }
  | { ok: false; message: string }

const GITHUB_BROWSER_SUCCESS_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>GitHub 登录</title><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0d1117;color:#e6edf3}.box{text-align:center;padding:2rem}h1{margin-bottom:.5rem}p{color:#8b949e}</style></head><body><div class="box"><h1>登录成功</h1><p>可以关闭此窗口并返回 Rcode。</p></div><script>setTimeout(()=>window.close(),1500)</script></body></html>'

function githubErrorHtml(message: string): string {
  const safe = message.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
  )
  return `<!doctype html><html><head><meta charset="utf-8"><title>GitHub 登录</title></head><body style="font-family:system-ui;padding:2rem;color:#f85149"><h1>登录失败</h1><p>${safe}</p></body></html>`
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

function redirectUri(port: number): string {
  return `http://${GITHUB_OAUTH_HOST}:${port}${GITHUB_OAUTH_CALLBACK_PATH}`
}

function authorizeUrl(challenge: string, state: string, redirectUriValue: string, clientId: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUriValue,
    scope: GITHUB_OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  })
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString()
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`GitHub 令牌交换失败 (${res.status}): ${text.slice(0, 400)}`)
  }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`GitHub OAuth: 无法解析令牌响应: ${text.slice(0, 400)}`)
  }
  if (typeof data.error === 'string') {
    const desc = typeof data.error_description === 'string' ? ` - ${data.error_description}` : ''
    throw new Error(`GitHub OAuth: ${data.error}${desc}`)
  }
  return data
}

async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Rcode'
    }
  })
  if (!res.ok) {
    throw new Error(`GitHub 用户信息获取失败 (${res.status})`)
  }
  const data = (await res.json()) as Record<string, unknown>
  return {
    login: typeof data.login === 'string' ? data.login : '',
    id: typeof data.id === 'number' ? data.id : 0,
    name: typeof data.name === 'string' ? data.name : null,
    email: typeof data.email === 'string' ? data.email : null,
    avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : null
  }
}

/**
 * Begin the GitHub browser OAuth flow. Resolves once the loopback callback
 * returns a valid token (or rejects/returns an error on timeout/cancel).
 *
 * `clientSecret` lets the UI / IPC layer inject a secret at runtime (e.g. the
 * user pasted one into Settings → GitHub). Priority:
 *   UI arg → env var → persisted (safeStorage) → built-in constant → ''
 */
export async function startGithubOAuth(
  openBrowser: (url: string) => void | Promise<void>,
  clientId?: string,
  clientSecret?: string
): Promise<GithubOAuthResult> {
  const resolvedClientId =
    clientId?.trim() ||
    process.env.GITHUB_OAUTH_CLIENT_ID ||
    (await getGithubClientId()) ||
    GITHUB_BUILTIN_CLIENT_ID
  if (!resolvedClientId) {
    return {
      ok: false,
      message:
        '应用未内置 GitHub OAuth Client ID：开发者需在 github-oauth.ts 设置 GITHUB_BUILTIN_CLIENT_ID，或在构建时注入环境变量 GITHUB_OAUTH_CLIENT_ID'
    }
  }

  const resolvedClientSecret =
    clientSecret?.trim() ||
    process.env.GITHUB_OAUTH_CLIENT_SECRET ||
    (await getGithubClientSecret()) ||
    GITHUB_BUILTIN_CLIENT_SECRET ||
    ''

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
    const credentials = await new Promise<GithubOAuthCredentials>((resolve, reject) => {
      let settled = false
      let listening = false
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('授权超时，请重试'))
      }, GITHUB_OAUTH_TIMEOUT_MS)

      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        cleanup()
        reject(error)
      }
      const settleResolve = (creds: GithubOAuthCredentials): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        cleanup()
        resolve(creds)
      }

      server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${GITHUB_OAUTH_HOST}:${GITHUB_OAUTH_PORT}`)
        if (url.pathname !== GITHUB_OAUTH_CALLBACK_PATH) {
          res.writeHead(404).end('Not found')
          return
        }
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        const oauthError = url.searchParams.get('error')
        if (oauthError) {
          const message = url.searchParams.get('error_description') || oauthError
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(githubErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        if (!code || returnedState !== state) {
          const message = !code ? '缺少授权码' : '状态校验失败（可能的 CSRF）'
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(githubErrorHtml(message))
          settleReject(new Error(message))
          return
        }
        const tokenBody: Record<string, string> = {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri(GITHUB_OAUTH_PORT),
          client_id: resolvedClientId,
          code_verifier: pkce.verifier
        }
        if (resolvedClientSecret) {
          tokenBody.client_secret = resolvedClientSecret
        }
        void postForm(GITHUB_TOKEN_URL, tokenBody)
          .then(async (tokens) => {
            const accessToken = tokens.access_token as string | undefined
            const scope = (tokens.scope as string | undefined) ?? GITHUB_OAUTH_SCOPE
            if (!accessToken) {
              throw new Error(`令牌交换返回的数据不完整：${JSON.stringify(tokens).slice(0, 400)}`)
            }
            const user = await fetchGithubUser(accessToken)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(GITHUB_BROWSER_SUCCESS_HTML)
            settleResolve({ kind: 'github-oauth', accessToken, scope, user })
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(githubErrorHtml(message))
            settleReject(new Error(message))
          })
      })

      const beginListen = (): void => {
        if (listening) return
        listening = true
        activeServer = server
        const uri = redirectUri(GITHUB_OAUTH_PORT)
        void Promise.resolve(openBrowser(authorizeUrl(pkce.challenge, state, uri, resolvedClientId))).catch((err: unknown) => {
          settleReject(err instanceof Error ? err : new Error(String(err)))
        })
      }

      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // 端口仍被占用（上一轮回调 server 尚未完全释放）。
          // 强制清理后延迟重试一次，避免用户中途关闭浏览器后无法再次登录。
          closeActiveServer()
          setTimeout(() => {
            try {
              server?.listen(GITHUB_OAUTH_PORT, GITHUB_OAUTH_HOST, beginListen)
            } catch (e) {
              settleReject(e instanceof Error ? e : new Error(String(e)))
            }
          }, 500)
          return
        }
        settleReject(new Error(err.message))
      })

      server.listen(GITHUB_OAUTH_PORT, GITHUB_OAUTH_HOST, beginListen)
    })
    return { ok: true, credentials }
  } catch (error) {
    cleanup()
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
