import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveJokerMcpJsonPath } from './claw-schedule-mcp-config'
import { getGithubCredentials } from './services/github-credential-store'

/**
 * 一键把「已登录的 GitHub OAuth token」注入到 Joker 的 MCP 配置里，
 * 让内置 agent 通过官方 GitHub MCP 服务器直接管理仓库 / Issue / PR 等。
 *
 * 写入的目标与运行时读取的是同一份文件（~/.Joker/mcp.json），
 * 且仅新增/更新 `github` 这一个服务器条目，不会破坏用户已有的其它 MCP 服务器
 * （计划任务同步逻辑 buildSyncedClawScheduleMcpJson 也会保留 userServers）。
 *
 * 注意：token 以 Bearer 头明文写入 mcp.json 的 github 服务器条目（与 app 本身
 * 同为受信任分发场景，且 OAuth token 已存在于本机）。若日后要走「不落盘」方案，
 * 可改为 MCP 连接时由运行时动态注入 Authorization 头。
 */

export const GITHUB_MCP_SERVER_NAME = 'github'

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

// 官方 GitHub MCP 服务器的真实部署形态：
//   1. GitHub 官方仓库 github/github-mcp-server 是 Go 写的，没有 npm 包；
//      npm 上的 github-mcp-server / @modelcontextprotocol/server-github 要么是
//      不相关的 git CLI wrapper，要么已废弃（"no longer supported"）。
//   2. 官方推荐的本地形态是 docker / brew / go install，但都需要额外装运行时。
//   3. 最稳的形式是远程 streamable-http MCP，由 GitHub 托管：
//      https://api.githubcopilot.com/mcp/
// 该端点要求请求带 Authorization: Bearer <token>。Joker runtime 的 MCP
// OAuth provider 是「按需显式配置」的（见 Joker/src/adapters/tool/mcp-oauth-provider.ts），
// 并不会在 github 条目缺 oauth 字段时自动触发浏览器授权，所以裸连必报
// "missing required Authorization header"。因此这里直接把「已登录的 GitHub
// OAuth token」作为 Bearer 头写进 mcp.json，与 cloudflare-mcp.ts 同构。
const GITHUB_MCP_OFFICIAL_URL = 'https://api.githubcopilot.com/mcp/'

function githubServerEntry(accessToken: string): Record<string, unknown> {
  return {
    transport: 'streamable-http',
    url: GITHUB_MCP_OFFICIAL_URL,
    headers: { Authorization: `Bearer ${accessToken}` },
    trustScope: 'user',
    enabled: true
  }
}

/**
 * 写入「官方远程 GitHub MCP」条目到 mcp.json。
 * 要求已通过 GitHub OAuth 登录（设置页「GitHub 授权」区块）—— 没有 token 时
 * 拒绝启用并给出可提示用户去登录的 message；启用后把 token 作为 Bearer 头注入，
 * 这样 agent 运行时连接 api.githubcopilot.com/mcp/ 时即带上鉴权，不再报
 * "missing required Authorization header"。
 */
export async function enableGithubMcp(): Promise<{ ok: true } | { ok: false; message: string }> {
  const creds = await getGithubCredentials()
  if (!creds) {
    return {
      ok: false,
      message: '尚未授权 GitHub 账号：请先在「GitHub 授权」区块完成登录，再启用 GitHub MCP'
    }
  }
  const path = resolveJokerMcpJsonPath()
  const current = (await readMcpJson(path)) ?? {}
  const servers = isRecord(current.servers) ? current.servers : {}

  const next: Record<string, unknown> = {
    ...current,
    servers: {
      ...servers,
      [GITHUB_MCP_SERVER_NAME]: githubServerEntry(creds.accessToken)
    }
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return { ok: true }
}

/**
 * 从 mcp.json 中移除 github MCP 服务器条目（保留其它服务器）。
 */
export async function disableGithubMcp(): Promise<void> {
  const path = resolveJokerMcpJsonPath()
  const current = await readMcpJson(path)
  if (!current) return

  const servers = isRecord(current.servers) ? current.servers : {}
  if (!(GITHUB_MCP_SERVER_NAME in servers)) return

  const nextServers: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(servers)) {
    if (name === GITHUB_MCP_SERVER_NAME) continue
    nextServers[name] = value
  }

  const next: Record<string, unknown> = { ...current, servers: nextServers }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

/**
 * github MCP 服务器条目是否已存在且启用。
 */
export async function isGithubMcpEnabled(): Promise<boolean> {
  const path = resolveJokerMcpJsonPath()
  const current = await readMcpJson(path)
  if (!current) return false
  const servers = isRecord(current.servers) ? current.servers : {}
  const entry = servers[GITHUB_MCP_SERVER_NAME]
  if (!isRecord(entry)) return false
  return entry.enabled !== false
}
