/**
 * Reads environment-level context the GUI injects via process.env and turns it
 * into pinned constraint strings the runtime's immutable prefix carries into
 * every ModelRequest.
 *
 * Today the GUI only emits JOKER_GITHUB_ACCOUNT_CONTEXT (a JSON blob describing
 * the currently-logged-in GitHub user) via github-environment-bridge.ts. This
 * module is the runtime-side consumer; it is intentionally strict about the
 * shape so a stale or malformed GUI value can never crash prefix construction.
 */

export type GithubAccountContext = {
  login: string
  name?: string | null
  email?: string | null
  id?: number | string | null
  avatarUrl?: string | null
  scopes?: string | null
}

export type EnvironmentContextOptions = {
  /** Override the env read (used by tests). */
  env?: NodeJS.ProcessEnv
}

/**
 * Returns constraint strings that should be appended to pinnedConstraints
 * for the runtime immutable prefix. Returns an empty array when no
 * environment context is set or the value cannot be parsed.
 */
export function getEnvironmentContextConstraints(
  options: EnvironmentContextOptions = {}
): string[] {
  const env = options.env ?? process.env
  const raw = env.JOKER_GITHUB_ACCOUNT_CONTEXT
  if (!raw || !raw.trim()) return []

  let parsed: GithubAccountContext | null = null
  try {
    const value = JSON.parse(raw) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const candidate = value as Partial<GithubAccountContext>
      if (typeof candidate.login === 'string' && candidate.login.trim()) {
        parsed = {
          login: candidate.login.trim(),
          name: typeof candidate.name === 'string' ? candidate.name : null,
          email: typeof candidate.email === 'string' ? candidate.email : null,
          id: candidate.id ?? null,
          avatarUrl:
            typeof candidate.avatarUrl === 'string' ? candidate.avatarUrl : null,
          scopes:
            typeof candidate.scopes === 'string' ? candidate.scopes : null
        }
      }
    }
  } catch {
    return []
  }
  if (!parsed) return []

  const label = '[env: github] logged in as @' + parsed.login
  const extras: string[] = []
  if (parsed.name) extras.push('name=' + parsed.name)
  if (parsed.email) extras.push('email=' + parsed.email)
  if (parsed.id !== null && parsed.id !== undefined) {
    extras.push('id=' + String(parsed.id))
  }
  const scopes = parsed.scopes && parsed.scopes.trim()
  if (scopes) extras.push('scopes=' + scopes)
  const tail = extras.length ? ' (' + extras.join(', ') + ')' : ''
  return [
    label +
      tail +
      ' — when the user asks about their GitHub repos/Issues/PRs/branches/actions/notifications/code-search, call the matching GitHub MCP tool with NO owner/login argument (or use this login verbatim) rather than asking them to re-supply the account.',
    'Treat the GitHub MCP access token as a credential: never echo it back to the user in chat or in tool output.'
  ]
}

/** Serialize a GitHub user payload into the env-friendly JSON form. */
export function serializeGithubAccountContext(
  user: GithubAccountContext,
  extras: { scopes?: string | null } = {}
): string {
  return JSON.stringify({
    login: user.login,
    name: user.name ?? null,
    email: user.email ?? null,
    id: user.id ?? null,
    avatarUrl: user.avatarUrl ?? null,
    scopes: extras.scopes ?? null
  })
}
