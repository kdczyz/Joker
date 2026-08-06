import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Cloud, Download, Loader2, RefreshCw, Trash2, Upload, CheckCircle2 } from 'lucide-react'
import {
  getCloudAiConfig,
  saveCloudAiConfig,
  deleteCloudAiConfig,
  type CloudAiConfig,
  type CloudAiProvider
} from '../auth/authClient'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import {
  defaultModelRequestRetrySettings,
  normalizeModelProviderId
} from '@shared/app-settings'

interface CloudProvidersPanelProps {
  onImportProvider: (provider: ModelProviderProfileV1) => void
  getLocalProviders: () => ModelProviderProfileV1[]
  authenticated: boolean
  /** Auto-merge cloud provider metadata into local (preserves local apiKey). */
  onAutoSyncProviders: (cloudProviders: CloudAiProvider[]) => void
}

type NoticeTone = 'success' | 'error' | 'info'
interface NoticeState {
  tone: NoticeTone
  message: string
}

function cloudProviderToLocalProfile(cloud: CloudAiProvider): ModelProviderProfileV1 {
  const id = normalizeModelProviderId(cloud.id) || normalizeModelProviderId(cloud.displayName) || `cloud-${Date.now()}`
  const models = cloud.models.length > 0 ? cloud.models : (cloud.model ? [cloud.model] : [])
  const profile: ModelProviderProfileV1 = {
    id,
    name: cloud.displayName || id,
    apiKey: '',
    baseUrl: cloud.baseUrl,
    endpointFormat: 'chat_completions',
    retry: defaultModelRequestRetrySettings(),
    models,
    modelProfiles: {}
  }
  if (cloud.imageModels.length > 0) {
    ;(profile as ModelProviderProfileV1 & { image?: { protocol: 'openai-images'; baseUrl: string; models: string[] } }).image = {
      protocol: 'openai-images',
      baseUrl: cloud.baseUrl,
      models: cloud.imageModels
    }
  }
  return profile
}

function localProviderToSavePayload(provider: ModelProviderProfileV1) {
  const imageModels = provider.image?.models ?? []
  return {
    providerId: provider.id,
    displayName: provider.name,
    baseUrl: provider.baseUrl,
    chatCompletionsPath: '/chat/completions',
    imageGenerationPath: '/images/generations',
    model: provider.models[0] ?? '',
    models: provider.models,
    defaultImageModel: imageModels[0],
    imageModels,
    apiKey: provider.apiKey
  }
}

