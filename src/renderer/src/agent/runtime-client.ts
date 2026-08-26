import type { AppSettingsPatch, AppSettingsV1 } from '@shared/app-settings'
import type {
  RuntimeRequestResult,
  SseEndPayload,
  SseErrorPayload,
  SseEventPayload
} from '@shared/Joker-gui-api'

class RendererRuntimeClient {
  private cachedSettings: AppSettingsV1 | null = null
  private settingsPromise: Promise<AppSettingsV1> | null = null

  async getSettings(options?: { forceRefresh?: boolean }): Promise<AppSettingsV1> {
    if (options?.forceRefresh) {
      this.invalidateSettings()
    }
    if (this.cachedSettings) return this.cachedSettings
    if (this.settingsPromise) return this.settingsPromise
    const task = window.JokerGui.getSettings().then((settings) => {
      this.cachedSettings = settings
      return settings
    })
    this.settingsPromise = task.finally(() => {
      if (this.settingsPromise === task) this.settingsPromise = null
    })
    return task
  }

  async setSettings(partial: AppSettingsPatch): Promise<AppSettingsV1> {
    const settings = await window.JokerGui.setSettings(partial)
    this.cachedSettings = settings
    this.settingsPromise = null
    return settings
  }

  invalidateSettings(): void {
    this.cachedSettings = null
    this.settingsPromise = null
  }

  runtimeRequest(path: string, method?: string, body?: string): Promise<RuntimeRequestResult> {
    if (body === undefined) {
      if (method === undefined) return window.JokerGui.runtimeRequest(path)
      return window.JokerGui.runtimeRequest(path, method)
    }
    return window.JokerGui.runtimeRequest(path, method, body)
  }

  restartRuntime(): Promise<void> {
    return window.JokerGui.restartRuntime()
  }

  startSse(
    threadId: string,
    sinceSeq: number,
    streamId?: string,
    options?: { acknowledgedBatches?: boolean }
  ): Promise<{ streamId: string }> {
    return window.JokerGui.startSse(threadId, sinceSeq, streamId, options)
  }

  stopSse(streamId: string): Promise<boolean> {
    return window.JokerGui.stopSse(streamId)
  }

  ackSse(streamId: string, batchId: string): Promise<boolean> {
    return window.JokerGui.ackSse(streamId, batchId)
  }

  onSseEvent(handler: (payload: SseEventPayload) => void): () => void {
    return window.JokerGui.onSseEvent(handler)
  }

  onSseEnd(handler: (payload: SseEndPayload) => void): () => void {
    return window.JokerGui.onSseEnd(handler)
  }

  onSseError(handler: (payload: SseErrorPayload) => void): () => void {
    return window.JokerGui.onSseError(handler)
  }
}

export const rendererRuntimeClient = new RendererRuntimeClient()
