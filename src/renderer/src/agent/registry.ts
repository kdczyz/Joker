import type { AgentProvider } from './types'
import { RcodeRuntimeProvider } from './Rcode-runtime'

let cachedProvider: AgentProvider | null = null

export function getProvider(): AgentProvider {
  if (cachedProvider) return cachedProvider
  cachedProvider = new RcodeRuntimeProvider()
  return cachedProvider
}

export function resetProviderCacheForTests(): void {
  cachedProvider = null
}
