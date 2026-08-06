import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  defaultRcodeRuntimeSettings,
  defaultModelProviderSettings,
  getModelProviderPreset,
  modelProviderPresetProfile,
  type ModelProviderProfileV1
} from '@shared/app-settings'
import { AgentsSettingsSection, modelProvidersSettingsPatch } from './settings-section-agents'
import { ProvidersSettingsSection } from './settings-section-providers'

const labels: Record<string, string> = {
  agentsQuickBase: 'Base',
  agentsQuickSkill: 'Skills',
  agentsQuickMcp: 'MCP',
  agentsQuickPermissions: 'Permissions',
  agents: 'Agents',
  providers: 'Providers',
  providersDesc: 'Providers description',
  RcodeProvider: 'Provider',
  RcodeProviderDesc: 'Provider description',
  RcodeProviderSelectDesc: 'Provider select description',
  modelProviderAdd: 'Add provider',
  modelProviderAddMenuCustom: 'Custom provider…',
  modelProviderSectionBasics: 'Provider basics',
  modelProviderSectionConnection: 'Provider connection',
  modelProviderSectionDanger: 'Danger zone',
  modelProviderTestConnection: 'Test connection',
  modelProviderFetchModels: 'Fetch from API',
  modelProviderModelsPlaceholder: 'Type a model ID and press Enter',
  modelProviderModelCount: 'models count',
  modelProviderInUse: 'In use',
  modelProviderMissingKey: 'No API key',
  modelProviderDefaultBadge: 'Default',
  modelProviderPresetBadge: 'Preset',
  modelProviderCustomBadge: 'Custom',
  modelProviderDangerHint: 'Danger hint',
  modelProviderIdLocked: 'Provider ID locked',
  modelProviderRemove: 'Remove provider',
  modelProviderName: 'Provider name',
  modelProviderId: 'Provider ID',
  modelProviderApiKey: 'Provider API key',
  modelProviderApiKeyPlaceholder: 'Enter provider API key',
  modelProviderBaseUrl: 'Provider base URL',
  modelProviderEndpointFormat: 'Endpoint format',
  modelProviderRetrySection: 'Failure retry',
  modelProviderRetryMaxAttempts: 'Retry attempts',
  modelProviderRetryInitialDelayMs: 'Initial retry delay (ms)',
  modelProviderRetryStatusCodes: 'Retry HTTP status codes',
  modelProviderRetryStatusCodesHint: 'Separate multiple status codes with commas, for example 429,503.',
  modelProviderFetchEmpty: 'No models found',
  modelEndpointChatCompletions: '/v1/chat/completions (openai)',
  modelEndpointResponses: '/v1/responses (openai)',
  modelEndpointMessages: '/v1/messages (anthropic)',
  modelEndpointCustomEndpoint: 'Custom full endpoint',
  modelProviderModels: 'Provider models',
  modelProviderImageCapability: 'Image capability',
  modelProviderImageCapabilityDesc: 'Image capability description',
  modelProviderImageEnable: 'Enable image',
  modelProviderImageDisable: 'Disable image',
  imageGenProtocol: 'Image protocol',
  imageGenProtocolOpenAi: 'OpenAI Images',
  imageGenProtocolMiniMax: 'MiniMax image_generation',
  imageGenBaseUrl: 'Image base URL',
  imageGenModel: 'Image model',
  imageGenBaseUrlPlaceholder: 'https://api.example.com/v1',
  baseUrlPlaceholder: 'https://api.example.com/v1',
  RcodeApiKey: 'Rcode API key',
  RcodeApiKeyDesc: 'Rcode API key description',
  RcodeApiKeyPlaceholder: 'Inherit API key',
  RcodeApiKeyInherited: 'Inherited API key',
  RcodeApiKeyMissing: 'Missing API key',
  RcodeApiKeyOverride: 'Override API key',
  RcodeBaseUrl: 'Rcode base URL',
  RcodeBaseUrlDesc: 'Rcode base URL description',
  RcodeBaseUrlPlaceholder: 'Inherit base URL',
  RcodeBaseUrlOfficial: 'Official base URL',
  RcodeBaseUrlInherited: 'Inherited base URL',
  RcodeBaseUrlOverride: 'Override base URL',
  RcodeAssistantAdvanced: 'Assistant advanced settings',
  RcodeAssistantAdvancedDesc: 'Assistant advanced settings description',
  autoStart: 'Auto start',
  autoStartDesc: 'Auto start description',
  port: 'Port',
  portDesc: 'Port description',
  RcodeBinary: 'Rcode binary',
  RcodeBinaryDesc: 'Rcode binary description',
  RcodeBinaryPlaceholder: 'Bundled Rcode',
  RcodeDataDir: 'Data dir',
  RcodeDataDirDesc: 'Data dir description',
  RcodeModel: 'Model',
  RcodeModelDesc: 'Model description',
  RcodeTokenEconomy: 'Token-saving mode',
  RcodeTokenEconomyDesc: 'Token-saving mode description',
  RcodeTokenEconomySavings: 'Saved {{tokens}} tokens',
  RcodeTokenEconomySavingsLoading: 'Loading savings',
  RcodeTokenEconomySavingsEmpty: 'Savings empty',
  RcodeTokenEconomyAdvanced: 'Token-saving advanced settings',
  RcodeTokenEconomyAdvancedDesc: 'Token-saving advanced settings description',
  RcodeTokenEconomyOptions: 'Token-saving options',
  RcodeTokenEconomyOptionsDesc: 'Token-saving options description',
  RcodeCompressToolDescriptions: 'Compress tool descriptions',
  RcodeCompressToolResults: 'Compress tool results',
  RcodeConciseResponses: 'Concise responses',
  RcodeHistoryHygiene: 'History guard',
  RcodeHistoryHygieneDesc: 'History guard description',
  RcodeHistoryMaxResultLines: 'Max result lines',
  RcodeHistoryMaxResultBytes: 'Max result bytes',
  RcodeHistoryMaxResultTokens: 'Max result tokens',
  RcodeHistoryMaxArgumentBytes: 'Max argument bytes',
  RcodeHistoryMaxArgumentTokens: 'Max argument tokens',
  RcodeHistoryMaxArrayItems: 'Max array items',
  runtimeToken: 'Runtime token',
  runtimeTokenDesc: 'Runtime token description',
  showSecret: 'Show',
  hideSecret: 'Hide',
  RcodeInsecure: 'Insecure',
  RcodeInsecureDesc: 'Insecure description',
  RcodeInsecureForcedDesc: 'Insecure forced',
  RcodeAdvanced: 'Advanced runtime settings',
  RcodeAdvancedDetails: 'Storage, model context, and tool guards',
  RcodeAdvancedDetailsDesc: 'Per-model context policy comes from models.profiles',
  RcodeStorageBackend: 'Storage backend',
  RcodeStorageBackendDesc: 'Storage backend description',
  RcodeStorageHybrid: 'Hybrid storage',
  RcodeStorageFile: 'Pure JSONL file storage',
  RcodeStorageSqlitePath: 'SQLite path',
  RcodeStorageSqlitePathDesc: 'SQLite path description',
  RcodeStorageSqlitePathPlaceholder: 'Automatic SQLite path',
  RcodeModelContextProfile: 'Current model context policy',
  RcodeModelContextProfileDesc: 'Current model context policy description',
  RcodeModelContextModel: 'Matched model',
  RcodeModelContextWindow: 'Context window',
  RcodeModelContextSoft: 'Model soft threshold',
  RcodeModelContextHard: 'Model hard threshold',
  RcodeModelContextSourceBuiltIn: 'Built-in model config',
  RcodeModelContextSourceFallback: 'Fallback model config',
  RcodeCompactionThresholds: 'Fallback compaction thresholds',
  RcodeCompactionThresholdsDesc: 'Fallback compaction thresholds description',
  RcodeCompactionSoftThreshold: 'Fallback soft threshold',
  RcodeCompactionHardThreshold: 'Fallback hard threshold',
  RcodeCompactionSummary: 'Compaction summary',
  RcodeCompactionSummaryDesc: 'Compaction summary description',
  RcodeCompactionSummaryMode: 'Summary mode',
  RcodeCompactionSummaryHeuristic: 'Heuristic summary',
  RcodeCompactionSummaryModel: 'Model summary',
  RcodeCompactionSummaryTimeout: 'Summary timeout',
  RcodeCompactionSummaryMaxTokens: 'Summary max tokens',
  RcodeCompactionSummaryInputBytes: 'Summary input bytes',
  RcodeMaxWallTime: 'Maximum turn duration',
  RcodeMaxWallTimeDesc: 'Maximum turn duration description',
  RcodeStreamIdleTimeout: 'Stream idle timeout',
  RcodeStreamIdleTimeoutDesc: 'Stream idle timeout description',
  RcodeToolStorm: 'Tool storm',
  RcodeToolStormDesc: 'Tool storm description',
  RcodeToolStormLimits: 'Tool storm limits',
  RcodeToolStormLimitsDesc: 'Tool storm limits description',
  RcodeToolStormWindowSize: 'Tool storm window',
  RcodeToolStormThreshold: 'Tool storm threshold',
  RcodeToolOutputLimits: 'Tool output limits',
  RcodeToolOutputLimitsDesc: 'Tool output limits description',
  RcodeToolOutputMaxLines: 'Tool output max lines',
  RcodeToolOutputMaxBytes: 'Tool output max bytes',
  RcodeToolArgumentRepair: 'Tool argument repair',
  RcodeToolArgumentRepairDesc: 'Tool argument repair description',
  RcodeInstructions: 'AGENTS.md instructions',
  RcodeInstructionsDesc: 'AGENTS.md instructions description',
  RcodeInstructionsDiagnostics: '1 source injected last turn',
  RcodeDiagnostics: 'Rcode diagnostics',
  RcodeDiagnosticsAdvanced: 'Detailed diagnostics',
  RcodeDiagnosticsAdvancedDesc: 'Detailed diagnostics description',
  RcodeRuntimeCapabilities: 'Runtime capabilities',
  RcodeRuntimeCapabilitiesDesc: 'Runtime capabilities description',
  RcodeRuntimeModel: 'Runtime model',
  RcodeRuntimePid: 'Runtime PID',
  RcodeDiagnosticsRefresh: 'Refresh diagnostics',
  RcodeToolDiagnostics: 'Tool diagnostics',
  RcodeToolDiagnosticsDesc: 'Tool diagnostics description',
  RcodeDiagnosticsProviders: 'Providers',
  RcodeDiagnosticsMcpServers: 'MCP servers',
  RcodeDiagnosticsSkills: 'Discovered Skills',
  RcodeDiagnosticsAttachments: 'Attachments',
  RcodeMemoryRecords: 'Memory records',
  RcodeMemoryRecordsDesc: 'Memory records description',
  RcodeMemoryEmpty: 'No memories',
  RcodeMemoryDisable: 'Disable memory',
  memoryRestore: 'Restore',
  RcodeMemoryDelete: 'Delete memory',
  RcodeMemoryDisabled: 'Disabled',
  skill: 'Skill',
  skillsLocation: 'Skill location',
  skillsLocationDesc: 'Skill location description',
  skillsPath: 'Skills path',
  skillsPathDesc: 'Skills path description',
  skillsRootUnavailable: 'Unavailable',
  skillsPermissionSources: 'Skill permission sources',
  skillsPermissionSourcesDesc: 'Skill permission sources description',
  skillsPermissionEnabledRoots: 'Enabled roots',
  skillsPermissionDisabledRoots: 'Disabled roots',
  skillsPermissionWorkspaceRoots: 'Workspace roots',
  skillsPermissionGlobalRoots: 'Global roots',
  skillsPermissionDisabledIds: 'Blocked skills',
  skillsPermissionRuntimeNote: 'Only enabled skill roots reach runtime',
  skillsScanDirs: 'Scan dirs',
  skillsScanDirsDesc: 'Scan dirs description',
  skillsActions: 'Skill actions',
  skillsActionsDesc: 'Skill actions description',
  skillsOpenRoot: 'Open root',
  skillsOpenPlugins: 'Open plugins',
  mcp: 'MCP',
  mcpSearchEnabled: 'MCP search enabled',
  mcpSearchEnabledDesc: 'MCP search description',
  mcpAdvanced: 'MCP advanced settings',
  mcpAdvancedDesc: 'MCP advanced settings description',
  mcpSearchMode: 'MCP search mode',
  mcpSearchModeDesc: 'MCP search mode description',
  mcpSearchModeAuto: 'Auto mode',
  mcpSearchModeSearch: 'Search mode',
  mcpSearchModeDirect: 'Direct mode',
  mcpSearchLimits: 'MCP search limits',
  mcpSearchLimitsDesc: 'MCP search limits description',
  mcpSearchAutoThreshold: 'Auto threshold',
  mcpSearchTopKDefault: 'Default results',
  mcpSearchTopKMax: 'Max results',
  mcpSearchMinScore: 'Minimum score',
  mcpSearchDiagnostics: 'MCP search diagnostics',
  mcpSearchDiagnosticsDesc: 'MCP search diagnostics description',
  mcpSearchStatus: 'MCP search status',
  mcpSearchActive: 'Active',
  mcpSearchInactive: 'Inactive',
  mcpSearchIndexed: 'Indexed',
  mcpSearchAdvertised: 'Advertised',
  mcpPermissionSources: 'External tool permission sources',
  mcpPermissionSourcesDesc: 'External tool permission sources description',
  mcpPermissionEnabledServers: 'Enabled servers',
  mcpPermissionDisabledServers: 'Disabled servers',
  mcpPermissionUserServers: 'All-workspace scope',
  mcpPermissionWorkspaceServers: 'Workspace scope',
  mcpPermissionVisibleServers: 'Workspace-visible only',
  mcpPermissionLocalServers: 'Local commands',
  mcpPermissionRemoteServers: 'HTTP/SSE servers',
  mcpPermissionEnvServers: 'Uses env',
  mcpPermissionHeaderServers: 'Uses headers',
  mcpPermissionParseError: 'Permission preview unavailable: {{error}}',
  mcpPermissionRuntimeNote: 'Secret values stay hidden here',
  configFilePath: 'External tool config path',
  mcpPathDesc: 'MCP JSON path description',
  mcpEditor: 'MCP editor',
  mcpEditorDesc: 'Model and API credentials do not live in this MCP file',
  mcpFileStatusReady: 'MCP config ready',
  mcpFileStatusMissing: 'MCP config missing',
  loading: 'Loading',
  mcpActions: 'MCP actions',
  mcpRuntimeHint: 'MCP runtime hint',
  mcpSave: 'Save MCP config',
  mcpReload: 'Reload MCP config',
  mcpOpenDir: 'Open MCP directory',
  permissions: 'Permissions',
  toolPermissionMode: 'Tool permission mode',
  toolPermissionModeDesc: 'Tool permission mode description',
  toolPermissionAlwaysAsk: 'Always ask',
  toolPermissionAlwaysAskDesc: 'Every tool call asks first',
  toolPermissionReadOnly: 'Read only',
  toolPermissionReadOnlyDesc: 'Read tools run automatically',
  toolPermissionSensitiveAsk: 'Sensitive operations ask',
  toolPermissionSensitiveAskDesc: 'Sensitive operations ask first',
  toolPermissionWorkspaceWrite: 'Ask for workspace writes',
  toolPermissionWorkspaceWriteDesc: 'Asks before workspace file changes',
  toolPermissionTrustedWorkspace: 'Trusted workspace',
  toolPermissionTrustedWorkspaceDesc: 'Workspace file changes run without prompts',
  toolPermissionBypass: 'Bypass mode',
  toolPermissionBypassDesc: 'Never asks and has full access',
  permissionsBehaviorHint: 'Tool confirmation and local permissions are unified',
  projectConfigTitle: 'Project MCP & Skills',
  projectConfigDescription: 'Portable project configuration',
  projectConfigSecurityHint: 'Project MCP requires digest approval',
  projectConfigWorkspaceRequired: 'Select a workspace first',
  projectConfigWorkspace: 'Project scope',
  projectConfigWorkspaceDesc: 'Fixed workspace config path',
  projectConfigStatus: 'Validation and trust',
  projectConfigStatusDesc: 'Local digest trust',
  projectConfigStatus_missing: 'File not created',
  projectConfigStatus_invalid: 'Invalid configuration',
  projectConfigStatus_valid: 'Valid configuration',
  projectConfigTrust_untrusted: 'MCP not approved',
  projectConfigTrust_trusted: 'MCP approved',
  projectConfigTrust_stale: 'Approval stale',
  projectConfigSummary: 'Project declarations',
  projectConfigSummaryDesc: 'Redacted targets',
  projectConfigMcpServers: 'Project MCP servers',
  projectConfigSkillRoots: 'Project Skill roots',
  projectConfigDisabledSkills: 'Project disabled Skills',
  projectConfigServerEnabled: 'enabled',
  projectConfigServerDisabled: 'disabled',
  projectConfigEditor: 'Project JSON',
  projectConfigEditorDesc: 'Workspace-relative paths',
  projectConfigActions: 'Project actions',
  projectConfigActionsDesc: 'Save does not approve',
  projectConfigSave: 'Save project config',
  projectConfigRefresh: 'Refresh project config',
  projectConfigOpenDir: 'Open project config dir',
  projectConfigApprove: 'Approve project MCP',
  projectConfigReapprove: 'Reapprove project MCP',
  projectConfigRevoke: 'Revoke project MCP'
}

