import { ipcMain } from 'electron'
import { GrokBuildAdapter, type GrokBuildEvent, type GrokProviderConfig } from '../runtime/grok-build-adapter'
import { logError, logInfo } from '../logger'

// ---------------------------------------------------------------------------
// IPC Channel Constants
// ---------------------------------------------------------------------------

const GROK_CHANNELS = {
  CONNECT: 'grok:connect',
  DISCONNECT: 'grok:disconnect',
  SEND_PROMPT: 'grok:send-prompt',
  CANCEL: 'grok:cancel',
  EVENT: 'grok:event',
  STATUS: 'grok:status'
} as const

// ---------------------------------------------------------------------------
// IPC Registration
// ---------------------------------------------------------------------------

/**
 * Register IPC handlers that bridge the renderer to the grok-build ACP runtime.
 * Events from grok-build are forwarded to the renderer via webContents.send.
 */
export function registerGrokIpc(options: {
  getMainWindow: () => Electron.BrowserWindow | null
}): () => void {
  const { getMainWindow } = options

  const forwardEvent = (event: GrokBuildEvent): void => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(GROK_CHANNELS.EVENT, event)
  }

  // When the renderer asks to connect to grok-build
  ipcMain.handle(GROK_CHANNELS.CONNECT, async (_event, params: {
    cwd: string
    apiKey: string
    baseUrl?: string
    model?: string
    providerId?: string
  }) => {
    try {
      const config: GrokProviderConfig = {
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        model: params.model,
        providerId: params.providerId
      }
      logInfo('grok-ipc', `Connecting to grok-build with cwd=${params.cwd} provider=${params.providerId ?? 'xai'} model=${params.model ?? 'default'}`)
      GrokBuildAdapter.onEvent(forwardEvent)
      await GrokBuildAdapter.ensureRunning(params.cwd, config)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError('grok-ipc', 'Failed to connect to grok-build', { message })
      return { ok: false, error: message }
    }
  })

  // When the renderer asks to disconnect
  ipcMain.handle(GROK_CHANNELS.DISCONNECT, async () => {
    try {
      GrokBuildAdapter.removeEventListener()
      await GrokBuildAdapter.stopAndWait()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // When the renderer sends a prompt
  ipcMain.handle(GROK_CHANNELS.SEND_PROMPT, async (_event, params: {
    prompt: string
    sessionId?: string
    cwd?: string
  }) => {
    try {
      if (params.sessionId) {
        return {
          ok: true,
          session: await GrokBuildAdapter.continueSession(params.sessionId, params.prompt)
        }
      }
      return {
        ok: true,
        session: await GrokBuildAdapter.sendPrompt(params.prompt, {
          cwd: params.cwd
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError('grok-ipc', 'Failed to send prompt', { message })
      return { ok: false, error: message }
    }
  })

  // When the renderer asks to cancel
  ipcMain.handle(GROK_CHANNELS.CANCEL, async () => {
    try {
      await GrokBuildAdapter.stopAndWait()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // Return the dispose function
  return () => {
    ipcMain.removeHandler(GROK_CHANNELS.CONNECT)
    ipcMain.removeHandler(GROK_CHANNELS.DISCONNECT)
    ipcMain.removeHandler(GROK_CHANNELS.SEND_PROMPT)
    ipcMain.removeHandler(GROK_CHANNELS.CANCEL)
    GrokBuildAdapter.removeEventListener()
  }
}

export { GROK_CHANNELS }