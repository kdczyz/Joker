import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_MODEL_PROVIDER_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_IMAGE_GENERATION_RESOLUTION,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_RESOLUTIONS,
  DEFAULT_JOKER_DATA_DIR,
  DEFAULT_JOKER_MODEL,
  DEFAULT_JOKER_PORT,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  MIN_JOKER_LOCAL_PORT,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES,
  DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_REASONING_EFFORTS,
  MODEL_REASONING_REQUEST_PROTOCOLS,
  normalizeModelEndpointFormat,
  type AppSettingsV1,
  type JokerComputerUseSettingsV1,
  type JokerContextCompactionSettingsV1,
  type JokerDesignQualitySettingsV1,
  type JokerDesignQualityStrictness,
  type JokerHistoryHygieneSettingsV1,
  type JokerImageGenerationSettingsV1,
  type JokerInstructionSettingsV1,
  type ImageGenerationQuality,
  type ImageGenerationResolution,
  type JokerMcpSearchSettingsV1,
  type JokerProjectConfigSettingsV1,
  type JokerMusicGenerationSettingsV1,
  type JokerPromptOptimizationSettingsV1,
  type JokerRuntimeTuningSettingsV1,
  type JokerRuntimeSettingsPatchV1,
  type JokerRuntimeSettingsV1,
  type JokerSettingsEnvelopePatchV1,
  type JokerSettingsEnvelopeV1,
  type JokerSpeechToTextSettingsV1,
  type JokerStorageSettingsV1,
  type JokerToolOutputLimitsSettingsV1,
  type JokerTextToSpeechSettingsV1,
  type JokerTokenEconomySettingsV1,
  type JokerVideoGenerationSettingsV1,
  type ImageGenerationProtocol,
  type MusicGenerationProtocol,
  type ModelProviderInputModality,
  type ModelProviderMessagePartSupport,
  type ModelProviderModelProfilePatchV1,
  type ModelProviderModelProfileV1,
  type ModelProviderReasoningCapabilityV1,
  type ModelReasoningEffort,
  type ModelProviderSettingsV1,
  type SpeechToTextProtocol,
  type TextToSpeechProtocol,
  type VideoGenerationProtocol,
  type ApprovalPolicy,
  type SandboxMode
} from './app-settings-types'
import {
  normalizeModelProviderSettings,
  resolveJokerRuntimeSettings
} from './app-settings-provider'
import {
  LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID,
  LOCAL_WHISPER_DEFAULT_MODEL_ID,
  LOCAL_WHISPER_PROVIDER_ID,
  LOCAL_WHISPER_PROTOCOL,
  isLocalWhisperDownloadSourceId
} from './local-whisper'

const LEGACY_COREAGENT_DATA_DIR = '~/.deepseekgui/coreagent'
const LEGACY_JOKER_DEFAULT_MODEL = 'deepseek-chat'
// 旧版真实落盘默认值, 用于把升级前配置迁移到当前 Joker 默认端口。
const LEGACY_LOCAL_HTTP_DEFAULT_PORT = 7878
const PREVIOUS_JOKER_DEFAULT_PORT = 8899

type LegacyLocalHttpRuntimeSettingsV1 = {
  binaryPath: string
  port: number
  autoStart: boolean
  apiKey: string
  baseUrl: string
  runtimeToken: string
  extraCorsOrigins: string[]
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
}

type LegacyReasoningEffort = 'low' | 'medium' | 'high' | 'max'
type LegacyReasoningEditMode = 'review' | 'auto' | 'yolo' | 'plan'

type LegacyReasoningRuntimeSettingsV1 = {
  binaryPath: string
  autoStart: boolean
  apiKey: string
  baseUrl: string
  model: string
  reasoningEffort: LegacyReasoningEffort
  editMode: LegacyReasoningEditMode
}

/**
 * Joker runtime settings. Mirrors the `Joker serve` CLI
 * options. It is the only active agent settings object the GUI
 * stores after legacy settings have been migrated.
 */
function legacyLocalHttpRuntimeDefaults(port = LEGACY_LOCAL_HTTP_DEFAULT_PORT): LegacyLocalHttpRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    apiKey: '',
    baseUrl: DEFAULT_MODEL_PROVIDER_BASE_URL,
    runtimeToken: '',
    extraCorsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE
  }
}

function legacyReasoningRuntimeDefaults(): LegacyReasoningRuntimeSettingsV1 {
  return {
    binaryPath: '',
    autoStart: true,
    apiKey: '',
    baseUrl: DEFAULT_MODEL_PROVIDER_BASE_URL,
    model: LEGACY_JOKER_DEFAULT_MODEL,
    reasoningEffort: 'medium',
    editMode: 'auto'
  }
}

export function defaultJokerRuntimeSettings(
  port = DEFAULT_JOKER_PORT
): JokerRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    apiKey: '',
    baseUrl: '',
    providerId: '',
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    retry: {
      maxAttempts: DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
      initialDelayMs: DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
      httpStatusCodes: [...DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES]
    },
    runtimeToken: '',
    dataDir: DEFAULT_JOKER_DATA_DIR,
    model: DEFAULT_JOKER_MODEL,
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE,
    tokenEconomyMode: false,
    tokenEconomy: defaultJokerTokenEconomySettings(),
    toolOutputLimits: defaultJokerToolOutputLimitsSettings(),
    insecure: false,
    mcpSearch: defaultJokerMcpSearchSettings(),
    projectConfig: defaultJokerProjectConfigSettings(),
    storage: defaultJokerStorageSettings(),
    contextCompaction: defaultJokerContextCompactionSettings(),
    runtimeTuning: defaultJokerRuntimeTuningSettings(),
    imageGeneration: defaultJokerImageGenerationSettings(),
    speechToText: defaultJokerSpeechToTextSettings(),
    textToSpeech: defaultJokerTextToSpeechSettings(),
    promptOptimization: defaultJokerPromptOptimizationSettings(),
    musicGeneration: defaultJokerMusicGenerationSettings(),
    videoGeneration: defaultJokerVideoGenerationSettings(),
    modelProfiles: {},
    memoryEnabled: false,
    instructions: defaultJokerInstructionSettings(),
    computerUse: defaultJokerComputerUseSettings(),
    quality: defaultJokerQualitySettings(),
    webSearchAutoMode: true,
    webSearchEnabled: true,
    openWebSearchEnabled: true,
    openWebSearchEngine: 'duckduckgo',
    openWebSearchProxyEnabled: false,
    openWebSearchProxyUrl: ''
  }
}

