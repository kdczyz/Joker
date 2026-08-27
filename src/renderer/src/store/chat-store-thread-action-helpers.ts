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

const MAX_SSE_RECONNECT_DEPTH = 5

export function subscribeThreadEventsWithRecovery(
  provider: AgentProvider,
  threadId: string,
  sinceSeq: number,
  sink: ThreadEventSink,
  signal: AbortSignal,
  get: ChatStoreGet,
  depth = 0
): void {
  void provider.subscribeThreadEvents(threadId, sinceSeq, sink, signal)
    .catch(() => undefined)
    .then(() => {
      if (signal.aborted) return
      const state = get()
      if (state.activeThreadId !== threadId || !state.busy) return
      // SSE 流关闭（分页回放结束或连接断开）。如果深度未超限且 lastSeq 已推进，
      // 用当前 cursor 轻量重连 SSE，避免每次走完整的 HTTP getThreadDetail。
      if (depth < MAX_SSE_RECONNECT_DEPTH && state.lastSeq > sinceSeq) {
        const ac = new AbortController()
        signal.addEventListener('abort', () => ac.abort())
        subscribeThreadEventsWithRecovery(provider, threadId, state.lastSeq, sink, ac.signal, get, depth + 1)
        return
      }
      // 降级到完整恢复（HTTP getThreadDetail + 重新订阅）
      void state.recoverActiveTurn()
    })
}
