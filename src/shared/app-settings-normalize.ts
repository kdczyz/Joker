import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_CHECKPOINT_CLEANUP_ENABLED,
  DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_CURSOR_SPOTLIGHT_COLOR,
  DEFAULT_GIT_BRANCH_PREFIX,
  DEFAULT_LOG_RETENTION_DAYS,
  normalizeGuiUpdateChannel,
  normalizeChatContentMaxWidth,
  normalizeUiFontScale,
  type AppBehaviorConfigV1,
  type AppSettingsV1,
  type CheckpointCleanupConfigV1,
  type CheckpointCleanupIntervalDays,
  type ClawSettingsPatchV1,
  type DesignSettingsPatchV1,
  type GuiUpdateConfigV1,
  type RcodeRuntimeSettingsV1,
  type ModelProviderProfileV1,
  type NotificationConfigV1,
  type RemoteAgentSettingsV1,
  type ScheduleSettingsPatchV1,
  WINDOW_CLOSE_ACTIONS,
  type WindowCloseAction,
  type WorkflowSettingsPatchV1,
  type WriteSettingsPatchV1,
  type OpenAiProxySettingsPatchV1
} from './app-settings-types'
import { isAppLocale } from './app-locales'
import { normalizeKeyboardShortcuts, type KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import {
  defaultRcodeRuntimeSettings,
  getRcodeRuntimeSettings,
  RcodeSettingsEnvelope,
  mergeRcodeRuntimeSettings,
  migrateLegacyAppSettings
} from './app-settings-Rcode'
import {
  defaultMiniMaxMediaGenerationRcodePatch,
  normalizeModelProviderSettings
} from './app-settings-provider'
import { normalizeModelProviderBaseUrl } from './app-settings-normalizers'
import { normalizeClawSettings } from './app-settings-claw'
import { normalizeRemoteAgentSettings } from './app-settings-remote-agent'
import { normalizeScheduleSettings } from './app-settings-schedule'
import { normalizeWorkflowSettings } from './app-settings-workflow'
import { normalizeOpenAiProxySettings } from './app-settings-openai-proxy'
import { normalizeWriteSettings } from './app-settings-write'
import { normalizeDesignSettings } from './app-settings-design'
import { normalizeTerminalSettings, type TerminalSettingsPatchV1 } from './app-settings-terminal'

export function normalizeAppSettings(settings: AppSettingsV1): AppSettingsV1 {
  const migrated = shouldMigrateLegacySettings(settings)
    ? migrateLegacyAppSettings(settings as Parameters<typeof migrateLegacyAppSettings>[0])
    : settings
  const maybeSettings = migrated as AppSettingsV1 & {
    appBehavior?: Partial<AppBehaviorConfigV1>
    keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
    notifications?: Partial<NotificationConfigV1>
    provider?: Parameters<typeof normalizeModelProviderSettings>[0]
    checkpointCleanup?: Partial<CheckpointCleanupConfigV1>
    write?: WriteSettingsPatchV1
    claw?: ClawSettingsPatchV1
    remoteAgent?: Partial<RemoteAgentSettingsV1>
    schedule?: ScheduleSettingsPatchV1
    workflow?: WorkflowSettingsPatchV1
    design?: DesignSettingsPatchV1
    guiUpdate?: Partial<GuiUpdateConfigV1>
    terminal?: TerminalSettingsPatchV1
    openaiProxy?: OpenAiProxySettingsPatchV1
  }
  const providerSettings = normalizeModelProviderSettings(maybeSettings.provider)
  const rawRcode = maybeSettings.agents?.Rcode
  const runtime = normalizeRuntimeModelProviderSelection(
    getRcodeRuntimeSettings(maybeSettings),
    providerSettings.providers,
    typeof rawRcode?.model === 'string' && Boolean(rawRcode.model.trim())
  )
  const rawMediaPatch: Parameters<typeof defaultMiniMaxMediaGenerationRcodePatch>[0]['RcodePatch'] = {
    ...(rawRcode?.textToSpeech !== undefined ? { textToSpeech: rawRcode.textToSpeech } : {}),
    ...(rawRcode?.musicGeneration !== undefined ? { musicGeneration: rawRcode.musicGeneration } : {}),
    ...(rawRcode?.videoGeneration !== undefined ? { videoGeneration: rawRcode.videoGeneration } : {})
  }
  const miniMaxMediaDefaults = defaultMiniMaxMediaGenerationRcodePatch({
    providers: providerSettings.providers,
    currentRcode: runtime,
    RcodePatch: rawMediaPatch
  })
  return {
    version: 1,
    locale: isAppLocale(maybeSettings.locale) ? maybeSettings.locale : 'system',
    theme:
      maybeSettings.theme === 'light' || maybeSettings.theme === 'dark' || maybeSettings.theme === 'system'
        ? maybeSettings.theme
        : 'system',
    uiFontScale: normalizeUiFontScale(maybeSettings.uiFontScale),
    chatContentMaxWidthPx: normalizeChatContentMaxWidth(maybeSettings.chatContentMaxWidthPx),
    cursorSpotlight: maybeSettings.cursorSpotlight !== false,
    cursorSpotlightColor: normalizeCursorSpotlightColor(maybeSettings.cursorSpotlightColor),
    provider: providerSettings,
    agents: RcodeSettingsEnvelope(mergeRcodeRuntimeSettings(defaultRcodeRuntimeSettings(), {
      ...runtime,
      baseUrl: runtime.baseUrl.trim() ? normalizeModelProviderBaseUrl(runtime.baseUrl) : '',
      ...(miniMaxMediaDefaults ?? {})
    })),
    workspaceRoot: typeof maybeSettings.workspaceRoot === 'string' ? maybeSettings.workspaceRoot : '',
    conversationWorkspaceRoot:
      typeof maybeSettings.conversationWorkspaceRoot === 'string'
        ? maybeSettings.conversationWorkspaceRoot
        : '',
    log: {
      enabled: maybeSettings.log?.enabled !== false,
      retentionDays: typeof maybeSettings.log?.retentionDays === 'number'
        ? maybeSettings.log.retentionDays
        : DEFAULT_LOG_RETENTION_DAYS
    },
    checkpointCleanup: normalizeCheckpointCleanupSettings(maybeSettings.checkpointCleanup),
    gitBranchPrefix: normalizeGitBranchPrefix(maybeSettings.gitBranchPrefix),
    notifications: {
      turnComplete: maybeSettings.notifications?.turnComplete !== false
    },
    appBehavior: normalizeAppBehaviorSettings(maybeSettings.appBehavior),
    keyboardShortcuts: normalizeKeyboardShortcuts(maybeSettings.keyboardShortcuts),
    write: normalizeWriteSettings(maybeSettings.write),
    claw: normalizeClawSettings(maybeSettings.claw),
    remoteAgent: normalizeRemoteAgentSettings(maybeSettings.remoteAgent),
    schedule: normalizeScheduleSettings(maybeSettings.schedule),
    workflow: normalizeWorkflowSettings(maybeSettings.workflow),
    design: normalizeDesignSettings(maybeSettings.design),
    terminal: normalizeTerminalSettings(maybeSettings.terminal),
    openaiProxy: normalizeOpenAiProxySettings(maybeSettings.openaiProxy),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(
        maybeSettings.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL
      )
    },
    codePromptPrefix: typeof maybeSettings.codePromptPrefix === 'string' ? maybeSettings.codePromptPrefix : '',
    disabledSkillIds: normalizeDisabledSkillIds(maybeSettings.disabledSkillIds)
  }
}