export function defaultJokerInstructionSettings(): JokerInstructionSettingsV1 {
  return {
    enabled: true
  }
}

export function defaultJokerToolOutputLimitsSettings(): JokerToolOutputLimitsSettingsV1 {
  return {
    maxLines: DEFAULT_TOOL_OUTPUT_MAX_LINES,
    maxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES
  }
}

export function defaultJokerQualitySettings(): JokerDesignQualitySettingsV1 {
  return {
    enabled: true,
    strictness: 'standard',
    ignoreRules: [],
    ignoreFiles: [],
    maxFindings: 12
  }
}

export function defaultJokerComputerUseSettings(): JokerComputerUseSettingsV1 {
  return {
    enabled: false,
    mode: 'auto',
    maxImageDimension: 1280,
    maxActionsPerTurn: 40
  }
}

export function defaultJokerImageGenerationSettings(): JokerImageGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_IMAGE_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    defaultResolution: DEFAULT_IMAGE_GENERATION_RESOLUTION,
    defaultSize: '',
    quality: 'auto',
    timeoutMs: 180_000
  }
}

export function defaultJokerSpeechToTextSettings(): JokerSpeechToTextSettingsV1 {
  return {
    enabled: true,
    providerId: LOCAL_WHISPER_PROVIDER_ID,
    protocol: LOCAL_WHISPER_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: LOCAL_WHISPER_DEFAULT_MODEL_ID,
    localWhisperDownloadSource: LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID,
    language: '',
    timeoutMs: 60_000
  }
}

export function defaultJokerTextToSpeechSettings(): JokerTextToSpeechSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    voice: '',
    format: 'mp3',
    timeoutMs: 120_000
  }
}

export function defaultJokerPromptOptimizationSettings(): JokerPromptOptimizationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    model: '',
    prompt: '',
    timeoutMs: 60_000
  }
}

export function defaultJokerMusicGenerationSettings(): JokerMusicGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    format: 'mp3',
    timeoutMs: 300_000
  }
}

export function defaultJokerVideoGenerationSettings(): JokerVideoGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    defaultDuration: 6,
    defaultResolution: '1080P',
    timeoutMs: 900_000,
    pollIntervalMs: 10_000
  }
}

