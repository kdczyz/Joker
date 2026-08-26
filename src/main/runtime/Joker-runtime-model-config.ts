import {
  defaultJokerTokenEconomySettings,
  getModelProviderSettings,
  resolveModelProviderProxyUrl,
  type AppSettingsV1,
  type JokerRuntimeSettingsV1,
  type ModelProviderModelProfileV1,
  type ModelProviderProfileV1
} from '../../shared/app-settings'
import { legacyProviderCredentialSourceId } from '../legacy-provider-settings-migration'

const DEFAULT_JOKER_MODEL_PROFILES: Record<string, Record<string, unknown>> = {}

export function modelConfigForRuntime(
  existing: Record<string, unknown>,
  guiModelProfiles: Record<string, ModelProviderModelProfileV1> = {}
): Record<string, unknown> {
  const existingProfiles = objectValue(existing.profiles)
  const guiProfiles = modelConfigProfilesFromProviderProfiles(guiModelProfiles)
  const profileDefaults = { ...DEFAULT_JOKER_MODEL_PROFILES, ...guiProfiles }
  const profiles: Record<string, unknown> = {}
  for (const modelId of new Set([...Object.keys(profileDefaults), ...Object.keys(existingProfiles)])) {
    const defaultProfile = objectValue(profileDefaults[modelId])
    const existingProfile = objectValue(existingProfiles[modelId])
    const guiProfile = objectValue(guiProfiles[modelId])
    const baseProfile = Object.prototype.hasOwnProperty.call(guiProfiles, modelId)
      ? { ...defaultProfile, ...guiProfile }
      : { ...defaultProfile, ...existingProfile }
    profiles[modelId] = {
      ...baseProfile,
      contextCompaction: {
        ...objectValue(defaultProfile.contextCompaction),
        ...objectValue(existingProfile.contextCompaction),
        ...objectValue(guiProfile.contextCompaction)
      }
    }
  }
  return { ...existing, profiles }
}

export function providersConfigForRuntime(
  settings: AppSettingsV1
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  const proxyUrl = resolveModelProviderProxyUrl(settings)
  for (const provider of getModelProviderSettings(settings).providers as ModelProviderProfileV1[]) {
    const id = provider.id?.trim()
    const baseUrl = provider.baseUrl?.trim()
    const isAgentSdk = provider.kind === 'agent-sdk'
    if (!id || (!baseUrl && !isAgentSdk)) continue
    out[id] = {
      // Provider secrets live in the protected account store. The runtime
      // resolves this opaque source binding after reading config.json.
      apiKey: '',
      credentialSourceId: legacyProviderCredentialSourceId(id),
      ...(baseUrl ? { baseUrl } : {}),
      ...(provider.kind ? { kind: provider.kind } : {}),
      ...(provider.endpointFormat ? { endpointFormat: provider.endpointFormat } : {}),
      retry: provider.retry,
      ...(proxyUrl ? { modelProxyUrl: proxyUrl } : {}),
      // Credential-derived transport headers are reconstructed in Joker from
      // the protected binding and are never persisted in config.json.
    }
  }
  if (!out['opencode-zen']) {
    out['opencode-zen'] = {
      apiKey: 'public',
      baseUrl: 'https://opencode.ai/zen/v1',
      endpointFormat: 'chat_completions'
    }
  }
  return out
}

export function tokenEconomyConfigForRuntime(
  tokenEconomy: Pick<JokerRuntimeSettingsV1, 'tokenEconomy'>['tokenEconomy'] | undefined,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const defaults = defaultJokerTokenEconomySettings()
  const normalized = {
    ...defaults,
    ...(tokenEconomy ?? {}),
    historyHygiene: { ...defaults.historyHygiene, ...(tokenEconomy?.historyHygiene ?? {}) }
  }
  const existingHistoryHygiene = objectValue(existing.historyHygiene)
  return {
    ...existing,
    enabled: normalized.enabled,
    compressToolDescriptions: normalized.compressToolDescriptions,
    compressToolResults: normalized.compressToolResults,
    conciseResponses: normalized.conciseResponses,
    historyHygiene: {
      ...existingHistoryHygiene,
      maxToolResultLines: normalized.historyHygiene.maxToolResultLines,
      maxToolResultBytes: normalized.historyHygiene.maxToolResultBytes,
      maxToolResultTokens: normalized.historyHygiene.maxToolResultTokens,
      maxToolArgumentStringBytes: normalized.historyHygiene.maxToolArgumentStringBytes,
      maxToolArgumentStringTokens: normalized.historyHygiene.maxToolArgumentStringTokens,
      maxArrayItems: normalized.historyHygiene.maxArrayItems
    }
  }
}

