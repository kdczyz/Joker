import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { CheckCircle, ExternalLink, Globe, Loader2, RefreshCw, Search, Sparkles, XCircle } from 'lucide-react'
import { SecretInput, SettingsCard, SettingRow, Toggle } from './settings-controls'
import { getProvider } from '../agent/registry'

const OPEN_WEB_SEARCH_REPO_URL = 'https://github.com/Aas-ee/open-webSearch'
const TAVILY_KEY_URL = 'https://app.tavily.com/home'
const BAIDU_KEY_URL = 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application'

const OPEN_WEB_SEARCH_ENGINES = [
  { id: 'duckduckgo', labelKey: 'webSearchEngineDuckduckgo' },
  { id: 'bing', labelKey: 'webSearchEngineBing' },
  { id: 'baidu', labelKey: 'webSearchEngineBaidu' },
  { id: 'sogou', labelKey: 'webSearchEngineSogou' },
  { id: 'brave', labelKey: 'webSearchEngineBrave' },
  { id: 'exa', labelKey: 'webSearchEngineExa' },
  { id: 'csdn', labelKey: 'webSearchEngineCsdn' },
  { id: 'juejin', labelKey: 'webSearchEngineJuejin' },
  { id: 'startpage', labelKey: 'webSearchEngineStartpage' },
  { id: 'hackernews', labelKey: 'webSearchEngineHackernews' }
] as const

// Tool names that count as "web search" calls
const WEB_SEARCH_TOOL_NAMES = new Set([
  'web_search', 'web_fetch',
  'open-websearch', 'open_websearch',
  'search', 'fetch-web', 'fetch_web',
  'fetch-csdn', 'fetch_csdn',
  'fetch-github-readme', 'fetch_github_readme',
  'tavily-search', 'tavily_search', 'tavily',
  'baidu-search', 'baidu_search', 'baidu'
])

function isWebSearchToolName(name: string | undefined): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  if (WEB_SEARCH_TOOL_NAMES.has(lower)) return true
  return lower.includes('open-websearch') ||
    lower.includes('websearch') ||
    lower.includes('tavily') ||
    lower.includes('baidu') ||
    lower.includes('search') ||
    lower.includes('fetch-web') ||
    lower.includes('fetch-csdn')
}

/** Map a raw tool name to a localized, human-readable label. */
function localizeToolName(
  name: string,
  t: (key: string) => string
): string {
  const lower = name.toLowerCase().trim()
  if (lower === 'web_search') return t('webSearchToolWebSearch')
  if (lower === 'web_fetch') return t('webSearchToolWebFetch')
  if (lower === 'open-websearch' || lower === 'open_websearch') return t('webSearchToolOpenWebSearch')
  if (lower === 'fetch-web' || lower === 'fetch_web') return t('webSearchToolFetchWeb')
  if (lower === 'fetch-csdn' || lower === 'fetch_csdn') return t('webSearchToolFetchCsdn')
  if (lower === 'fetch-github-readme' || lower === 'fetch_github_readme') return t('webSearchToolFetchGithubReadme')
  if (lower === 'tavily-search' || lower === 'tavily_search' || lower === 'tavily') return t('webSearchToolTavily')
  if (lower === 'baidu-search' || lower === 'baidu_search' || lower === 'baidu') return t('webSearchToolBaidu')
  if (lower.includes('open-websearch')) return t('webSearchToolOpenWebSearch')
  if (lower.includes('fetch-web') || lower.includes('fetch_web')) return t('webSearchToolFetchWeb')
  if (lower.includes('fetch-csdn') || lower.includes('fetch_csdn')) return t('webSearchToolFetchCsdn')
  if (lower.includes('tavily')) return t('webSearchToolTavily')
  if (lower.includes('baidu')) return t('webSearchToolBaidu')
  if (lower.includes('search')) return t('webSearchToolSearch')
  if (lower.includes('fetch')) return t('webSearchToolFetch')
  return name
}

type McpServerStatus = {
  id: string
  enabled: boolean
  status: string
  toolCount?: number
  lastConnectedAt?: string
  lastError?: string
}

type WebSearchCallRecord = {
  id: string
  toolName: string
  query: string
  status: 'running' | 'success' | 'error'
  createdAt?: string
  threadId?: string
  threadTitle?: string
}

