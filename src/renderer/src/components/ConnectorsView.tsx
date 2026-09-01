import type { ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Check,
  Info,
  Loader2,
  Plug,
  Plus,
  Search,
  Settings,
  X
} from 'lucide-react'
import { useChatStore } from '../store/chat-store'
import { NoticeView, type MarketplaceNotice } from './PluginMarketplaceParts'
import { rendererRuntimeClient } from '../agent/runtime-client'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
}

type ConnectorConfigField = {
  key: string
  label: string
  placeholder?: string
  type: 'text' | 'password' | 'url'
  required?: boolean
}

type ConnectorItem = {
  id: string
  titleKey: string
  descriptionKey: string
  docsUrl?: string
  icon: string
  category: 'cloud' | 'messaging' | 'productivity' | 'devtools' | 'data'
  source: 'oauth' | 'remote-mcp' | 'webhook'
  statusTone?: 'default' | 'success' | 'warning' | 'error'
  serverIds?: string[]
  setupSteps?: string[]
  noteKey?: string
  configFields?: ConnectorConfigField[]
}

type Notice = MarketplaceNotice
type NoticeTone = 'success' | 'error' | 'info'

const CONNECTOR_CATALOG: ConnectorItem[] = [
  {
    id: 'vercel',
    titleKey: 'pluginMcpVercelTitle',
    descriptionKey: 'pluginMcpVercelDesc',
    icon: '▲',
    category: 'cloud',
    source: 'oauth',
    docsUrl: 'https://vercel.com/docs/agent-resources/vercel-mcp.md',
    serverIds: ['vercel']
  },
  {
    id: 'google-workspace',
    titleKey: 'pluginMcpGoogleWorkspaceTitle',
    descriptionKey: 'pluginMcpGoogleWorkspaceDesc',
    icon: 'G',
    category: 'productivity',
    source: 'oauth',
    serverIds: ['google-workspace']
  },
  {
    id: 'github',
    titleKey: 'pluginMcpGithubTitle',
    descriptionKey: 'pluginMcpGithubDesc',
    icon: '🐙',
    category: 'devtools',
    source: 'remote-mcp',
    configFields: [
      { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub Personal Access Token', type: 'password', required: true }
    ]
  },
  {
    id: 'playwright',
    titleKey: 'pluginMcpPlaywrightTitle',
    descriptionKey: 'pluginMcpPlaywrightDesc',
    icon: '🎭',
    category: 'devtools',
    source: 'remote-mcp'
  },
  {
    id: 'context7',
    titleKey: 'pluginMcpContext7Title',
    descriptionKey: 'pluginMcpContext7Desc',
    icon: '📖',
    category: 'data',
    source: 'remote-mcp'
  },
  {
    id: 'brave-search',
    titleKey: 'pluginMcpBraveSearchTitle',
    descriptionKey: 'pluginMcpBraveSearchDesc',
    icon: '🦁',
    category: 'data',
    source: 'remote-mcp',
    configFields: [
      { key: 'BRAVE_API_KEY', label: 'Brave Search API Key', type: 'password', required: true }
    ]
  },
  {
    id: 'sequential-thinking',
    titleKey: 'pluginMcpSequentialThinkingTitle',
    descriptionKey: 'pluginMcpSequentialThinkingDesc',
    icon: '🧠',
    category: 'devtools',
    source: 'remote-mcp'
  },
  {
    id: 'memory',
    titleKey: 'pluginMcpMemoryTitle',
    descriptionKey: 'pluginMcpMemoryDesc',
    icon: '💾',
    category: 'data',
    source: 'remote-mcp'
  }
]

type ConnectorFilter = 'all' | 'cloud' | 'messaging' | 'productivity' | 'devtools' | 'data'

function ConnectorConfigPanel({
  connector,
  configValues,
  onConfigChange,
  onClose,
  onSave
}: {
  connector: ConnectorItem
  configValues: Record<string, string>
  onConfigChange: (key: string, value: string) => void
  onClose: () => void
  onSave: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const hasConfigFields = connector.configFields && connector.configFields.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-[#18181b]">
      {/* Panel Header */}
      <div className="ds-no-drag flex items-center gap-2.5 border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ds-faint transition hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/[0.04] text-[14px] dark:bg-white/[0.08]">
            {connector.icon}
          </span>
          <div>
            <h2 className="text-[13px] font-semibold text-[#18181b] dark:text-[#f4f4f5]">
              {t(connector.titleKey)}
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.03] px-1.5 py-0.5 text-[10px] font-medium text-ds-faint dark:bg-white/[0.06]">
              {connector.source === 'oauth' ? 'OAuth' : connector.source === 'remote-mcp' ? 'Remote MCP' : 'Webhook'}
            </span>
          </div>
        </div>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Description */}
        <p className="mb-4 text-[12px] leading-[1.6] text-[#606066] dark:text-[#9e9ea6]">
          {t(connector.descriptionKey)}
        </p>

        {/* Status */}
        <div className="mb-4 rounded-lg border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
            <span className="text-[11px] font-medium text-ds-faint">{t('connectorsConfigStatus')}</span>
          </div>
        </div>

        {/* Config Fields */}
        {hasConfigFields ? (
          <div className="space-y-3">
            <h3 className="text-[12px] font-medium text-[#18181b] dark:text-[#f4f4f5]">
              {t('connectorsConfigFields')}
            </h3>
            {connector.configFields!.map((field) => (
              <div key={field.key}>
                <label className="mb-1 block text-[11px] font-medium text-ds-faint">
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                <input
                  type={field.type}
                  value={configValues[field.key] ?? ''}
                  onChange={(e) => onConfigChange(field.key, e.target.value)}
                  placeholder={field.placeholder ?? `Enter ${field.label}`}
                  className="h-8 w-full rounded-lg border border-black/[0.08] bg-white px-3 text-[12px] text-[#18181b] placeholder-ds-faint transition focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400/30 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-[#f4f4f5]"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-black/[0.08] p-4 text-center dark:border-white/[0.1]">
            <Settings className="mx-auto mb-2 h-5 w-5 text-ds-faint" strokeWidth={1.5} />
            <p className="text-[12px] text-ds-faint">
              {t('connectorsConfigNoFields')}
            </p>
          </div>
        )}

        {/* Docs Link */}
        {connector.docsUrl && (
          <a
            href={connector.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center gap-1.5 rounded-lg border border-black/[0.06] px-3 py-2 text-[12px] text-ds-faint transition hover:bg-black/[0.03] hover:text-[#18181b] dark:border-white/[0.08] dark:hover:bg-white/[0.05] dark:hover:text-white"
          >
            <Info className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('pluginOAuthDocs')}
          </a>
        )}
      </div>

      {/* Panel Footer */}
      <div className="border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
        <button
          type="button"
          onClick={onSave}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-white/90"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
          {t('connectorsConfigSave')}
        </button>
      </div>
    </div>
  )
}

export function ConnectorsView({
  leftSidebarCollapsed,
  onToggleLeftSidebar
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<ConnectorFilter>('all')
  const [notices, setNotices] = useState<Notice[]>([])
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [selectedConnector, setSelectedConnector] = useState<ConnectorItem | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})

  const addNotice = useCallback((tone: NoticeTone, messageKey: string, interpolations?: Record<string, string>) => {
    const id = `notice-${Date.now()}`
    setNotices((prev) => [...prev, { id, tone, messageKey, interpolations }])
    setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), 5000)
  }, [])

  const filteredConnectors = useMemo(() => {
    return CONNECTOR_CATALOG.filter((item) => {
      if (activeFilter !== 'all' && item.category !== activeFilter) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const title = t(item.titleKey).toLowerCase()
        const desc = t(item.descriptionKey).toLowerCase()
        if (!title.includes(query) && !desc.includes(query) && !item.id.includes(query)) return false
      }
      return true
    })
  }, [activeFilter, searchQuery, t])

  const handleInstall = useCallback(async (item: ConnectorItem) => {
    setInstallingId(item.id)
    try {
      if (item.serverIds) {
        useChatStore.getState().openSettings('providers')
        addNotice('info', 'pluginOAuthPreviewDesc', { name: t(item.titleKey) })
      } else {
        await rendererRuntimeClient.addMcpServer?.(item.id)
        setInstalledIds((prev) => new Set(prev).add(item.id))
        addNotice('success', 'pluginMcpEnabled')
      }
    } catch {
      addNotice('error', 'pluginMcpRestartHint')
    } finally {
      setInstallingId(null)
    }
  }, [addNotice, t])

  const handleCardClick = useCallback((item: ConnectorItem) => {
    setSelectedConnector(item)
    setConfigValues({})
  }, [])

  const handleConfigChange = useCallback((key: string, value: string) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleConfigSave = useCallback(() => {
    if (!selectedConnector) return
    setInstalledIds((prev) => new Set(prev).add(selectedConnector.id))
    addNotice('success', 'pluginMcpEnabled')
    setSelectedConnector(null)
  }, [selectedConnector, addNotice])

  const filterButtons: { key: ConnectorFilter; label: string }[] = [
    { key: 'all', label: t('pluginTabAll') },
    { key: 'cloud', label: t('connectorsFilterCloud') },
    { key: 'productivity', label: t('connectorsFilterProductivity') },
    { key: 'devtools', label: t('connectorsFilterDevtools') },
    { key: 'data', label: t('connectorsFilterData') }
  ]

  return (
    <div className="flex h-full min-h-0 flex-row overflow-hidden bg-ds-main">
      {/* Left: Connector list */}
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${selectedConnector ? 'max-w-[55%]' : ''}`}>
        {/* Header */}
        <div className="ds-no-drag flex items-center gap-3 border-b border-black/[0.06] px-5 py-4 dark:border-white/[0.08]">
          {!leftSidebarCollapsed && (
            <button
              type="button"
              onClick={onToggleLeftSidebar}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ds-faint transition hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
              aria-label="Toggle sidebar"
            >
              <ArrowRight className="h-4 w-4 rotate-180" strokeWidth={1.75} />
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <Plug className="h-4 w-4 text-zinc-600 dark:text-zinc-400" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-[#18181b] dark:text-[#f4f4f5]">
                {t('connectors')}
              </h1>
              <p className="text-[11.5px] text-ds-faint">
                {t('connectorsSubtitle')}
              </p>
            </div>
          </div>
        </div>

        {/* Notices */}
        {notices.length > 0 && (
          <div className="space-y-2 px-5 pt-3">
            {notices.map((notice) => (
              <NoticeView key={notice.id} notice={notice} onDismiss={() => setNotices((prev) => prev.filter((n) => n.id !== notice.id))} />
            ))}
          </div>
        )}

        {/* Search + Filters */}
        <div className="ds-no-drag flex flex-col gap-3 px-5 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint" strokeWidth={1.75} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('pluginSearchPlaceholder')}
              className="h-8 w-full rounded-lg border border-black/[0.08] bg-white pl-9 pr-3 text-[12.5px] text-[#18181b] placeholder-ds-faint transition focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400/30 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-[#f4f4f5]"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {filterButtons.map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={() => setActiveFilter(btn.key)}
                className={`shrink-0 rounded-full px-3 py-1 text-[11.5px] font-medium transition ${
                  activeFilter === btn.key
                    ? 'bg-zinc-200/60 text-[#18181b] dark:bg-white/10 dark:text-white'
                    : 'text-ds-faint hover:bg-black/[0.04] hover:text-[#18181b] dark:hover:bg-white/[0.06] dark:hover:text-white'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Connector Grid */}
        <div className="flex-1 overflow-y-auto px-5 pb-6">
          {filteredConnectors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Plug className="mb-3 h-8 w-8 text-ds-faint/50" strokeWidth={1.25} />
              <p className="text-[13px] text-ds-faint">{t('pluginNoResults')}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredConnectors.map((item) => {
                const isInstalled = installedIds.has(item.id)
                const isInstalling = installingId === item.id
                const isSelected = selectedConnector?.id === item.id
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCardClick(item)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardClick(item) }}
                    className={`group relative flex cursor-pointer flex-col rounded-xl border p-4 transition ${
                      isSelected
                        ? 'border-zinc-400 bg-zinc-100/50 dark:border-zinc-500 dark:bg-white/[0.06]'
                        : 'border-black/[0.06] bg-white hover:shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/[0.04] text-[16px] dark:bg-white/[0.08]">
                          {item.icon}
                        </span>
                        <div>
                          <h2 className="text-[13px] font-medium text-[#18181b] dark:text-[#f4f4f5]">
                            {t(item.titleKey)}
                          </h2>
                          <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.03] px-1.5 py-0.5 text-[10px] font-medium text-ds-faint dark:bg-white/[0.06]">
                            {item.source === 'oauth' ? 'OAuth' : item.source === 'remote-mcp' ? 'Remote MCP' : 'Webhook'}
                          </span>
                        </div>
                      </div>
                      {isInstalled && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10">
                          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
                        </span>
                      )}
                    </div>

                    <p className="mb-4 flex-1 text-[12px] leading-[1.6] text-[#606066] dark:text-[#9e9ea6]">
                      {t(item.descriptionKey)}
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleInstall(item) }}
                        disabled={isInstalling || isInstalled}
                        className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-zinc-900 px-3 text-[11.5px] font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-55 dark:bg-white dark:text-zinc-900 dark:hover:bg-white/90"
                      >
                        {isInstalling ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : isInstalled ? (
                          <Check className="h-3 w-3" strokeWidth={2} />
                        ) : (
                          <Plus className="h-3 w-3" strokeWidth={2} />
                        )}
                        {isInstalled ? t('pluginMcpAdded', { path: '' }) : t('pluginOAuthInstall')}
                      </button>
                      {item.configFields && item.configFields.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleCardClick(item) }}
                          className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-black/[0.08] px-2 text-[11.5px] text-ds-faint transition hover:bg-black/[0.04] hover:text-[#18181b] dark:border-white/[0.1] dark:hover:bg-white/[0.06] dark:hover:text-white"
                        >
                          <Settings className="h-3 w-3" strokeWidth={1.75} />
                          {t('connectorsConfig')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: Config Panel */}
      {selectedConnector && (
        <div className="w-[320px] shrink-0">
          <ConnectorConfigPanel
            connector={selectedConnector}
            configValues={configValues}
            onConfigChange={handleConfigChange}
            onClose={() => setSelectedConnector(null)}
            onSave={handleConfigSave}
          />
        </div>
      )}
    </div>
  )
}
