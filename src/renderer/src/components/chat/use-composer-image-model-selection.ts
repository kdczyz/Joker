import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { getModelProviderSettings } from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { emitRendererSettingsChanged, SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import type { ModelProviderModelGroup } from '@shared/Rcode-gui-api'

export interface ComposerImageModelSelection {
  /** Image-model groups grouped by the provider that exposes them. */
  groups: ModelProviderModelGroup[]
  /** The image model id currently configured for image generation. */
  currentModel: string
  /** Persist the chosen image model as the image-generation model. */
  select: (modelId: string, providerId: string) => void
}

/**
 * Bridges the composer model picker with the image-generation configuration.
 *
 * Image models live under each provider's `image` capability (not in the chat
 * `models` list), so they never appear in the normal composer picker. This
 * hook collects them into selectable groups and writes the chosen model back
 * into `Rcode.imageGeneration` so the runtime `generate_image` tool uses it.
 */
export function useComposerImageModelSelection(): ComposerImageModelSelection {
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null)

  useEffect(() => {
    let active = true
    const refresh = async (): Promise<void> => {
      const next = await rendererRuntimeClient.getSettings()
      if (active) setSettings(next)
    }
    void refresh()
    const onChanged = (event: Event): void => {
      const detail = (event as CustomEvent<AppSettingsV1>).detail
      if (detail) setSettings(detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChanged)
    return () => {
      active = false
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onChanged)
    }
  }, [])

  const groups = useMemo<ModelProviderModelGroup[]>(() => {
    if (!settings) return []
    return getModelProviderSettings(settings)
      .providers.filter((provider) => Boolean(provider.image?.models?.length))
      .map((provider) => ({
        providerId: provider.id,
        label: provider.name?.trim() || provider.id,
        modelIds: provider.image?.models ?? []
      }))
  }, [settings])

  const currentModel = settings?.agents?.Rcode?.imageGeneration?.model?.trim() ?? ''

  const select = useCallback((modelId: string, providerId: string) => {
    const current = settings?.agents?.Rcode?.imageGeneration ?? {}
    void rendererRuntimeClient.setSettings({
      agents: { Rcode: { imageGeneration: { ...current, providerId, model: modelId } } }
    }).then((saved) => {
      emitRendererSettingsChanged(saved)
    })
  }, [settings])

  return { groups, currentModel, select }
}
