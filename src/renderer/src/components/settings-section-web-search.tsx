import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { CheckCircle, ExternalLink, Loader2, Search, XCircle } from 'lucide-react'
import { SecretInput, SettingsCard, SettingRow, Toggle } from './settings-controls'

const TAVILY_KEY_URL = 'https://app.tavily.com/home'
const BAIDU_KEY_URL = 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application'

type WebSearchSettingsCtx = {
  t: (key: string) => string
  Rcode: {
    webSearchEnabled: boolean
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

export function WebSearchSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, Rcode, updateRcode, mcpConfigText, setMcpConfigText, showApiKey, setShowApiKey } = ctx as WebSearchSettingsCtx
  const [tavilyVisible, setTavilyVisible] = useState(false)
  const [baiduVisible, setBaiduVisible] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState<LocalNotice>(null)

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

  const handleGenerateMcp = useCallback(async (): Promise<void> => {
    const servers: Record<string, unknown> = {}

    if (tavilyKey.trim()) {
      servers['tavily-search'] = {
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'tavily-mcp'],
        env: { TAVILY_API_KEY: tavilyKey.trim() }
      }
    }

    // Baidu search is always included (free, no API key required)
    servers['baidu-search'] = {
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'baidu-search-mcp', '--max-result=5', '--fetch-content-count=2', '--max-content-length=2000']
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
  }, [tavilyKey, mcpConfigText, setMcpConfigText, t])

  return (
    <div className="space-y-6">
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

        <div className="border-t border-ds-border-muted" />

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