function normalizeRuntimeModelProviderSelection(
  runtime: RcodeRuntimeSettingsV1,
  providers: readonly ModelProviderProfileV1[],
  preferModelOwner: boolean
): RcodeRuntimeSettingsV1 {
  if (providers.length === 0) return runtime
  const main = normalizeModelProviderPair(runtime.providerId, runtime.model, providers, preferModelOwner)
  const profiles = runtime.subagents?.profiles.map((profile) => {
    const model = profile.model?.trim() ?? ''
    const providerId = profile.providerId?.trim() ?? ''
    if (!model && !providerId) return profile
    const normalized = normalizeModelProviderPair(providerId, model, providers, Boolean(model))
    return {
      ...profile,
      model: normalized.model,
      providerId: normalized.providerId || providers[0].id
    }
  })
  return {
    ...runtime,
    ...main,
    ...(runtime.subagents && profiles
      ? { subagents: { ...runtime.subagents, profiles } }
      : {})
  }
}

function normalizeModelProviderPair(
  providerInput: string,
  modelInput: string,
  providers: readonly ModelProviderProfileV1[],
  preferModelOwner: boolean
): { providerId: string; model: string } {
  const providerId = providerInput.trim()
  const model = modelInput.trim()
  const selected = providerId
    ? providers.find((provider) => provider.id === providerId)
    : providers[0]
  if (selected && providerContainsModel(selected, model)) return { providerId, model }
  if (providerId && !selected) return { providerId, model }

  const matches = providers.filter((provider) => providerContainsModel(provider, model))
  if ((!providerId || preferModelOwner) && matches.length === 1) {
    return { providerId: matches[0].id, model }
  }

  const fallbackProvider = selected ?? providers[0]
  const fallbackModel = fallbackProvider.models.find((candidate) => candidate.trim())?.trim()
  if (!fallbackModel) return { providerId, model }
  return {
    providerId: providerId
      ? fallbackProvider.id
      : fallbackProvider === providers[0]
        ? ''
        : fallbackProvider.id,
    model: fallbackModel
  }
}

