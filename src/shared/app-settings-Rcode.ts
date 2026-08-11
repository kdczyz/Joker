import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_MODEL_PROVIDER_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_IMAGE_GENERATION_RESOLUTION,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_RESOLUTIONS,
  DEFAULT_RCODE_DATA_DIR,
  DEFAULT_RCODE_MODEL,
  DEFAULT_RCODE_PORT,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  MIN_RCODE_LOCAL_PORT,
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
  type RcodeComputerUseSettingsV1,
  type RcodeContextCompactionSettingsV1,
  type RcodeDesignQualitySettingsV1,
  type RcodeDesignQualityStrictness,
  type RcodeHistoryHygieneSettingsV1,
  type RcodeImageGenerationSettingsV1,
  type RcodeInstructionSettingsV1,
  type ImageGenerationQuality,
  type ImageGenerationResolution,
  type RcodeMcpSearchSettingsV1,
  type RcodeProjectConfigSettingsV1,
  type RcodeMusicGenerationSettingsV1,
  type RcodePromptOptimizationSettingsV1,
  type RcodeRuntimeTuningSettingsV1,
  type RcodeRuntimeSettingsPatchV1,
  type RcodeRuntimeSettingsV1,
  type RcodeSettingsEnvelopePatchV1,
  type RcodeSettingsEnvelopeV1,
  type RcodeSpeechToTextSettingsV1,
  type RcodeStorageSettingsV1,
  type RcodeToolOutputLimitsSettingsV1,
  type RcodeTextToSpeechSettingsV1,
  type RcodeTokenEconomySettingsV1,
  type RcodeVideoGenerationSettingsV1,
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
  resolveRcodeRuntimeSettings
} from './app-settings-provider'
import {
  LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID,
  LOCAL_WHISPER_DEFAULT_MODEL_ID,
  LOCAL_WHISPER_PROVIDER_ID,
  LOCAL_WHISPER_PROTOCOL,
  isLocalWhisperDownloadSourceId
} from './local-whisper'

const LEGACY_COREAGENT_DATA_DIR = '~/.deepseekgui/coreagent'
const LEGACY_RCODE_DEFAULT_MODEL = 'deepseek-chat'
// 旧版真实落盘默认值, 用于把升级前配置迁移到当前 Rcode 默认端口。
const LEGACY_LOCAL_HTTP_DEFAULT_PORT = 7878
const PREVIOUS_RCODE_DEFAULT_PORT = 8899

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
 * Rcode runtime settings. Mirrors the `Rcode serve` CLI
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
    model: LEGACY_RCODE_DEFAULT_MODEL,
    reasoningEffort: 'medium',
    editMode: 'auto'
  }
}

export function defaultRcodeRuntimeSettings(
  port = DEFAULT_RCODE_PORT
): RcodeRuntimeSettingsV1 {
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
    dataDir: DEFAULT_RCODE_DATA_DIR,
    model: DEFAULT_RCODE_MODEL,
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE,
    tokenEconomyMode: false,
    tokenEconomy: defaultRcodeTokenEconomySettings(),
    toolOutputLimits: defaultRcodeToolOutputLimitsSettings(),
    insecure: false,
    mcpSearch: defaultRcodeMcpSearchSettings(),
    projectConfig: defaultRcodeProjectConfigSettings(),
    storage: defaultRcodeStorageSettings(),
    contextCompaction: defaultRcodeContextCompactionSettings(),
    runtimeTuning: defaultRcodeRuntimeTuningSettings(),
    imageGeneration: defaultRcodeImageGenerationSettings(),
    speechToText: defaultRcodeSpeechToTextSettings(),
    textToSpeech: defaultRcodeTextToSpeechSettings(),
    promptOptimization: defaultRcodePromptOptimizationSettings(),
    musicGeneration: defaultRcodeMusicGenerationSettings(),
    videoGeneration: defaultRcodeVideoGenerationSettings(),
    modelProfiles: {},
    memoryEnabled: false,
    instructions: defaultRcodeInstructionSettings(),
    computerUse: defaultRcodeComputerUseSettings(),
    quality: defaultRcodeQualitySettings(),
    webSearchAutoMode: true,
    webSearchEnabled: true
  }
}

