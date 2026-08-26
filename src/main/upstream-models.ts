import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getModelProviderPreset,
  getModelProviderSettings,
  isComposerChatModelId,
  listModelProviderModelIds,
  listNonTextModelIds,
  modelProfileSupportsTextChat,
  modelProviderModelProfile,
  modelProviderPresetProfile,
  resolveRcodeRuntimeSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { DEFAULT_COMPOSER_MODEL_IDS } from '../shared/default-composer-models'
import type { ModelProviderModelGroup } from '../shared/Rcode-gui-api'

export type FetchUpstreamModelsResult =
  | { ok: true; modelIds: string[]; defaultModelId?: string; modelGroups?: ModelProviderModelGroup[] }
  | { ok: false; message: string }

export function fallbackModelIds(): string[] {
  return sortComposerModelIds(DEFAULT_COMPOSER_MODEL_IDS)
}

/**
 * Builds the model list the composer picker shows. Despite the historical name,
 * this intentionally mirrors only the models the user has explicitly added to
 * each provider (`provider.models`) — it does NOT query the provider's full
 * upstream `GET /v1/models` catalog.
 *
 * Pulling the whole catalog (issue #337) buried the few configured models under
 * hundreds of upstream ids (e.g. every OpenRouter / Aliyun model) and surfaced
 * ids that error when actually used. Custom-endpoint providers never triggered
 * it, which is why only preset providers were affected. Discover and add
 * upstream models deliberately via "从 API 拉取" (probeModelProvider) in
 * Settings instead.
 *
 * The second argument is kept for call-site compatibility; the upstream key is
 * no longer needed here.
 */
export async function fetchUpstreamModelIds(
  settings: AppSettingsV1,
  _apiKey?: string
): Promise<FetchUpstreamModelsResult> {
  const configuredModelIds = await readConfiguredRcodeModelIds(settings)
  const configuredGroups = await readConfiguredModelGroups(settings)
  const nonTextModelIds = listNonTextModelIds(settings)
  const runtime = resolveRcodeRuntimeSettings(settings)
  const runtimeModel = runtime.model.trim()
  const defaultModelId = isComposerChatModelId(runtimeModel, nonTextModelIds) ? runtimeModel : ''
  return modelListOrError(
    configuredModelIds,
    configuredGroups,
    defaultModelId,
    'Configured providers have no usable text models yet.'
  )
}

export async function readConfiguredRcodeModelIds(settings: AppSettingsV1): Promise<string[]> {
  const runtime = resolveRcodeRuntimeSettings(settings)
  const configPath = join(expandHome(runtime.dataDir), 'config.json')
  const nonTextModelIds = listNonTextModelIds(settings)
  const ids = [runtime.model, ...listModelProviderModelIds(settings)].filter((id) =>
    isComposerChatModelId(id, nonTextModelIds)
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  } catch {
    return mergeModelIds(ids)
  }
  const root = objectValue(parsed)
  const models = objectValue(root.models)
  const contextCompaction = objectValue(root.contextCompaction)
  return mergeModelIds([
    ...ids,
    ...modelIdsFromProfiles(objectValue(contextCompaction.modelProfiles), nonTextModelIds),
    ...modelIdsFromProfiles(objectValue(models.profiles), nonTextModelIds)
  ])
}

function modelListOrError(
  ids: readonly string[],
  groups: readonly ModelProviderModelGroup[],
  defaultModelId: string,
  message: string
): FetchUpstreamModelsResult {
  return hasCustomModelId(ids)
    ? { ok: true, modelIds: mergeModelIds(ids), defaultModelId, modelGroups: mergeModelGroups(groups) }
    : { ok: false, message }
}

let liveZenModelsCache: { models: string[]; timestamp: number } | null = null
const ZEN_CACHE_TTL_MS = 120_000

export function isOpenCodeZenFreeModelId(id: string): boolean {
  const lower = id.trim().toLowerCase()
  return (
    lower.endsWith('-free') ||
    lower.includes('-free') ||
    lower.endsWith(':free') ||
    lower === 'big-pickle'
  )
}

export function getKnownOpenCodeZenFreeModelIds(): string[] {
  return liveZenModelsCache?.models ?? [
    'big-pickle',
    'hy3-free',
    'mimo-v2.5-free',
    'muse-spark-1.2-contributor-free',
    'nemotron-3-ultra-free',
    'nemotron-3.5-lightning-free',
    'x-preview-f-free',
    'deepseek-v4-flash-free',
    'laguna-s-2.1-free'
  ]
}