export function CloudProvidersPanel({
  onImportProvider,
  getLocalProviders,
  authenticated,
  onAutoSyncProviders
}: CloudProvidersPanelProps): ReactElement {
  const [config, setConfig] = useState<CloudAiConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [syncFlash, setSyncFlash] = useState(false)
  const syncFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async (silent = false) => {
    if (!authenticated) return
    if (!silent) setLoading(true)
    if (!silent) setNotice(null)
    try {
      const data = await getCloudAiConfig()
      setConfig(data)
      if (silent) {
        // Auto-merge cloud metadata into local providers
        onAutoSyncProviders(data.providers)
        setSyncFlash(true)
        if (syncFlashTimer.current) clearTimeout(syncFlashTimer.current)
        syncFlashTimer.current = setTimeout(() => setSyncFlash(false), 2000)
      }
    } catch (error) {
      if (!silent) {
        setNotice({ tone: 'error', message: error instanceof Error ? error.message : '无法读取云端配置' })
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [authenticated, onAutoSyncProviders])

  // Initial load
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Listen for config.sync events from RemoteAgent (real-time sync)
  useEffect(() => {
    if (!authenticated) return
    const unsub = window.RcodeGui.remoteAgent.onConfigSync(() => {
      void refresh(true)
    })
    return unsub
  }, [authenticated, refresh])

  // Periodic fallback polling (every 60s) in case WebSocket isn't connected
  useEffect(() => {
    if (!authenticated) return
    const timer = setInterval(() => void refresh(true), 60_000)
    return () => clearInterval(timer)
  }, [authenticated, refresh])

  // Cleanup
  useEffect(() => {
    return () => {
      if (syncFlashTimer.current) clearTimeout(syncFlashTimer.current)
    }
  }, [])

  const handleImport = useCallback((cloud: CloudAiProvider) => {
    onImportProvider(cloudProviderToLocalProfile(cloud))
    setNotice({ tone: 'success', message: `已导入「${cloud.displayName}」到本地，请补充 API Key` })
  }, [onImportProvider])

  const handleSaveLocal = useCallback(async (provider: ModelProviderProfileV1) => {
    if (!provider.apiKey.trim()) {
      setNotice({ tone: 'error', message: '本地接口未填写 API Key，无法保存到云端' })
      return
    }
    setBusy(`save-${provider.id}`)
    setNotice(null)
    try {
      const next = await saveCloudAiConfig(localProviderToSavePayload(provider))
      setConfig(next)
      setNotice({ tone: 'success', message: `「${provider.name}」已保存到云端账号` })
      // Notify other devices to sync
      void window.RcodeGui.remoteAgent.notifyConfigSync()
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : '保存到云端失败' })
    } finally {
      setBusy(null)
    }
  }, [])

  const handleDelete = useCallback(async (providerId: string, name: string) => {
    setBusy(`del-${providerId}`)
    setNotice(null)
    try {
      const next = await deleteCloudAiConfig(providerId)
      setConfig(next)
      setNotice({ tone: 'success', message: `已从云端删除「${name}」` })
      // Notify other devices to sync
      void window.RcodeGui.remoteAgent.notifyConfigSync()
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : '删除云端配置失败' })
    } finally {
      setBusy(null)
    }
  }, [])

  const noticeClass =
    notice?.tone === 'error'
      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
      : notice?.tone === 'success'
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'bg-ds-subtle text-ds-muted'

  if (!authenticated) {
    return (
      <div className="rounded-2xl border border-ds-border bg-ds-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
          <h3 className="text-[14px] font-semibold text-ds-ink">云端账号配置</h3>
        </div>
        <p className="mt-2 text-[13px] text-ds-muted">
          登录 Rcode 账号后，接口与模型配置将自动在电脑端和手机端之间实时同步。
        </p>
      </div>
    )
  }

  const localProviders = getLocalProviders()
  const cloudProviders = config?.providers ?? []
  const localById = new Map(localProviders.map((p) => [p.baseUrl, p]))

  return (
    <div className="rounded-2xl border border-ds-border bg-ds-card shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
          <h3 className="text-[14px] font-semibold text-ds-ink">云端账号配置</h3>
          {syncFlash ? (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-500">
              <CheckCircle2 className="h-3 w-3" />
              已同步
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          刷新
        </button>
      </div>

      {/* Sync status indicator */}
      <div className="mx-4 mt-2 flex items-center gap-1.5 text-[11.5px] text-ds-faint">
        <span className={`h-1.5 w-1.5 rounded-full ${syncFlash ? 'bg-emerald-500' : 'bg-ds-muted'}`} />
        实时同步已开启 — 电脑端和手机端配置变更将自动同步
      </div>

      {notice ? (
        <div className={`mx-4 mt-3 rounded-lg px-3 py-2 text-[12.5px] ${noticeClass}`}>
          {notice.message}
        </div>
      ) : null}

      {cloudProviders.length === 0 ? (
        <div className="px-4 py-4 text-[13px] text-ds-muted">
          云端账号尚未保存接口配置。在下方本地接口填写 API Key 后，可点「保存到云端」同步到账号。
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 py-3">
          {cloudProviders.map((cloud) => {
            const matchedLocal = localById.get(cloud.baseUrl)
            return (
              <div
                key={cloud.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
                    <span className="truncate">{cloud.displayName}</span>
                    <span className="shrink-0 rounded bg-ds-subtle px-1.5 py-0.5 text-[10.5px] font-medium text-ds-muted">
                      {cloud.apiKeyPreview}
                    </span>
                    {matchedLocal?.apiKey?.trim() ? (
                      <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
                        本地已就绪
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11.5px] text-ds-faint" title={cloud.baseUrl}>
                    {cloud.baseUrl}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded bg-ds-hover px-1.5 py-0.5 text-[11px] text-ds-muted">
                      {cloud.model}
                    </span>
                    {cloud.models.slice(0, 4).map((m) =>
                      m === cloud.model ? null : (
                        <span key={m} className="rounded bg-ds-hover px-1.5 py-0.5 text-[11px] text-ds-faint">
                          {m}
                        </span>
                      )
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    title="导入到本地"
                    onClick={() => handleImport(cloud)}
                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    title="从云端删除"
                    onClick={() => void handleDelete(cloud.id, cloud.displayName)}
                    disabled={busy === `del-${cloud.id}`}
                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-red-500/10 hover:text-red-500 disabled:opacity-45"
                  >
                    {busy === `del-${cloud.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {localProviders.filter((p) => p.apiKey.trim()).length > 0 ? (
        <div className="border-t border-ds-border-muted px-4 py-3">
          <div className="mb-2 text-[12.5px] font-medium text-ds-muted">将本地接口保存到云端账号</div>
          <div className="flex flex-col gap-1.5">
            {localProviders
              .filter((p) => p.apiKey.trim())
              .map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => void handleSaveLocal(provider)}
                  disabled={busy === `save-${provider.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-2 text-left text-[12.5px] transition hover:bg-ds-hover disabled:opacity-45"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Upload className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} />
                    <span className="truncate text-ds-ink">{provider.name}</span>
                    <span className="truncate font-mono text-[11px] text-ds-faint">{provider.baseUrl}</span>
                  </span>
                  {busy === `save-${provider.id}` ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