function providerContainsModel(provider: ModelProviderProfileV1, modelId: string): boolean {
  const model = modelId.trim().toLowerCase()
  if (!model) return false
  if (provider.models.some((candidate) => candidate.trim().toLowerCase() === model)) return true
  return Object.entries(provider.modelProfiles).some(([profileModel, profile]) =>
    profileModel.trim().toLowerCase() === model ||
    profile.aliases?.some((alias) => alias.trim().toLowerCase() === model) === true
  )
}

export function normalizeGitBranchPrefix(value: unknown): string {
  const normalized = typeof value === 'string'
    ? value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    : DEFAULT_GIT_BRANCH_PREFIX
  if (!normalized) return ''
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

export function applyGitBranchPrefix(branch: string, prefix: unknown): string {
  const normalizedBranch = branch.trim().replace(/^\/+/, '')
  const normalizedPrefix = normalizeGitBranchPrefix(prefix)
  if (!normalizedBranch || !normalizedPrefix || normalizedBranch.startsWith(normalizedPrefix)) {
    return normalizedBranch
  }
  return `${normalizedPrefix}${normalizedBranch}`
}

export function normalizeCheckpointCleanupIntervalDays(value: unknown): CheckpointCleanupIntervalDays {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS
  if (parsed <= 1) return 1
  if (parsed <= 2) return 2
  if (parsed <= 3) return 3
  if (parsed <= 5) return 5
  return 10
}

export function normalizeCheckpointCleanupSettings(
  settings?: Partial<CheckpointCleanupConfigV1>
): CheckpointCleanupConfigV1 {
  const intervalDays = normalizeCheckpointCleanupIntervalDays(settings?.intervalDays)
  const directory = typeof settings?.directory === 'string' ? settings.directory.trim() : ''
  const maxPerThread = typeof settings?.maxPerThread === 'number' && Number.isFinite(settings.maxPerThread)
    ? Math.max(1, Math.min(100, Math.floor(settings.maxPerThread)))
    : undefined
  return {
    enabled: typeof settings?.enabled === 'boolean' ? settings.enabled : DEFAULT_CHECKPOINT_CLEANUP_ENABLED,
    intervalDays: CHECKPOINT_CLEANUP_INTERVAL_DAYS.includes(intervalDays)
      ? intervalDays
      : DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS,
    // Only include the optional storage overrides when explicitly set so
    // existing settings snapshots (which omit them) stay byte-for-byte equal.
    ...(directory ? { directory } : {}),
    ...(maxPerThread !== undefined ? { maxPerThread } : {})
  }
}

export function normalizeCursorSpotlightColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CURSOR_SPOTLIGHT_COLOR
  const color = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_CURSOR_SPOTLIGHT_COLOR
}

function normalizeDisabledSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim().replace(/^\/?skill:/i, '').trim())
    .filter(Boolean))]
}

export function normalizeAppBehaviorSettings(
  settings?: Partial<AppBehaviorConfigV1>
): AppBehaviorConfigV1 {
  const openAtLogin = settings?.openAtLogin === true
  const closeAction = normalizeWindowCloseAction(settings?.closeAction)
    ?? (settings?.closeToTray === true ? 'tray' : 'ask')
  return {
    openAtLogin,
    startMinimized: openAtLogin && settings?.startMinimized === true,
    closeAction,
    closeToTray: closeAction === 'tray'
  }
}

export function normalizeWindowCloseAction(value: unknown): WindowCloseAction | null {
  return typeof value === 'string' && WINDOW_CLOSE_ACTIONS.includes(value as WindowCloseAction)
    ? value as WindowCloseAction
    : null
}

export function mergeAppBehaviorSettings(
  current: AppBehaviorConfigV1,
  patch?: Partial<AppBehaviorConfigV1>
): AppBehaviorConfigV1 {
  const translatedPatch: Partial<AppBehaviorConfigV1> | undefined =
    patch && patch.closeAction === undefined && patch.closeToTray !== undefined
      ? {
          ...patch,
          closeAction: patch.closeToTray ? 'tray' : 'quit'
        }
      : patch
  return normalizeAppBehaviorSettings({
    ...current,
    ...(translatedPatch ?? {})
  })
}

function shouldMigrateLegacySettings(settings: AppSettingsV1): boolean {
  const raw = settings as AppSettingsV1 & {
    agentProvider?: unknown
    deepseek?: unknown
    agents?: {
      Rcode?: Partial<ReturnType<typeof defaultRcodeRuntimeSettings>>
      codewhale?: unknown
      reasonix?: unknown
    }
  }
  if (!raw.agents?.Rcode) return true
  if ('agentProvider' in raw || 'deepseek' in raw) return true
  if (raw.agents.codewhale || raw.agents.reasonix) return true
  const dataDir = typeof raw.agents.Rcode.dataDir === 'string'
    ? raw.agents.Rcode.dataDir.replace(/\\/g, '/').toLowerCase()
    : ''
  return dataDir === '~/.deepseekgui/coreagent' || dataDir.endsWith('/.deepseekgui/coreagent')
}
