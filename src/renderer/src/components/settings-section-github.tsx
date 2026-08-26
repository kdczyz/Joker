import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  Download,
  ExternalLink,
  Github,
  GitBranch,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Upload
} from 'lucide-react'
import {
  InlineNoticeView,
  SettingsCard,
  SettingRow
} from './settings-controls'
import type { GithubRepoInfo, GithubStatusResult } from '@shared/Joker-gui-api'

const inputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

interface ClonedRepo {
  fullName: string
  localPath: string
}

export function GithubSettingsSection(): ReactElement {
  const [status, setStatus] = useState<GithubStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [repos, setRepos] = useState<GithubRepoInfo[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [cloned, setCloned] = useState<ClonedRepo[]>([])
  const [prForm, setPrForm] = useState<{ fullName: string; defaultBase: string } | null>(null)
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const [mcpBusy, setMcpBusy] = useState(false)

  const loadMcpStatus = useCallback(async (): Promise<void> => {
    try {
      const r = await window.JokerGui.githubMcpStatus()
      setMcpEnabled(r.enabled)
    } catch {
      setMcpEnabled(false)
    }
  }, [])

  const loadAccount = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const s = await window.JokerGui.githubStatus()
      setStatus(s)
      if (s.connected) {
        setReposLoading(true)
        try {
          const list = await window.JokerGui.githubListRepos()
          setRepos(list)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setReposLoading(false)
        }
      } else {
        setRepos([])
        setCloned([])
        setPrForm(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      void loadMcpStatus()
    }
  }, [loadMcpStatus])

  useEffect(() => {
    void loadAccount()
  }, [loadAccount])

  const connect = async (): Promise<void> => {
    setConnecting(true)
    setError('')
    try {
      // 不传 clientId/clientSecret：完全使用主进程内置常量，普通用户不需要也不能改。
      const result = await window.JokerGui.githubOAuthConnect()
      if (!result.ok) {
        setError(result.message)
        return
      }
      await loadAccount()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    setError('')
    await window.JokerGui.githubOAuthDisconnect()
    await loadAccount()
  }

  const toggleMcp = async (): Promise<void> => {
    setMcpBusy(true)
    setError('')
    try {
      if (mcpEnabled) {
        await window.JokerGui.githubDisableMcp()
        setMcpEnabled(false)
      } else {
        const r = await window.JokerGui.githubEnableMcp()
        if (!r.ok) {
          setError(r.message ?? '启用 GitHub MCP 失败')
          return
        }
        setMcpEnabled(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMcpBusy(false)
    }
  }

  const loadRepos = async (): Promise<void> => {
    setReposLoading(true)
    setError('')
    try {
      const list = await window.JokerGui.githubListRepos()
      setRepos(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setReposLoading(false)
    }
  }

  const clone = async (repo: GithubRepoInfo): Promise<void> => {
    setError('')
    try {
      const result = await window.JokerGui.githubCloneRepo(repo.cloneUrl, repo.name)
      if (result.cancelled) return
      if (result.targetDir) {
        setCloned((prev) => [...prev.filter((c) => c.fullName !== repo.fullName), { fullName: repo.fullName, localPath: result.targetDir! }])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const push = async (repo: ClonedRepo, branch?: string): Promise<void> => {
    setError('')
    try {
      await window.JokerGui.githubPush(repo.localPath, branch)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const pull = async (repo: ClonedRepo, branch?: string): Promise<void> => {
    setError('')
    try {
      await window.JokerGui.githubPull(repo.localPath, branch)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const createPr = async (
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body?: string
  ): Promise<void> => {
    setError('')
    try {
      const result = await window.JokerGui.githubCreatePr({ owner, repo, title, head, base, body })
      if (result.htmlUrl) {
        if (typeof window.JokerGui.openExternal === 'function') {
          await window.JokerGui.openExternal(result.htmlUrl)
        } else {
          window.open(result.htmlUrl, '_blank', 'noopener,noreferrer')
        }
      }
      setPrForm(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const openExternal = (url: string): void => {
    if (typeof window.JokerGui.openExternal === 'function') {
      void window.JokerGui.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  if (loading) {
    return (
      <SettingsCard title="GitHub 仓库">
        <div className="flex items-center gap-2 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          加载中…
        </div>
      </SettingsCard>
    )
  }

  const user = status?.user ?? null

  return (
    <SettingsCard title="GitHub 仓库">
      <SettingRow
        title="GitHub 账号"
        description={user ? `已连接为 ${user.login}` : '连接 GitHub 以列出、克隆并推送你自己的仓库'}
        wideControl
        control={
          <div className="grid gap-3">
            {!status?.connected ? (
              <button
                type="button"
                disabled={connecting}
                onClick={() => void connect()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#24292f] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[#32383f] disabled:opacity-60"
              >
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
                {connecting ? '正在打开浏览器授权…' : '使用 GitHub 登录'}
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.login} className="h-9 w-9 rounded-full" />
                ) : null}
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold text-ds-ink">{user?.name ?? user?.login}</div>
                  <div className="truncate text-[12px] text-ds-faint">@{user?.login}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  断开连接
                </button>
              </div>
            )}

            {error ? <InlineNoticeView notice={{ tone: 'error', message: error }} /> : null}

            {status?.connected ? (
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12.5px] font-semibold text-ds-muted">我的仓库</h3>
                  <button
                    type="button"
                    disabled={reposLoading}
                    onClick={() => void loadRepos()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-muted hover:bg-ds-hover disabled:opacity-60"
                  >
                    <RefreshCw className={`h-3 w-3 ${reposLoading ? 'animate-spin' : ''}`} />
                    刷新
                  </button>
                </div>
                {repos.length === 0 && !reposLoading ? (
                  <p className="text-[12px] text-ds-faint">点击「刷新」加载你的仓库。</p>
                ) : null}
                <div className="grid gap-2">
                  {repos.map((repo) => {
                    const clonedInfo = cloned.find((c) => c.fullName === repo.fullName)
                    return (
                      <div key={repo.id} className="rounded-xl border border-ds-border bg-ds-card p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 truncate text-[13px] font-semibold text-ds-ink">{repo.fullName}</span>
                          {repo.private ? (
                            <span className="rounded-full border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-300">
                              私有
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => openExternal(repo.htmlUrl)}
                            className="ml-auto inline-flex items-center gap-1 text-[12px] text-ds-faint hover:text-ds-ink"
                          >
                            <ExternalLink className="h-3 w-3" />
                            GitHub
                          </button>
                        </div>
                        {repo.description ? (
                          <p className="mt-1 text-[12px] text-ds-muted">{repo.description}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {!clonedInfo ? (
                            <button
                              type="button"
                              onClick={() => void clone(repo)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/90"
                            >
                              <Download className="h-3.5 w-3.5" />
                              克隆到本地
                            </button>
                          ) : (
                            <>
                              <span className="min-w-0 truncate text-[11.5px] text-ds-faint">{clonedInfo.localPath}</span>
                              <button
                                type="button"
                                onClick={() => void push(clonedInfo)}
                                className="inline-flex items-center gap-1 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1 text-[12px] text-ds-muted hover:bg-ds-hover"
                              >
                                <Upload className="h-3 w-3" />
                                推送
                              </button>
                              <button
                                type="button"
                                onClick={() => void pull(clonedInfo)}
                                className="inline-flex items-center gap-1 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1 text-[12px] text-ds-muted hover:bg-ds-hover"
                              >
                                <Download className="h-3 w-3" />
                                拉取
                              </button>
                              <button
                                type="button"
                                onClick={() => setPrForm({ fullName: repo.fullName, defaultBase: repo.defaultBranch })}
                                className="inline-flex items-center gap-1 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1 text-[12px] text-ds-muted hover:bg-ds-hover"
                              >
                                <GitBranch className="h-3 w-3" />
                                创建 PR
                              </button>
                            </>
                          )}
                        </div>
                        {prForm?.fullName === repo.fullName ? (
                          <PrForm
                            fullName={repo.fullName}
                            defaultBase={prForm.defaultBase}
                            onCancel={() => setPrForm(null)}
                            onSubmit={createPr}
                          />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        }
      />
      <SettingRow
        title="GitHub MCP 服务器"
        description="启用后，内置 AI 可直接通过 GitHub MCP 管理你的仓库、Issue、PR 等，无需再手动粘贴 token。"
        wideControl
        control={
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={mcpBusy || !status?.connected}
              onClick={() => void toggleMcp()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#24292f] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[#32383f] disabled:opacity-60 sm:w-auto"
            >
              {mcpBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
              {mcpEnabled ? '停用 GitHub MCP' : '启用 GitHub MCP'}
            </button>
            <span className="text-[12px] text-ds-faint">
              {!status?.connected
                ? '请先登录 GitHub'
                : mcpEnabled
                  ? '已启用 · agent 可使用 GitHub 工具'
                  : '未启用'}
            </span>
          </div>
        }
      />
    </SettingsCard>
  )
}

function PrForm({
  fullName,
  defaultBase,
  onCancel,
  onSubmit
}: {
  fullName: string
  defaultBase: string
  onCancel: () => void
  onSubmit: (owner: string, repo: string, title: string, head: string, base: string, body?: string) => Promise<void>
}): ReactElement {
  const [owner, repo] = fullName.split('/')
  const [title, setTitle] = useState('')
  const [head, setHead] = useState('')
  const [base, setBase] = useState(defaultBase)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!title.trim() || !head.trim() || !base.trim()) return
    setBusy(true)
    try {
      await onSubmit(owner, repo, title.trim(), head.trim(), base.trim(), body.trim() || undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-ds-border-muted bg-ds-main/35 p-3">
      <input className={inputClass} placeholder="PR 标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className={inputClass} placeholder="源分支 (head)" value={head} onChange={(e) => setHead(e.target.value)} />
        <input className={inputClass} placeholder="目标分支 (base)" value={base} onChange={(e) => setBase(e.target.value)} />
      </div>
      <textarea className={inputClass} placeholder="描述（可选）" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[12px] text-ds-muted hover:bg-ds-hover"
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          创建 PR
        </button>
      </div>
    </div>
  )
}