export function toolOutputLimitsConfigForRuntime(
  limits: Pick<JokerRuntimeSettingsV1, 'toolOutputLimits'>['toolOutputLimits'] | undefined
): Record<string, unknown> {
  return { maxLines: limits?.maxLines, maxBytes: limits?.maxBytes }
}

export function storageConfigForRuntime(
  storage: Pick<JokerRuntimeSettingsV1, 'storage'>['storage']
): Record<string, unknown> {
  const sqlitePath = storage.sqlitePath.trim()
  return { backend: storage.backend, ...(sqlitePath ? { sqlitePath } : {}) }
}

export function contextCompactionConfigForRuntime(
  value: Pick<JokerRuntimeSettingsV1, 'contextCompaction'>['contextCompaction'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    defaultSoftThreshold: value.defaultSoftThreshold,
    defaultHardThreshold: value.defaultHardThreshold,
    summaryMode: value.summaryMode,
    summaryTimeoutMs: value.summaryTimeoutMs,
    summaryMaxTokens: value.summaryMaxTokens,
    summaryInputMaxBytes: value.summaryInputMaxBytes,
    ...(value.summaryModel ? { summaryModel: value.summaryModel } : {}),
    ...(value.summaryProviderId ? { summaryProviderId: value.summaryProviderId } : {})
  }
}

export function rolesConfigForRuntime(runtime: Pick<
  JokerRuntimeSettingsV1,
  'smallModel' | 'smallModelProviderId' | 'smallModelAccountId' |
  'titleModel' | 'titleProviderId' | 'titleAccountId' |
  'summaryModel' | 'summaryProviderId' | 'summaryAccountId' |
  'codeReviewModel' | 'codeReviewProviderId' | 'codeReviewAccountId' |
  'titleReasoningEffort' | 'summaryReasoningEffort' | 'codeReviewReasoningEffort'
>): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (key: string, value: string | undefined): void => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed) out[key] = trimmed
  }
  put('smallModel', runtime.smallModel)
  put('smallModelProviderId', runtime.smallModelProviderId)
  put('smallModelAccountId', runtime.smallModelAccountId)
  put('titleModel', runtime.titleModel)
  put('titleProviderId', runtime.titleProviderId)
  put('titleAccountId', runtime.titleAccountId)
  put('summaryModel', runtime.summaryModel)
  put('summaryProviderId', runtime.summaryProviderId)
  put('summaryAccountId', runtime.summaryAccountId)
  put('codeReviewModel', runtime.codeReviewModel)
  put('codeReviewProviderId', runtime.codeReviewProviderId)
  put('codeReviewAccountId', runtime.codeReviewAccountId)
  put('titleReasoningEffort', runtime.titleReasoningEffort)
  put('summaryReasoningEffort', runtime.summaryReasoningEffort)
  put('codeReviewReasoningEffort', runtime.codeReviewReasoningEffort)
  return out
}

function modelConfigProfilesFromProviderProfiles(
  profiles: Record<string, ModelProviderModelProfileV1>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [modelId, profile] of Object.entries(profiles)) {
    const trimmed = modelId.trim()
    if (!trimmed) continue
    out[trimmed] = {
      ...(profile.aliases?.length ? { aliases: profile.aliases } : {}),
      ...(profile.contextWindowTokens ? { contextWindowTokens: profile.contextWindowTokens } : {}),
      ...(profile.maxOutputTokens ? { maxOutputTokens: profile.maxOutputTokens } : {}),
      inputModalities: profile.inputModalities,
      outputModalities: profile.outputModalities,
      supportsToolCalling: profile.supportsToolCalling,
      messageParts: profile.messageParts,
      ...(profile.reasoning ? { reasoning: profile.reasoning } : {}),
      ...(profile.endpointFormat ? { endpointFormat: profile.endpointFormat } : {}),
      ...(profile.responsesMode ? { responsesMode: profile.responsesMode } : {}),
      ...(profile.defaultWebSearch !== undefined ? { defaultWebSearch: profile.defaultWebSearch } : {})
    }
  }
  return out
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