export function defaultJokerMcpSearchSettings(): JokerMcpSearchSettingsV1 {
  return {
    enabled: false,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
}

export function defaultJokerProjectConfigSettings(): JokerProjectConfigSettingsV1 {
  return { grants: [] }
}

export function defaultJokerTokenEconomySettings(): JokerTokenEconomySettingsV1 {
  return {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: defaultJokerHistoryHygieneSettings()
  }
}

export function defaultJokerHistoryHygieneSettings(): JokerHistoryHygieneSettingsV1 {
  return {
    maxToolResultLines: 320,
    maxToolResultBytes: 32 * 1024,
    maxToolResultTokens: 8_000,
    maxToolArgumentStringBytes: 8 * 1024,
    maxToolArgumentStringTokens: 2_000,
    maxArrayItems: 80
  }
}

export function defaultJokerStorageSettings(): JokerStorageSettingsV1 {
  return {
    backend: 'hybrid',
    sqlitePath: ''
  }
}

export function defaultJokerContextCompactionSettings(): JokerContextCompactionSettingsV1 {
  return {
    defaultSoftThreshold: 192_000,
    defaultHardThreshold: 217_600,
    // Default to model-generated summaries (codex-style): the model writes a
    // structured recap of the folded turns instead of a mechanical item list.
    // Falls back to the heuristic summary automatically on timeout/failure.
    summaryMode: 'model',
    summaryTimeoutMs: 15_000,
    summaryMaxTokens: 2_048,
    summaryInputMaxBytes: 96 * 1024
  }
}

export function defaultJokerRuntimeTuningSettings(): JokerRuntimeTuningSettingsV1 {
  return {
    maxWallTimeMs: 86_400_000,
    streamIdleTimeoutMs: 450_000,
    toolStorm: {
      enabled: true,
      windowSize: 8,
      threshold: 3
    },
    toolArgumentRepair: {
      maxStringBytes: 512 * 1024
    }
  }
}

export function getJokerRuntimeSettings(
  settings: AppSettingsV1
): JokerRuntimeSettingsV1 {
  const raw = (settings as { agents?: { Joker?: Partial<JokerRuntimeSettingsV1> } }).agents?.Joker
  return mergeJokerRuntimeSettings(defaultJokerRuntimeSettings(), raw)
}

export function JokerSettingsEnvelope(
  Joker: JokerRuntimeSettingsV1
): JokerSettingsEnvelopeV1 {
  return { Joker }
}

export function JokerSettingsPatch(
  Joker: JokerRuntimeSettingsPatchV1 | undefined
): JokerSettingsEnvelopePatchV1 {
  return Joker ? { Joker } : {}
}

export function mergeJokerRuntimeSettings(
  current: JokerRuntimeSettingsV1,
  patch: JokerRuntimeSettingsPatchV1 | undefined
): JokerRuntimeSettingsV1 {
  const currentMcpSearch = normalizeJokerMcpSearchSettings(current.mcpSearch)
  const nextMcpSearch = normalizeJokerMcpSearchSettings({
    ...currentMcpSearch,
    ...(patch?.mcpSearch ?? {})
  })
  const nextProjectConfig = normalizeJokerProjectConfigSettings(
    patch?.projectConfig ?? current.projectConfig
  )
  const currentTokenEconomy = normalizeJokerTokenEconomySettings(
    current.tokenEconomy,
    current.tokenEconomyMode
  )
  const patchedTokenEconomy = normalizeJokerTokenEconomySettings({
    ...currentTokenEconomy,
    ...(patch?.tokenEconomy ?? {}),
    historyHygiene: {
      ...currentTokenEconomy.historyHygiene,
      ...(patch?.tokenEconomy?.historyHygiene ?? {})
    }
  }, currentTokenEconomy.enabled)
  const tokenEconomyEnabled = typeof patch?.tokenEconomy?.enabled === 'boolean'
    ? patch.tokenEconomy.enabled
    : typeof patch?.tokenEconomyMode === 'boolean'
      ? patch.tokenEconomyMode
      : patchedTokenEconomy.enabled
  const nextTokenEconomy = {
    ...patchedTokenEconomy,
    enabled: tokenEconomyEnabled
  }
  const currentToolOutputLimits = normalizeJokerToolOutputLimitsSettings(current.toolOutputLimits)
  const nextToolOutputLimits = normalizeJokerToolOutputLimitsSettings({
    ...currentToolOutputLimits,
    ...(patch?.toolOutputLimits ?? {})
  })
  const currentStorage = normalizeJokerStorageSettings(current.storage)
  const nextStorage = normalizeJokerStorageSettings({
    ...currentStorage,
    ...(patch?.storage ?? {})
  })
  const currentContextCompaction = normalizeJokerContextCompactionSettings(current.contextCompaction)
  const contextCompactionPatch = patch?.contextCompaction ?? {}
  const nextContextCompactionInput = {
    ...currentContextCompaction,
    ...contextCompactionPatch
  }
  if (
    contextCompactionPatch.defaultSoftThreshold !== undefined &&
    contextCompactionPatch.defaultHardThreshold === undefined
  ) {
    nextContextCompactionInput.defaultHardThreshold = contextCompactionPatch.defaultSoftThreshold
  }
  const nextContextCompaction = normalizeJokerContextCompactionSettings(nextContextCompactionInput)
  const currentImageGeneration = normalizeJokerImageGenerationSettings(current.imageGeneration)
  const nextImageGeneration = normalizeJokerImageGenerationSettings({
    ...currentImageGeneration,
    ...(patch?.imageGeneration ?? {})
  })
  const currentSpeechToText = normalizeJokerSpeechToTextSettings(current.speechToText)
  const nextSpeechToText = normalizeJokerSpeechToTextSettings({
    ...currentSpeechToText,
    ...(patch?.speechToText ?? {})
  })
  const currentTextToSpeech = normalizeJokerTextToSpeechSettings(current.textToSpeech)
  const nextTextToSpeech = normalizeJokerTextToSpeechSettings({
    ...currentTextToSpeech,
    ...(patch?.textToSpeech ?? {})
  })
  const currentPromptOptimization = normalizeJokerPromptOptimizationSettings(current.promptOptimization)
  const nextPromptOptimization = normalizeJokerPromptOptimizationSettings({
    ...currentPromptOptimization,
    ...(patch?.promptOptimization ?? {})
  })
  const currentMusicGeneration = normalizeJokerMusicGenerationSettings(current.musicGeneration)
  const nextMusicGeneration = normalizeJokerMusicGenerationSettings({
    ...currentMusicGeneration,
    ...(patch?.musicGeneration ?? {})
  })
  const currentVideoGeneration = normalizeJokerVideoGenerationSettings(current.videoGeneration)
  const nextVideoGeneration = normalizeJokerVideoGenerationSettings({
    ...currentVideoGeneration,
    ...(patch?.videoGeneration ?? {})
  })
  const currentComputerUse = normalizeJokerComputerUseSettings(current.computerUse)
  const nextComputerUse = normalizeJokerComputerUseSettings({
    ...currentComputerUse,
    ...(patch?.computerUse ?? {})
  })
  const currentQuality = normalizeJokerQualitySettings(current.quality)
  const nextQuality = normalizeJokerQualitySettings({
    ...currentQuality,
    ...(patch?.quality ?? {})
  })
  const currentRuntimeTuning = normalizeJokerRuntimeTuningSettings(current.runtimeTuning)
  const nextRuntimeTuning = normalizeJokerRuntimeTuningSettings({
    ...currentRuntimeTuning,
    ...(patch?.runtimeTuning
      ? {
          ...(patch.runtimeTuning.maxWallTimeMs !== undefined
            ? { maxWallTimeMs: patch.runtimeTuning.maxWallTimeMs }
            : {}),
          ...(patch.runtimeTuning.streamIdleTimeoutMs !== undefined
            ? { streamIdleTimeoutMs: patch.runtimeTuning.streamIdleTimeoutMs }
            : {}),
          toolStorm: {
            ...currentRuntimeTuning.toolStorm,
            ...(patch.runtimeTuning.toolStorm ?? {})
          },
          toolArgumentRepair: {
            ...currentRuntimeTuning.toolArgumentRepair,
            ...(patch.runtimeTuning.toolArgumentRepair ?? {})
          }
        }
      : {})
  })
  const nextModelProfiles = normalizeJokerModelProfiles(current.modelProfiles, patch?.modelProfiles)
  const nextInstructions = {
    enabled: patch?.instructions?.enabled ?? current.instructions?.enabled ?? true
  }
  const nextPort = normalizeJokerLocalPort(patch?.port ?? current.port, DEFAULT_JOKER_PORT)
  // Optional role/small-model slots (agents.Joker.*). Patch wins when the key is
  // present (even as empty string => clear); otherwise inherit current. Empty/
  // whitespace strings are dropped so the field is omitted entirely.
  const nextRoleModelSlots = mergeOptionalModelSlot(current, patch)
  const nextRoleReasoningSlots = mergeOptionalReasoningSlot(current, patch)
  const nextSubagents = mergeJokerSubagentsSettings(current.subagents, patch?.subagents)
  // Do not let the nested partial patch leak through the broad object spread;
  // `nextSubagents` below is the fully materialized authoritative value.
  const {
    subagents: _subagentsPatch,
    projectConfig: _projectConfigPatch,
    ...flatPatch
  } = patch ?? {}
  void _subagentsPatch
  void _projectConfigPatch
  // NOTE: approvalPolicy/sandboxMode are merged through verbatim from the patch.
  // The unified 6-mode UI selector already resolves a mode to its concrete
  // {approvalPolicy, sandboxMode} pair via JokerToolPermissionModeSettings before
  // dispatching the patch. We must NOT re-canonicalize here: the mode->settings
  // mapping is lossy (only 6 of the 6x4 policy/sandbox combos are representable),
  // so round-tripping would silently rewrite valid non-UI values — e.g. demote
  // approvalPolicy 'never'/'suggest' to 'on-request', or escalate a 'read-only'/
  // 'external-sandbox' sandbox to 'danger-full-access' — on every settings merge.
  const merged: JokerRuntimeSettingsV1 = {
    ...current,
    ...flatPatch,
    port: nextPort,
    tokenEconomyMode: nextTokenEconomy.enabled,
    tokenEconomy: nextTokenEconomy,
    toolOutputLimits: nextToolOutputLimits,
    mcpSearch: nextMcpSearch,
    projectConfig: nextProjectConfig,
    storage: nextStorage,
    contextCompaction: nextContextCompaction,
    runtimeTuning: nextRuntimeTuning,
    imageGeneration: nextImageGeneration,
    speechToText: nextSpeechToText,
    textToSpeech: nextTextToSpeech,
    promptOptimization: nextPromptOptimization,
    musicGeneration: nextMusicGeneration,
    videoGeneration: nextVideoGeneration,
    modelProfiles: nextModelProfiles,
    memoryEnabled: patch?.memoryEnabled ?? current.memoryEnabled ?? false,
    instructions: nextInstructions,
    computerUse: nextComputerUse,
    quality: nextQuality,
    ...(nextSubagents !== undefined ? { subagents: nextSubagents } : {})
  }
  // Optional model slots are authoritative from mergeOptionalModelSlot: strip any
  // verbatim copies leaked by the spreads above, then re-apply only the non-empty
  // ones so a cleared (empty-string) patch value removes the field entirely.
  for (const key of OPTIONAL_MODEL_SLOT_KEYS) delete merged[key]
  for (const key of OPTIONAL_REASONING_SLOT_KEYS) delete merged[key]
  return { ...merged, ...nextRoleModelSlots, ...nextRoleReasoningSlots }
}

function mergeJokerSubagentsSettings(
  current: JokerRuntimeSettingsV1['subagents'],
  patch: JokerRuntimeSettingsPatchV1['subagents']
): JokerRuntimeSettingsV1['subagents'] {
  if (patch === undefined) return current
  return {
    ...(current ?? { enabled: true, profiles: [] }),
    ...patch,
    enabled: patch.enabled ?? current?.enabled ?? true,
    // A roster diff is an intentional whole-array replacement (including []
    // for deleting every custom profile). Omitting it keeps the current roster.
    profiles: patch.profiles !== undefined
      ? [...patch.profiles]
      : [...(current?.profiles ?? [])]
  }
}

const OPTIONAL_MODEL_SLOT_KEYS = [
  'smallModel',
  'smallModelProviderId',
  'smallModelAccountId',
  'titleModel',
  'titleProviderId',
  'titleAccountId',
  'summaryModel',
  'summaryProviderId',
  'summaryAccountId',
  'codeReviewModel',
  'codeReviewProviderId',
  'codeReviewAccountId',
  'planModel',
  'planProviderId',
  'planAccountId'
] as const

type OptionalModelSlotKey = (typeof OPTIONAL_MODEL_SLOT_KEYS)[number]

function mergeOptionalModelSlot(
  current: JokerRuntimeSettingsV1,
  patch: JokerRuntimeSettingsPatchV1 | undefined
): Partial<Record<OptionalModelSlotKey, string>> {
  const out: Partial<Record<OptionalModelSlotKey, string>> = {}
  for (const key of OPTIONAL_MODEL_SLOT_KEYS) {
    const source = patch && key in patch ? patch[key] : current[key]
    const trimmed = typeof source === 'string' ? source.trim() : ''
    if (trimmed) out[key] = trimmed
  }
  return out
}

// Per-role reasoning-depth slots (agents.Joker.*ReasoningEffort). Validated against
// the ModelReasoningEffort enum; default 'off' is omitted so the field stays absent
// unless the user opts into a deeper level. Must be stripped + re-applied exactly
// like the model slots to avoid settings-sync round-trip drift.
const OPTIONAL_REASONING_SLOT_KEYS = [
  'titleReasoningEffort',
  'summaryReasoningEffort',
  'codeReviewReasoningEffort'
] as const

type OptionalReasoningSlotKey = (typeof OPTIONAL_REASONING_SLOT_KEYS)[number]

function mergeOptionalReasoningSlot(
  current: JokerRuntimeSettingsV1,
  patch: JokerRuntimeSettingsPatchV1 | undefined
): Partial<Record<OptionalReasoningSlotKey, ModelReasoningEffort>> {
  const out: Partial<Record<OptionalReasoningSlotKey, ModelReasoningEffort>> = {}
  for (const key of OPTIONAL_REASONING_SLOT_KEYS) {
    const source = patch && key in patch ? patch[key] : current[key]
    const normalized = normalizeReasoningEffortOrUndefined(source)
    // Omit 'off' (the default) and undefined so the field stays absent.
    if (normalized && normalized !== 'off') out[key] = normalized
  }
  return out
}

function normalizeReasoningEffortOrUndefined(
  value: unknown
): ModelReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim() as ModelReasoningEffort
  return MODEL_REASONING_EFFORTS.includes(trimmed) ? trimmed : undefined
}

