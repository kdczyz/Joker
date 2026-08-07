/**
 * Backend selection store - manages the choice between Rcode and grok-build runtimes.
 * Uses localStorage for persistence since this is a renderer-level concern.
 */
import { create } from 'zustand'
import { getProvider, switchProvider, getActiveProviderId } from '../agent/registry'
import type { AgentProviderId } from '../agent/types'

const BACKEND_STORAGE_KEY = 'Rcode.backend'

interface BackendState {
  /** Currently selected backend */
  backend: AgentProviderId
  /** Whether grok-build is connected */
  grokConnected: boolean
  /** Connection status message */
  grokStatus: string
  /** Currently selected model for grok backend */
  grokModel: string
  /** Currently selected provider id for grok backend */
  grokProviderId: string

  /** Actions */
  setBackend: (backend: AgentProviderId) => void
  connectGrok: (cwd: string) => Promise<void>
  disconnectGrok: () => Promise<void>
}

function loadBackend(): AgentProviderId {
  try {
    const stored = localStorage.getItem(BACKEND_STORAGE_KEY)
    if (stored === 'grok-build' || stored === 'Rcode') return stored
  } catch { /* ignore */ }
  return 'Rcode'
}

/** Resolve the provider config from Rcode settings for grok-build connection. */
async function resolveGrokProviderConfig(): Promise<{
  apiKey: string
  baseUrl: string
  model: string
  providerId: string
}> {
  const settings = await window.RcodeGui.getSettings()
  const providerId = settings.agents?.Rcode?.providerId || settings.provider?.providers?.[0]?.id || ''
  const model = settings.agents?.Rcode?.model || ''

  const provider = settings.provider?.providers?.find(p => p.id === providerId)
  const apiKey = provider?.apiKey ?? ''
  const baseUrl = provider?.baseUrl ?? ''

  return { apiKey, baseUrl, model, providerId }
}

export const useBackendStore = create<BackendState>((set, get) => ({
  backend: loadBackend(),
  grokConnected: false,
  grokStatus: '',
  grokModel: '',
  grokProviderId: '',

  setBackend: (backend: AgentProviderId) => {
    try {
      localStorage.setItem(BACKEND_STORAGE_KEY, backend)
    } catch { /* ignore */ }
    set({ backend })
    switchProvider(backend)
  },

  connectGrok: async (cwd: string) => {
    set({ grokStatus: '正在连接...' })

    try {
      const config = await resolveGrokProviderConfig()

      if (!config.apiKey) {
        set({ grokStatus: '请先在模型设置中配置 API Key' })
        return
      }

      const result = await window.RcodeGui.grok.connect({
        cwd,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || undefined,
        model: config.model || undefined,
        providerId: config.providerId || undefined
      })
      if (result.ok) {
        // Switch to grok-build provider and ensure the event listener is set up
        const provider = switchProvider('grok-build')
        await provider.connect().catch(() => { /* connect() already handled */ })
        set({
          backend: 'grok-build',
          grokConnected: true,
          grokStatus: '已连接',
          grokModel: config.model,
          grokProviderId: config.providerId
        })
      } else {
        set({ grokConnected: false, grokStatus: result.error ?? '连接失败' })
      }
    } catch (err) {
      set({
        grokConnected: false,
        grokStatus: err instanceof Error ? err.message : '连接失败'
      })
    }
  },

  disconnectGrok: async () => {
    try {
      await window.RcodeGui.grok.disconnect()
    } catch { /* ignore */ }
    set({ grokConnected: false, grokStatus: '已断开' })
  }
}))

/**
 * Initialize the backend on app startup. Call this once during app initialization.
 */
export async function initializeBackend(): Promise<void> {
  const backend = loadBackend()
  if (backend === 'grok-build') {
    try {
      const config = await resolveGrokProviderConfig()
      if (!config.apiKey) {
        // Fall back to Rcode if no API key is configured
        switchProvider('Rcode')
        useBackendStore.setState({ backend: 'Rcode', grokConnected: false, grokStatus: '未配置 API Key，已回退到 Rcode' })
        return
      }

      const cwd = await window.RcodeGui.getSettings().then(s => {
        return s.workspaceRoot || s.conversationWorkspaceRoot || window.RcodeGui.homeDir
      }).catch(() => window.RcodeGui.homeDir)
      if (cwd) {
        try {
          const result = await window.RcodeGui.grok.connect({
            cwd,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl || undefined,
            model: config.model || undefined,
            providerId: config.providerId || undefined
          })
          if (result.ok) {
            const provider = switchProvider('grok-build')
            await provider.connect().catch(() => { /* connect() already handled */ })
            useBackendStore.setState({
              backend: 'grok-build',
              grokConnected: true,
              grokStatus: '已连接',
              grokModel: config.model,
              grokProviderId: config.providerId
            })
            return
          }
        } catch { /* fall through to Rcode */ }
      }
    } catch { /* fall through to Rcode */ }

    // Fall back to Rcode if grok-build connection fails
    switchProvider('Rcode')
    useBackendStore.setState({ backend: 'Rcode', grokConnected: false, grokStatus: '连接失败，已回退到 Rcode' })
  }
}