function t(key: string): string {
  return labels[key] ?? key
}

function baseCtx(): Record<string, unknown> {
  const noop = () => undefined
  const asyncNoop = async () => undefined
  const ref = { current: null }
  const Rcode = {
    ...defaultRcodeRuntimeSettings(),
    autoStart: true,
    runtimeToken: '',
    insecure: true
  }
  return {
    t,
    tCommon: t,
    form: { claw: { skills: { extraDirs: ['/tmp/project/.agents/skills'] } } },
    Rcode,
    activeApiKey: '',
    update: noop,
    updateRcode: noop,
    updateSharedCredential: noop,
    sharedApiKey: '',
    sharedBaseUrl: '',
    showApiKey: false,
    setShowApiKey: noop,
    showRuntimeToken: false,
    setShowRuntimeToken: noop,
    portError: '',
    selectControlClass: 'select',
    openOnboardingPreview: noop,
    pickWorkspace: asyncNoop,
    resetWorkspaceToDefault: noop,
    workspacePickerError: '',
    guiUpdateInfo: null,
    checkingGuiUpdate: false,
    downloadingGuiUpdate: false,
    installingGuiUpdate: false,
    guiUpdateDownloaded: false,
    guiUpdateProgress: null,
    guiUpdateError: null,
    checkGuiUpdate: asyncNoop,
    downloadGuiUpdate: asyncNoop,
    installGuiUpdate: asyncNoop,
    logPath: '',
    logDirOpenError: '',
    setLogDirOpenError: noop,
    compactHomePath: (path: string) => path,
    expandHomePath: (path: string) => path,
    compactHomePathList: (values: readonly string[]) => values.join('\n'),
    expandHomePathList: (value: string) => value.split('\n').filter(Boolean),
    pickWriteWorkspace: asyncNoop,
    resetWriteWorkspaceToDefault: noop,
    writeWorkspacePickerError: '',
    writeInlineBaseUrlInherited: false,
    effectiveWriteInlineBaseUrl: '',
    writeInlineModelInherited: false,
    effectiveWriteInlineModel: '',
    setWriteDebugModalOpen: noop,
    loadWriteDebugEntries: asyncNoop,
    scrollToAgentSection: noop,
    agentsSectionRef: ref,
    skillSectionRef: ref,
    mcpSectionRef: ref,
    permissionsSectionRef: ref,
    skillRoots: [],
    skillRootsLoading: false,
    toggleSkillRoot: noop,
    skillNotice: null,
    openSkillRoot: asyncNoop,
    openPlugins: noop,
    mcpConfigPath: '/tmp/project/.Rcode/mcp.json',
    mcpConfigExists: true,
    mcpConfigText: '{"mcpServers":{}}',
    setMcpConfigText: noop,
    mcpLoading: false,
    mcpBusy: false,
    mcpNotice: null,
    saveMcpConfig: asyncNoop,
    loadMcpConfig: asyncNoop,
    openMcpConfigDir: asyncNoop,
    activeProjectWorkspaceRoot: '/tmp/project',
    projectConfig: {
      workspaceRoot: '/tmp/project',
      path: '/tmp/project/.Rcode/project.json',
      content: '{"version":1}',
      exists: true,
      status: 'valid',
      trust: 'untrusted',
      digest: 'a'.repeat(64),
      serverSummaries: [{ id: 'local', transport: 'stdio', target: 'node', enabled: true }],
      skillRootCount: 1,
      disabledSkillCount: 2
    },
    projectConfigText: '{"version":1}',
    setProjectConfigText: noop,
    projectConfigLoading: false,
    projectConfigBusy: false,
    projectConfigNotice: null,
    loadProjectConfig: asyncNoop,
    saveProjectConfig: asyncNoop,
    setProjectConfigTrust: asyncNoop,
    openProjectConfigDir: asyncNoop,
    runtimeInfo: null,
    toolDiagnostics: null,
    memoryRecords: [],
    runtimeDiagnosticsBusy: false,
    runtimeDiagnosticsNotice: null,
    refreshRcodeDiagnostics: asyncNoop,
    disableMemoryRecord: asyncNoop,
    deleteMemoryRecord: asyncNoop,
    pickClawWorkspace: asyncNoop,
    resetClawWorkspaceToDefault: noop,
    clawWorkspacePickerError: '',
    splitSettingsList: (value: string) => value.split('\n').filter(Boolean),
    listSettingsText: (value: string[]) => value.join('\n')
  }
}