function normalizeJokerImageGenerationSettings(
  input: Partial<JokerImageGenerationSettingsV1> | undefined
): JokerImageGenerationSettingsV1 {
  const defaults = defaultJokerImageGenerationSettings()
  const defaultSize = typeof input?.defaultSize === 'string' ? input.defaultSize.trim() : ''
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeJokerImageGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    defaultResolution: normalizeJokerImageGenerationResolution(input?.defaultResolution),
    defaultSize: /^(auto|\d+x\d+)$/.test(defaultSize) ? defaultSize : '',
    quality: normalizeJokerImageGenerationQuality(input?.quality),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeJokerImageGenerationResolution(value: unknown): ImageGenerationResolution {
  return IMAGE_GENERATION_RESOLUTIONS.includes(value as ImageGenerationResolution)
    ? value as ImageGenerationResolution
    : DEFAULT_IMAGE_GENERATION_RESOLUTION
}

function normalizeJokerImageGenerationQuality(value: unknown): ImageGenerationQuality {
  return IMAGE_GENERATION_QUALITIES.includes(value as ImageGenerationQuality)
    ? value as ImageGenerationQuality
    : 'auto'
}

function normalizeJokerImageGenerationProtocol(value: unknown): ImageGenerationProtocol {
  if (value === 'minimax-image') return 'minimax-image'
  if (value === 'codex-responses-image') return 'codex-responses-image'
  return DEFAULT_IMAGE_GENERATION_PROTOCOL
}

function normalizeJokerSpeechToTextSettings(
  input: Partial<JokerSpeechToTextSettingsV1> | undefined
): JokerSpeechToTextSettingsV1 {
  const defaults = defaultJokerSpeechToTextSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeJokerSpeechToTextProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    localWhisperDownloadSource: isLocalWhisperDownloadSourceId(input?.localWhisperDownloadSource)
      ? input.localWhisperDownloadSource
      : defaults.localWhisperDownloadSource,
    language: typeof input?.language === 'string' ? input.language.trim().toLowerCase().slice(0, 16) : defaults.language,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeJokerSpeechToTextProtocol(value: unknown): SpeechToTextProtocol {
  if (value === 'local-whisper') return 'local-whisper'
  return value === 'mimo-asr' ? 'mimo-asr' : DEFAULT_SPEECH_TO_TEXT_PROTOCOL
}

function normalizeJokerTextToSpeechSettings(
  input: Partial<JokerTextToSpeechSettingsV1> | undefined
): JokerTextToSpeechSettingsV1 {
  const defaults = defaultJokerTextToSpeechSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeJokerTextToSpeechProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    voice: typeof input?.voice === 'string' ? input.voice.trim().slice(0, 128) : defaults.voice,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeJokerTextToSpeechProtocol(value: unknown): TextToSpeechProtocol {
  return value === 'minimax-t2a' || value === 'mimo-tts'
    ? value
    : DEFAULT_TEXT_TO_SPEECH_PROTOCOL
}

function normalizeJokerPromptOptimizationSettings(
  input: Partial<JokerPromptOptimizationSettingsV1> | undefined
): JokerPromptOptimizationSettingsV1 {
  const defaults = defaultJokerPromptOptimizationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    prompt: typeof input?.prompt === 'string' ? input.prompt.trim() : defaults.prompt,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

export function resolveJokerPromptOptimizationPrompt(settings: JokerRuntimeSettingsV1): string {
  const configured = settings.promptOptimization?.prompt?.trim() ?? ''
  return configured || DEFAULT_PROMPT_OPTIMIZATION_PROMPT
}

function normalizeJokerMusicGenerationSettings(
  input: Partial<JokerMusicGenerationSettingsV1> | undefined
): JokerMusicGenerationSettingsV1 {
  const defaults = defaultJokerMusicGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeJokerMusicGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 900_000)
  }
}

function normalizeJokerMusicGenerationProtocol(value: unknown): MusicGenerationProtocol {
  return value === 'minimax-music' ? 'minimax-music' : DEFAULT_MUSIC_GENERATION_PROTOCOL
}

function normalizeJokerVideoGenerationSettings(
  input: Partial<JokerVideoGenerationSettingsV1> | undefined
): JokerVideoGenerationSettingsV1 {
  const defaults = defaultJokerVideoGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeJokerVideoGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    defaultDuration: boundedPositiveInt(input?.defaultDuration, defaults.defaultDuration, 60),
    defaultResolution: typeof input?.defaultResolution === 'string' && input.defaultResolution.trim()
      ? input.defaultResolution.trim().slice(0, 32)
      : defaults.defaultResolution,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 1_800_000),
    pollIntervalMs: boundedPositiveInt(input?.pollIntervalMs, defaults.pollIntervalMs, 60_000)
  }
}

