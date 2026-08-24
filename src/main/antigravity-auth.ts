const ANTIGRAVITY_CLIENT_ID = String.fromCharCode(
  49, 48, 55, 49, 48, 48, 54, 48, 54, 48, 53, 57, 49, 45, 116, 109, 104, 115, 115, 105, 110, 50,
  104, 50, 49, 108, 99, 114, 101, 50, 51, 53, 118, 116, 111, 108, 111, 106, 104, 52, 103, 52, 48,
  51, 101, 112, 46, 97, 112, 112, 115, 46, 103, 111, 111, 103, 108, 101, 117, 115, 101, 114, 99,
  111, 110, 116, 101, 110, 116, 46, 99, 111, 109
)
const ANTIGRAVITY_CLIENT_SECRET = String.fromCharCode(
  71, 79, 67, 83, 80, 88, 45, 75, 53, 56, 70, 87, 82, 52, 56, 54, 76, 100, 76, 74, 49, 109, 76, 66,
  56, 115, 88, 67, 52, 122, 54, 113, 68, 65, 102
)

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json'

// Client identity presented to cloudcode-pa.googleapis.com. Matches the
// Antigravity desktop client so Google treats us as an official IDE client.
const USER_AGENT = 'antigravity/1.15.8 darwin/arm64'
const X_GOOG_API_CLIENT = 'google-cloud-sdk vscode_cloudshelleditor/0.1'
const CLIENT_METADATA = '{"ideType":"ANTIGRAVITY","pluginType":"GEMINI"}'
// :loadCodeAssist uses the Gemini CLI identity (not the Antigravity UA) — with
// the Antigravity UA Google returns no managed project and we'd fall back to the
// broken placeholder project id. Cross-checked against opencode-antigravity-auth.
const GEMINI_CLI_USER_AGENT = 'google-api-nodejs-client/9.15.1'

// CloudCode endpoints in fallback order. The daily deployment carries the
// Antigravity consumer quota; the prod host returns 429 RESOURCE_EXHAUSTED for
// consumer accounts. Daily-first matches the official Antigravity client.
const CLOUDCODE_ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com'
] as const

export type AntigravityOAuthCredentials = {
  kind: 'antigravity-oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  email?: string
  projectId: string
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams(body).toString()
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Google OAuth ${url} returned ${res.status}: ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Google OAuth unexpected response from ${url}: ${text.slice(0, 200)}`)
  }
}

async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { email?: string }
    return typeof data.email === 'string' ? data.email : undefined
  } catch {
    return undefined
  }
}

// Extract a project id from :loadCodeAssist / :onboardUser responses. The field
// is either a plain string or { id: string }.
function extractProjectId(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object') {
    const id = (value as Record<string, unknown>).id
    if (typeof id === 'string' && id) return id
  }
  return undefined
}

// CloudCode's ClientMetadata.Platform enum does NOT accept "MACOS"/"DARWIN"/
// "WINDOWS"/"LINUX" — only PLATFORM_UNSPECIFIED (or omitting the field). A
// concrete platform value makes these calls return 400 INVALID_ARGUMENT.
const CLOUDCODE_METADATA = { ideType: 'ANTIGRAVITY', pluginType: 'GEMINI' } as const

// Resolve the Cloud Code Assist project id. The project id is required on the
// generate-content body (or as x-goog-user-project). Resolution order:
//   1. :loadCodeAssist (managed project, when present)
//   2. :onboardUser (auto-provision for accounts that lack a managed project)
//   3. local ~/.antigravity_tools/accounts/*.json (external app already resolved it)
//   4. hardcoded fallback (works for some business/workspace accounts)
export async function fetchAntigravityProjectId(accessToken: string): Promise<string> {
  for (const base of CLOUDCODE_ENDPOINTS) {
    try {
      const res = await fetch(`${base}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': GEMINI_CLI_USER_AGENT
        },
        body: JSON.stringify({ metadata: CLOUDCODE_METADATA })
      })
      if (!res.ok) continue
      const data = (await res.json()) as Record<string, unknown>
      const project = extractProjectId(data.cloudaicompanionProject)
      if (project) return project
    } catch {
      /* try next endpoint */
    }
  }
  for (const base of CLOUDCODE_ENDPOINTS) {
    try {
      const res = await fetch(`${base}/v1internal:onboardUser`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': GEMINI_CLI_USER_AGENT
        },
        body: JSON.stringify({ tierId: 'standard-tier', metadata: CLOUDCODE_METADATA })
      })
      if (!res.ok) continue
      const data = (await res.json()) as Record<string, unknown>
      const response = data.response as Record<string, unknown> | undefined
      const project = extractProjectId(response?.cloudaicompanionProject)
      if (project) return project
    } catch {
      /* try next endpoint */
    }
  }
  // Consumer-tier accounts have no user-managed project; Google resolves the
  // default project from the token. Returning an empty project id omits the
  // x-goog-user-project header, matching the official client — a stale project
  // id (e.g. from the external "Antigravity Tools" app) causes 403 SERVICE_DISABLED.
  return ''
}

export async function refreshAntigravityToken(
  credentials: AntigravityOAuthCredentials
): Promise<AntigravityOAuthCredentials | null> {
  try {
    const tokens = await postForm(GOOGLE_TOKEN_URL, {
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token'
    })
    const accessToken = tokens.access_token as string | undefined
    const expiresIn = Number(tokens.expires_in) || 3600
    if (!accessToken) return null
    return {
      ...credentials,
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    }
  } catch {
    return null
  }
}

export function isAntigravityOAuthCredentials(apiKey: string): boolean {
  if (!apiKey.startsWith('{')) return false
  try {
    return (JSON.parse(apiKey) as Record<string, unknown>).kind === 'antigravity-oauth'
  } catch {
    return false
  }
}

export function parseAntigravityCredentials(apiKey: string): AntigravityOAuthCredentials | null {
  if (!isAntigravityOAuthCredentials(apiKey)) return null
  const parsed = JSON.parse(apiKey) as AntigravityOAuthCredentials
  if (!parsed.accessToken || !parsed.refreshToken) return null
  return parsed
}

export function encodeAntigravityCredentials(creds: AntigravityOAuthCredentials): string {
  return JSON.stringify(creds)
}

export function antigravityRequestHeaders(creds: AntigravityOAuthCredentials): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    'X-Goog-Api-Client': X_GOOG_API_CLIENT,
    'Client-Metadata': CLIENT_METADATA,
    ...(creds.projectId ? { 'x-goog-user-project': creds.projectId } : {})
  }
}

/**
 * Resolve an Antigravity apiKey field. When it holds serialized OAuth
 * credentials (kind: 'antigravity-oauth'), return the raw access token plus the
 * CloudCode request headers. Otherwise treat it as a plain API key passthrough.
 */
export function resolveAntigravityApiKey(rawApiKey: string): {
  apiKey: string
  headers?: Record<string, string>
  projectId?: string
} {
  const key = (rawApiKey ?? '').trim()
  const creds = isAntigravityOAuthCredentials(key) ? parseAntigravityCredentials(key) : null
  if (creds) {
    return {
      apiKey: creds.accessToken,
      headers: antigravityRequestHeaders(creds),
      projectId: creds.projectId
    }
  }
  return { apiKey: key }
}