export async function fetchLiveOpenCodeZenFreeModelIds(): Promise<string[] | null> {
  const now = Date.now()
  if (liveZenModelsCache && now - liveZenModelsCache.timestamp < ZEN_CACHE_TTL_MS) {
    return liveZenModelsCache.models
  }
  try {
    const res = await fetch('https://opencode.ai/zen/v1/models', {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return liveZenModelsCache?.models ?? null
    const json = (await res.json()) as { data?: Array<{ id?: string }> }
    const rawList = Array.isArray(json.data) ? json.data : []
    const freeModels = rawList
      .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
      .filter((id) => Boolean(id) && isOpenCodeZenFreeModelId(id))
    if (freeModels.length > 0) {
      liveZenModelsCache = { models: freeModels, timestamp: now }
      return freeModels
    }
  } catch {
    // network timeout / offline fallback
  }
  return liveZenModelsCache?.models ?? null
}

async function readConfiguredModelGroups(settings: AppSettingsV1): Promise<ModelProviderModelGroup[]> {
  const groups: ModelProviderModelGroup[] = []
  const nonTextModelIds = listNonTextModelIds(settings)
  const configuredProviders = getModelProviderSettings(settings).providers
  const knownZenFreeModels = getKnownOpenCodeZenFreeModelIds()
  if (process.env.NODE_ENV !== 'test') {
    void fetchLiveOpenCodeZenFreeModelIds().catch(() => {})
  }

  for (const provider of configuredProviders) {
    if (provider.id === 'opencode-zen') {
      const baseModels = [...new Set([...knownZenFreeModels, ...provider.models])]
      const modelIds = baseModels.filter((id) =>
        isOpenCodeZenFreeModelId(id)
        && isComposerChatModelId(id, nonTextModelIds)
        && modelProfileSupportsTextChat(modelProviderModelProfile(provider, id))
      )
      if (modelIds.length === 0) continue
      const modelProfiles = { ...(provider.modelProfiles ?? {}) }
      for (const id of modelIds) {
        if (!modelProfiles[id]) {
          modelProfiles[id] = { contextWindowTokens: 131_072 }
        }
      }
      groups.push({
        providerId: provider.id,
        label: provider.name,
        modelIds,
        modelProfiles
      })
      continue
    }

    const modelIds = provider.models.filter((id) =>
      isComposerChatModelId(id, nonTextModelIds)
      && modelProfileSupportsTextChat(modelProviderModelProfile(provider, id))
    )
    if (modelIds.length === 0) continue
    groups.push({
      providerId: provider.id,
      label: provider.name,
      modelIds,
      modelProfiles: provider.modelProfiles
    })
  }

  if (!configuredProviders.some((p) => p.id === 'opencode-zen')) {
    const zenPreset = getModelProviderPreset('opencode-zen')
    if (zenPreset) {
      const zenProfile = modelProviderPresetProfile(zenPreset, 'public')
      const baseModels = [...new Set([...knownZenFreeModels, ...zenProfile.models])]
      const modelIds = baseModels.filter((id) =>
        isOpenCodeZenFreeModelId(id)
        && isComposerChatModelId(id, nonTextModelIds)
        && modelProfileSupportsTextChat(modelProviderModelProfile(zenProfile, id))
      )
      if (modelIds.length > 0) {
        const modelProfiles = { ...(zenProfile.modelProfiles ?? {}) }
        for (const id of modelIds) {
          if (!modelProfiles[id]) {
            modelProfiles[id] = { contextWindowTokens: 131_072 }
          }
        }
        groups.push({
          providerId: zenProfile.id,
          label: zenProfile.name,
          modelIds,
          modelProfiles
        })
      }
    }
  }
  return mergeModelGroups(groups)
}

function mergeModelGroups(groups: readonly ModelProviderModelGroup[]): ModelProviderModelGroup[] {
  const byProvider = new Map<string, ModelProviderModelGroup>()
  for (const group of groups) {
    const providerId = group.providerId.trim()
    if (!providerId) continue
    const existing = byProvider.get(providerId)
    const modelIds = sortComposerModelIds([
      ...(existing?.modelIds ?? []),
      ...group.modelIds
    ])
    byProvider.set(providerId, {
      providerId,
      label: group.label.trim() || providerId,
      modelIds,
      modelProfiles: {
        ...(existing?.modelProfiles ?? {}),
        ...(group.modelProfiles ?? {})
      }
    })
  }
  return [...byProvider.values()].filter((group) => group.modelIds.length > 0)
}

function modelIdsFromProfiles(
  profiles: Record<string, unknown>,
  nonTextModelIds: readonly string[] = []
): string[] {
  const ids: string[] = []
  for (const [modelId, rawProfile] of Object.entries(profiles)) {
    const trimmed = modelId.trim()
    if (trimmed && isComposerChatModelId(trimmed, nonTextModelIds)) ids.push(trimmed)
    const aliases = objectValue(rawProfile).aliases
    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        if (typeof alias !== 'string') continue
        const trimmedAlias = alias.trim()
        if (trimmedAlias && isComposerChatModelId(trimmedAlias, nonTextModelIds)) ids.push(trimmedAlias)
      }
    }
  }
  return ids
}

function mergeModelIds(ids: readonly string[]): string[] {
  return sortComposerModelIds([...DEFAULT_COMPOSER_MODEL_IDS, ...ids])
}

function hasCustomModelId(ids: readonly string[]): boolean {
  const defaults = new Set<string>(DEFAULT_COMPOSER_MODEL_IDS)
  return ids.some((id) => {
    const trimmed = id.trim()
    return trimmed !== '' && !defaults.has(trimmed as typeof DEFAULT_COMPOSER_MODEL_IDS[number])
  })
}

function sortComposerModelIds(ids: readonly string[]): string[] {
  const ordered = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (trimmed && trimmed !== 'auto') ordered.add(trimmed)
  }
  return [...ordered].sort((a, b) => a.localeCompare(b))
}

function expandHome(path: string): string {
  return path.startsWith('~') ? path.replace(/^~(?=$|[\\/])/, homedir()) : path
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
