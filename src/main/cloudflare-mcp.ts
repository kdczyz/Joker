import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveJokerMcpJsonPath } from './claw-schedule-mcp-config'
import { refreshCloudflareToken } from './cloudflare-oauth'
import {
  getCloudflareClientId,
  getCloudflareCredentials,
  storeCloudflareCredentials
} from './services/cloudflare-credential-store'

/**
 * 一键把「已授权的 Cloudflare OAuth 凭据」注入到 Joker 的 MCP 配置里，
 * 让内置 agent 通过 Cloudflare 官方的远程 API MCP 服务器直接管理
 * Workers / KV / R2 / D1 / Pages / DNS / 防火墙 等 2500+ 个端点。
 *
 * Cloudflare 官方 MCP（https://mcp.cloudflare.com/mcp）走 streamable-http，
 * 支持两种认证：OAuth 跳转授权，或 `Authorization: Bearer <token>` 头。
 * 这里复用应用内已完成的 Cloudflare OAuth 授权（access token 本身就是
 * Cloudflare API 的 Bearer token），把 token 直接注入 headers —— 用户
 * 无需再走一遍浏览器授权，也无需手动创建 API Token。
 *
 * 与 github-mcp.ts 一样只新增/更新 `cloudflare` 这一个服务器条目，
 * 不会破坏用户已有的其它 MCP 服务器。
 *
 * 注意：token 以明文写入 mcp.json 的 headers（与 app 本身同为受信任分发
 * 场景，且 OAuth token 已存在于本机）。access token 过期时（默认约 1 小时）
 * 需重新启用 MCP 以刷新，或等待用户重新授权。
 */

export const CLOUDFLARE_MCP_SERVER_NAME = 'cloudflare'
/** Cloudflare 官方远程 API MCP（Code Mode，约 1000 tokens，覆盖全 API）。 */
const CLOUDFLARE_MCP_OFFICIAL_URL = 'https://mcp.cloudflare.com/mcp'
/** 过期前 60s 视为已过期，避免边界竞态。 */
const CLOUDFLARE_TOKEN_SKEW_MS = 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readMcpJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    // 损坏的 JSON：退回空对象，让后续合并逻辑重建。
    return null
  }
}

async function resolveCloudflareClientId(): Promise<string | undefined> {
  return process.env.CLOUDFLARE_OAUTH_CLIENT_ID || (await getCloudflareClientId()) || undefined
}

/**
 * 返回一份「仍有效」的 Cloudflare 凭据：若 access token 已过期且存在
 * refresh token，则先用 refresh_token grant 续期并回写存储；续期失败或
 * 无 refresh token 时退化为原 token（可能已过期，由远端 401 兜底）。
 */
export async function ensureFreshCloudflareAccessToken(): Promise<{
  accessToken: string
  refreshToken?: string | null
} | null> {
  const creds = await getCloudflareCredentials()
  if (!creds) return null
  const expired =
    creds.expiresAt !== undefined && creds.expiresAt <= Date.now() + CLOUDFLARE_TOKEN_SKEW_MS
  if (expired && creds.refreshToken) {
    const clientId = await resolveCloudflareClientId()
    if (clientId) {
      try {
        const fresh = await refreshCloudflareToken(creds.refreshToken, clientId)
        const updated: typeof creds = {
          ...creds,
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken ?? creds.refreshToken,
          expiresAt: fresh.expiresAt
        }
        await storeCloudflareCredentials(updated)
        return updated
      } catch {
        /* 续期失败：使用现有 token（由远端 401 兜底并提示重新授权） */
      }
    }
  }
  return creds
}

function cloudflareServerEntry(accessToken: string): Record<string, unknown> {
  return {
    transport: 'streamable-http',
    url: CLOUDFLARE_MCP_OFFICIAL_URL,
    headers: { Authorization: `Bearer ${accessToken}` },
    trustScope: 'user',
    enabled: true
  }
}

/**
 * 写入「Cloudflare 官方远程 MCP」条目到 mcp.json。要求已授权 Cloudflare。
 */
export async function enableCloudflareMcp(): Promise<{ ok: true } | { ok: false; message: string }> {
  const creds = await ensureFreshCloudflareAccessToken()
  if (!creds) {
    return {
      ok: false,
      message: '尚未授权 Cloudflare 账号：请先在「Cloudflare 授权」区块完成登录，再启用 Cloudflare MCP'
    }
  }
  const path = resolveJokerMcpJsonPath()
  const current = (await readMcpJson(path)) ?? {}
  const servers = isRecord(current.servers) ? current.servers : {}

  const next: Record<string, unknown> = {
    ...current,
    servers: {
      ...servers,
      [CLOUDFLARE_MCP_SERVER_NAME]: cloudflareServerEntry(creds.accessToken)
    }
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return { ok: true }
}

/**
 * 从 mcp.json 中移除 Cloudflare MCP 服务器条目（保留其它服务器）。
 */
export async function disableCloudflareMcp(): Promise<void> {
  const path = resolveJokerMcpJsonPath()
  const current = await readMcpJson(path)
  if (!current) return

  const servers = isRecord(current.servers) ? current.servers : {}
  if (!(CLOUDFLARE_MCP_SERVER_NAME in servers)) return

  const nextServers: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(servers)) {
    if (name === CLOUDFLARE_MCP_SERVER_NAME) continue
    nextServers[name] = value
  }

  const next: Record<string, unknown> = { ...current, servers: nextServers }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

/**
 * Cloudflare MCP 服务器条目是否已存在且启用。
 */
export async function isCloudflareMcpEnabled(): Promise<boolean> {
  const path = resolveJokerMcpJsonPath()
  const current = await readMcpJson(path)
  if (!current) return false
  const servers = isRecord(current.servers) ? current.servers : {}
  const entry = servers[CLOUDFLARE_MCP_SERVER_NAME]
  if (!isRecord(entry)) return false
  return entry.enabled !== false
}
