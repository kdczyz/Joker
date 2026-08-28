import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, normalize } from 'node:path'
import { promisify } from 'node:util'
import type {
  GitBranchesResult,
  GitBranchWorktreeRow,
  GitBranchWorktreesResult,
  GitWorktreeCheckoutResult
} from '../../shared/git-branches'
import type {
  GitCommitResult,
  GitDiffStatFile,
  GitDiffStatResult,
  GitFileDiffResult,
  GitPushResult
} from '../../shared/git-changes'
import { findNearestGitRoot } from './git-discovery'

const execFileAsync = promisify(execFile)

/**
 * Resolve a workspaceRoot to a directory that sits inside a Git working tree.
 *
 * `git rev-parse --show-toplevel` already walks up the directory tree, so it
 * usually finds the right cwd by itself. However, when the user's workspace
 * is set to a sub-folder of a repo AND the git binary is older than 2.28
 * (no `branch --format`) or returns an error string we don't match, the rest
 * of `getGitBranches` falls through to `gitFailure` and the UI shows
 * "未检测到 Git" even though we are clearly inside a repo. See issue #98.
 *
 * We mitigate that by walking up the tree in pure Node first and passing the
 * discovered repo root (or the original cwd if none was found) to git. This
 * is a defensive layer — when git itself works, the result is identical.
 */
export async function resolveGitCwd(workspaceRoot: string): Promise<string> {
  const trimmed = workspaceRoot.trim()
  if (!trimmed) return trimmed
  const discovered = await findNearestGitRoot(trimmed)
  return discovered ?? trimmed
}

export async function runGit(
  cwd: string,
  args: string[],
  timeout = 10_000
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout,
    maxBuffer: 1024 * 1024,
    // Force a C locale so git emits English diagnostics. gitFailure() matches
    // messages like "not a git repository"; without this, a localized git
    // (e.g. zh_CN: "不是 Git 仓库") falls through to a generic `error` reason
    // and the UI shows the wrong state instead of "not a Git repository".
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
  })
  return { stdout: String(stdout), stderr: String(stderr) }
}

function gitFailure(error: unknown): GitBranchesResult {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a git repository/i.test(message)) {
    return { ok: false, reason: 'not_git_repo', message: 'The working directory is not a Git repository.' }
  }
  if (/ENOENT/i.test(message) || /spawn git/i.test(message)) {
    return { ok: false, reason: 'git_unavailable', message: 'Git executable was not found.' }
  }
  return { ok: false, reason: 'error', message }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function resolveBranchWorktreeRoot(worktreeRoot?: string): string {
  return worktreeRoot?.trim() || join(homedir(), '.Joker', 'worktrees')
}

function normalizeGitPath(path: string): string {
  return normalize(path)
}

async function allocateBranchWorktreePath(
  sourceRepositoryRoot: string,
  worktreeRoot?: string
): Promise<string> {
  const repoName = basename(sourceRepositoryRoot) || 'project'
  const root = resolveBranchWorktreeRoot(worktreeRoot)
  for (let i = 0; i < 100; i += 1) {
    const id = randomBytes(2).toString('hex')
    const candidate = join(root, id, repoName)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error(`Failed to allocate a free worktree path under ${root}`)
}

async function getPrimaryWorktreeRoot(cwd: string, fallback: string): Promise<string> {
  try {
    const { stdout } = await runGit(cwd, ['worktree', 'list', '--porcelain'])
    const line = stdout.split('\n').find((item) => item.startsWith('worktree '))
    const root = line?.slice('worktree '.length).trim()
    return root ? normalizeGitPath(root) : fallback
  } catch {
    return fallback
  }
}

async function allocateDerivedWorktreeBranch(cwd: string): Promise<string> {
  for (let i = 0; i < 100; i += 1) {
    const branch = `Joker/worktree-${randomBytes(3).toString('hex')}`
    try {
      await runGit(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    } catch {
      return branch
    }
  }
  throw new Error('Failed to allocate a free worktree branch name.')
}

function parseWorktreeListPorcelain(stdout: string): GitBranchWorktreeRow[] {
  const rows: GitBranchWorktreeRow[] = []
  let path = ''
  let branch: string | null = null
  let head = ''
  const flush = (): void => {
    if (path) rows.push({ path: normalizeGitPath(path), branch, head })
    path = ''
    branch = null
    head = ''
  }
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      if (path) flush()
      path = line.slice('worktree '.length).trim()
    } else if (line.startsWith('HEAD ')) {
      head = line.slice('HEAD '.length).trim()
    } else if (line.startsWith('branch refs/heads/')) {
      branch = line.slice('branch refs/heads/'.length).trim()
    }
  }
  flush()
  return rows
}