function normalizeJokerVideoGenerationProtocol(value: unknown): VideoGenerationProtocol {
  return value === 'minimax-video' ? 'minimax-video' : DEFAULT_VIDEO_GENERATION_PROTOCOL
}

function normalizeJokerComputerUseSettings(
  input: Partial<JokerComputerUseSettingsV1> | undefined
): JokerComputerUseSettingsV1 {
  const defaults = defaultJokerComputerUseSettings()
  const mode = input?.mode === 'always' || input?.mode === 'off' || input?.mode === 'auto'
    ? input.mode
    : defaults.mode
  return {
    enabled: input?.enabled === true,
    mode,
    maxImageDimension: boundedPositiveInt(input?.maxImageDimension, defaults.maxImageDimension, 4096),
    maxActionsPerTurn: boundedPositiveInt(input?.maxActionsPerTurn, defaults.maxActionsPerTurn, 1000)
  }
}

function normalizeAudioFormat(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return /^(mp3|wav|flac|pcm16)$/.test(normalized) ? normalized : fallback
}

function normalizeJokerTokenEconomySettings(
  input: Partial<JokerTokenEconomySettingsV1> | undefined,
  enabledFallback = false
): JokerTokenEconomySettingsV1 {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : enabledFallback,
    compressToolDescriptions: input?.compressToolDescriptions !== false,
    compressToolResults: input?.compressToolResults !== false,
    conciseResponses: input?.conciseResponses !== false,
    historyHygiene: normalizeJokerHistoryHygieneSettings(input?.historyHygiene)
  }
}

function normalizeJokerToolOutputLimitsSettings(
  input: Partial<JokerToolOutputLimitsSettingsV1> | undefined
): JokerToolOutputLimitsSettingsV1 {
  const defaults = defaultJokerToolOutputLimitsSettings()
  return {
    maxLines: boundedPositiveInt(input?.maxLines, defaults.maxLines, 1_000_000),
    maxBytes: boundedPositiveInt(input?.maxBytes, defaults.maxBytes, 64 * 1024 * 1024)
  }
}

function normalizeJokerHistoryHygieneSettings(
  input: Partial<JokerHistoryHygieneSettingsV1> | undefined
): JokerHistoryHygieneSettingsV1 {
  const defaults = defaultJokerHistoryHygieneSettings()
  return {
    maxToolResultLines: boundedPositiveInt(input?.maxToolResultLines, defaults.maxToolResultLines, 100_000),
    maxToolResultBytes: boundedPositiveInt(input?.maxToolResultBytes, defaults.maxToolResultBytes, 8 * 1024 * 1024),
    maxToolResultTokens: boundedPositiveInt(input?.maxToolResultTokens, defaults.maxToolResultTokens, 256_000),
    maxToolArgumentStringBytes: boundedPositiveInt(
      input?.maxToolArgumentStringBytes,
      defaults.maxToolArgumentStringBytes,
      8 * 1024 * 1024
    ),
    maxToolArgumentStringTokens: boundedPositiveInt(
      input?.maxToolArgumentStringTokens,
      defaults.maxToolArgumentStringTokens,
      64_000
    ),
    maxArrayItems: boundedPositiveInt(input?.maxArrayItems, defaults.maxArrayItems, 10_000)
  }
}

function normalizeJokerMcpSearchSettings(
  input: Partial<JokerMcpSearchSettingsV1> | undefined
): JokerMcpSearchSettingsV1 {
  const defaults = defaultJokerMcpSearchSettings()
  const topKMax = positiveInt(input?.topKMax, defaults.topKMax)
  const topKDefault = Math.min(positiveInt(input?.topKDefault, defaults.topKDefault), topKMax)
  return {
    enabled: input?.enabled === true,
    mode: input?.mode === 'direct' || input?.mode === 'search' || input?.mode === 'auto'
      ? input.mode
      : defaults.mode,
    autoThresholdToolCount: positiveInt(input?.autoThresholdToolCount, defaults.autoThresholdToolCount),
    topKDefault,
    topKMax,
    minScore: nonNegativeNumber(input?.minScore, defaults.minScore)
  }
}

