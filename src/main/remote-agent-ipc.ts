import { ipcMain, BrowserWindow } from 'electron'
import type { JsonSettingsStore } from './settings-store'
import type { AppSettingsV1, ScheduleReasoningEffort, ScheduleRunMode } from '../shared/app-settings'
import { DEFAULT_SCHEDULE_REASONING_EFFORT } from '../shared/app-settings'
import { getModelProviderSettings } from '../shared/app-settings-provider'
import { runPromptViaRuntime, resolveScheduleModelConfig, type RuntimeRequestFn } from './schedule-runtime-helpers'
import { runtimeRequestViaHost } from './runtime/Rcode-adapter'
import { RemoteAgent, type RemoteAgentExecuteOptions, type RemoteAgentState, type RemoteCommand, type RemoteCommandEvent } from './remote-agent'

export interface RemoteAgentIpcDeps {
  store: JsonSettingsStore
  ensureRuntime: (settings: AppSettingsV1) => Promise<AppSettingsV1 | void>
  getMainWindow: () => BrowserWindow | null
  logError: (category: string, message: string, detail?: unknown) => void
}

export function registerRemoteAgentIpc(deps: RemoteAgentIpcDeps): void {
  const { store, ensureRuntime, getMainWindow, logError } = deps

  let agent: RemoteAgent | null = null

  /** Broadcast to all browser windows. */
  function broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try { win.webContents.send(channel, payload) } catch { /* window closing */ }
      }
    }
  }

  /** Build the runtimeRequest function used by runPromptViaRuntime. */
  const runtimeRequest: RuntimeRequestFn = async (settings, pathAndQuery, init) => {
    return runtimeRequestViaHost(settings, pathAndQuery, init, ensureRuntime)
  }

  /** Map the controller's thinking mode (fast|balanced|deep) to a reasoning effort. */
  function thinkingModeToReasoningEffort(thinkingMode: string | null | undefined): ScheduleReasoningEffort | null {
    if (thinkingMode === 'fast') return 'low'
    if (thinkingMode === 'deep') return 'high'
    if (thinkingMode === 'balanced') return 'medium'
    return null
  }

  /** Execute an agent prompt headlessly via Rcode runtime. */
  async function executeAgent(
    prompt: string,
    mode: ScheduleRunMode,
    signal: AbortSignal,
    options?: RemoteAgentExecuteOptions
  ): Promise<{ ok: boolean; text?: string; message: string }> {
    try {
      const settings = await store.load()
      // Validate the controller-supplied providerId against the desktop's
      // configured providers. If the id doesn't match any local provider,
      // drop it so resolveScheduleModelConfig falls back to model-based
      // lookup — this prevents routing a model to the wrong provider just
      // because a stale/foreign providerId happened to collide.
      const desktopProviderIds = new Set(
        getModelProviderSettings(settings).providers
          .map((p) => p.id)
          .filter(Boolean)
      )
      const safeProviderId =
        options?.providerId && desktopProviderIds.has(options.providerId)
          ? options.providerId
          : null
      const modelConfig = resolveScheduleModelConfig(settings, {
        providerId: safeProviderId,
        model: options?.model ?? null,
        reasoningEffort: thinkingModeToReasoningEffort(options?.thinkingMode)
      })
      // Remote-agent permission override: fall back to the global agent policy
      // when the user hasn't explicitly configured a mode for mobile sessions.
      const remoteAgentSettings = settings.remoteAgent
      const approvalPolicy =
        remoteAgentSettings?.approvalPolicy ?? settings.agents.Rcode.approvalPolicy
      const sandboxMode =
        remoteAgentSettings?.sandboxMode ?? settings.agents.Rcode.sandboxMode
      const result = await runPromptViaRuntime(
        { runtimeRequest },
        settings,
        {
          prompt,
          title: '[Remote] 远程任务',
          workspaceRoot: settings.workspaceRoot || '',
          model: modelConfig.model,
          providerId: modelConfig.providerId || undefined,
          reasoningEffort: modelConfig.reasoningEffort || DEFAULT_SCHEDULE_REASONING_EFFORT,
          mode,
          approvalPolicy,
          sandboxMode,
          waitForResult: true,
          responseTimeoutMs: 30 * 60_000,
          signal
        }
      )
      if (result.ok) {
        return { ok: true, text: result.text, message: result.message ?? 'Completed' }
      }
      return { ok: false, message: result.message }
    } catch (err) {
      const message = err instanceof Error ? err.message : '执行失败'
      return { ok: false, message }
    }
  }

  ipcMain.handle('remote-agent:start', async (_, token: string) => {
    console.log('[remote-agent-ipc] start requested, token length=', token?.length)
    if (!token || typeof token !== 'string') {
      return { ok: false, message: '缺少认证令牌' }
    }
    if (agent) {
      agent.stop()
      agent = null
    }
    agent = new RemoteAgent({
      executeAgent,
      getSettings: () => store.load(),
      onStatusChange: (state: RemoteAgentState, message?: string) => {
        broadcast('remote-agent:status', { state, message })
      },
      onCommandUpdate: (command: RemoteCommand) => {
        broadcast('remote-agent:command', command)
      },
      onCommandEvent: (commandId: string, event: RemoteCommandEvent) => {
        broadcast('remote-agent:event', { commandId, event })
      },
      onConfigSync: (source: string) => {
        console.log('[remote-agent-ipc] config.sync from', source, '→ forwarding to renderer')
        broadcast('remote-agent:config-sync', { source })
      }
    })
    try {
      await agent.start(token)
      console.log('[remote-agent-ipc] agent.start() resolved OK')
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : '启动远程连接失败'
      console.error('[remote-agent-ipc] agent.start() failed:', message)
      logError('remote-agent', message)
      return { ok: false, message }
    }
  })

  ipcMain.handle('remote-agent:stop', async () => {
    if (agent) {
      agent.stop()
      agent = null
    }
    return { ok: true }
  })

  ipcMain.handle('remote-agent:status', async () => {
    if (!agent) return { state: 'offline' as const }
    return { state: agent.state }
  })

  ipcMain.handle('remote-agent:notify-config-sync', async () => {
    if (agent) {
      agent.notifyConfigSync()
    }
    return { ok: true }
  })
}