function gitWorktreeFailure(error: unknown): GitWorktreeCheckoutResult {
  const result = gitFailure(error)
  return result.ok
    ? { ok: false, reason: 'error', message: 'Unexpected Git branch result.' }
    : result
}

async function worktreeCheckoutResult(
  worktreePath: string,
  sourceRepositoryRoot: string
): Promise<GitWorktreeCheckoutResult> {
  const resolvedWorktreePath = await realpath(worktreePath).catch(() => worktreePath)
  const result = await getGitBranches(resolvedWorktreePath)
  if (!result.ok) return result
  return {
    ...result,
    sourceRepositoryRoot,
    worktreePath: result.repositoryRoot
  }
}

export async function getGitBranches(workspaceRoot: string): Promise<GitBranchesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  try {
    const repositoryRoot = normalizeGitPath((await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim())
    const currentRaw = (await runGit(cwd, ['branch', '--show-current'])).stdout.trim()
    const currentBranch = currentRaw || null
    const branchLines = (await runGit(cwd, ['branch', '--format=%(refname:short)'])).stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const branchSet = new Set(branchLines)
    if (currentBranch && !branchSet.has(currentBranch)) branchSet.add(currentBranch)
    const worktreeRows = parseWorktreeListPorcelain(
      (await runGit(cwd, ['worktree', 'list', '--porcelain'])).stdout
    )
    const primaryRepositoryRoot = worktreeRows[0]?.path || repositoryRoot
    const worktreeByBranch = new Map<string, { path: string; primary: boolean }>()
    for (const row of worktreeRows) {
      if (row.branch && !worktreeByBranch.has(row.branch)) {
        worktreeByBranch.set(row.branch, { path: row.path, primary: row.path === primaryRepositoryRoot })
      }
    }
    const branches = [...branchSet].map((name) => {
      // A branch checked out in *another* worktree cannot be switched to here.
      // (The current branch lives in this worktree, so it's never "elsewhere".)
      const elsewhere = name === currentBranch ? undefined : worktreeByBranch.get(name)
      const offsite = elsewhere && elsewhere.path !== repositoryRoot ? elsewhere : undefined
      return {
        name,
        current: currentBranch === name,
        ...(offsite ? { worktreePath: offsite.path, worktreePrimary: offsite.primary } : {})
      }
    })
    const dirtyCount = (await runGit(cwd, ['status', '--porcelain=v1'])).stdout
      .split('\n')
      .filter((line) => line.trim().length > 0).length
    return { ok: true, repositoryRoot, primaryRepositoryRoot, currentBranch, branches, dirtyCount }
  } catch (error) {
    return gitFailure(error)
  }
}

export async function switchGitBranch(
  workspaceRoot: string,
  branchName: string
): Promise<GitBranchesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    try {
      await runGit(cwd, ['switch', branch], 20_000)
    } catch {
      await runGit(cwd, ['checkout', branch], 20_000)
    }
    return getGitBranches(cwd)
  } catch (error) {
    return gitFailure(error)
  }
}

export async function createAndSwitchGitBranch(
  workspaceRoot: string,
  branchName: string
): Promise<GitBranchesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    await runGit(cwd, ['check-ref-format', '--branch', branch])
    try {
      await runGit(cwd, ['switch', '-c', branch], 20_000)
    } catch {
      await runGit(cwd, ['checkout', '-b', branch], 20_000)
    }
    return getGitBranches(cwd)
  } catch (error) {
    return gitFailure(error)
  }
}