describe('AgentsSettingsSection Rcode diagnostics smoke', () => {
  it('builds a single patch when adding and selecting a model provider', () => {
    const provider = defaultModelProviderSettings()
    const customProvider = {
      id: 'custom-provider-2',
      name: 'Custom Provider',
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'responses',
      models: [],
      modelProfiles: {}
    } satisfies ModelProviderProfileV1

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, customProvider],
      Rcode: { providerId: customProvider.id }
    })

    expect(patch.provider?.providers).toEqual([...provider.providers, customProvider])
    expect(patch.agents?.Rcode?.providerId).toBe(customProvider.id)
    expect(patch.agents?.Rcode?.apiKey).toBe('')
    expect(patch.agents?.Rcode?.baseUrl).toBe('')
  })

  it('builds a single patch when removing the active model provider', () => {
    const provider = defaultModelProviderSettings()

    const patch = modelProvidersSettingsPatch({
      provider: {
        ...provider,
        providers: [
          ...provider.providers,
          {
            id: 'custom-provider-2',
            name: 'Custom Provider',
            apiKey: '',
            baseUrl: 'https://api.example.com/v1',
            endpointFormat: 'responses',
            models: [],
            modelProfiles: {}
          }
        ]
      },
      providers: provider.providers,
      Rcode: { providerId: DEFAULT_MODEL_PROVIDER_ID }
    })

    expect(patch.provider?.providers).toEqual(provider.providers)
    expect(patch.agents?.Rcode?.providerId).toBe(DEFAULT_MODEL_PROVIDER_ID)
    expect(patch.agents?.Rcode?.apiKey).toBe('')
    expect(patch.agents?.Rcode?.baseUrl).toBe('')
  })

  it('builds a single patch when adding a preset model provider', () => {
    const provider = defaultModelProviderSettings()
    const xiaomi = getModelProviderPreset('xiaomi')
    expect(xiaomi).not.toBeNull()
    const xiaomiProvider = modelProviderPresetProfile(xiaomi!)

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, xiaomiProvider],
      Rcode: {
        providerId: xiaomiProvider.id,
        model: xiaomiProvider.models[0]
      }
    })

    expect(patch.provider?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'xiaomi',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        endpointFormat: 'chat_completions',
        models: expect.arrayContaining(['mimo-v2.5'])
      })
    ]))
    expect(patch.agents?.Rcode).toEqual(expect.objectContaining({
      providerId: 'xiaomi',
      model: xiaomiProvider.models[0]
    }))
  })

  it('defaults MiniMax media generation when adding a configured MiniMax provider', () => {
    const provider = defaultModelProviderSettings()
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxProvider = modelProviderPresetProfile(minimax!, 'sk-minimax')

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, minimaxProvider],
      currentRcode: defaultRcodeRuntimeSettings(),
      Rcode: {
        providerId: minimaxProvider.id,
        model: minimaxProvider.models[0]
      }
    })

    expect(patch.agents?.Rcode).toEqual(expect.objectContaining({
      providerId: 'minimax',
      model: minimaxProvider.models[0],
      textToSpeech: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        model: 'speech-2.8-hd'
      }),
      musicGeneration: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        model: 'music-2.6'
      }),
      videoGeneration: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        model: 'MiniMax-Hailuo-2.3'
      })
    }))
  })

  it('renders custom model provider id as editable', () => {
    const provider = defaultModelProviderSettings()
    const customProvider = {
      id: 'custom-provider-2',
      name: 'Custom Provider',
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'messages',
      models: [],
      modelProfiles: {}
    } satisfies ModelProviderProfileV1
    const html = renderToStaticMarkup(createElement(ProvidersSettingsSection, {
      ctx: {
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, customProvider]
        },
        Rcode: {
          ...defaultRcodeRuntimeSettings(),
          providerId: customProvider.id
        }
      }
    }))
    const providerIdInput = html.match(/<input[^>]+value="custom-provider-2"[^>]*>/)?.[0]

    expect(providerIdInput).toBeTruthy()
    expect(providerIdInput).not.toContain('readOnly')
    expect(providerIdInput).not.toContain('readonly')
    expect(html).toContain('Endpoint format')
    expect(html).toContain('<option value="messages" selected="">/v1/messages (anthropic)</option>')
    expect(html).toContain('<option value="custom_endpoint">Custom full endpoint</option>')
    expect(html).toContain('Enter provider API key')
    expect(html).not.toContain('Inherit API key')
    expect(html).toContain('Add provider')
    expect(html).toContain('Test connection')
    expect(html).toContain('Fetch from API')
    expect(html).toContain('Danger zone')
    expect(html).toContain('In use')
    expect(html).toContain('No API key')
  })

  it('renders retry status codes without spaces and explains comma separation before retry fields', () => {
    const provider = defaultModelProviderSettings()
    const customProvider = {
      id: 'retry-provider',
      name: 'Retry Provider',
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'chat_completions',
      retry: {
        maxAttempts: 3,
        initialDelayMs: 3000,
        httpStatusCodes: [429, 503]
      },
      models: ['retry-model'],
      modelProfiles: {}
    } satisfies ModelProviderProfileV1
    const html = renderToStaticMarkup(createElement(ProvidersSettingsSection, {
      ctx: {
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, customProvider]
        },
        Rcode: {
          ...defaultRcodeRuntimeSettings(),
          providerId: customProvider.id
        }
      }
    }))

    expect(html).toContain('Failure retry')
    expect(html).toContain('Retry HTTP status codes')
    expect(html).toContain('value="429,503"')
    expect(html).not.toContain('value="429, 503"')
    expect(html).toContain('Separate multiple status codes with commas, for example 429,503.')
    expect(html.indexOf('Separate multiple status codes with commas, for example 429,503.'))
      .toBeLessThan(html.indexOf('Retry attempts'))
  })

  it('locks preset and default provider ids and shows the danger zone only for removable providers', () => {
    const provider = defaultModelProviderSettings()
    const xiaomi = getModelProviderPreset('xiaomi')
    expect(xiaomi).not.toBeNull()
    const html = renderToStaticMarkup(createElement(ProvidersSettingsSection, {
      ctx: {
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, modelProviderPresetProfile(xiaomi!)]
        },
        Rcode: {
          ...defaultRcodeRuntimeSettings(),
          providerId: 'xiaomi'
        }
      }
    }))
    const providerIdInput = html.match(/<input[^>]+value="xiaomi"[^>]*>/)?.[0]

    expect(providerIdInput).toBeTruthy()
    expect(providerIdInput?.toLowerCase()).toContain('readonly')
    expect(html).toContain('Provider ID locked')
    expect(html).toContain('Danger zone')
  })

  it('hides the danger zone for the default provider', () => {
    const html = renderToStaticMarkup(createElement(ProvidersSettingsSection, {
      ctx: {
        ...baseCtx(),
        provider: defaultModelProviderSettings(),
        Rcode: defaultRcodeRuntimeSettings()
      }
    }))

    expect(html).not.toContain('Danger zone')
    expect(html).toContain('Test connection')
  })

  it('keeps advanced agent controls behind collapsed disclosures', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Assistant advanced settings')
    expect(html).toContain('Storage, model context, and tool guards')
    expect(html).toContain('Maximum turn duration')
    expect(html).toContain('value="86400000"')
    expect(html).toContain('MCP advanced settings')
    expect(html).not.toContain('<details open')
  })

  it('does not render image generation settings inside the agent section', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).not.toContain('imageGen')
  })

  it('renders unified permission controls with bypass as the default mode', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Permissions')
    expect(html).toContain('Tool confirmation and local permissions are unified')
    expect(html).toContain('Tool permission mode')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('Every tool call asks first')
    expect(html).toContain('Read tools run automatically')
    expect(html).toContain('Sensitive operations ask first')
    expect(html).toContain('Asks before workspace file changes')
    expect(html).toContain('Workspace file changes run without prompts')
    expect(html).toContain('Never asks and has full access')
    expect(html).toContain('lucide-hand')
    expect(html).toContain('lucide-eye')
    expect(html).toContain('lucide-shield-question')
    expect(html).toContain('lucide-folder-pen')
    expect(html).toContain('lucide-shield-check')
    expect(html).toContain('lucide-lock-keyhole-open')
    expect(html).not.toContain('Approval policy')
    expect(html).not.toContain('Sandbox mode')
  })

  it('renders pure JSONL as a selectable storage backend', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Storage backend')
    expect(html).toContain('<option value="hybrid"')
    expect(html).toContain('Hybrid storage')
    expect(html).toContain('<option value="file"')
    expect(html).toContain('Pure JSONL file storage')
  })

  it('shows DeepSeek V4 model compaction thresholds from the model profile', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Current model context policy')
    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('Built-in model config')
    expect(html).toContain('1,000,000')
    expect(html).toContain('980,000')
    expect(html).toContain('990,000')
    expect(html).toContain('Fallback compaction thresholds')
  })

  it('renders MCP, Skill, web, attachment, and memory diagnostics', () => {
    const ctx = {
      ...baseCtx(),
      runtimeInfo: {
        pid: 123,
        capabilities: {
          model: { id: 'deepseek-chat' },
          mcp: { status: 'available', configuredServers: 2, connectedServers: 2 },
          web: { status: 'available', provider: 'brave-search' },
          instructions: { status: 'available', lastSourceCount: 1 },
          skills: { status: 'available' },
          subagents: { status: 'available' },
          attachments: { status: 'available' },
          memory: { status: 'available' }
        }
      },
      toolDiagnostics: {
        providers: [{ id: 'builtin' }, { id: 'mcp' }, { id: 'web' }, { id: 'memory' }],
        mcpServers: [{ id: 'github' }],
        instructions: { lastInjection: { sources: [{ scope: 'workspace', path: '/tmp/project/AGENTS.md' }] } },
        skills: { skills: [{ id: 'skill_docs' }] },
        attachments: { count: 1 }
      },
      memoryRecords: [
        {
          id: 'mem_1',
          content: 'Prefer pnpm for this workspace',
          scope: 'workspace',
          tags: ['tooling'],
          disabledAt: '2026-06-21T01:00:00.000Z'
        }
      ]
    }

    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('Rcode diagnostics')
    expect(html).toContain('MCP')
    expect(html).toContain('available')
    expect(html).toContain('2/2')
    expect(html).toContain('brave-search')
    expect(html).toContain('Instructions')
    expect(html).toContain('AGENTS.md instructions')
    expect(html).toContain('Providers')
    expect(html).toContain('MCP servers')
    expect(html).toContain('Discovered Skills')
    expect(html).toContain('Prefer pnpm for this workspace')
    expect(html).toContain('mem_1')
    expect(html).toContain('aria-label="Restore"')
    expect(html).not.toContain('aria-label="Disable memory"')
    expect(html).toContain('Delete memory')
  })

  it('describes MCP config as an external-tool JSON file instead of model credentials', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('External tool config path')
    expect(html).toContain('/tmp/project/.Rcode/mcp.json')
    expect(html).toContain('Model and API credentials do not live in this MCP file')
    expect(html).not.toContain('DeepSeek auth')
    expect(html).not.toContain('Base URL are stored in this file')
    expect(html).not.toContain('config.toml')
  })

  it('renders valid untrusted project config with redacted summaries and approval actions', () => {
    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('Project MCP &amp; Skills')
    expect(html).toContain('/tmp/project/.Rcode/project.json')
    expect(html).toContain('Valid configuration')
    expect(html).toContain('MCP not approved')
    expect(html).toContain('sha256:aaaaaaaaaaaa')
    expect(html).toContain('local')
    expect(html).toContain('node')
    expect(html).toContain('Save project config')
    expect(html).toContain('Approve project MCP')
    expect(html).not.toContain('GITHUB_TOKEN')
  })

  it('renders trusted, stale, invalid, and missing-workspace project states', () => {
    const trusted = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        projectConfig: { ...(baseCtx().projectConfig as object), trust: 'trusted' }
      }
    }))
    expect(trusted).toContain('MCP approved')
    expect(trusted).toContain('Revoke project MCP')

    const stale = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        projectConfig: { ...(baseCtx().projectConfig as object), trust: 'stale' }
      }
    }))
    expect(stale).toContain('Approval stale')
    expect(stale).toContain('Reapprove project MCP')
    expect(stale).toContain('Revoke project MCP')

    const staleInvalid = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        projectConfig: {
          ...(baseCtx().projectConfig as object),
          status: 'invalid',
          trust: 'stale',
          message: 'Project config is invalid'
        }
      }
    }))
    expect(staleInvalid).toContain('Revoke project MCP')
    expect(staleInvalid).toMatch(/Reapprove project MCP<\/button>/)
    expect(staleInvalid).toContain('disabled=""')

    const invalid = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: {
        ...baseCtx(),
        projectConfig: {
          ...(baseCtx().projectConfig as object),
          status: 'invalid',
          trust: 'untrusted',
          message: 'Skill root escapes the workspace'
        }
      }
    }))
    expect(invalid).toContain('Invalid configuration')
    expect(invalid).toContain('Skill root escapes the workspace')
    expect(invalid).toMatch(/Approve project MCP<\/button>/)
    expect(invalid).toContain('disabled=""')

    const missingWorkspace = renderToStaticMarkup(createElement(AgentsSettingsSection, {
      ctx: { ...baseCtx(), activeProjectWorkspaceRoot: '' }
    }))
    expect(missingWorkspace).toContain('Select a workspace first')
    expect(missingWorkspace).not.toContain('Save project config')
  })

  it('renders Skill and MCP permission-source previews without exposing secret values', () => {
    const ctx = {
      ...baseCtx(),
      form: {
        claw: { skills: { extraDirs: ['/tmp/project/.agents/skills'] } },
        disabledSkillIds: ['legacy-skill']
      },
      skillRoots: [
        {
          id: 'workspace-agents',
          disableKey: 'workspace-agents',
          path: '/repo/.agents/skills',
          scope: 'project',
          source: 'common',
          exists: true,
          enabled: true,
          skillCount: 2
        },
        {
          id: 'global-Rcode',
          disableKey: 'global-Rcode',
          path: '/home/me/.Rcode/skills',
          scope: 'global',
          source: 'common',
          exists: true,
          enabled: true,
          skillCount: 1
        },
        {
          id: 'disabled-extra',
          disableKey: 'disabled-extra',
          path: '/tmp/disabled-skills',
          scope: 'global',
          source: 'extra',
          exists: true,
          enabled: false,
          skillCount: 1
        }
      ],
      mcpConfigText: JSON.stringify({
        servers: {
          github: {
            transport: 'stdio',
            command: 'npx',
            env: { GITHUB_TOKEN: '' },
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/repo']
          },
          docs: {
            transport: 'streamable-http',
            url: 'https://mcp.example.com',
            workspaceRoots: ['/repo/docs'],
            headers: { Authorization: '' },
            trustScope: 'user'
          },
          disabled: {
            transport: 'sse',
            url: 'https://disabled.example.com',
            enabled: false
          }
        }
      })
    }

    const html = renderToStaticMarkup(createElement(AgentsSettingsSection, { ctx }))

    expect(html).toContain('Skill permission sources')
    expect(html).toContain('Enabled roots')
    expect(html).toContain('Disabled roots')
    expect(html).toContain('Workspace roots')
    expect(html).toContain('Global roots')
    expect(html).toContain('Blocked skills')
    expect(html).toContain('External tool permission sources')
    expect(html).toContain('Enabled servers')
    expect(html).toContain('Disabled servers')
    expect(html).toContain('All-workspace scope')
    expect(html).toContain('Workspace scope')
    expect(html).toContain('Workspace-visible only')
    expect(html).toContain('Local commands')
    expect(html).toContain('HTTP/SSE servers')
    expect(html).toContain('Uses env')
    expect(html).toContain('Uses headers')
    expect(html).toContain('Secret values stay hidden here')
  })

  it('defines the LiteLLM provider preset for the Providers menu', () => {
    const litellm = getModelProviderPreset('litellm')
    expect(litellm && modelProviderPresetProfile(litellm)).toMatchObject({
      id: 'litellm',
      name: 'LiteLLM',
      baseUrl: 'http://localhost:4000',
      endpointFormat: 'chat_completions'
    })
  })

  it('defines OpenAI-compatible provider presets for the Providers menu', () => {
    const expected = [
      ['longcat', 'LongCat', 'https://api.longcat.chat/openai'],
      ['zhipu-coding-plan', 'Zhipu Coding Plan', 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', 'custom_endpoint'],
      ['zai-coding-plan', 'Z.ai Coding Plan', 'https://api.z.ai/api/coding/paas/v4/chat/completions', 'custom_endpoint'],
      ['kimi-code', 'Kimi Code', 'https://api.kimi.com/coding/v1'],
      ['moonshot-cn', 'Moonshot CN', 'https://api.moonshot.cn/v1'],
      ['moonshot-global', 'Moonshot Global', 'https://api.moonshot.ai/v1']
    ] as const

    for (const [id, name, baseUrl, endpointFormat = 'chat_completions'] of expected) {
      const preset = getModelProviderPreset(id)
      expect(preset && modelProviderPresetProfile(preset)).toMatchObject({
        id,
        name,
        baseUrl,
        endpointFormat
      })
    }
  })
})