type ActivityState = {
  loading: boolean
  servers: McpServerStatus[]
  calls: WebSearchCallRecord[]
}

type WebSearchSettingsCtx = {
  t: (key: string) => string
  Rcode: {
    webSearchEnabled: boolean
    openWebSearchEnabled?: boolean
    openWebSearchEngine?: string
    openWebSearchProxyEnabled?: boolean
    openWebSearchProxyUrl?: string
    tavilySearchApiKey?: string
    baiduSearchApiKey?: string
  }
  updateRcode: (patch: Record<string, unknown>) => void
  mcpConfigText: string
  setMcpConfigText: (text: string) => void
  showApiKey: boolean
  setShowApiKey: (v: boolean) => void
}

type LocalNotice = { tone: 'success' | 'error' | 'info'; message: string } | null

/** Extract a human-readable query from a tool block's meta/detail. */
function extractQuery(block: Record<string, unknown>): string {
  const meta = block.meta as Record<string, unknown> | undefined
  // Try meta.arguments.query (MCP tools)
  const metaArgs = meta?.arguments as Record<string, unknown> | undefined
  if (metaArgs) {
    if (typeof metaArgs.query === 'string') return metaArgs.query
    if (typeof metaArgs.url === 'string') return metaArgs.url
    if (typeof metaArgs.keyword === 'string') return metaArgs.keyword
    if (Array.isArray(metaArgs.queries) && typeof metaArgs.queries[0] === 'string') {
      return String(metaArgs.queries[0])
    }
  }
  // Try meta.query
  if (meta && typeof meta.query === 'string') return meta.query
  // Try meta.url
  if (meta && typeof meta.url === 'string') return meta.url
  // Fall back to summary or detail (truncated)
  const summary = typeof block.summary === 'string' ? block.summary : ''
  const detail = typeof block.detail === 'string' ? block.detail : ''
  // Try to parse JSON from detail to extract query
  if (detail) {
    try {
      const parsed = JSON.parse(detail)
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.query === 'string') return parsed.query
        if (typeof parsed.url === 'string') return parsed.url
        if (typeof parsed.keyword === 'string') return parsed.keyword
      }
    } catch { /* not JSON */ }
  }
  return summary || detail.slice(0, 80) || ''
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    return d.toLocaleDateString()
  } catch {
    return iso
  }
}