export function normalizeJokerProjectConfigSettings(
  input: Partial<JokerProjectConfigSettingsV1> | undefined
): JokerProjectConfigSettingsV1 {
  const grants = Array.isArray(input?.grants) ? input.grants : []
  const unique = new Map<string, { workspaceRoot: string; configDigest: string }>()
  for (const grant of grants.slice(0, 64)) {
    const workspaceRoot = typeof grant?.workspaceRoot === 'string' ? grant.workspaceRoot.trim() : ''
    const configDigest = typeof grant?.configDigest === 'string'
      ? grant.configDigest.trim().toLowerCase()
      : ''
    if (!workspaceRoot || !/^[a-f0-9]{64}$/.test(configDigest)) continue
    unique.set(workspaceRoot, { workspaceRoot, configDigest })
  }
  return { grants: [...unique.values()] }
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function boundedPositiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

/** Like {@link boundedPositiveInt} but accepts `0` (e.g. "disabled"). */
function boundedNonNegativeInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return Math.min(Math.floor(value), max)
}

function normalizeJokerStorageSettings(
  input: Partial<JokerStorageSettingsV1> | undefined
): JokerStorageSettingsV1 {
  const defaults = defaultJokerStorageSettings()
  return {
    backend: input?.backend === 'file' || input?.backend === 'hybrid'
      ? input.backend
      : defaults.backend,
    sqlitePath: typeof input?.sqlitePath === 'string' ? input.sqlitePath.trim() : defaults.sqlitePath
  }
}

function normalizeJokerContextCompactionSettings(
  input: Partial<JokerContextCompactionSettingsV1> | undefined
): JokerContextCompactionSettingsV1 {
  const defaults = defaultJokerContextCompactionSettings()
  const defaultSoftThreshold = boundedPositiveInt(input?.defaultSoftThreshold, defaults.defaultSoftThreshold)
  const defaultHardThreshold = input?.defaultSoftThreshold !== undefined && input?.defaultHardThreshold === undefined
    ? defaultSoftThreshold
    : defaults.defaultHardThreshold
  const requestedHardThreshold = boundedPositiveInt(input?.defaultHardThreshold, defaultHardThreshold)
  return {
    defaultSoftThreshold,
    defaultHardThreshold: Math.max(defaultSoftThreshold, requestedHardThreshold),
    // Compaction is always model-based now (the heuristic fold survives only as
    // a silent in-loop fallback when the model call fails). 'heuristic' is no
    // longer a user-selectable mode, so any stored value coerces to 'model' —
    // this self-heals stale 'heuristic' configs from the removed UI toggle.
    summaryMode: 'model',
    summaryTimeoutMs: boundedPositiveInt(input?.summaryTimeoutMs, defaults.summaryTimeoutMs, 120_000),
    summaryMaxTokens: boundedPositiveInt(input?.summaryMaxTokens, defaults.summaryMaxTokens, 16_000),
    summaryInputMaxBytes: boundedPositiveInt(input?.summaryInputMaxBytes, defaults.summaryInputMaxBytes, 8 * 1024 * 1024),
    ...(typeof input?.summaryModel === 'string' && input.summaryModel.trim() ? { summaryModel: input.summaryModel.trim() } : {}),
    ...(typeof input?.summaryProviderId === 'string' && input.summaryProviderId.trim() ? { summaryProviderId: input.summaryProviderId.trim() } : {})
  }
}

function normalizeJokerRuntimeTuningSettings(
  input: Partial<JokerRuntimeTuningSettingsV1> | undefined
): JokerRuntimeTuningSettingsV1 {
  const defaults = defaultJokerRuntimeTuningSettings()
  return {
    maxWallTimeMs: boundedPositiveInt(
      input?.maxWallTimeMs,
      defaults.maxWallTimeMs,
      86_400_000
    ),
    streamIdleTimeoutMs: boundedNonNegativeInt(
      input?.streamIdleTimeoutMs,
      defaults.streamIdleTimeoutMs,
      3_600_000
    ),
    toolStorm: {
      enabled: input?.toolStorm?.enabled !== false,
      windowSize: boundedPositiveInt(input?.toolStorm?.windowSize, defaults.toolStorm.windowSize, 128),
      threshold: Math.max(2, boundedPositiveInt(input?.toolStorm?.threshold, defaults.toolStorm.threshold, 128))
    },
    toolArgumentRepair: {
      maxStringBytes: boundedPositiveInt(
        input?.toolArgumentRepair?.maxStringBytes,
        defaults.toolArgumentRepair.maxStringBytes,
        16 * 1024 * 1024
      )
    }
  }
}

const JOKER_DESIGN_QUALITY_STRICTNESS: readonly JokerDesignQualityStrictness[] = [
  'relaxed',
  'standard',
  'strict'
]

function normalizeJokerQualitySettings(
  input: Partial<JokerDesignQualitySettingsV1> | undefined
): JokerDesignQualitySettingsV1 {
  const defaults = defaultJokerQualitySettings()
  const strictness =
    input?.strictness && JOKER_DESIGN_QUALITY_STRICTNESS.includes(input.strictness)
      ? input.strictness
      : defaults.strictness
  const sanitizeList = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : defaults.ignoreRules
  return {
    enabled: input?.enabled !== false,
    strictness,
    ignoreRules: sanitizeList(input?.ignoreRules),
    ignoreFiles: sanitizeList(input?.ignoreFiles),
    maxFindings: boundedPositiveInt(input?.maxFindings, defaults.maxFindings, 100)
  }
}

function normalizeJokerModelProfiles(
  current: Record<string, ModelProviderModelProfileV1> | undefined,
  patch: Record<string, ModelProviderModelProfilePatchV1 | null> | undefined
): Record<string, ModelProviderModelProfileV1> {
  const profiles: Record<string, ModelProviderModelProfileV1> = {}
  for (const [rawModelId, rawProfile] of Object.entries(current ?? {})) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    profiles[modelId] = normalizeJokerModelProfile(rawProfile)
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return profiles
  for (const [rawModelId, rawProfile] of Object.entries(patch)) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    if (rawProfile === null) {
      delete profiles[modelId]
      continue
    }
    profiles[modelId] = normalizeJokerModelProfile({
      ...(profiles[modelId] ?? {}),
      ...rawProfile
    })
  }
  return profiles
}