export async function checkoutGitBranchWorktree(
  workspaceRoot: string,
  branchName: string,
  worktreeRoot?: string
): Promise<GitWorktreeCheckoutResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    const currentRepositoryRoot = normalizeGitPath((await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim())
    const sourceRepositoryRoot = await getPrimaryWorktreeRoot(cwd, currentRepositoryRoot)
    const wtPath = await allocateBranchWorktreePath(sourceRepositoryRoot, worktreeRoot)
    const worktreeBranch = await allocateDerivedWorktreeBranch(cwd)
    await mkdir(join(wtPath, '..'), { recursive: true })
    // Always add from the primary checkout so multiple derived worktrees can be
    // created from the same source branch regardless of the caller's cwd.
    await runGit(sourceRepositoryRoot, ['worktree', 'add', '-b', worktreeBranch, wtPath, branch], 30_000)
    return worktreeCheckoutResult(wtPath, sourceRepositoryRoot)
  } catch (error) {
    return gitWorktreeFailure(error)
  }
}

export async function createGitBranchWorktree(
  workspaceRoot: string,
  branchName: string,
  worktreeRoot?: string
): Promise<GitWorktreeCheckoutResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  const branch = branchName.trim()
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }
  try {
    await runGit(cwd, ['check-ref-format', '--branch', branch])
    const currentRepositoryRoot = normalizeGitPath((await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim())
    const sourceRepositoryRoot = await getPrimaryWorktreeRoot(cwd, currentRepositoryRoot)
    const wtPath = await allocateBranchWorktreePath(sourceRepositoryRoot, worktreeRoot)
    await mkdir(join(wtPath, '..'), { recursive: true })
    await runGit(sourceRepositoryRoot, ['worktree', 'add', '-b', branch, wtPath, 'HEAD'], 30_000)
    return worktreeCheckoutResult(wtPath, sourceRepositoryRoot)
  } catch (error) {
    return gitWorktreeFailure(error)
  }
}

export async function listGitBranchWorktrees(
  workspaceRoot: string,
  worktreeRoot?: string
): Promise<GitBranchWorktreesResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  try {
    const currentRepositoryRoot = normalizeGitPath((await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim())
    const sourceRepositoryRoot = await getPrimaryWorktreeRoot(cwd, currentRepositoryRoot)
    const root = normalizeGitPath(
      await realpath(resolveBranchWorktreeRoot(worktreeRoot)).catch(() => resolveBranchWorktreeRoot(worktreeRoot))
    )
    const { stdout } = await runGit(cwd, ['worktree', 'list', '--porcelain'])
    const worktrees = parseWorktreeListPorcelain(stdout)
      .filter((row) => row.path !== sourceRepositoryRoot)
      .filter((row) => row.path === root || row.path.startsWith(`${root}\\`) || row.path.startsWith(`${root}/`))
    return {
      ok: true,
      repositoryRoot: sourceRepositoryRoot,
      worktreeRoot: root,
      worktrees
    }
  } catch (error) {
    const result = gitFailure(error)
    return result.ok ? { ok: false, reason: 'error', message: 'Unexpected Git branch result.' } : result
  }
}

export async function removeGitBranchWorktree(params: {
  workspaceRoot: string
  worktreePath: string
}): Promise<void> {
  const cwd = await resolveGitCwd(params.workspaceRoot)
  if (!cwd) throw new Error('No working directory selected.')
  await runGit(cwd, ['worktree', 'remove', '--force', params.worktreePath], 30_000)
}

type ParsedDiffStat = {
  added: number
  removed: number
  files: GitDiffStatFile[]
}

function parseNumStat(stdout: string): ParsedDiffStat {
  const files: GitDiffStatFile[] = []
  let added = 0
  let removed = 0
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Format: "<added>\t<removed>\t<path>" where either count may be "-"
    // for binary files.
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(trimmed)
    if (!match) continue
    const fileAdded = match[1] === '-' ? 0 : Number.parseInt(match[1], 10)
    const fileRemoved = match[2] === '-' ? 0 : Number.parseInt(match[2], 10)
    added += fileAdded
    removed += fileRemoved
    files.push({ path: match[3], added: fileAdded, removed: fileRemoved })
  }
  return { added, removed, files }
}