export function WebSearchSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t, Rcode, updateRcode, mcpConfigText, setMcpConfigText
  } = ctx as WebSearchSettingsCtx
  const [tavilyVisible, setTavilyVisible] = useState(false)
  const [baiduVisible, setBaiduVisible] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState<LocalNotice>(null)
  const [activity, setActivity] = useState<ActivityState>({ loading: false, servers: [], calls: [] })

  const openWebSearchEnabled = Rcode.openWebSearchEnabled !== false
  const openWebSearchEngine = Rcode.openWebSearchEngine || 'duckduckgo'
  const openWebSearchProxyEnabled = Rcode.openWebSearchProxyEnabled === true
  const openWebSearchProxyUrl = Rcode.openWebSearchProxyUrl ?? ''

  const tavilyKey = Rcode.tavilySearchApiKey ?? ''
  const baiduKey = Rcode.baiduSearchApiKey ?? ''

  // Load MCP config when entering this tab
  useEffect(() => {
    if (mcpConfigText) return
    if (typeof window.RcodeGui?.getRcodeConfigFile !== 'function') return
    void window.RcodeGui.getRcodeConfigFile().then((config) => {
      setMcpConfigText(config.content)
    }).catch(() => undefined)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load activity (MCP server status + recent web search calls)
  const loadActivity = useCallback(async (): Promise<void> => {
    const provider = getProvider()
    if (!provider) return
    setActivity((prev) => ({ ...prev, loading: true }))

    // 1. Load MCP server diagnostics
    let servers: McpServerStatus[] = []
    try {
      const diag = await provider.getToolDiagnostics?.()
      const rawServers = Array.isArray(diag?.mcpServers) ? diag.mcpServers : []
      servers = rawServers
        .filter((s: Record<string, unknown>) => {
          const id = typeof s.id === 'string' ? s.id : ''
          return isWebSearchToolName(id) || id.includes('search')
        })
        .map((s: Record<string, unknown>) => ({
          id: String(s.id ?? ''),
          enabled: s.enabled !== false,
          status: String(s.status ?? 'unknown'),
          toolCount: typeof s.toolCount === 'number' ? s.toolCount : undefined,
          lastConnectedAt: typeof s.lastConnectedAt === 'string' ? s.lastConnectedAt : undefined,
          lastError: typeof s.lastError === 'string' ? s.lastError : undefined
        }))
    } catch { /* ignore */ }

    // 2. Load recent threads and extract web search tool calls
    let calls: WebSearchCallRecord[] = []
    try {
      const threads = await provider.listThreads?.({ limit: 20 })
      if (Array.isArray(threads) && threads.length > 0) {
        const results = await Promise.allSettled(
          threads.slice(0, 15).map(async (thread) => {
            const detail = await provider.getThreadDetail?.(thread.id)
            if (!detail?.blocks) return []
            return (detail.blocks as Array<Record<string, unknown>>)
              .filter((b) => {
                if (b.kind !== 'tool') return false
                const meta = b.meta as Record<string, unknown> | undefined
                return isWebSearchToolName(typeof meta?.toolName === 'string' ? meta.toolName : '')
              })
              .map((b) => {
                const meta = b.meta as Record<string, unknown> | undefined
                return {
                  id: String(b.id ?? ''),
                  toolName: String(meta?.toolName ?? 'unknown'),
                  query: extractQuery(b),
                  status: (b.status as 'running' | 'success' | 'error') ?? 'success',
                  createdAt: typeof b.createdAt === 'string' ? b.createdAt : undefined,
                  threadId: thread.id,
                  threadTitle: thread.title
                } as WebSearchCallRecord
              })
          })
        )
        for (const r of results) {
          if (r.status === 'fulfilled') calls.push(...r.value)
        }
        // Sort by createdAt desc, take top 20
        calls.sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return tb - ta
        })
        calls = calls.slice(0, 20)
      }
    } catch { /* ignore */ }

    setActivity({ loading: false, servers, calls })
  }, [])

  useEffect(() => {
    void loadActivity()
  }, [loadActivity])

  const handleGenerateMcp = useCallback(async (): Promise<void> => {
    const servers: Record<string, unknown> = {}

    // Open WebSearch (Keyless multi-engine web search)
    if (openWebSearchEnabled) {
      const env: Record<string, string> = {
        DEFAULT_SEARCH_ENGINE: openWebSearchEngine || 'duckduckgo'
      }
      if (openWebSearchProxyEnabled) {
        env.USE_PROXY = 'true'
        if (openWebSearchProxyUrl.trim()) {
          env.PROXY_URL = openWebSearchProxyUrl.trim()
        }
      }
      servers['open-websearch'] = {
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'open-websearch@latest'],
        env
      }
    }

    if (tavilyKey.trim()) {
      servers['tavily-search'] = {
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'tavily-mcp'],
        env: { TAVILY_API_KEY: tavilyKey.trim() }
      }
    }

    if (baiduKey.trim()) {
      servers['baidu-search'] = {
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'baidu-search-mcp', '--max-result=5', '--fetch-content-count=2', '--max-content-length=2000']
      }
    }

    if (Object.keys(servers).length === 0) {
      setNotice({ tone: 'error', message: t('webSearchMcpNoKey') })
      return
    }

    setGenerating(true)
    setNotice(null)

    try {
      // Load current config if not already loaded
      let current: Record<string, unknown> = {}
      try { current = JSON.parse(mcpConfigText || '{}') } catch { /* use empty */ }
      if (Object.keys(current).length === 0 && typeof window.RcodeGui?.getRcodeConfigFile === 'function') {
        const config = await window.RcodeGui.getRcodeConfigFile()
        try { current = JSON.parse(config.content || '{}') } catch { /* use empty */ }
      }
      const existingServers = (current.servers || {}) as Record<string, unknown>
      const next = {
        ...current,
        servers: {
          ...existingServers,
          ...servers
        }
      }
      const nextText = JSON.stringify(next, null, 2)
      setMcpConfigText(nextText)

      // Save to disk
      if (typeof window.RcodeGui?.setRcodeConfigFile === 'function') {
        await window.RcodeGui.setRcodeConfigFile(nextText)
      }
      setNotice({ tone: 'success', message: t('webSearchMcpGenerated') })
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : 'Failed to generate MCP config.' })
    } finally {
      setGenerating(false)
    }
  }, [openWebSearchEnabled, openWebSearchEngine, openWebSearchProxyEnabled, openWebSearchProxyUrl, tavilyKey, baiduKey, mcpConfigText, setMcpConfigText, t])

  const serverStatusText = (status: string): string => {
    switch (status) {
      case 'connected': return t('webSearchStatusConnected')
      case 'error': return t('webSearchStatusError')
      case 'disabled': return t('webSearchStatusDisabled')
      case 'reconnecting': return t('webSearchStatusReconnecting')
      default: return status
    }
  }

  const serverStatusColor = (status: string): string => {
    switch (status) {
      case 'connected': return 'text-emerald-600 dark:text-emerald-400'
      case 'error': return 'text-red-600 dark:text-red-400'
      case 'disabled': return 'text-ds-muted'
      case 'reconnecting': return 'text-amber-600 dark:text-amber-400'
      default: return 'text-ds-muted'
    }
  }

  return (
    <div className="space-y-6">
      {/* 调用记录与状态 */}
      <SettingsCard
        title={t('webSearchActivity')}
        action={
          <button
            type="button"
            onClick={() => void loadActivity()}
            disabled={activity.loading}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] text-ds-muted transition hover:bg-ds-bg-hover hover:text-ds-text disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${activity.loading ? 'animate-spin' : ''}`} />
            {t('webSearchRefresh')}
          </button>
        }
      >
        <div className="px-3 pb-2 pt-1">
          <p className="text-[13px] leading-relaxed text-ds-muted">{t('webSearchActivityDesc')}</p>
        </div>

        {/* MCP 服务器状态 */}
        <div className="px-3 pb-3">
          {activity.loading && activity.servers.length === 0 ? (
            <div className="flex items-center gap-2 py-3 text-[13px] text-ds-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('webSearchLoading')}
            </div>
          ) : activity.servers.length === 0 ? (
            <p className="py-3 text-[13px] text-ds-muted">{t('webSearchNoServers')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {activity.servers.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-ds-border-muted bg-ds-bg-card px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ds-text">{s.id}</span>
                    <span className={`shrink-0 text-[12px] font-semibold ${serverStatusColor(s.status)}`}>
                      {serverStatusText(s.status)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ds-muted">
                    {s.toolCount !== undefined && (
                      <span>{t('webSearchToolCount')}: {s.toolCount}</span>
                    )}
                    {s.lastConnectedAt && (
                      <span>{t('webSearchLastConnected')}: {formatTime(s.lastConnectedAt)}</span>
                    )}
                  </div>
                  {s.lastError && (
                    <p className="mt-1 truncate text-[11px] text-red-500" title={s.lastError}>
                      {s.lastError}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-ds-border-muted" />

        {/* 按工具名聚合的调用次数 */}
        <div className="px-3 py-3">
          <h4 className="mb-2 text-[13px] font-semibold text-ds-text">{t('webSearchToolStats')}</h4>
          {activity.calls.length === 0 ? (
            <p className="py-2 text-[13px] text-ds-muted">{t('webSearchNoCalls')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(() => {
                const counts = new Map<string, { total: number; success: number; error: number; running: number }>()
                for (const c of activity.calls) {
                  const entry = counts.get(c.toolName) ?? { total: 0, success: 0, error: 0, running: 0 }
                  entry.total += 1
                  if (c.status === 'success') entry.success += 1
                  else if (c.status === 'error') entry.error += 1
                  else entry.running += 1
                  counts.set(c.toolName, entry)
                }
                const entries = [...counts.entries()].sort((a, b) => b[1].total - a[1].total)
                return entries.map(([name, stat]) => {
                  const successRate = stat.total > 0 ? Math.round((stat.success / stat.total) * 100) : 0
                  const label = localizeToolName(name, t)
                  return (
                    <div
                      key={name}
                      className="flex min-w-[140px] flex-1 flex-col gap-1 rounded-xl border border-ds-border-muted bg-ds-bg-card px-3 py-2"
                      title={`${label}: ${stat.success} 成功 / ${stat.error} 失败 / ${stat.running} 进行中`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] font-medium text-ds-text">{label}</span>
                        <span className="shrink-0 text-[16px] font-bold tabular-nums text-accent">
                          {stat.total}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-ds-muted">
                        <span className="text-emerald-600 dark:text-emerald-400">{stat.success}</span>
                        <span className="opacity-50">·</span>
                        <span className="text-red-600 dark:text-red-400">{stat.error}</span>
                        {stat.running > 0 ? (
                          <>
                            <span className="opacity-50">·</span>
                            <span className="text-amber-600 dark:text-amber-400">{stat.running}</span>
                          </>
                        ) : null}
                        <span className="ml-auto opacity-70">{successRate}%</span>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>

        <div className="border-t border-ds-border-muted" />

        {/* 最近调用记录 */}
        <div className="px-3 py-3">
          <h4 className="mb-2 text-[13px] font-semibold text-ds-text">{t('webSearchRecentCalls')}</h4>
          {activity.calls.length === 0 ? (
            <p className="py-2 text-[13px] text-ds-muted">{t('webSearchNoCalls')}</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-ds-bg-card text-ds-muted">
                  <tr>
                    <th className="pb-1.5 pr-3 font-medium">{t('webSearchCallQuery')}</th>
                    <th className="pb-1.5 pr-3 font-medium">{t('webSearchCallStatus')}</th>
                    <th className="pb-1.5 font-medium">{t('webSearchCallTime')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.calls.map((c) => (
                    <tr key={c.id} className="border-t border-ds-border-muted/50">
                      <td className="max-w-[200px] truncate py-1.5 pr-3 text-ds-text" title={c.query}>
                        <span className="mr-1.5 inline-block rounded bg-ds-bg-hover px-1.5 py-0.5 text-[10px] text-ds-muted">
                          {localizeToolName(c.toolName, t)}
                        </span>
                        {c.query || '-'}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className={
                          c.status === 'success'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : c.status === 'error'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-600 dark:text-amber-400'
                        }>
                          {c.status === 'success' ? t('webSearchStatusConnected') :
                           c.status === 'error' ? t('webSearchStatusError') : t('webSearchLoading')}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-ds-muted">
                        {formatTime(c.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* 联网搜索总开关 */}
      <SettingsCard title={t('webSearch')}>
        <div className="px-3 pb-2 pt-1">
          <p className="text-[13px] leading-relaxed text-ds-muted">{t('webSearchDesc')}</p>
        </div>

        <SettingRow
          title={t('webSearchEnable')}
          description={t('webSearchEnableDesc')}
          control={
            <Toggle
              checked={Rcode.webSearchEnabled}
              onChange={(v) => updateRcode({ webSearchEnabled: v })}
            />
          }
        />
      </SettingsCard>

      {/* Open WebSearch (免 Key 多引擎搜索) */}
      <SettingsCard
        title={t('webSearchOpenWebSearch')}
        action={
          <button
            type="button"
            onClick={() => {
              if (typeof window.RcodeGui?.openExternal === 'function') {
                void window.RcodeGui.openExternal(OPEN_WEB_SEARCH_REPO_URL).catch(() => undefined)
              } else {
                window.open(OPEN_WEB_SEARCH_REPO_URL, '_blank', 'noopener,noreferrer')
              }
            }}
            className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
          >
            <Globe className="h-3.5 w-3.5" />
            GitHub: open-webSearch
            <ExternalLink className="h-3 w-3" />
          </button>
        }
      >
        <div className="px-3 pb-2 pt-1">
          <div className="flex items-start gap-2 rounded-xl bg-accent/10 p-3 text-[13px] text-accent dark:text-accent-foreground">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-relaxed">{t('webSearchOpenWebSearchDesc')}</p>
          </div>
        </div>

        <SettingRow
          title={t('webSearchOpenWebSearchEnable')}
          description={t('webSearchOpenWebSearchEnableDesc')}
          control={
            <Toggle
              checked={openWebSearchEnabled}
              onChange={(v) => updateRcode({ openWebSearchEnabled: v })}
            />
          }
        />

        {openWebSearchEnabled && (
          <>
            <div className="border-t border-ds-border-muted" />

            <SettingRow
              title={t('webSearchDefaultEngine')}
              description={t('webSearchDefaultEngineDesc')}
              control={
                <select
                  value={openWebSearchEngine}
                  onChange={(e) => updateRcode({ openWebSearchEngine: e.target.value })}
                  className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13.5px] font-medium text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                >
                  {OPEN_WEB_SEARCH_ENGINES.map((engine) => (
                    <option key={engine.id} value={engine.id}>
                      {t(engine.labelKey)} ({engine.id})
                    </option>
                  ))}
                </select>
              }
            />

            <div className="border-t border-ds-border-muted" />

            <SettingRow
              title={t('webSearchProxyEnable')}
              description={t('webSearchProxyDesc')}
              control={
                <Toggle
                  checked={openWebSearchProxyEnabled}
                  onChange={(v) => updateRcode({ openWebSearchProxyEnabled: v })}
                />
              }
            />

            {openWebSearchProxyEnabled && (
              <>
                <div className="border-t border-ds-border-muted" />
                <SettingRow
                  title={t('webSearchProxyUrl')}
                  description={t('webSearchProxyDesc')}
                  wideControl
                  control={
                    <input
                      type="text"
                      value={openWebSearchProxyUrl}
                      onChange={(e) => updateRcode({ openWebSearchProxyUrl: e.target.value })}
                      placeholder={t('webSearchProxyUrlPlaceholder')}
                      className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13.5px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                    />
                  }
                />
              </>
            )}
          </>
        )}
      </SettingsCard>

      {/* 高级 / 备用搜索 API */}
      <SettingsCard title={t('webSearchOptionalApiKeys')}>
        <div className="px-3 pb-2 pt-1">
          <p className="text-[13px] leading-relaxed text-ds-muted">{t('webSearchOptionalApiKeysDesc')}</p>
        </div>

        <SettingRow
          title={t('webSearchTavilyKey')}
          description={t('webSearchTavilyKeyDesc')}
          wideControl
          control={
            <div className="flex w-full flex-col gap-2">
              <SecretInput
                value={tavilyKey}
                onChange={(v) => updateRcode({ tavilySearchApiKey: v })}
                visible={tavilyVisible}
                onToggleVisibility={() => setTavilyVisible(!tavilyVisible)}
                placeholder={t('webSearchTavilyKeyPlaceholder')}
                showLabel={t('showApiKey')}
                hideLabel={t('hideApiKey')}
              />
              <button
                type="button"
                onClick={() => {
                  if (typeof window.RcodeGui?.openExternal === 'function') {
                    void window.RcodeGui.openExternal(TAVILY_KEY_URL).catch(() => undefined)
                  } else {
                    window.open(TAVILY_KEY_URL, '_blank', 'noopener,noreferrer')
                  }
                }}
                className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {t('webSearchGetKey')} — Tavily
              </button>
            </div>
          }
        />

        <div className="border-t border-ds-border-muted" />

        <SettingRow
          title={t('webSearchBaiduKey')}
          description={t('webSearchBaiduKeyDesc')}
          wideControl
          control={
            <div className="flex w-full flex-col gap-2">
              <SecretInput
                value={baiduKey}
                onChange={(v) => updateRcode({ baiduSearchApiKey: v })}
                visible={baiduVisible}
                onToggleVisibility={() => setBaiduVisible(!baiduVisible)}
                placeholder={t('webSearchBaiduKeyPlaceholder')}
                showLabel={t('showApiKey')}
                hideLabel={t('hideApiKey')}
              />
              <button
                type="button"
                onClick={() => {
                  if (typeof window.RcodeGui?.openExternal === 'function') {
                    void window.RcodeGui.openExternal(BAIDU_KEY_URL).catch(() => undefined)
                  } else {
                    window.open(BAIDU_KEY_URL, '_blank', 'noopener,noreferrer')
                  }
                }}
                className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {t('webSearchGetKey')} — 百度千帆 AI Search
              </button>
            </div>
          }
        />

        <div className="border-t border-ds-border-muted" />

        <div className="px-3 py-4">
          <button
            type="button"
            onClick={handleGenerateMcp}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {generating ? t('webSearchGenerating') : t('webSearchGenerateMcp')}
          </button>

          {notice ? (
            <div
              className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] ${
                notice.tone === 'success'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : notice.tone === 'error'
                    ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                    : 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
              }`}
            >
              {notice.tone === 'success' ? (
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : notice.tone === 'error' ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : null}
              <span>{notice.message}</span>
            </div>
          ) : null}
        </div>
      </SettingsCard>
    </div>
  )
}

