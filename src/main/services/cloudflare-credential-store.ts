import { app, safeStorage } from 'electron'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CloudflareUser } from '../cloudflare-oauth'

/**
 * Persists the Cloudflare OAuth token + profile on disk, encrypted with
 * Electron's `safeStorage` (OS keychain on macOS). Falls back to a 0o600
 * plaintext file when encryption is unavailable (e.g. some Linux setups).
 */

export interface CloudflareCredentials {
  accessToken: string
  refreshToken?: string | null
  scope: string
  user: CloudflareUser
}

const STORE_FILE = 'cloudflare-auth.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

export async function storeCloudflareCredentials(credentials: CloudflareCredentials): Promise<void> {
  const payload = JSON.stringify(credentials)
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(payload)
    : Buffer.from(payload, 'utf8')
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(storePath(), encrypted, { mode: 0o600 })
}

export async function getCloudflareCredentials(): Promise<CloudflareCredentials | null> {
  try {
    const buffer = await readFile(storePath())
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString('utf8')
    const parsed = JSON.parse(json) as CloudflareCredentials
    if (!parsed || typeof parsed.accessToken !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export async function clearCloudflareCredentials(): Promise<void> {
  try {
    await unlink(storePath())
  } catch {
    /* nothing to remove */
  }
}

/**
 * The Cloudflare OAuth `client_id` is not a secret (public desktop client, PKCE
 * is used instead of a client secret), so it is stored in plaintext. It is
 * user-specific config rather than a credential and never grants access on its
 * own. Falls back to `CLOUDFLARE_OAUTH_CLIENT_ID` env when unset.
 */
const CLIENT_ID_FILE = 'cloudflare-client-id.json'

function clientIdPath(): string {
  return join(app.getPath('userData'), CLIENT_ID_FILE)
}

export async function storeCloudflareClientId(clientId: string): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(clientIdPath(), clientId.trim(), { encoding: 'utf8', mode: 0o600 })
}

export async function getCloudflareClientId(): Promise<string | null> {
  try {
    const raw = await readFile(clientIdPath(), 'utf8')
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export async function clearCloudflareClientId(): Promise<void> {
  try {
    await unlink(clientIdPath())
  } catch {
    /* nothing to remove */
  }
}