function buildCommitSuggestion(files: GitDiffStatFile[]): string {
  const busiest = [...files]
    .sort((a, b) => b.added + b.removed - (a.added + a.removed))
    .slice(0, 3)
    .map((file) => file.path.split('/').slice(-2).join('/'))
  if (busiest.length === 0) return ''
  return `Update ${busiest.join(', ')}`
}

function countStatusSections(stdout: string): { staged: number; unstaged: number; untracked: number } {
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const line of stdout.split('\n')) {
    if (line.trim().length < 2) continue
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') {
      untracked += 1
      continue
    }
    if (x !== ' ') staged += 1
    if (y !== ' ') unstaged += 1
  }
  return { staged, unstaged, untracked }
}

/**
 * Resolve the ref the diff stat compares against. The "code changes" number is
 * defined as "local working tree vs the GitHub remote branch", so prefer the
 * configured upstream, then origin/<branch>, and finally fall back to HEAD for
 * branches that were never pushed.
 */
async function resolveDiffBase(cwd: string): Promise<string> {
  try {
    const upstream = (await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).stdout.trim()
    if (upstream && !upstream.startsWith('@{u}')) return upstream
  } catch {
    // No upstream configured — try origin/<current-branch> below.
  }
  try {
    const branch = (await runGit(cwd, ['branch', '--show-current'])).stdout.trim()
    if (branch) {
      const remoteRef = `refs/remotes/origin/${branch}`
      await runGit(cwd, ['show-ref', '--verify', '--quiet', remoteRef])
      return `origin/${branch}`
    }
  } catch {
    // Remote branch doesn't exist — fall back to HEAD.
  }
  return 'HEAD'
}

export async function getGitDiffStat(workspaceRoot: string): Promise<GitDiffStatResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  try {
    await runGit(cwd, ['rev-parse', '--git-dir'])
    const base = await resolveDiffBase(cwd)
    let combined: ParsedDiffStat = { added: 0, removed: 0, files: [] }
    try {
      combined = parseNumStat((await runGit(cwd, ['diff', '--numstat', base], 20_000)).stdout)
    } catch {
      // Fresh repository without any commit yet — the base ref doesn't exist,
      // so fall back to the worktree-only diff.
      combined = parseNumStat((await runGit(cwd, ['diff', '--numstat'], 20_000)).stdout)
    }
    const statusOutput = (await runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=normal'])).stdout
    const status = countStatusSections(statusOutput)
    // Files changed vs the remote branch, plus untracked files that the cloud
    // doesn't have yet (they carry no line counts until staged).
    const changedPaths = new Set(combined.files.map((file) => file.path))
    const trackedPaths = new Set(combined.files.map((file) => file.path))
    const files = [...combined.files]
    for (const line of statusOutput.split('\n')) {
      if (line.trim().length < 4) continue
      if (line[0] === '?' && line[1] === '?') {
        changedPaths.add(line.slice(3).trim())
        const untrackedPath = line.slice(3).trim()
        if (!trackedPaths.has(untrackedPath)) files.push({ path: untrackedPath, added: 0, removed: 0 })
      }
    }
    return {
      ok: true,
      added: combined.added,
      removed: combined.removed,
      fileCount: changedPaths.size,
      stagedFiles: status.staged,
      unstagedFiles: status.unstaged,
      untrackedFiles: status.untracked,
      files,
      suggestion: buildCommitSuggestion(combined.files)
    }
  } catch (error) {
    return gitStatFailure(error)
  }
}

/**
 * execFile rejections keep git's diagnostics in `stderr`/`stdout` properties,
 * while `error.message` is only the generic "Command failed: git …" line —
 * prefer the real git output so the UI can show why a command failed.
 */
function gitErrorDetail(error: unknown): string {
  if (error && typeof error === 'object') {
    const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown }
    const parts = [stderr, stdout]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
    if (parts.length > 0) return parts.join('\n').trim()
  }
  return error instanceof Error ? error.message : String(error)
}

