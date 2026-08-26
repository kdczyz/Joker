import type { AgentProvider, AgentProviderId } from './types'
import { JokerRuntimeProvider } from './Joker-runtime'
import { GrokBuildProvider } from './grok-build-provider'

let cachedProvider: AgentProvider | null = null
let activeProviderId: AgentProviderId = 'Joker'

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
    case 'Joker':
    default:
      return new JokerRuntimeProvider()
  }
}

export function resetProviderCacheForTests(): void {
  cachedProvider = null
  activeProviderId = 'Joker'
}