/**
 * Bridges the GUI's GitHub OAuth credentials into the runtime's
 * `process.env.JOKER_GITHUB_ACCOUNT_CONTEXT`. The runtime rebuilds its
 * immutable prefix on every restart, so we MUST also trigger `restartRuntime`
 * after mutating the env — otherwise stale prefix will keep masking the new
 * identity.
 *
 * Why an env var: the runtime and the GUI share the same Electron main process,
 * so process.env is the cheapest cross-cutting channel. Joker's
 * `environment-context.ts` reads this var on every prefix build.
 */
import {
  getGithubCredentials,
  type GithubCredentials
} from './services/github-credential-store'
import {
  serializeGithubAccountContext,
  type GithubAccountContext
} from '../../Joker/src/cache/environment-context'

const ENV_KEY = 'JOKER_GITHUB_ACCOUNT_CONTEXT'

/**
 * Snapshot the currently-credentialed GitHub user into process.env. Idempotent:
 * safe to call multiple times. Returns whether something was written.
 */
export async function syncGithubAccountToEnvironment(): Promise<boolean> {
  const credentials = await getGithubCredentials()
  if (!credentials) {
    clearGithubAccountFromEnvironment()
    return false
  }
  process.env[ENV_KEY] = JSON.stringify({
    login: credentials.user.login,
    name: credentials.user.name ?? null,
    email: credentials.user.email ?? null,
    id: credentials.user.id ?? null,
    avatarUrl: credentials.user.avatarUrl ?? null,
    scopes: credentials.scope || null
  } satisfies GithubAccountContext)
  return true
}

/** Remove the GitHub account env snapshot. Idempotent. */
export function clearGithubAccountFromEnvironment(): void {
  delete process.env[ENV_KEY]
}

/** Compose the snapshot shape from credentials; exported for reuse / tests. */
export function githubAccountContextFromCredentials(
  credentials: GithubCredentials
): string {
  return serializeGithubAccountContext(
    {
      login: credentials.user.login,
      name: credentials.user.name ?? null,
      email: credentials.user.email ?? null,
      id: credentials.user.id ?? null,
      avatarUrl: credentials.user.avatarUrl ?? null
    },
    { scopes: credentials.scope || null }
  )
}
