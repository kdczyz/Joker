import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveJokerMcpJsonPath } from './claw-schedule-mcp-config'

/**
 * 一键把「已登录的 GitHub OAuth token」注入到 Joker 的 MCP 配置里，
 * 让内置 agent 通过官方 GitHub MCP 服务器直接管理仓库 / Issue / PR 等。
 *
 * 写入的目标与运行时读取的是同一份文件（~/.Joker/mcp.json），
 * 且仅新增/更新 `github` 这一个服务器条目，不会破坏用户已有的其它 MCP 服务器
 * （计划任务同步逻辑 buildSyncedClawScheduleMcpJson 也会保留 userServers）。
 *
 * 注意：token 以明文写入 mcp.json 的 env（与 app 本身同为受信任分发场景，
 * 且 OAuth token 已存在于本机）。若日后要走「不落盘」方案，可改为在 MCP
 * 服务器 spawn 时由运行时动态注入 env。
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
//      Joker runtime 已支持 transport=streamable-http + OAuth provider，
//      第一次连接会按运行时 OAuth 流程引导用户在浏览器里授权 GitHub。
// 改动后，OAuth token 不再写进 mcp.json（远程 MCP 自己处理 OAuth），
// 减少本机 token 暴露面。
const GITHUB_MCP_OFFICIAL_URL = 'https://api.githubcopilot.com/mcp/'

function githubServerEntry(): Record<string, unknown> {
  return {
    transport: 'streamable-http',
    url: GITHUB_MCP_OFFICIAL_URL,
    trustScope: 'user',
    enabled: true
  }
}

/**
 * 写入「官方远程 GitHub MCP」条目到 mcp.json。
 * 不需要本地 OAuth token —— 运行时第一次连接时会通过内置 OAuth provider
 * 引导用户在浏览器里完成 GitHub 授权（与 VS Code 等编辑器走同一条 OAuth 流）。
 */
export async function enableGithubMcp(): Promise<void> {
  const path = resolveJokerMcpJsonPath()
  const current = (await readMcpJson(path)) ?? {}
  const servers = isRecord(current.servers) ? current.servers : {}

  const next: Record<string, unknown> = {
    ...current,
    servers: {
      ...servers,
      [GITHUB_MCP_SERVER_NAME]: githubServerEntry()
    }
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
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
