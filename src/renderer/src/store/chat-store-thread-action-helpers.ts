import type { AgentProvider, NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet } from './chat-store-types'
import {
  activeClawChannel,
  composerModelSelectable,
  providerIdForComposerModel,
  providerIdMatchesComposerModel,
  readThreadComposerSelection
} from './chat-store-helpers'

export function fallbackComposerProviderIdForSend(state: ChatState): string {
  if (state.route === 'claw') {
    // claw (IM) 路径下，model 取自 channel.model，providerId 必须与之配对，
    // 否则 runtime 会回退到 default provider，导致 model 与 provider 错配 → HTTP 400。
    const channel = activeClawChannel(state)
    const channelProviderId = channel?.providerId?.trim()
    if (channelProviderId) return channelProviderId
    const channelModel = channel?.model?.trim()
    if (channelModel) {
      const resolved = providerIdForComposerModel(state.composerModelGroups, channelModel)
      if (resolved) return resolved
    }
    // channel 未显式配置时，回退到桌面端当前选中的 provider（已由 setComposerModel 写入）。
    return state.composerProviderId.trim()
  }
  return state.composerProviderId.trim()
}

export async function ensureRuntimeProviderForSend(input: {
  providerId?: string
  model?: string
}): Promise<void> {
  const providerId = input.providerId?.trim()
  const model = input.model?.trim()
  if (!providerId || !model || model.toLowerCase() === 'auto') return
}

export function composerSelectionForThread(
  state: ChatState,
  thread: Pick<NormalizedThread, 'id' | 'model'> | null | undefined
): { model: string; providerId: string } | null {
  if (!thread) return null
  const pickList = state.composerPickList
  const stored = readThreadComposerSelection(thread.id)
  const storedModel = stored?.model.trim() ?? ''
  const threadModel = thread.model.trim()
  const model = composerModelSelectable(pickList, state.composerModelGroups, storedModel)
    ? storedModel
    : composerModelSelectable(pickList, state.composerModelGroups, threadModel)
      ? threadModel
      : ''
  if (!model) return null
  const storedProviderId =
    stored && providerIdMatchesComposerModel(state.composerModelGroups, stored.providerId, model)
      ? stored.providerId
      : ''
  return {
    model,
    providerId: storedProviderId || providerIdForComposerModel(state.composerModelGroups, model)
  }
}

export function subscribeThreadEventsWithRecovery(
  provider: AgentProvider,
  threadId: string,
  sinceSeq: number,
  sink: ThreadEventSink,
  signal: AbortSignal,
  get: ChatStoreGet
): void {
  void provider.subscribeThreadEvents(threadId, sinceSeq, sink, signal)
    .catch(() => undefined)
    .then(() => {
      if (signal.aborted) return
      const state = get()
      if (state.activeThreadId !== threadId || !state.busy) return
      void state.recoverActiveTurn()
    })
}
