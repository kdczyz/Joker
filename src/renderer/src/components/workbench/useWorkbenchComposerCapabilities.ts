import { useMemo } from 'react'
import type { ModelProviderModelProfileV1 } from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/Rcode-gui-api'
import type { CoreRuntimeInfoJson } from '../../agent/Rcode-contract'
import { resolveComposerContextWindowTokens } from '../../store/chat-store-helpers'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'

function normalizeModelCapabilityKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

export type WorkbenchComposerCapabilitiesOptions = {
  route: string
  rightPanelMode: RightPanelMode | null
  activeClawModel?: string | null
  designAssistantModel?: string
  resolvedDesignAssistantProviderId?: string
  writeAssistantModel: string
  resolvedWriteAssistantProviderId: string
  composerModel: string
  composerProviderId?: string
  composerModelGroups: readonly ModelProviderModelGroup[]
  runtimeInfo: CoreRuntimeInfoJson | null
}

export type WorkbenchComposerCapabilities = {
  selectedComposerModel: string
  selectedComposerProviderId: string
  selectedContextWindowTokens?: number
}

function modelProfileForGroup(
  group: ModelProviderModelGroup,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  const key = normalizeModelCapabilityKey(modelId)
  if (!key) return undefined
  const profiles = group.modelProfiles ?? {}
  const direct = profiles[key] ?? profiles[modelId.trim()]
  if (direct) return direct
  return Object.values(profiles).find((profile) =>
    profile.aliases?.some((alias) => normalizeModelCapabilityKey(alias) === key)
  )
}

export function modelProfileForComposerSelection(
  groups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId?: string
): ModelProviderModelProfileV1 | undefined {
  const selectedProviderId = providerId?.trim()
  if (selectedProviderId) {
    const selectedGroup = groups.find((group) => group.providerId === selectedProviderId)
    if (selectedGroup) {
      const profile = modelProfileForGroup(selectedGroup, modelId)
      if (profile) return profile
    }
  }
  for (const group of groups) {
    const profile = modelProfileForGroup(group, modelId)
    if (profile) return profile
  }
  return undefined
}

export function useWorkbenchComposerCapabilities({
  route,
  rightPanelMode,
  activeClawModel,
  designAssistantModel,
  resolvedDesignAssistantProviderId,
  writeAssistantModel,
  resolvedWriteAssistantProviderId,
  composerModel,
  composerProviderId = '',
  composerModelGroups,
  runtimeInfo
}: WorkbenchComposerCapabilitiesOptions): WorkbenchComposerCapabilities {
  const selectedComposerModel =
    route === 'claw'
      ? activeClawModel ?? 'auto'
    : route === 'design'
      ? (designAssistantModel ?? '')
      : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi
          ? writeAssistantModel
          : composerModel
  const selectedComposerProviderId =
    route === 'design'
      ? (resolvedDesignAssistantProviderId ?? '')
      : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi
        ? resolvedWriteAssistantProviderId
        : route === 'chat'
          ? composerProviderId
          : ''
  const selectedContextWindowTokens = useMemo(() => {
    return resolveComposerContextWindowTokens(
      composerModelGroups,
      selectedComposerModel,
      selectedComposerProviderId
    )
  }, [composerModelGroups, selectedComposerModel, selectedComposerProviderId])

  return {
    selectedComposerModel,
    selectedComposerProviderId,
    selectedContextWindowTokens
  }
}
