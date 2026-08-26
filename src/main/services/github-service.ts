import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir } from 'node:fs/promises'
import { basename } from 'node:path'

const execFileAsync = promisify(execFile)
const GITHUB_API_URL = 'https://api.github.com'

export interface GithubRepo {
  id: number
  name: string
  fullName: string
  private: boolean
  description: string | null
  htmlUrl: string
  cloneUrl: string
  defaultBranch: string
  updatedAt: string
}

interface RawRepo {
  id: number
  name: string
  full_name: string
  private: boolean
  description: string | null
  html_url: string
  clone_url: string
  default_branch?: string
  updated_at?: string
}

function authCloneUrl(cloneUrl: string, token: string): string {
  // https://github.com/owner/repo.git -> https://x-access-token:TOKEN@github.com/owner/repo.git
  return cloneUrl.replace(/^https:\/\//i, `https://x-access-token:${token}@`)
}

const GIT_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C', GIT_TERMINAL_PROMPT: '0' }

function redact(message: string): string {
  // Git surfaces the remote URL (incl. the in-URL token) in failure messages.
  // Never let an access token leak into UI error text or logs.
  return message.replace(/x-access-token:[^@\s]*/g, 'x-access-token:***')
}

export async function listUserRepos(token: string, perPage = 100): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = []
  let page = 1
  while (page <= 5) {
    const res = await fetch(
      `${GITHUB_API_URL}/user/repos?affiliation=owner&sort=updated&per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Joker'
        }
      }
    )
    if (!res.ok) {
      throw new Error(`GitHub 仓库列表获取失败 (${res.status})`)
    }
    const data = (await res.json()) as RawRepo[]
    if (!Array.isArray(data) || data.length === 0) break
    for (const r of data) {
      repos.push({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        description: r.description ?? null,
        htmlUrl: r.html_url,
        cloneUrl: r.clone_url,
        defaultBranch: r.default_branch ?? 'main',
        updatedAt: r.updated_at ?? ''
      })
    }
    if (data.length < perPage) break
    page += 1
  }
  return repos
}

export async function cloneRepository(opts: {
  token: string
  cloneUrl: string
  targetDir: string
}): Promise<{ targetDir: string }> {
  const { token, cloneUrl, targetDir } = opts
  await mkdir(targetDir, { recursive: true })
  try {
    await execFileAsync(
      'git',
      ['clone', authCloneUrl(cloneUrl, token), targetDir],
      { timeout: 120_000, maxBuffer: 1024 * 1024, env: GIT_ENV }
    )
  } catch (err) {
    throw new Error(redact(err instanceof Error ? err.message : String(err)))
  }
  // Do NOT persist the token in the cloned repo's .git/config: reset origin to
  // the plain URL. push/pull re-inject the token from secure storage each time.
  await execFileAsync('git', ['-C', targetDir, 'remote', 'set-url', 'origin', cloneUrl], {
    timeout: 10_000,
    env: GIT_ENV
  })
  return { targetDir }
}

async function originAuthUrl(cwd: string, token: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    timeout: 10_000,
    env: GIT_ENV
  })
  return authCloneUrl(stdout.trim(), token)
}

export async function pushRepository(opts: {
  token: string
  cwd: string
  branch?: string
}): Promise<void> {
  const { token, cwd, branch } = opts
  const authUrl = await originAuthUrl(cwd, token)
  const args = ['-C', cwd, 'push', authUrl]
  if (branch) args.push(branch)
  try {
    await execFileAsync('git', args, { timeout: 120_000, maxBuffer: 1024 * 1024, env: GIT_ENV })
  } catch (err) {
    throw new Error(redact(err instanceof Error ? err.message : String(err)))
  }
}

export async function pullRepository(opts: {
  token: string
  cwd: string
  branch?: string
}): Promise<void> {
  const { token, cwd, branch } = opts
  const authUrl = await originAuthUrl(cwd, token)
  const args = ['-C', cwd, 'pull', authUrl]
  if (branch) args.push(branch)
  try {
    await execFileAsync('git', args, { timeout: 120_000, maxBuffer: 1024 * 1024, env: GIT_ENV })
  } catch (err) {
    throw new Error(redact(err instanceof Error ? err.message : String(err)))
  }
}

export interface CreatePrResult {
  htmlUrl: string
}

export async function createPullRequest(opts: {
  token: string
  owner: string
  repo: string
  title: string
  head: string
  base: string
  body?: string
}): Promise<CreatePrResult> {
  const { token, owner, repo, title, head, base, body } = opts
  const res = await fetch(
    `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Joker'
      },
      body: JSON.stringify({ title, head, base, body: body ?? '' })
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub 创建 PR 失败 (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as { html_url?: string }
  return { htmlUrl: data.html_url ?? '' }
}

// Re-export so callers can build a default clone target name from a URL.
export function repoNameFromCloneUrl(cloneUrl: string): string {
  const base = basename(cloneUrl.replace(/\.git$/i, ''))
  return base || 'repository'
}
