import { useMemo, useState } from 'react'
import type { ModelProviderModelGroup } from '@shared/Rcode-gui-api'

/**
 * Shared model/provider selection state for the document-assistant rail.
 *
 * NOTE: the dedicated "写作台" (Write) workspace was removed, but the SDD
 * assistant panel still reuses this model picker, so the hook is kept (minus
 * any write-route-only wiring) to back `writeAssistantModel` /
 * `resolvedWriteAssistantProviderId` consumed by the SDD turn controller,
 * composer capabilities, and the right-panel `sdd` slot.
 */
type UseWorkbenchWriteAssistantRuntimeParams = {
  composerPickList: string[]
  composerModelGroups: ModelProviderModelGroup[]
}

export function useWorkbenchWriteAssistantRuntime({
  composerPickList,
  composerModelGroups
}: UseWorkbenchWriteAssistantRuntimeParams): {
  resolvedWriteAssistantProviderId: string
  setWriteAssistantModel: (model: string, providerId?: string) => void
  setWriteAssistantOpen: (open: boolean) => void
  writeAssistantModel: string
  writeAssistantOpen: boolean
  writeAssistantPickList: string[]
} {
  const [writeAssistantModel, setWriteAssistantModel] = useState('')
  const [writeAssistantOpen, setWriteAssistantOpen] = useState(false)
  const writeAssistantPickList = useMemo(() => composerPickList, [composerPickList])
  const resolvedWriteAssistantProviderId = useMemo(() => {
    if (!writeAssistantModel) return ''
    for (const group of composerModelGroups) {
      if (group.modelIds.some((modelId) => modelId === writeAssistantModel)) {
        return group.providerId
      }
    }
    return ''
  }, [writeAssistantModel, composerModelGroups])

  return {
    resolvedWriteAssistantProviderId,
    setWriteAssistantModel,
    setWriteAssistantOpen,
    writeAssistantModel,
    writeAssistantOpen,
    writeAssistantPickList
  }
}