function normalizeJokerModelProfile(
  input: ModelProviderModelProfilePatchV1 | undefined
): ModelProviderModelProfileV1 {
  const inputModalities = normalizeJokerModelInputModalities(input?.inputModalities)
  const fallbackMessageParts: ModelProviderMessagePartSupport[] = inputModalities.includes('image')
    ? ['text', 'image_url']
    : ['text']
  const contextWindowTokens = typeof input?.contextWindowTokens === 'number' &&
    Number.isInteger(input.contextWindowTokens) &&
    input.contextWindowTokens > 0
    ? input.contextWindowTokens
    : undefined
  const maxOutputTokens = typeof input?.maxOutputTokens === 'number' &&
    Number.isInteger(input.maxOutputTokens) &&
    input.maxOutputTokens > 0
    ? input.maxOutputTokens
    : undefined
  const reasoning = normalizeJokerReasoningCapability(input?.reasoning)
  const endpointFormat = typeof input?.endpointFormat === 'string' && input.endpointFormat.trim()
    ? normalizeModelEndpointFormat(input.endpointFormat)
    : undefined
  return {
    ...(normalizeJokerProfileAliases(input?.aliases).length
      ? { aliases: normalizeJokerProfileAliases(input?.aliases) }
      : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    inputModalities,
    outputModalities: normalizeJokerModelInputModalities(input?.outputModalities),
    supportsToolCalling: input?.supportsToolCalling !== false,
    messageParts: normalizeJokerModelMessageParts(input?.messageParts, fallbackMessageParts),
    ...(reasoning ? { reasoning } : {}),
    ...(endpointFormat ? { endpointFormat } : {})
  }
}

function normalizeJokerReasoningCapability(
  input: ModelProviderModelProfilePatchV1['reasoning'] | undefined
): ModelProviderReasoningCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const supportedEfforts = normalizeJokerReasoningEfforts(input.supportedEfforts)
  if (supportedEfforts.length === 0) return undefined
  const defaultEffort = normalizeJokerReasoningEffort(input.defaultEffort)
  const requestProtocol = normalizeJokerReasoningRequestProtocol(input.requestProtocol)
  if (!requestProtocol) return undefined
  return {
    supportedEfforts,
    defaultEffort: defaultEffort && supportedEfforts.includes(defaultEffort)
      ? defaultEffort
      : supportedEfforts[0],
    requestProtocol
  }
}

function normalizeJokerReasoningEfforts(value: unknown): ModelProviderReasoningCapabilityV1['supportedEfforts'] {
  if (!Array.isArray(value)) return []
  const efforts: ModelProviderReasoningCapabilityV1['supportedEfforts'] = []
  for (const item of value) {
    const effort = normalizeJokerReasoningEffort(item)
    if (effort && !efforts.includes(effort)) efforts.push(effort)
  }
  return efforts
}

function normalizeJokerReasoningEffort(value: unknown): ModelProviderReasoningCapabilityV1['defaultEffort'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ModelProviderReasoningCapabilityV1['defaultEffort'])
    ? normalized as ModelProviderReasoningCapabilityV1['defaultEffort']
    : undefined
}

function normalizeJokerReasoningRequestProtocol(
  value: unknown
): ModelProviderReasoningCapabilityV1['requestProtocol'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_REQUEST_PROTOCOLS.includes(normalized as ModelProviderReasoningCapabilityV1['requestProtocol'])
    ? normalized as ModelProviderReasoningCapabilityV1['requestProtocol']
    : undefined
}

function normalizeModelProfileId(value: string): string {
  return value.trim().slice(0, 128)
}

function normalizeJokerProfileAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const aliases: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const alias = item.trim().slice(0, 128)
    if (alias && !aliases.includes(alias)) aliases.push(alias)
    if (aliases.length >= 50) break
  }
  return aliases
}

function normalizeJokerModelInputModalities(value: unknown): ModelProviderInputModality[] {
  if (!Array.isArray(value)) return ['text']
  const modalities: ModelProviderInputModality[] = []
  for (const item of value) {
    if ((item === 'text' || item === 'image') && !modalities.includes(item)) {
      modalities.push(item)
    }
    if (modalities.length >= 8) break
  }
  return modalities.length > 0 ? modalities : ['text']
}

function normalizeJokerModelMessageParts(
  value: unknown,
  fallback: ModelProviderMessagePartSupport[]
): ModelProviderMessagePartSupport[] {
  if (!Array.isArray(value)) return [...fallback]
  const parts: ModelProviderMessagePartSupport[] = []
  for (const item of value) {
    if (
      (item === 'text' || item === 'image_url' || item === 'input_image') &&
      !parts.includes(item)
    ) {
      parts.push(item)
    }
    if (parts.length >= 8) break
  }
  return parts.length > 0 ? parts : [...fallback]
}

export function withJokerRuntimeSettings(
  settings: AppSettingsV1,
  Joker: JokerRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: JokerSettingsEnvelope(Joker)
  }
}

export function applyJokerRuntimePatch(
  settings: AppSettingsV1,
  patch: JokerRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withJokerRuntimeSettings(
    settings,
    mergeJokerRuntimeSettings(getJokerRuntimeSettings(settings), patch)
  )
}

export function isJokerRuntimeInsecure(runtime: Pick<JokerRuntimeSettingsV1, 'insecure' | 'runtimeToken'>): boolean {
  return runtime.insecure === true
}

export function getActiveAgentApiKey(settings: AppSettingsV1): string {
  return resolveJokerRuntimeSettings(settings).apiKey?.trim() ?? ''
}

export function mergeAgentRuntimeSettings(
  defaults: JokerSettingsEnvelopeV1,
  patch: JokerSettingsEnvelopePatchV1 | undefined
): JokerSettingsEnvelopeV1 {
  return JokerSettingsEnvelope(
    mergeJokerRuntimeSettings(defaults.Joker, patch?.Joker)
  )
}

type LegacyAgentsSettingsShape = {
  Joker?: Partial<JokerRuntimeSettingsV1>
  codewhale?: Partial<LegacyLocalHttpRuntimeSettingsV1>
  reasonix?: Partial<LegacyReasoningRuntimeSettingsV1>
}

type LegacyAppSettingsShape = Partial<Omit<AppSettingsV1, 'agents' | 'provider'>> & {
  agents?: LegacyAgentsSettingsShape
  provider?: Partial<ModelProviderSettingsV1>
  deepseek?: Partial<LegacyLocalHttpRuntimeSettingsV1>
  /** Legacy single-provider discriminator. Read only inside migration. */
  agentProvider?: unknown
}

function nonEmptyStringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function upgradeLegacyJokerDefaultDataDir(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_JOKER_DATA_DIR
  const trimmed = value.trim()
  const normalized = trimmed.replace(/\\/g, '/').toLowerCase()
  if (
    !trimmed ||
    normalized === LEGACY_COREAGENT_DATA_DIR ||
    normalized.endsWith('/.deepseekgui/coreagent')
  ) {
    return DEFAULT_JOKER_DATA_DIR
  }
  return trimmed
}

function upgradeLegacyJokerDefaultModel(value: unknown, fallback: string): string {
  const model = nonEmptyStringOrFallback(value, fallback).trim()
  return model === LEGACY_JOKER_DEFAULT_MODEL ? DEFAULT_JOKER_MODEL : model
}

function upgradeLegacyJokerDefaultPort(value: unknown, fallback: number): number {
  return value === LEGACY_LOCAL_HTTP_DEFAULT_PORT ? DEFAULT_JOKER_PORT : fallback
}

function normalizeJokerLocalPort(value: unknown, fallback: number): number {
  if (value === LEGACY_LOCAL_HTTP_DEFAULT_PORT || value === PREVIOUS_JOKER_DEFAULT_PORT) {
    return DEFAULT_JOKER_PORT
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(65_535, Math.max(MIN_JOKER_LOCAL_PORT, Math.floor(parsed)))
}

export function migrateLegacyAppSettings(parsed: LegacyAppSettingsShape): Partial<AppSettingsV1> {
  const rawAgentProvider = parsed.agentProvider
  const isReasoningLegacy = rawAgentProvider === 'reasonix'
  const hasProviderSettings = typeof parsed.provider === 'object' && parsed.provider !== null
  const defaults = legacyLocalHttpRuntimeDefaults()
  const JokerDefaults = defaultJokerRuntimeSettings()
  const legacyDeepseek = parsed.deepseek ?? {}
  const legacyLocalHttp = {
    ...defaults,
    ...(parsed.agents?.codewhale ?? {}),
    ...legacyDeepseek
  }
  const legacyReasoning = {
    ...legacyReasoningRuntimeDefaults(),
    ...(parsed.agents?.reasonix ?? {})
  }
  const explicitJoker: Partial<JokerRuntimeSettingsV1> = parsed.agents?.Joker ?? {}
  const legacySource = isReasoningLegacy ? legacyReasoning : legacyLocalHttp
  const legacySeed = {
    binaryPath: JokerDefaults.binaryPath,
    port: isReasoningLegacy
      ? JokerDefaults.port
      : upgradeLegacyJokerDefaultPort(legacyLocalHttp.port, legacyLocalHttp.port),
    autoStart: isReasoningLegacy ? legacyReasoning.autoStart : legacyLocalHttp.autoStart,
    apiKey: legacySource.apiKey,
    baseUrl: legacySource.baseUrl,
    providerId: '',
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    retry: JokerDefaults.retry,
    runtimeToken: isReasoningLegacy ? JokerDefaults.runtimeToken : legacyLocalHttp.runtimeToken,
    model: isReasoningLegacy ? legacyReasoning.model : JokerDefaults.model,
    approvalPolicy: isReasoningLegacy ? JokerDefaults.approvalPolicy : legacyLocalHttp.approvalPolicy,
    sandboxMode: isReasoningLegacy ? JokerDefaults.sandboxMode : legacyLocalHttp.sandboxMode
  }
  const provider = normalizeModelProviderSettings({
    apiKey: hasProviderSettings
      ? parsed.provider?.apiKey
      : nonEmptyStringOrFallback(explicitJoker.apiKey, legacySeed.apiKey),
    baseUrl: hasProviderSettings
      ? parsed.provider?.baseUrl
      : nonEmptyStringOrFallback(explicitJoker.baseUrl, legacySeed.baseUrl),
    proxy: parsed.provider?.proxy,
    providers: parsed.provider?.providers
  })
  const Joker = {
    ...JokerDefaults,
    ...legacySeed,
    ...explicitJoker,
    port: normalizeJokerLocalPort(explicitJoker.port ?? legacySeed.port, JokerDefaults.port),
    apiKey: hasProviderSettings ? explicitJoker.apiKey ?? '' : '',
    baseUrl: hasProviderSettings ? explicitJoker.baseUrl ?? '' : '',
    runtimeToken: nonEmptyStringOrFallback(explicitJoker.runtimeToken, legacySeed.runtimeToken),
    dataDir: upgradeLegacyJokerDefaultDataDir(explicitJoker.dataDir),
    model: upgradeLegacyJokerDefaultModel(explicitJoker.model, legacySeed.model),
    tokenEconomyMode: typeof explicitJoker.tokenEconomy?.enabled === 'boolean'
      ? explicitJoker.tokenEconomy.enabled
      : explicitJoker.tokenEconomyMode ?? JokerDefaults.tokenEconomyMode,
    tokenEconomy: normalizeJokerTokenEconomySettings(
      explicitJoker.tokenEconomy,
      explicitJoker.tokenEconomyMode ?? JokerDefaults.tokenEconomyMode
    ),
    toolOutputLimits: normalizeJokerToolOutputLimitsSettings(explicitJoker.toolOutputLimits),
    mcpSearch: normalizeJokerMcpSearchSettings(explicitJoker.mcpSearch),
    projectConfig: normalizeJokerProjectConfigSettings(explicitJoker.projectConfig),
    storage: normalizeJokerStorageSettings(explicitJoker.storage),
    contextCompaction: normalizeJokerContextCompactionSettings(explicitJoker.contextCompaction),
    runtimeTuning: normalizeJokerRuntimeTuningSettings(explicitJoker.runtimeTuning),
    imageGeneration: normalizeJokerImageGenerationSettings(explicitJoker.imageGeneration),
    speechToText: normalizeJokerSpeechToTextSettings(explicitJoker.speechToText),
    textToSpeech: normalizeJokerTextToSpeechSettings(explicitJoker.textToSpeech),
    musicGeneration: normalizeJokerMusicGenerationSettings(explicitJoker.musicGeneration),
    videoGeneration: normalizeJokerVideoGenerationSettings(explicitJoker.videoGeneration),
    quality: normalizeJokerQualitySettings(explicitJoker.quality)
  }
  // Strip the legacy `agentProvider` discriminator and the legacy
  // per-provider settings from the surfaced migration result. The
  // runtime now has a single agent (Joker) and we no longer
  // round-trip the legacy value into the new settings shape.
  const { deepseek: _legacyDeepseek, agents: _agents, agentProvider: _agentProvider, ...rest } = parsed
  void _legacyDeepseek
  void _agents
  void _agentProvider
  return {
    ...rest,
    provider,
    agents: {
      Joker
    }
  }
}