function gitChangeFailure(error: unknown): GitCommitResult {
  const detail = gitErrorDetail(error)
  const message = error instanceof Error ? error.message : String(error)
  if (/nothing to commit/i.test(detail) || /nothing to commit/i.test(message)) {
    return {
      ok: false,
      reason: 'nothing_to_commit',
      message: 'There are no staged changes to commit.'
    }
  }
  const fallback = gitFailure(error)
  return fallback.ok
    ? { ok: false, reason: 'error', message: detail }
    : { ok: false, reason: fallback.reason, message: fallback.message }
}

function gitStatFailure(error: unknown): GitDiffStatResult {
  const fallback = gitFailure(error)
  return fallback.ok
    ? { ok: false, reason: 'error', message: String(error) }
    : { ok: false, reason: fallback.reason, message: fallback.message }
}

export async function commitGitChanges(params: {
  workspaceRoot: string
  message?: string
  includeUnstaged?: boolean
  push?: boolean
}): Promise<GitCommitResult> {
  const cwd = await resolveGitCwd(params.workspaceRoot)
  if (!cwd) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  try {
    await runGit(cwd, ['rev-parse', '--git-dir'])
    const diff = await getGitDiffStat(cwd)
    if (diff.ok) {
      // The vs-cloud diff also covers committed-but-unpushed work; only local
      // pending changes can be committed.
      const localCount = params.includeUnstaged
        ? diff.stagedFiles + diff.unstagedFiles + diff.untrackedFiles
        : diff.stagedFiles
      if (localCount === 0) {
        return {
          ok: false,
          reason: 'nothing_to_commit',
          message:
            'No local changes to commit — everything already differs from the remote only via unpushed commits. Use push instead.'
        }
      }
    }
    const message = params.message?.trim() || (diff.ok ? diff.suggestion : '')
    if (!message) return { ok: false, reason: 'nothing_to_commit', message: 'There are no changes to commit.' }
    if (params.includeUnstaged) {
      await runGit(cwd, ['add', '-A'], 60_000)
    }
    await runGit(cwd, ['commit', '-m', message], 60_000)
    const commitHash = (await runGit(cwd, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
    let pushed = false
    if (params.push) {
      await runGit(cwd, ['push'], 120_000)
      pushed = true
    }
    return { ok: true, commitHash, pushed }
  } catch (error) {
    return gitChangeFailure(error)
  }
}

export async function pushGitChanges(workspaceRoot: string): Promise<GitPushResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  try {
    const { stdout, stderr } = await runGit(cwd, ['push'], 120_000)
    return { ok: true, output: (stdout + '\n' + stderr).trim() }
  } catch (error) {
    const result = gitFailure(error)
    if (result.ok) return { ok: false, reason: 'error', message: gitErrorDetail(error) }
    return { ok: false, reason: result.reason, message: result.message }
  }
}

export async function getGitFileDiff(
  workspaceRoot: string,
  filePath: string
): Promise<GitFileDiffResult> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }
  const path = filePath.trim()
  if (!path) return { ok: false, reason: 'error', message: 'File path is required.' }
  try {
    await runGit(cwd, ['rev-parse', '--git-dir'])
    const statusLine = (
      await runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=normal', '--', path])
    ).stdout.split('\n')[0]
    if (statusLine.startsWith('??')) {
      // Untracked file: synthesize an all-additions patch. `--no-index` exits
      // with code 1 when differences exist, so read the patch from the error.
      const nullDevice = process.platform === 'win32' ? 'nul' : '/dev/null'
      try {
        await runGit(cwd, ['diff', '--no-index', '--', nullDevice, path], 20_000)
        return { ok: true, patch: '' }
      } catch (error) {
        const patch = gitErrorDetail(error)
        if (patch) return { ok: true, patch }
        throw error
      }
    }
    const base = await resolveDiffBase(cwd)
    const { stdout: patch } = await runGit(cwd, ['diff', base, '--', path], 20_000)
    return { ok: true, patch }
  } catch (error) {
    const result = gitFailure(error)
    if (result.ok) return { ok: false, reason: 'error', message: gitErrorDetail(error) }
    return { ok: false, reason: result.reason, message: result.message }
  }
}
