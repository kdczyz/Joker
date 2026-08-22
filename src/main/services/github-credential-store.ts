import { app, safeStorage } from 'electron'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GithubUser } from '../github-oauth'

/**
 * Persists the GitHub OAuth token + profile on disk, encrypted with Electron's
 * `safeStorage` (which is backed by the OS keychain on macOS). Falls back to a
 * 0o600 plaintext file when encryption is unavailable (e.g. some Linux setups).
 */

export interface GithubCredentials {
  accessToken: string
  scope: string
  user: GithubUser
}

const STORE_FILE = 'github-auth.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

export async function storeGithubCredentials(credentials: GithubCredentials): Promise<void> {
  const payload = JSON.stringify(credentials)
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(payload)
    : Buffer.from(payload, 'utf8')
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(storePath(), encrypted, { mode: 0o600 })
}

export async function getGithubCredentials(): Promise<GithubCredentials | null> {
  try {
    const buffer = await readFile(storePath())
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString('utf8')
    const parsed = JSON.parse(json) as GithubCredentials
    if (!parsed || typeof parsed.accessToken !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export async function clearGithubCredentials(): Promise<void> {
  try {
    await unlink(storePath())
  } catch {
    /* nothing to remove */
  }
}

/**
 * The GitHub OAuth App `client_id` is not a secret (public desktop client, PKCE
 * is used instead of a client secret), so it is stored in plaintext. It is
 * user-specific config rather than a credential and never grants access on its
 * own. Falls back to `GITHUB_OAUTH_CLIENT_ID` env when unset.
 */
const CLIENT_ID_FILE = 'github-client-id.json'

function clientIdPath(): string {
  return join(app.getPath('userData'), CLIENT_ID_FILE)
}

export async function storeGithubClientId(clientId: string): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(clientIdPath(), clientId.trim(), { encoding: 'utf8', mode: 0o600 })
}

export async function getGithubClientId(): Promise<string | null> {
  try {
    const raw = await readFile(clientIdPath(), 'utf8')
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export async function clearGithubClientId(): Promise<void> {
  try {
    await unlink(clientIdPath())
  } catch {
    /* nothing to remove */
  }
}

/**
 * The GitHub OAuth App `client_secret` IS a secret (unlike `client_id`): it
 * grants token-exchange power for confidential apps, so we persist it via
 * `safeStorage` (OS keychain on macOS) instead of plaintext on disk.
 *
 * Stored separately so `clearGithubClientId` does not wipe a still-valid
 * secret, and vice versa.
 */
const CLIENT_SECRET_FILE = 'github-client-secret.bin'

function clientSecretPath(): string {
  return join(app.getPath('userData'), CLIENT_SECRET_FILE)
}

export async function storeGithubClientSecret(secret: string): Promise<void> {
  const trimmed = secret.trim()
  if (!trimmed) {
    await clearGithubClientSecret()
    return
  }
  // Wrap as JSON so future fields (e.g. per-clientId binding) can ride along
  // without a format migration.
  const payload = JSON.stringify({ secret: trimmed, storedAt: Date.now() })
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(payload)
    : Buffer.from(payload, 'utf8')
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(clientSecretPath(), encrypted, { mode: 0o600 })
}

export async function getGithubClientSecret(): Promise<string | null> {
  try {
    const buffer = await readFile(clientSecretPath())
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buffer)
      : buffer.toString('utf8')
    const parsed = JSON.parse(json) as { secret?: unknown }
    if (!parsed || typeof parsed.secret !== 'string') return null
    const trimmed = parsed.secret.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export async function clearGithubClientSecret(): Promise<void> {
  try {
    await unlink(clientSecretPath())
  } catch {
    /* nothing to remove */
  }
}

/** Wipe both the public client_id override and the encrypted secret. */
export async function clearGithubClientConfig(): Promise<void> {
  await Promise.all([clearGithubClientId(), clearGithubClientSecret()])
}
