import type { AgentProvider, AgentProviderId } from './types'
import { RcodeRuntimeProvider } from './Rcode-runtime'
import { GrokBuildProvider } from './grok-build-provider'

let cachedProvider: AgentProvider | null = null
let activeProviderId: AgentProviderId = 'Rcode'

export function getProvider(): AgentProvider {
  if (cachedProvider) return cachedProvider
  return createProvider(activeProviderId)
}

export function getActiveProviderId(): AgentProviderId {
  return activeProviderId
}

export function switchProvider(id: AgentProviderId): AgentProvider {
  if (id === activeProviderId && cachedProvider) return cachedProvider
  activeProviderId = id
  cachedProvider = createProvider(id)
  return cachedProvider
}

function createProvider(id: AgentProviderId): AgentProvider {
  switch (id) {
    case 'grok-build':
      return new GrokBuildProvider()
    case 'Rcode':
    default:
      return new RcodeRuntimeProvider()
  }
}

export function resetProviderCacheForTests(): void {
  cachedProvider = null
  activeProviderId = 'Rcode'
}