export function defaultRcodeInstructionSettings(): RcodeInstructionSettingsV1 {
  return {
    enabled: true
  }
}

export function defaultRcodeToolOutputLimitsSettings(): RcodeToolOutputLimitsSettingsV1 {
  return {
    maxLines: DEFAULT_TOOL_OUTPUT_MAX_LINES,
    maxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES
  }
}

export function defaultRcodeQualitySettings(): RcodeDesignQualitySettingsV1 {
  return {
    enabled: true,
    strictness: 'standard',
    ignoreRules: [],
    ignoreFiles: [],
    maxFindings: 12
  }
}

export function defaultRcodeComputerUseSettings(): RcodeComputerUseSettingsV1 {
  return {
    enabled: false,
    mode: 'auto',
    maxImageDimension: 1280,
    maxActionsPerTurn: 40
  }
}

export function defaultRcodeImageGenerationSettings(): RcodeImageGenerationSettingsV1 {
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

export function defaultRcodeSpeechToTextSettings(): RcodeSpeechToTextSettingsV1 {
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

export function defaultRcodeTextToSpeechSettings(): RcodeTextToSpeechSettingsV1 {
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

export function defaultRcodePromptOptimizationSettings(): RcodePromptOptimizationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    model: '',
    prompt: '',
    timeoutMs: 60_000
  }
}

export function defaultRcodeMusicGenerationSettings(): RcodeMusicGenerationSettingsV1 {
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

export function defaultRcodeVideoGenerationSettings(): RcodeVideoGenerationSettingsV1 {
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

export function defaultRcodeMcpSearchSettings(): RcodeMcpSearchSettingsV1 {
  return {
    enabled: false,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
}

export function defaultRcodeProjectConfigSettings(): RcodeProjectConfigSettingsV1 {
  return { grants: [] }
}

export function defaultRcodeTokenEconomySettings(): RcodeTokenEconomySettingsV1 {
  return {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: defaultRcodeHistoryHygieneSettings()
  }
}

export function defaultRcodeHistoryHygieneSettings(): RcodeHistoryHygieneSettingsV1 {
  return {
    maxToolResultLines: 320,
    maxToolResultBytes: 32 * 1024,
    maxToolResultTokens: 8_000,
    maxToolArgumentStringBytes: 8 * 1024,
    maxToolArgumentStringTokens: 2_000,
    maxArrayItems: 80
  }
}

export function defaultRcodeStorageSettings(): RcodeStorageSettingsV1 {
  return {
    backend: 'hybrid',
    sqlitePath: ''
  }
}

export function defaultRcodeContextCompactionSettings(): RcodeContextCompactionSettingsV1 {
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

export function defaultRcodeRuntimeTuningSettings(): RcodeRuntimeTuningSettingsV1 {
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

export function getRcodeRuntimeSettings(
  settings: AppSettingsV1
): RcodeRuntimeSettingsV1 {
  const raw = (settings as { agents?: { Rcode?: Partial<RcodeRuntimeSettingsV1> } }).agents?.Rcode
  return mergeRcodeRuntimeSettings(defaultRcodeRuntimeSettings(), raw)
}

export function RcodeSettingsEnvelope(
  Rcode: RcodeRuntimeSettingsV1
): RcodeSettingsEnvelopeV1 {
  return { Rcode }
}

export function RcodeSettingsPatch(
  Rcode: RcodeRuntimeSettingsPatchV1 | undefined
): RcodeSettingsEnvelopePatchV1 {
  return Rcode ? { Rcode } : {}
}

export function mergeRcodeRuntimeSettings(
  current: RcodeRuntimeSettingsV1,
  patch: RcodeRuntimeSettingsPatchV1 | undefined
): RcodeRuntimeSettingsV1 {
  const currentMcpSearch = normalizeRcodeMcpSearchSettings(current.mcpSearch)
  const nextMcpSearch = normalizeRcodeMcpSearchSettings({
    ...currentMcpSearch,
    ...(patch?.mcpSearch ?? {})
  })
  const nextProjectConfig = normalizeRcodeProjectConfigSettings(
    patch?.projectConfig ?? current.projectConfig
  )
  const currentTokenEconomy = normalizeRcodeTokenEconomySettings(
    current.tokenEconomy,
    current.tokenEconomyMode
  )
  const patchedTokenEconomy = normalizeRcodeTokenEconomySettings({
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
  const currentToolOutputLimits = normalizeRcodeToolOutputLimitsSettings(current.toolOutputLimits)
  const nextToolOutputLimits = normalizeRcodeToolOutputLimitsSettings({
    ...currentToolOutputLimits,
    ...(patch?.toolOutputLimits ?? {})
  })
  const currentStorage = normalizeRcodeStorageSettings(current.storage)
  const nextStorage = normalizeRcodeStorageSettings({
    ...currentStorage,
    ...(patch?.storage ?? {})
  })
  const currentContextCompaction = normalizeRcodeContextCompactionSettings(current.contextCompaction)
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
  const nextContextCompaction = normalizeRcodeContextCompactionSettings(nextContextCompactionInput)
  const currentImageGeneration = normalizeRcodeImageGenerationSettings(current.imageGeneration)
  const nextImageGeneration = normalizeRcodeImageGenerationSettings({
    ...currentImageGeneration,
    ...(patch?.imageGeneration ?? {})
  })
  const currentSpeechToText = normalizeRcodeSpeechToTextSettings(current.speechToText)
  const nextSpeechToText = normalizeRcodeSpeechToTextSettings({
    ...currentSpeechToText,
    ...(patch?.speechToText ?? {})
  })
  const currentTextToSpeech = normalizeRcodeTextToSpeechSettings(current.textToSpeech)
  const nextTextToSpeech = normalizeRcodeTextToSpeechSettings({
    ...currentTextToSpeech,
    ...(patch?.textToSpeech ?? {})
  })
  const currentPromptOptimization = normalizeRcodePromptOptimizationSettings(current.promptOptimization)
  const nextPromptOptimization = normalizeRcodePromptOptimizationSettings({
    ...currentPromptOptimization,
    ...(patch?.promptOptimization ?? {})
  })
  const currentMusicGeneration = normalizeRcodeMusicGenerationSettings(current.musicGeneration)
  const nextMusicGeneration = normalizeRcodeMusicGenerationSettings({
    ...currentMusicGeneration,
    ...(patch?.musicGeneration ?? {})
  })
  const currentVideoGeneration = normalizeRcodeVideoGenerationSettings(current.videoGeneration)
  const nextVideoGeneration = normalizeRcodeVideoGenerationSettings({
    ...currentVideoGeneration,
    ...(patch?.videoGeneration ?? {})
  })
  const currentComputerUse = normalizeRcodeComputerUseSettings(current.computerUse)
  const nextComputerUse = normalizeRcodeComputerUseSettings({
    ...currentComputerUse,
    ...(patch?.computerUse ?? {})
  })
  const currentQuality = normalizeRcodeQualitySettings(current.quality)
  const nextQuality = normalizeRcodeQualitySettings({
    ...currentQuality,
    ...(patch?.quality ?? {})
  })
  const currentRuntimeTuning = normalizeRcodeRuntimeTuningSettings(current.runtimeTuning)
  const nextRuntimeTuning = normalizeRcodeRuntimeTuningSettings({
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
  const nextModelProfiles = normalizeRcodeModelProfiles(current.modelProfiles, patch?.modelProfiles)
  const nextInstructions = {
    enabled: patch?.instructions?.enabled ?? current.instructions?.enabled ?? true
  }
  const nextPort = normalizeRcodeLocalPort(patch?.port ?? current.port, DEFAULT_RCODE_PORT)
  // Optional role/small-model slots (agents.Rcode.*). Patch wins when the key is
  // present (even as empty string => clear); otherwise inherit current. Empty/
  // whitespace strings are dropped so the field is omitted entirely.
  const nextRoleModelSlots = mergeOptionalModelSlot(current, patch)
  const nextRoleReasoningSlots = mergeOptionalReasoningSlot(current, patch)
  const nextSubagents = mergeRcodeSubagentsSettings(current.subagents, patch?.subagents)
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
  // {approvalPolicy, sandboxMode} pair via RcodeToolPermissionModeSettings before
  // dispatching the patch. We must NOT re-canonicalize here: the mode->settings
  // mapping is lossy (only 6 of the 6x4 policy/sandbox combos are representable),
  // so round-tripping would silently rewrite valid non-UI values — e.g. demote
  // approvalPolicy 'never'/'suggest' to 'on-request', or escalate a 'read-only'/
  // 'external-sandbox' sandbox to 'danger-full-access' — on every settings merge.
  const merged: RcodeRuntimeSettingsV1 = {
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

function mergeRcodeSubagentsSettings(
  current: RcodeRuntimeSettingsV1['subagents'],
  patch: RcodeRuntimeSettingsPatchV1['subagents']
): RcodeRuntimeSettingsV1['subagents'] {
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
  current: RcodeRuntimeSettingsV1,
  patch: RcodeRuntimeSettingsPatchV1 | undefined
): Partial<Record<OptionalModelSlotKey, string>> {
  const out: Partial<Record<OptionalModelSlotKey, string>> = {}
  for (const key of OPTIONAL_MODEL_SLOT_KEYS) {
    const source = patch && key in patch ? patch[key] : current[key]
    const trimmed = typeof source === 'string' ? source.trim() : ''
    if (trimmed) out[key] = trimmed
  }
  return out
}

// Per-role reasoning-depth slots (agents.Rcode.*ReasoningEffort). Validated against
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
  current: RcodeRuntimeSettingsV1,
  patch: RcodeRuntimeSettingsPatchV1 | undefined
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

function normalizeRcodeImageGenerationSettings(
  input: Partial<RcodeImageGenerationSettingsV1> | undefined
): RcodeImageGenerationSettingsV1 {
  const defaults = defaultRcodeImageGenerationSettings()
  const defaultSize = typeof input?.defaultSize === 'string' ? input.defaultSize.trim() : ''
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeRcodeImageGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    defaultResolution: normalizeRcodeImageGenerationResolution(input?.defaultResolution),
    defaultSize: /^(auto|\d+x\d+)$/.test(defaultSize) ? defaultSize : '',
    quality: normalizeRcodeImageGenerationQuality(input?.quality),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeRcodeImageGenerationResolution(value: unknown): ImageGenerationResolution {
  return IMAGE_GENERATION_RESOLUTIONS.includes(value as ImageGenerationResolution)
    ? value as ImageGenerationResolution
    : DEFAULT_IMAGE_GENERATION_RESOLUTION
}

function normalizeRcodeImageGenerationQuality(value: unknown): ImageGenerationQuality {
  return IMAGE_GENERATION_QUALITIES.includes(value as ImageGenerationQuality)
    ? value as ImageGenerationQuality
    : 'auto'
}

function normalizeRcodeImageGenerationProtocol(value: unknown): ImageGenerationProtocol {
  if (value === 'minimax-image') return 'minimax-image'
  if (value === 'codex-responses-image') return 'codex-responses-image'
  return DEFAULT_IMAGE_GENERATION_PROTOCOL
}

function normalizeRcodeSpeechToTextSettings(
  input: Partial<RcodeSpeechToTextSettingsV1> | undefined
): RcodeSpeechToTextSettingsV1 {
  const defaults = defaultRcodeSpeechToTextSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeRcodeSpeechToTextProtocol(input?.protocol),
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

function normalizeRcodeSpeechToTextProtocol(value: unknown): SpeechToTextProtocol {
  if (value === 'local-whisper') return 'local-whisper'
  return value === 'mimo-asr' ? 'mimo-asr' : DEFAULT_SPEECH_TO_TEXT_PROTOCOL
}

function normalizeRcodeTextToSpeechSettings(
  input: Partial<RcodeTextToSpeechSettingsV1> | undefined
): RcodeTextToSpeechSettingsV1 {
  const defaults = defaultRcodeTextToSpeechSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeRcodeTextToSpeechProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    voice: typeof input?.voice === 'string' ? input.voice.trim().slice(0, 128) : defaults.voice,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

function normalizeRcodeTextToSpeechProtocol(value: unknown): TextToSpeechProtocol {
  return value === 'minimax-t2a' || value === 'mimo-tts'
    ? value
    : DEFAULT_TEXT_TO_SPEECH_PROTOCOL
}

function normalizeRcodePromptOptimizationSettings(
  input: Partial<RcodePromptOptimizationSettingsV1> | undefined
): RcodePromptOptimizationSettingsV1 {
  const defaults = defaultRcodePromptOptimizationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    prompt: typeof input?.prompt === 'string' ? input.prompt.trim() : defaults.prompt,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

export function resolveRcodePromptOptimizationPrompt(settings: RcodeRuntimeSettingsV1): string {
  const configured = settings.promptOptimization?.prompt?.trim() ?? ''
  return configured || DEFAULT_PROMPT_OPTIMIZATION_PROMPT
}

function normalizeRcodeMusicGenerationSettings(
  input: Partial<RcodeMusicGenerationSettingsV1> | undefined
): RcodeMusicGenerationSettingsV1 {
  const defaults = defaultRcodeMusicGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeRcodeMusicGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 900_000)
  }
}

function normalizeRcodeMusicGenerationProtocol(value: unknown): MusicGenerationProtocol {
  return value === 'minimax-music' ? 'minimax-music' : DEFAULT_MUSIC_GENERATION_PROTOCOL
}

function normalizeRcodeVideoGenerationSettings(
  input: Partial<RcodeVideoGenerationSettingsV1> | undefined
): RcodeVideoGenerationSettingsV1 {
  const defaults = defaultRcodeVideoGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeRcodeVideoGenerationProtocol(input?.protocol),
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

function normalizeRcodeVideoGenerationProtocol(value: unknown): VideoGenerationProtocol {
  return value === 'minimax-video' ? 'minimax-video' : DEFAULT_VIDEO_GENERATION_PROTOCOL
}

function normalizeRcodeComputerUseSettings(
  input: Partial<RcodeComputerUseSettingsV1> | undefined
): RcodeComputerUseSettingsV1 {
  const defaults = defaultRcodeComputerUseSettings()
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

function normalizeRcodeTokenEconomySettings(
  input: Partial<RcodeTokenEconomySettingsV1> | undefined,
  enabledFallback = false
): RcodeTokenEconomySettingsV1 {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : enabledFallback,
    compressToolDescriptions: input?.compressToolDescriptions !== false,
    compressToolResults: input?.compressToolResults !== false,
    conciseResponses: input?.conciseResponses !== false,
    historyHygiene: normalizeRcodeHistoryHygieneSettings(input?.historyHygiene)
  }
}

function normalizeRcodeToolOutputLimitsSettings(
  input: Partial<RcodeToolOutputLimitsSettingsV1> | undefined
): RcodeToolOutputLimitsSettingsV1 {
  const defaults = defaultRcodeToolOutputLimitsSettings()
  return {
    maxLines: boundedPositiveInt(input?.maxLines, defaults.maxLines, 1_000_000),
    maxBytes: boundedPositiveInt(input?.maxBytes, defaults.maxBytes, 64 * 1024 * 1024)
  }
}

function normalizeRcodeHistoryHygieneSettings(
  input: Partial<RcodeHistoryHygieneSettingsV1> | undefined
): RcodeHistoryHygieneSettingsV1 {
  const defaults = defaultRcodeHistoryHygieneSettings()
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

function normalizeRcodeMcpSearchSettings(
  input: Partial<RcodeMcpSearchSettingsV1> | undefined
): RcodeMcpSearchSettingsV1 {
  const defaults = defaultRcodeMcpSearchSettings()
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

export function normalizeRcodeProjectConfigSettings(
  input: Partial<RcodeProjectConfigSettingsV1> | undefined
): RcodeProjectConfigSettingsV1 {
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

function normalizeRcodeStorageSettings(
  input: Partial<RcodeStorageSettingsV1> | undefined
): RcodeStorageSettingsV1 {
  const defaults = defaultRcodeStorageSettings()
  return {
    backend: input?.backend === 'file' || input?.backend === 'hybrid'
      ? input.backend
      : defaults.backend,
    sqlitePath: typeof input?.sqlitePath === 'string' ? input.sqlitePath.trim() : defaults.sqlitePath
  }
}

function normalizeRcodeContextCompactionSettings(
  input: Partial<RcodeContextCompactionSettingsV1> | undefined
): RcodeContextCompactionSettingsV1 {
  const defaults = defaultRcodeContextCompactionSettings()
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

function normalizeRcodeRuntimeTuningSettings(
  input: Partial<RcodeRuntimeTuningSettingsV1> | undefined
): RcodeRuntimeTuningSettingsV1 {
  const defaults = defaultRcodeRuntimeTuningSettings()
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

const RCODE_DESIGN_QUALITY_STRICTNESS: readonly RcodeDesignQualityStrictness[] = [
  'relaxed',
  'standard',
  'strict'
]

function normalizeRcodeQualitySettings(
  input: Partial<RcodeDesignQualitySettingsV1> | undefined
): RcodeDesignQualitySettingsV1 {
  const defaults = defaultRcodeQualitySettings()
  const strictness =
    input?.strictness && RCODE_DESIGN_QUALITY_STRICTNESS.includes(input.strictness)
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

function normalizeRcodeModelProfiles(
  current: Record<string, ModelProviderModelProfileV1> | undefined,
  patch: Record<string, ModelProviderModelProfilePatchV1 | null> | undefined
): Record<string, ModelProviderModelProfileV1> {
  const profiles: Record<string, ModelProviderModelProfileV1> = {}
  for (const [rawModelId, rawProfile] of Object.entries(current ?? {})) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    profiles[modelId] = normalizeRcodeModelProfile(rawProfile)
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return profiles
  for (const [rawModelId, rawProfile] of Object.entries(patch)) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    if (rawProfile === null) {
      delete profiles[modelId]
      continue
    }
    profiles[modelId] = normalizeRcodeModelProfile({
      ...(profiles[modelId] ?? {}),
      ...rawProfile
    })
  }
  return profiles
}

function normalizeRcodeModelProfile(
  input: ModelProviderModelProfilePatchV1 | undefined
): ModelProviderModelProfileV1 {
  const inputModalities = normalizeRcodeModelInputModalities(input?.inputModalities)
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
  const reasoning = normalizeRcodeReasoningCapability(input?.reasoning)
  const endpointFormat = typeof input?.endpointFormat === 'string' && input.endpointFormat.trim()
    ? normalizeModelEndpointFormat(input.endpointFormat)
    : undefined
  return {
    ...(normalizeRcodeProfileAliases(input?.aliases).length
      ? { aliases: normalizeRcodeProfileAliases(input?.aliases) }
      : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    inputModalities,
    outputModalities: normalizeRcodeModelInputModalities(input?.outputModalities),
    supportsToolCalling: input?.supportsToolCalling !== false,
    messageParts: normalizeRcodeModelMessageParts(input?.messageParts, fallbackMessageParts),
    ...(reasoning ? { reasoning } : {}),
    ...(endpointFormat ? { endpointFormat } : {})
  }
}

function normalizeRcodeReasoningCapability(
  input: ModelProviderModelProfilePatchV1['reasoning'] | undefined
): ModelProviderReasoningCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const supportedEfforts = normalizeRcodeReasoningEfforts(input.supportedEfforts)
  if (supportedEfforts.length === 0) return undefined
  const defaultEffort = normalizeRcodeReasoningEffort(input.defaultEffort)
  const requestProtocol = normalizeRcodeReasoningRequestProtocol(input.requestProtocol)
  if (!requestProtocol) return undefined
  return {
    supportedEfforts,
    defaultEffort: defaultEffort && supportedEfforts.includes(defaultEffort)
      ? defaultEffort
      : supportedEfforts[0],
    requestProtocol
  }
}

function normalizeRcodeReasoningEfforts(value: unknown): ModelProviderReasoningCapabilityV1['supportedEfforts'] {
  if (!Array.isArray(value)) return []
  const efforts: ModelProviderReasoningCapabilityV1['supportedEfforts'] = []
  for (const item of value) {
    const effort = normalizeRcodeReasoningEffort(item)
    if (effort && !efforts.includes(effort)) efforts.push(effort)
  }
  return efforts
}

function normalizeRcodeReasoningEffort(value: unknown): ModelProviderReasoningCapabilityV1['defaultEffort'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ModelProviderReasoningCapabilityV1['defaultEffort'])
    ? normalized as ModelProviderReasoningCapabilityV1['defaultEffort']
    : undefined
}

function normalizeRcodeReasoningRequestProtocol(
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

function normalizeRcodeProfileAliases(value: unknown): string[] {
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

function normalizeRcodeModelInputModalities(value: unknown): ModelProviderInputModality[] {
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

function normalizeRcodeModelMessageParts(
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

export function withRcodeRuntimeSettings(
  settings: AppSettingsV1,
  Rcode: RcodeRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: RcodeSettingsEnvelope(Rcode)
  }
}

export function applyRcodeRuntimePatch(
  settings: AppSettingsV1,
  patch: RcodeRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withRcodeRuntimeSettings(
    settings,
    mergeRcodeRuntimeSettings(getRcodeRuntimeSettings(settings), patch)
  )
}

export function isRcodeRuntimeInsecure(runtime: Pick<RcodeRuntimeSettingsV1, 'insecure' | 'runtimeToken'>): boolean {
  return runtime.insecure === true
}

export function getActiveAgentApiKey(settings: AppSettingsV1): string {
  return resolveRcodeRuntimeSettings(settings).apiKey?.trim() ?? ''
}

export function mergeAgentRuntimeSettings(
  defaults: RcodeSettingsEnvelopeV1,
  patch: RcodeSettingsEnvelopePatchV1 | undefined
): RcodeSettingsEnvelopeV1 {
  return RcodeSettingsEnvelope(
    mergeRcodeRuntimeSettings(defaults.Rcode, patch?.Rcode)
  )
}

type LegacyAgentsSettingsShape = {
  Rcode?: Partial<RcodeRuntimeSettingsV1>
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

function upgradeLegacyRcodeDefaultDataDir(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_RCODE_DATA_DIR
  const trimmed = value.trim()
  const normalized = trimmed.replace(/\\/g, '/').toLowerCase()
  if (
    !trimmed ||
    normalized === LEGACY_COREAGENT_DATA_DIR ||
    normalized.endsWith('/.deepseekgui/coreagent')
  ) {
    return DEFAULT_RCODE_DATA_DIR
  }
  return trimmed
}

function upgradeLegacyRcodeDefaultModel(value: unknown, fallback: string): string {
  const model = nonEmptyStringOrFallback(value, fallback).trim()
  return model === LEGACY_RCODE_DEFAULT_MODEL ? DEFAULT_RCODE_MODEL : model
}

function upgradeLegacyRcodeDefaultPort(value: unknown, fallback: number): number {
  return value === LEGACY_LOCAL_HTTP_DEFAULT_PORT ? DEFAULT_RCODE_PORT : fallback
}

function normalizeRcodeLocalPort(value: unknown, fallback: number): number {
  if (value === LEGACY_LOCAL_HTTP_DEFAULT_PORT || value === PREVIOUS_RCODE_DEFAULT_PORT) {
    return DEFAULT_RCODE_PORT
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(65_535, Math.max(MIN_RCODE_LOCAL_PORT, Math.floor(parsed)))
}

export function migrateLegacyAppSettings(parsed: LegacyAppSettingsShape): Partial<AppSettingsV1> {
  const rawAgentProvider = parsed.agentProvider
  const isReasoningLegacy = rawAgentProvider === 'reasonix'
  const hasProviderSettings = typeof parsed.provider === 'object' && parsed.provider !== null
  const defaults = legacyLocalHttpRuntimeDefaults()
  const RcodeDefaults = defaultRcodeRuntimeSettings()
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
  const explicitRcode: Partial<RcodeRuntimeSettingsV1> = parsed.agents?.Rcode ?? {}
  const legacySource = isReasoningLegacy ? legacyReasoning : legacyLocalHttp
  const legacySeed = {
    binaryPath: RcodeDefaults.binaryPath,
    port: isReasoningLegacy
      ? RcodeDefaults.port
      : upgradeLegacyRcodeDefaultPort(legacyLocalHttp.port, legacyLocalHttp.port),
    autoStart: isReasoningLegacy ? legacyReasoning.autoStart : legacyLocalHttp.autoStart,
    apiKey: legacySource.apiKey,
    baseUrl: legacySource.baseUrl,
    providerId: '',
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    retry: RcodeDefaults.retry,
    runtimeToken: isReasoningLegacy ? RcodeDefaults.runtimeToken : legacyLocalHttp.runtimeToken,
    model: isReasoningLegacy ? legacyReasoning.model : RcodeDefaults.model,
    approvalPolicy: isReasoningLegacy ? RcodeDefaults.approvalPolicy : legacyLocalHttp.approvalPolicy,
    sandboxMode: isReasoningLegacy ? RcodeDefaults.sandboxMode : legacyLocalHttp.sandboxMode
  }
  const provider = normalizeModelProviderSettings({
    apiKey: hasProviderSettings
      ? parsed.provider?.apiKey
      : nonEmptyStringOrFallback(explicitRcode.apiKey, legacySeed.apiKey),
    baseUrl: hasProviderSettings
      ? parsed.provider?.baseUrl
      : nonEmptyStringOrFallback(explicitRcode.baseUrl, legacySeed.baseUrl),
    proxy: parsed.provider?.proxy,
    providers: parsed.provider?.providers
  })
  const Rcode = {
    ...RcodeDefaults,
    ...legacySeed,
    ...explicitRcode,
    port: normalizeRcodeLocalPort(explicitRcode.port ?? legacySeed.port, RcodeDefaults.port),
    apiKey: hasProviderSettings ? explicitRcode.apiKey ?? '' : '',
    baseUrl: hasProviderSettings ? explicitRcode.baseUrl ?? '' : '',
    runtimeToken: nonEmptyStringOrFallback(explicitRcode.runtimeToken, legacySeed.runtimeToken),
    dataDir: upgradeLegacyRcodeDefaultDataDir(explicitRcode.dataDir),
    model: upgradeLegacyRcodeDefaultModel(explicitRcode.model, legacySeed.model),
    tokenEconomyMode: typeof explicitRcode.tokenEconomy?.enabled === 'boolean'
      ? explicitRcode.tokenEconomy.enabled
      : explicitRcode.tokenEconomyMode ?? RcodeDefaults.tokenEconomyMode,
    tokenEconomy: normalizeRcodeTokenEconomySettings(
      explicitRcode.tokenEconomy,
      explicitRcode.tokenEconomyMode ?? RcodeDefaults.tokenEconomyMode
    ),
    toolOutputLimits: normalizeRcodeToolOutputLimitsSettings(explicitRcode.toolOutputLimits),
    mcpSearch: normalizeRcodeMcpSearchSettings(explicitRcode.mcpSearch),
    projectConfig: normalizeRcodeProjectConfigSettings(explicitRcode.projectConfig),
    storage: normalizeRcodeStorageSettings(explicitRcode.storage),
    contextCompaction: normalizeRcodeContextCompactionSettings(explicitRcode.contextCompaction),
    runtimeTuning: normalizeRcodeRuntimeTuningSettings(explicitRcode.runtimeTuning),
    imageGeneration: normalizeRcodeImageGenerationSettings(explicitRcode.imageGeneration),
    speechToText: normalizeRcodeSpeechToTextSettings(explicitRcode.speechToText),
    textToSpeech: normalizeRcodeTextToSpeechSettings(explicitRcode.textToSpeech),
    musicGeneration: normalizeRcodeMusicGenerationSettings(explicitRcode.musicGeneration),
    videoGeneration: normalizeRcodeVideoGenerationSettings(explicitRcode.videoGeneration),
    quality: normalizeRcodeQualitySettings(explicitRcode.quality)
  }
  // Strip the legacy `agentProvider` discriminator and the legacy
  // per-provider settings from the surfaced migration result. The
  // runtime now has a single agent (Rcode) and we no longer
  // round-trip the legacy value into the new settings shape.
  const { deepseek: _legacyDeepseek, agents: _agents, agentProvider: _agentProvider, ...rest } = parsed
  void _legacyDeepseek
  void _agents
  void _agentProvider
  return {
    ...rest,
    provider,
    agents: {
      Rcode
    }
  }
}
