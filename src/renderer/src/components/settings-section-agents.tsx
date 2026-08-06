import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type {
  AppSettingsV1,
  RcodeToolPermissionMode,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_RCODE_DATA_DIR,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  MIN_RCODE_LOCAL_PORT,
  WRITE_INLINE_COMPLETION_MODEL_IDS,
  defaultModelProviderSettings,
  isRcodeRuntimeInsecure,
  RcodeToolPermissionModeFromSettings,
  RcodeToolPermissionModeSettings
} from '@shared/app-settings'
import type { GuiUpdateChannel } from '@shared/gui-update'
import type {
  ComputerUsePermissionKind,
  ComputerUsePermissions,
  ComputerUsePermissionState,
  SkillRootListItem
} from '@shared/Rcode-gui-api'
import {
  Ban,
  Check,
  Eye,
  FolderOpen,
  FolderPen,
  Hand,
  Loader2,
  LockKeyholeOpen,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShieldQuestion,
  Trash2
} from 'lucide-react'
import { GuiUpdateControl } from './settings-gui-update'
import { McpServersEditor } from './mcp/McpServersEditor'
import {
  AdvancedSettingsDisclosure,
  InlineNoticeView,
  ModelSelect,
  SecretInput,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'
import { formatCompactNumber } from '../hooks/use-thread-usage'
import {
  compactList,
  EMPTY_TOKEN_ECONOMY_SAVINGS_STATE,
  loadTokenEconomySavingsSummary,
  modelContextProfileSummary,
  skillRootShortLabel,
  statusPill,
  summarizeMcpPermissionSources,
  summarizeSkillPermissionSources,
  type TokenEconomySavingsState
} from './settings-section-agents-utils'
import { ComputerUseSettingsPanel, DesignQualitySettingsPanel } from './settings-section-agent-panels'

export { modelProvidersSettingsPatch } from './settings-section-providers'

const TOOL_PERMISSION_OPTIONS: Array<{
  value: RcodeToolPermissionMode
  labelKey: string
  descriptionKey: string
  Icon: typeof Hand
  iconClass: string
}> = [
  {
    value: 'always-ask',
    labelKey: 'toolPermissionAlwaysAsk',
    descriptionKey: 'toolPermissionAlwaysAskDesc',
    Icon: Hand,
    iconClass: 'border-sky-400/30 bg-sky-500/10 text-sky-700 dark:text-sky-200'
  },
  {
    value: 'read-only',
    labelKey: 'toolPermissionReadOnly',
    descriptionKey: 'toolPermissionReadOnlyDesc',
    Icon: Eye,
    iconClass: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  },
  {
    value: 'sensitive-ask',
    labelKey: 'toolPermissionSensitiveAsk',
    descriptionKey: 'toolPermissionSensitiveAskDesc',
    Icon: ShieldQuestion,
    iconClass: 'border-amber-400/35 bg-amber-500/10 text-amber-700 dark:text-amber-200'
  },
  {
    value: 'workspace-write',
    labelKey: 'toolPermissionWorkspaceWrite',
    descriptionKey: 'toolPermissionWorkspaceWriteDesc',
    Icon: FolderPen,
    iconClass: 'border-indigo-400/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200'
  },
  {
    value: 'trusted-workspace',
    labelKey: 'toolPermissionTrustedWorkspace',
    descriptionKey: 'toolPermissionTrustedWorkspaceDesc',
    Icon: ShieldCheck,
    iconClass: 'border-teal-400/30 bg-teal-500/10 text-teal-700 dark:text-teal-200'
  },
  {
    value: 'bypass',
    labelKey: 'toolPermissionBypass',
    descriptionKey: 'toolPermissionBypassDesc',
    Icon: LockKeyholeOpen,
    iconClass: 'border-orange-400/35 bg-orange-500/10 text-orange-700 dark:text-orange-200'
  }
]

export function AgentsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
    form,
    Rcode,
    update,
    updateRcode,
    showRuntimeToken,
    setShowRuntimeToken,
    portError,
    selectControlClass,
    openOnboardingPreview,
    pickWorkspace,
    resetWorkspaceToDefault,
    workspacePickerError,
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    compactHomePath,
    expandHomePath,
    compactHomePathList,
    expandHomePathList,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineBaseUrlInherited,
    effectiveWriteInlineBaseUrl,
    writeInlineModelInherited,
    effectiveWriteInlineModel,
    setWriteDebugModalOpen,
    loadWriteDebugEntries,
    scrollToAgentSection,
    agentsSectionRef,
    skillSectionRef,
    mcpSectionRef,
    permissionsSectionRef,
    skillRoots,
    skillRootsLoading,
    toggleSkillRoot,
    skillNotice,
    openSkillRoot,
    openPlugins,
    mcpConfigPath,
    mcpConfigExists,
    mcpConfigText,
    setMcpConfigText,
    mcpLoading,
    mcpBusy,
    mcpNotice,
    saveMcpConfig,
    loadMcpConfig,
    openMcpConfigDir,
    activeProjectWorkspaceRoot,
    projectConfig,
    projectConfigText,
    setProjectConfigText,
    projectConfigLoading,
    projectConfigBusy,
    projectConfigNotice,
    loadProjectConfig,
    saveProjectConfig,
    setProjectConfigTrust,
    openProjectConfigDir,
    runtimeInfo,
    toolDiagnostics,
    memoryRecords,
    runtimeDiagnosticsBusy,
    runtimeDiagnosticsNotice,
    refreshRcodeDiagnostics,
    disableMemoryRecord,
    restoreMemoryRecord,
    deleteMemoryRecord,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  } = ctx
  const mcpSearch = Rcode.mcpSearch ?? {
    enabled: false,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
  const tokenEconomyDefaults = {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: {
      maxToolResultLines: 320,
      maxToolResultBytes: 32768,
      maxToolResultTokens: 8000,
      maxToolArgumentStringBytes: 8192,
      maxToolArgumentStringTokens: 2000,
      maxArrayItems: 80
    }
  }
  const tokenEconomy = {
    ...tokenEconomyDefaults,
    ...(Rcode.tokenEconomy ?? {}),
    enabled: Rcode.tokenEconomy?.enabled ?? Rcode.tokenEconomyMode ?? false,
    historyHygiene: {
      ...tokenEconomyDefaults.historyHygiene,
      ...(Rcode.tokenEconomy?.historyHygiene ?? {})
    }
  }
  const [tokenEconomySavingsState, setTokenEconomySavingsState] =
    useState<TokenEconomySavingsState>(EMPTY_TOKEN_ECONOMY_SAVINGS_STATE)
  const [mcpRawMode, setMcpRawMode] = useState(false)
  const skillPermissionSummary = summarizeSkillPermissionSources(skillRoots, form.disabledSkillIds)
  const mcpPermissionSummary = useMemo(
    () => summarizeMcpPermissionSources(mcpConfigText),
    [mcpConfigText]
  )
  useEffect(() => {
    let cancelled = false
    if (!tokenEconomy.enabled) {
      setTokenEconomySavingsState(EMPTY_TOKEN_ECONOMY_SAVINGS_STATE)
      return
    }
    setTokenEconomySavingsState((current) => ({ ...current, loading: true }))
    void loadTokenEconomySavingsSummary()
      .then((summary) => {
        if (!cancelled) setTokenEconomySavingsState({ loading: false, loaded: true, summary })
      })
      .catch(() => {
        if (!cancelled) setTokenEconomySavingsState({ loading: false, loaded: true, summary: null })
      })
    return () => {
      cancelled = true
    }
  }, [tokenEconomy.enabled])
  const tokenEconomySavings = tokenEconomySavingsState.summary
  const storage = Rcode.storage ?? {
    backend: 'hybrid',
    sqlitePath: ''
  }
  const contextCompaction = Rcode.contextCompaction ?? {
    defaultSoftThreshold: 16000,
    defaultHardThreshold: 24000,
    summaryMode: 'model',
    summaryTimeoutMs: 15000,
    summaryMaxTokens: 1200,
    summaryInputMaxBytes: 98304
  }
  const modelContext = modelContextProfileSummary({
    model: Rcode.model,
    fallbackSoftThreshold: contextCompaction.defaultSoftThreshold,
    fallbackHardThreshold: contextCompaction.defaultHardThreshold
  })
  const runtimeTuning = Rcode.runtimeTuning ?? {
    maxWallTimeMs: 86400000,
    streamIdleTimeoutMs: 45000,
    toolStorm: {
      enabled: true,
      windowSize: 8,
      threshold: 3
    },
    toolArgumentRepair: {
      maxStringBytes: 524288
    }
  }
  const toolOutputLimits = Rcode.toolOutputLimits ?? {
    maxLines: DEFAULT_TOOL_OUTPUT_MAX_LINES,
    maxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES
  }
  const updateMcpSearch = (patch: Record<string, unknown>): void => {
    updateRcode({
      mcpSearch: {
        ...mcpSearch,
        ...patch
      }
    })
  }
  const updateTokenEconomy = (patch: Record<string, unknown>): void => {
    const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : tokenEconomy.enabled
    updateRcode({
      tokenEconomyMode: enabled,
      tokenEconomy: {
        ...tokenEconomy,
        ...patch,
        enabled
      }
    })
  }
  const updateHistoryHygiene = (patch: Record<string, unknown>): void => {
    updateTokenEconomy({
      historyHygiene: {
        ...tokenEconomy.historyHygiene,
        ...patch
      }
    })
  }
  const updateStorage = (patch: Record<string, unknown>): void => {
    updateRcode({
      storage: {
        ...storage,
        ...patch
      }
    })
  }
  const updateContextCompaction = (patch: Record<string, unknown>): void => {
    updateRcode({
      contextCompaction: {
        ...contextCompaction,
        ...patch
      }
    })
  }
  const updateRuntimeTuning = (patch: Record<string, unknown>): void => {
    updateRcode({
      runtimeTuning: {
        ...runtimeTuning,
        ...patch
      }
    })
  }
  const updateToolOutputLimits = (patch: Record<string, unknown>): void => {
    updateRcode({
      toolOutputLimits: {
        ...toolOutputLimits,
        ...patch
      }
    })
  }
  const updateToolStorm = (patch: Record<string, unknown>): void => {
    updateRuntimeTuning({
      toolStorm: {
        ...runtimeTuning.toolStorm,
        ...patch
      }
    })
  }
  const updateToolArgumentRepair = (patch: Record<string, unknown>): void => {
    updateRuntimeTuning({
      toolArgumentRepair: {
        ...runtimeTuning.toolArgumentRepair,
        ...patch
      }
    })
  }
  const provider = form.provider ?? defaultModelProviderSettings()
  const modelProviders = provider.providers as ModelProviderProfileV1[]
  const computerUse = Rcode.computerUse ?? {
    enabled: false,
    mode: 'auto' as const,
    maxImageDimension: 1280,
    maxActionsPerTurn: 40
  }
  const instructions = Rcode.instructions ?? {
    enabled: true
  }
  const updateInstructions = (patch: Record<string, unknown>): void => {
    updateRcode({
      instructions: {
        ...instructions,
        ...patch
      }
    })
  }
  const updateComputerUse = (patch: Record<string, unknown>): void => {
    updateRcode({
      computerUse: {
        ...computerUse,
        ...patch
      }
    })
  }
  const quality = Rcode.quality ?? {
    enabled: true,
    strictness: 'standard' as const,
    ignoreRules: [],
    ignoreFiles: [],
    maxFindings: 12
  }
  const updateQuality = (patch: Record<string, unknown>): void => {
    updateRcode({
      quality: {
        ...quality,
        ...patch
      }
    })
  }
  const activeProviderId = Rcode.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
  const activeProvider = modelProviders.find((item) => item.id === activeProviderId) ?? modelProviders[0]
  const activeProviderModels = activeProvider?.models ?? []
  const promptOptimization = {
    enabled: false,
    providerId: '',
    model: '',
    prompt: '',
    timeoutMs: 60000,
    ...(Rcode.promptOptimization ?? {})
  }
  const promptOptimizationProviderId = promptOptimization.providerId?.trim() || activeProviderId
  const promptOptimizationProvider =
    modelProviders.find((item) => item.id === promptOptimizationProviderId) ?? activeProvider
  const promptOptimizationModels = promptOptimizationProvider?.models ?? []
  const promptOptimizationDefaultModel = (() => {
    const providerId = promptOptimizationProvider?.id ?? promptOptimizationProviderId
    const smallModel = Rcode.smallModel?.trim() ?? ''
    const smallProviderId = Rcode.smallModelProviderId?.trim() || activeProviderId
    if (smallModel && smallProviderId === providerId) return smallModel
    const mainModel = Rcode.model?.trim() ?? ''
    if (mainModel && activeProviderId === providerId) return mainModel
    return promptOptimizationModels[0] ?? mainModel
  })()
  const updatePromptOptimization = (patch: Record<string, unknown>): void => {
    updateRcode({
      promptOptimization: {
        ...promptOptimization,
        ...patch
      }
    })
  }
  const selectRcodeProvider = (providerId: string): void => {
    const nextProvider = modelProviders.find((item) => item.id === providerId) ?? activeProvider
    const nextModel = nextProvider?.models.includes(Rcode.model)
      ? Rcode.model
      : nextProvider?.models[0] ?? Rcode.model
    updateRcode({ providerId, model: nextModel, apiKey: '', baseUrl: '' })
  }
  const toolPermissionMode = RcodeToolPermissionModeFromSettings(Rcode)

  return (
            <>
              <div className="mb-6 flex flex-wrap gap-2">
                <SectionJumpButton label={t('agentsQuickBase')} onClick={() => scrollToAgentSection('agents')} />
                <SectionJumpButton label={t('agentsQuickSkill')} onClick={() => scrollToAgentSection('skill')} />
                <SectionJumpButton label={t('agentsQuickMcp')} onClick={() => scrollToAgentSection('mcp')} />
                <SectionJumpButton
                  label={t('agentsQuickPermissions')}
                  onClick={() => scrollToAgentSection('permissions')}
                />
              </div>

              <div ref={agentsSectionRef}>
                <SettingsCard title={t('agents')}>
                  <SettingRow
                    title={t('autoStart')}
                    description={t('autoStartDesc')}
                    control={
                      <Toggle
                        checked={Rcode.autoStart}
                        onChange={(v) => updateRcode({ autoStart: v })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('RcodeProvider')}
                    description={t('RcodeProviderSelectDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={activeProvider?.id ?? DEFAULT_MODEL_PROVIDER_ID}
                        onChange={(e) => selectRcodeProvider(e.target.value)}
                      >
                        {modelProviders.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('RcodeModel')}
                    description={t('RcodeModelDesc')}
                    control={
                      <ModelSelect
                        value={Rcode.model}
                        options={activeProviderModels}
                        optionLabel={(model) =>
                          model === activeProviderModels[0]
                            ? t('modelSelectDefaultSuffix', { model })
                            : model}
                        allowCustom
                        customLabel={t('modelSelectCustomOption')}
                        customPlaceholder={t('modelSelectCustomPlaceholder')}
                        selectClassName={selectControlClass}
                        onChange={(model) => {
                          const next = model.trim()
                          updateRcode({ model: next || (activeProviderModels[0] ?? Rcode.model) })
                        }}
                      />
                    }
                  />
                  <SettingRow
                    title={t('codePromptPrefix')}
                    description={t('codePromptPrefixDesc')}
                    wideControl
                    control={
                      <textarea
                        value={form?.codePromptPrefix ?? ''}
                        onChange={(e) => update({ codePromptPrefix: e.target.value })}
                        placeholder={t('codePromptPrefixPlaceholder')}
                        className="min-h-[110px] w-full resize-y rounded-xl border border-ds-border bg-ds-main/60 px-3 py-3 text-[14px] leading-6 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
                      />
                    }
                  />
                  <SettingRow
                    title={t('RcodePromptOptimization')}
                    description={t('RcodePromptOptimizationDesc')}
                    control={
                      <Toggle
                        checked={promptOptimization.enabled}
                        onChange={(enabled) => updatePromptOptimization({ enabled })}
                      />
                    }
                  />
                  {promptOptimization.enabled ? (
                    <SettingRow
                      title={t('RcodePromptOptimizationConfig')}
                      description={t('RcodePromptOptimizationConfigDesc')}
                      wideControl
                      control={
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_minmax(120px,160px)]">
                          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                            {t('RcodePromptOptimizationProvider')}
                            <select
                              className={selectControlClass}
                              value={promptOptimization.providerId?.trim() || ''}
                              onChange={(e) => {
                                const providerId = e.target.value
                                const nextProvider = modelProviders.find((item) => item.id === providerId) ?? activeProvider
                                const keepModel = nextProvider?.models.includes(promptOptimization.model) === true
                                updatePromptOptimization({
                                  providerId,
                                  model: keepModel ? promptOptimization.model : ''
                                })
                              }}
                            >
                              <option value="">{t('modelSelectDefaultSuffix', {
                                model: activeProvider?.name ?? DEFAULT_MODEL_PROVIDER_ID
                              })}</option>
                              {modelProviders.map((item) => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                            {t('RcodePromptOptimizationModel')}
                            <ModelSelect
                              value={promptOptimization.model}
                              options={promptOptimizationModels}
                              defaultLabel={t('RcodePromptOptimizationModelDefault', {
                                model: promptOptimizationDefaultModel
                              })}
                              optionLabel={(model) => model}
                              allowCustom
                              customLabel={t('modelSelectCustomOption')}
                              customPlaceholder={t('modelSelectCustomPlaceholder')}
                              selectClassName={selectControlClass}
                              onChange={(model) => updatePromptOptimization({ model: model.trim() })}
                            />
                          </label>
                          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                            {t('RcodePromptOptimizationTimeout')}
                            <input
                              type="number"
                              min={1000}
                              max={600000}
                              step={1000}
                              className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                              value={promptOptimization.timeoutMs}
                              onChange={(e) => updatePromptOptimization({ timeoutMs: Number(e.target.value) })}
                            />
                          </label>
                          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted lg:col-span-3">
                            {t('RcodePromptOptimizationPrompt')}
                            <textarea
                              value={promptOptimization.prompt}
                              onChange={(e) => updatePromptOptimization({ prompt: e.target.value })}
                              placeholder={DEFAULT_PROMPT_OPTIMIZATION_PROMPT}
                              className="min-h-[140px] w-full resize-y rounded-xl border border-ds-border bg-ds-main/60 px-3 py-3 text-[13px] leading-6 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
                            />
                          </label>
                        </div>
                      }
                    />
                  ) : null}
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('RcodeAssistantAdvanced')}
                      description={t('RcodeAssistantAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('port')}
                    description={t('portDesc')}
                    control={
                      <div>
                        <input
                          type="number"
                          min={MIN_RCODE_LOCAL_PORT}
                          max={65535}
                          className={`w-28 rounded-xl border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:outline-none focus:ring-1 ${
                            portError
                              ? 'border-red-400 focus:ring-red-300'
                              : 'border-ds-border focus:border-accent/40 focus:ring-accent/30'
                          }`}
                          value={Rcode.port}
                          onChange={(e) => updateRcode({ port: Number(e.target.value) })}
                        />
                        {portError ? (
                          <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">{portError}</p>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeBinary')}
                    description={t('RcodeBinaryDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={t('RcodeBinaryPlaceholder')}
                        value={compactHomePath(Rcode.binaryPath)}
                        onChange={(e) => updateRcode({ binaryPath: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('RcodeDataDir')}
                    description={t('RcodeDataDirDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={DEFAULT_RCODE_DATA_DIR}
                        value={compactHomePath(Rcode.dataDir)}
                        onChange={(e) => updateRcode({ dataDir: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('runtimeToken')}
                    description={t('runtimeTokenDesc')}
                    control={
                      <SecretInput
                        value={Rcode.runtimeToken}
                        onChange={(value) => updateRcode({ runtimeToken: value })}
                        visible={showRuntimeToken}
                        onToggleVisibility={() => setShowRuntimeToken((value: boolean) => !value)}
                        showLabel={t('showSecret')}
                        hideLabel={t('hideSecret')}
                        className="md:max-w-md"
                      />
                    }
                  />
                  <SettingRow
                    title={t('RcodeInsecure')}
                    description={t('RcodeInsecureDesc')}
                    control={
                      <Toggle
                        checked={isRcodeRuntimeInsecure(Rcode)}
                        onChange={(v) => updateRcode({ insecure: v })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                  <SettingRow
                    title={t('RcodeTokenEconomy')}
                    description={t('RcodeTokenEconomyDesc')}
                    control={
                      <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
                        <Toggle
                          checked={tokenEconomy.enabled}
                          onChange={(enabled) => updateTokenEconomy({ enabled })}
                        />
                        {tokenEconomy.enabled ? (
                          <div className="max-w-full rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[12px] font-medium leading-5 text-emerald-700 dark:text-emerald-200">
                            {tokenEconomySavings ? (
                              <span>
                                {t('RcodeTokenEconomySavings', {
                                  tokens: formatCompactNumber(tokenEconomySavings.tokens)
                                })}
                              </span>
                            ) : tokenEconomySavingsState.loading ? (
                              <span>{t('RcodeTokenEconomySavingsLoading')}</span>
                            ) : (
                              <span>{t('RcodeTokenEconomySavingsEmpty')}</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeInstructions')}
                    description={t('RcodeInstructionsDesc')}
                    control={
                      <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
                        <Toggle
                          checked={instructions.enabled}
                          onChange={(enabled) => updateInstructions({ enabled })}
                        />
                        <div className="max-w-full rounded-lg border border-ds-border-muted bg-ds-main/40 px-2.5 py-1.5 text-[12px] leading-5 text-ds-muted">
                          {t('RcodeInstructionsDiagnostics', {
                            count: toolDiagnostics?.instructions?.lastInjection?.sources?.length ?? runtimeInfo?.capabilities?.instructions?.lastSourceCount ?? 0
                          })}
                        </div>
                      </div>
                    }
                  />
                </SettingsCard>
              </div>

              <div className="mt-6" ref={permissionsSectionRef}>
                <SettingsCard title={t('permissions')}>
                  <div className="px-3 py-4">
                    <InlineNoticeView notice={{ tone: 'info', message: t('permissionsBehaviorHint') }} />
                  </div>
                  <SettingRow
                    title={t('toolPermissionMode')}
                    description={t('toolPermissionModeDesc')}
                    wideControl
                    control={
                      <div
                        role="radiogroup"
                        aria-label={t('toolPermissionMode')}
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        {TOOL_PERMISSION_OPTIONS.map((option) => {
                          const selected = toolPermissionMode === option.value
                          const PermissionIcon = option.Icon
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => updateRcode(RcodeToolPermissionModeSettings(option.value))}
                              className={`min-h-[72px] rounded-lg border px-3 py-2.5 text-left transition ${
                                selected
                                  ? 'border-accent/55 bg-accent/10 text-ds-ink'
                                  : 'border-ds-border-muted bg-ds-card/70 text-ds-ink hover:bg-ds-hover/70'
                              }`}
                            >
                              <span className="flex items-start gap-2">
                                <span
                                  className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${option.iconClass}`}
                                >
                                  <PermissionIcon className="h-4 w-4" strokeWidth={1.9} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[13px] font-semibold">{t(option.labelKey)}</span>
                                  <span className="mt-1 block text-[12px] leading-snug text-ds-muted">
                                    {t(option.descriptionKey)}
                                  </span>
                                </span>
                                {selected ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>


              <ComputerUseSettingsPanel
                t={t}
                value={computerUse}
                selectControlClass={selectControlClass}
                permissionRow={<ComputerUsePermissionRow t={t} />}
                onChange={updateComputerUse}
              />

              <DesignQualitySettingsPanel
                t={t}
                value={quality}
                selectControlClass={selectControlClass}
                onChange={updateQuality}
              />

              <div className="mt-6">
                <SettingsCard title={t('projectConfigTitle')}>
                  <div className="space-y-3 px-3 py-4">
                    <InlineNoticeView notice={{ tone: 'info', message: t('projectConfigDescription') }} />
                    <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                      {t('projectConfigSecurityHint')}
                    </div>
                  </div>
                  {!activeProjectWorkspaceRoot ? (
                    <div className="px-3 pb-4">
                      <InlineNoticeView notice={{ tone: 'info', message: t('projectConfigWorkspaceRequired') }} />
                    </div>
                  ) : (
                    <>
                      <SettingRow
                        title={t('projectConfigWorkspace')}
                        description={t('projectConfigWorkspaceDesc')}
                        wideControl
                        control={
                          <div className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] text-ds-ink shadow-sm">
                            <div className="break-all">{compactHomePath(activeProjectWorkspaceRoot)}</div>
                            <div className="mt-1 break-all text-ds-muted">
                              {compactHomePath(projectConfig?.path ?? `${activeProjectWorkspaceRoot}/.Rcode/project.json`)}
                            </div>
                          </div>
                        }
                      />
                      <SettingRow
                        title={t('projectConfigStatus')}
                        description={t('projectConfigStatusDesc')}
                        wideControl
                        control={
                          <div className="flex w-full flex-col gap-2">
                            <div className="flex flex-wrap gap-2 text-[12px]">
                              <span className="rounded-full border border-ds-border bg-ds-main/70 px-2.5 py-1 font-medium text-ds-ink">
                                {projectConfigLoading
                                  ? t('loading')
                                  : t(`projectConfigStatus_${projectConfig?.status ?? 'missing'}`)}
                              </span>
                              <span className={`rounded-full border px-2.5 py-1 font-medium ${
                                projectConfig?.trust === 'trusted'
                                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                                  : projectConfig?.trust === 'stale'
                                    ? 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                                    : 'border-ds-border bg-ds-main/70 text-ds-muted'
                              }`}>
                                {t(`projectConfigTrust_${projectConfig?.trust ?? 'untrusted'}`)}
                              </span>
                              {projectConfig?.digest ? (
                                <span className="rounded-full border border-ds-border bg-ds-main/70 px-2.5 py-1 font-mono text-ds-muted">
                                  sha256:{projectConfig.digest.slice(0, 12)}
                                </span>
                              ) : null}
                            </div>
                            {projectConfig?.message ? (
                              <div className="rounded-xl border border-red-400/35 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-200">
                                {projectConfig.message}
                              </div>
                            ) : null}
                          </div>
                        }
                      />
                      <SettingRow
                        title={t('projectConfigSummary')}
                        description={t('projectConfigSummaryDesc')}
                        wideControl
                        control={
                          <div className="grid w-full gap-2 text-[12.5px] text-ds-muted sm:grid-cols-3">
                            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              {t('projectConfigMcpServers')}: <span className="font-mono text-ds-ink">{projectConfig?.serverSummaries.length ?? 0}</span>
                            </div>
                            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              {t('projectConfigSkillRoots')}: <span className="font-mono text-ds-ink">{projectConfig?.skillRootCount ?? 0}</span>
                            </div>
                            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              {t('projectConfigDisabledSkills')}: <span className="font-mono text-ds-ink">{projectConfig?.disabledSkillCount ?? 0}</span>
                            </div>
                            {projectConfig?.serverSummaries.length ? (
                              <div className="sm:col-span-3 rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                                {projectConfig.serverSummaries.map((server: { id: string; target: string; enabled: boolean }) => (
                                  <div key={server.id} className="flex min-w-0 items-center justify-between gap-3 py-0.5">
                                    <span className="font-mono text-ds-ink">{server.id}</span>
                                    <span className="min-w-0 truncate font-mono" title={server.target}>{server.target}</span>
                                    <span>{server.enabled ? t('projectConfigServerEnabled') : t('projectConfigServerDisabled')}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        }
                      />
                      <SettingRow
                        title={t('projectConfigEditor')}
                        description={t('projectConfigEditorDesc')}
                        wideControl
                        control={
                          <textarea
                            value={projectConfigText ?? ''}
                            onChange={(event) => setProjectConfigText?.(event.target.value)}
                            disabled={projectConfigLoading || projectConfigBusy}
                            spellCheck={false}
                            aria-label={t('projectConfigEditor')}
                            className="min-h-64 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[12.5px] leading-5 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
                          />
                        }
                      />
                      <SettingRow
                        title={t('projectConfigActions')}
                        description={t('projectConfigActionsDesc')}
                        wideControl
                        control={
                          <div className="flex w-full flex-col gap-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void saveProjectConfig?.()}
                                disabled={projectConfigBusy || projectConfigLoading}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                {projectConfigBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                {t('projectConfigSave')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void loadProjectConfig?.()}
                                disabled={projectConfigBusy || projectConfigLoading}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-subtle disabled:opacity-55"
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${projectConfigLoading ? 'animate-spin' : ''}`} />
                                {t('projectConfigRefresh')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void openProjectConfigDir?.()}
                                disabled={projectConfigBusy}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-subtle disabled:opacity-55"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                                {t('projectConfigOpenDir')}
                              </button>
                              {projectConfig?.trust !== 'trusted' ? (
                                <button
                                  type="button"
                                  onClick={() => void setProjectConfigTrust?.(true)}
                                  disabled={projectConfigBusy || projectConfig?.status !== 'valid'}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-[13px] font-medium text-emerald-700 transition hover:bg-emerald-500/15 disabled:opacity-55 dark:text-emerald-200"
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  {projectConfig?.trust === 'stale' ? t('projectConfigReapprove') : t('projectConfigApprove')}
                                </button>
                              ) : null}
                              {projectConfig?.trust === 'trusted' || projectConfig?.trust === 'stale' ? (
                                <button
                                  type="button"
                                  onClick={() => void setProjectConfigTrust?.(false)}
                                  disabled={projectConfigBusy}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/35 bg-red-500/10 px-3 py-2 text-[13px] font-medium text-red-700 transition hover:bg-red-500/15 disabled:opacity-55 dark:text-red-200"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                  {t('projectConfigRevoke')}
                                </button>
                              ) : null}
                            </div>
                            {projectConfigNotice ? <InlineNoticeView notice={projectConfigNotice} /> : null}
                          </div>
                        }
                      />
                    </>
                  )}
                </SettingsCard>
              </div>

              <div ref={skillSectionRef} className="mt-6">
                <SettingsCard title={t('skill')}>
                  <SettingRow
                    title={t('skillsDetectedDirs')}
                    description={t('skillsDetectedDirsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        {skillRootsLoading && skillRoots.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('loading')}
                          </div>
                        ) : skillRoots.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('skillsDetectedDirsEmpty')}
                          </div>
                        ) : (
                          skillRoots.map((root: SkillRootListItem) => (
                            <div
                              key={`${root.id}:${root.path}`}
                              className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 shadow-sm ${
                                root.enabled ? 'border-ds-border bg-ds-card' : 'border-ds-border-muted bg-ds-main/40'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[13px] font-medium text-ds-ink">
                                    {root.labelKey ? tCommon(root.labelKey) : skillRootShortLabel(root.path)}
                                  </span>
                                  <span className="rounded-md border border-ds-border-muted bg-ds-main/50 px-1.5 py-0.5 text-[11px] font-medium text-ds-muted">
                                    {root.scope === 'project' ? t('skillsScopeProject') : t('skillsScopeGlobal')}
                                  </span>
                                  {root.exists ? (
                                    <span className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-200">
                                      {t('skillsDirSkillCount', { count: root.skillCount })}
                                    </span>
                                  ) : (
                                    <span className="rounded-md border border-ds-border-muted bg-ds-main/50 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint">
                                      {t('skillsDirNotFound')}
                                    </span>
                                  )}
                                </div>
                                <code className="mt-1 block break-all font-mono text-[12px] text-ds-muted">
                                  {compactHomePath(root.path)}
                                </code>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => void openSkillRoot(root.path)}
                                  className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                                  aria-label={t('skillsOpenRoot')}
                                  title={t('skillsOpenRoot')}
                                >
                                  <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
                                </button>
                                <Toggle checked={root.enabled} onChange={(value) => toggleSkillRoot(root, value)} />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('skillsPermissionSources')}
                    description={t('skillsPermissionSourcesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-5">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionEnabledRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.enabledRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionDisabledRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.disabledRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionWorkspaceRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.workspaceRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionGlobalRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.globalRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionDisabledIds')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.disabledSkillIds}</span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                          {t('skillsPermissionRuntimeNote')}
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('skillsScanDirs')}
                    description={t('skillsScanDirsDesc')}
                    wideControl
                    control={
                      <textarea
                        value={compactHomePathList(form.claw.skills.extraDirs)}
                        onChange={(event) =>
                          update({
                            claw: {
                              skills: {
                                extraDirs: expandHomePathList(splitSettingsList(event.target.value))
                              }
                            }
                          })
                        }
                        spellCheck={false}
                        placeholder={'~/.agents/skills'}
                        className="min-h-24 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    }
                  />
                  <SettingRow
                    title={t('skillsActions')}
                    description={t('skillsActionsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openPlugins()}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
                          >
                            <Settings className="h-4 w-4" />
                            {t('skillsOpenPlugins')}
                          </button>
                        </div>
                        {skillNotice ? <InlineNoticeView notice={skillNotice} /> : null}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>

              <div ref={mcpSectionRef} className="mt-6">
                <SettingsCard title={t('mcp')}>
                  <SettingRow
                    title={t('mcpSearchEnabled')}
                    description={t('mcpSearchEnabledDesc')}
                    control={
                      <Toggle
                        checked={mcpSearch.enabled}
                        onChange={(v) => updateMcpSearch({ enabled: v })}
                      />
                    }
                  />
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('mcpAdvanced')}
                      description={t('mcpAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('mcpSearchMode')}
                    description={t('mcpSearchModeDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={mcpSearch.mode}
                        disabled={!mcpSearch.enabled}
                        onChange={(e) => updateMcpSearch({ mode: e.target.value })}
                      >
                        <option value="auto">{t('mcpSearchModeAuto')}</option>
                        <option value="search">{t('mcpSearchModeSearch')}</option>
                        <option value="direct">{t('mcpSearchModeDirect')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchLimits')}
                    description={t('mcpSearchLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchAutoThreshold')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.autoThresholdToolCount}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ autoThresholdToolCount: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKDefault')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKDefault}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKDefault: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKMax')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKMax}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKMax: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchMinScore')}
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.minScore}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ minScore: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchDiagnostics')}
                    description={t('mcpSearchDiagnosticsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-3">
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchStatus')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.active ? t('mcpSearchActive') : t('mcpSearchInactive')}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchIndexed')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.indexedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.indexedToolCount ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchAdvertised')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.advertisedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.advertisedToolCount ?? 0}</span>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpPermissionSources')}
                    description={t('mcpPermissionSourcesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-4">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionEnabledServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.enabledServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionDisabledServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.disabledServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionUserServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.userScopeServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionWorkspaceServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.workspaceScopeServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionVisibleServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.workspaceVisibleServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionLocalServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.localServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionRemoteServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.remoteServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionEnvServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.envServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionHeaderServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.headerServers}</span>
                          </div>
                        </div>
                        {mcpPermissionSummary.parseError ? (
                          <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-200">
                            {t('mcpPermissionParseError')}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                            {t('mcpPermissionRuntimeNote')}
                          </div>
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('configFilePath')}
                    description={t('mcpPathDesc')}
                    control={
                      <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                        <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                          {compactHomePath(mcpConfigPath)}
                        </code>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpEditor')}
                    description={t('mcpEditorDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="rounded-xl border border-ds-border bg-ds-main/50 px-3 py-2 text-[12px] leading-5 text-ds-muted">
                          {mcpConfigExists ? t('mcpFileStatusReady') : t('mcpFileStatusMissing')}
                        </div>
                        <McpServersEditor
                          value={mcpConfigText}
                          onChange={setMcpConfigText}
                          disabled={mcpLoading}
                          rawMode={mcpRawMode}
                          onToggleRawMode={setMcpRawMode}
                          loadingPlaceholder={mcpLoading ? t('loading') : ''}
                        />
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpActions')}
                    description={t('mcpRuntimeHint')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void saveMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {mcpBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                            ) : null}
                            {t('mcpSave')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void loadMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${mcpLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('mcpReload')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void openMcpConfigDir()}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('mcpOpenDir')}
                          </button>
                        </div>
                        {mcpNotice ? <InlineNoticeView notice={mcpNotice} /> : null}
                      </div>
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>


              <div className="mt-6">
                <SettingsCard title={t('RcodeAdvanced')}>
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('RcodeAdvancedDetails')}
                      description={t('RcodeAdvancedDetailsDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('RcodeTokenEconomyOptions')}
                    description={t('RcodeTokenEconomyOptionsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('RcodeCompressToolDescriptions')}</span>
                          <Toggle
                            checked={tokenEconomy.compressToolDescriptions}
                            disabled={!tokenEconomy.enabled}
                            onChange={(compressToolDescriptions) =>
                              updateTokenEconomy({ compressToolDescriptions })}
                          />
                        </label>
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('RcodeCompressToolResults')}</span>
                          <Toggle
                            checked={tokenEconomy.compressToolResults}
                            disabled={!tokenEconomy.enabled}
                            onChange={(compressToolResults) =>
                              updateTokenEconomy({ compressToolResults })}
                          />
                        </label>
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('RcodeConciseResponses')}</span>
                          <Toggle
                            checked={tokenEconomy.conciseResponses}
                            disabled={!tokenEconomy.enabled}
                            onChange={(conciseResponses) =>
                              updateTokenEconomy({ conciseResponses })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeHistoryHygiene')}
                    description={t('RcodeHistoryHygieneDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeHistoryMaxResultLines')}
                          <input
                            type="number"
                            min={1}
                            max={100000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultLines}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultLines: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeHistoryMaxResultBytes')}
                          <input
                            type="number"
                            min={512}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultBytes}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultBytes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeHistoryMaxResultTokens')}
                          <input
                            type="number"
                            min={128}
                            max={256000}
                            step={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultTokens}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeHistoryMaxArgumentBytes')}
                          <input
                            type="number"
                            min={512}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolArgumentStringBytes}
                            onChange={(e) =>
                              updateHistoryHygiene({ maxToolArgumentStringBytes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeHistoryMaxArgumentTokens')}
                          <input
                            type="number"
                            min={128}
                            max={64000}
                            step={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolArgumentStringTokens}
                            onChange={(e) =>
                              updateHistoryHygiene({ maxToolArgumentStringTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeHistoryMaxArrayItems')}
                          <input
                            type="number"
                            min={1}
                            max={10000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxArrayItems}
                            onChange={(e) => updateHistoryHygiene({ maxArrayItems: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeModelContextProfile')}
                    description={t('RcodeModelContextProfileDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('RcodeModelContextModel')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.modelLabel}
                          </div>
                          <div className="mt-1 text-[11px] leading-4 text-ds-muted">
                            {t(modelContext.sourceLabelKey)}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('RcodeModelContextWindow')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.contextWindowLabel}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('RcodeModelContextSoft')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.softThresholdLabel}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('RcodeModelContextHard')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.hardThresholdLabel}
                          </div>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeStorageBackend')}
                    description={t('RcodeStorageBackendDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={storage.backend}
                        onChange={(e) => updateStorage({ backend: e.target.value })}
                      >
                        <option value="hybrid">{t('RcodeStorageHybrid')}</option>
                        <option value="file">{t('RcodeStorageFile')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('RcodeStorageSqlitePath')}
                    description={t('RcodeStorageSqlitePathDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        value={compactHomePath(storage.sqlitePath)}
                        disabled={storage.backend !== 'hybrid'}
                        placeholder={t('RcodeStorageSqlitePathPlaceholder')}
                        onChange={(e) => updateStorage({ sqlitePath: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('RcodeCompactionThresholds')}
                    description={t('RcodeCompactionThresholdsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeCompactionSoftThreshold')}
                          <input
                            type="number"
                            min={1024}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.defaultSoftThreshold}
                            onChange={(e) => updateContextCompaction({ defaultSoftThreshold: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeCompactionHardThreshold')}
                          <input
                            type="number"
                            min={1024}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.defaultHardThreshold}
                            onChange={(e) => updateContextCompaction({ defaultHardThreshold: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeCompactionSummary')}
                    description={t('RcodeCompactionSummaryDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeCompactionSummaryTimeout')}
                          <input
                            type="number"
                            min={1000}
                            max={120000}
                            step={1000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryTimeoutMs}
                            onChange={(e) => updateContextCompaction({ summaryTimeoutMs: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeCompactionSummaryMaxTokens')}
                          <input
                            type="number"
                            min={64}
                            max={16000}
                            step={64}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryMaxTokens}
                            onChange={(e) => updateContextCompaction({ summaryMaxTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeCompactionSummaryInputBytes')}
                          <input
                            type="number"
                            min={1024}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryInputMaxBytes}
                            onChange={(e) => updateContextCompaction({ summaryInputMaxBytes: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeMaxWallTime')}
                    description={t('RcodeMaxWallTimeDesc')}
                    control={
                      <input
                        type="number"
                        min={1000}
                        max={86400000}
                        step={60000}
                        className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={runtimeTuning.maxWallTimeMs}
                        onChange={(e) =>
                          updateRuntimeTuning({ maxWallTimeMs: Number(e.target.value) })
                        }
                      />
                    }
                  />
                  <SettingRow
                    title={t('RcodeStreamIdleTimeout')}
                    description={t('RcodeStreamIdleTimeoutDesc')}
                    control={
                      <input
                        type="number"
                        min={0}
                        max={3600000}
                        step={1000}
                        className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={runtimeTuning.streamIdleTimeoutMs}
                        onChange={(e) =>
                          updateRuntimeTuning({ streamIdleTimeoutMs: Number(e.target.value) })
                        }
                      />
                    }
                  />
                  <SettingRow
                    title={t('RcodeToolStorm')}
                    description={t('RcodeToolStormDesc')}
                    control={
                      <Toggle
                        checked={runtimeTuning.toolStorm.enabled}
                        onChange={(enabled) => updateToolStorm({ enabled })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('RcodeToolStormLimits')}
                    description={t('RcodeToolStormLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeToolStormWindowSize')}
                          <input
                            type="number"
                            min={1}
                            max={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={runtimeTuning.toolStorm.windowSize}
                            disabled={!runtimeTuning.toolStorm.enabled}
                            onChange={(e) => updateToolStorm({ windowSize: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeToolStormThreshold')}
                          <input
                            type="number"
                            min={2}
                            max={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={runtimeTuning.toolStorm.threshold}
                            disabled={!runtimeTuning.toolStorm.enabled}
                            onChange={(e) => updateToolStorm({ threshold: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeToolOutputLimits')}
                    description={t('RcodeToolOutputLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeToolOutputMaxLines')}
                          <input
                            type="number"
                            min={1}
                            max={1000000}
                            step={1000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={toolOutputLimits.maxLines}
                            onChange={(e) => updateToolOutputLimits({ maxLines: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('RcodeToolOutputMaxBytes')}
                          <input
                            type="number"
                            min={1}
                            max={67108864}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={toolOutputLimits.maxBytes}
                            onChange={(e) => updateToolOutputLimits({ maxBytes: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeToolArgumentRepair')}
                    description={t('RcodeToolArgumentRepairDesc')}
                    control={
                      <input
                        type="number"
                        min={1024}
                        max={16777216}
                        step={1024}
                        className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={runtimeTuning.toolArgumentRepair.maxStringBytes}
                        onChange={(e) => updateToolArgumentRepair({ maxStringBytes: Number(e.target.value) })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>

              <div className="mt-6">
                <SettingsCard title={t('RcodeDiagnostics')}>
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('RcodeDiagnosticsAdvanced')}
                      description={t('RcodeDiagnosticsAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('RcodeRuntimeCapabilities')}
                    description={t('RcodeRuntimeCapabilitiesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          {[
                            ['MCP', runtimeInfo?.capabilities?.mcp?.status],
                            ['Web', runtimeInfo?.capabilities?.web?.status],
                            ['Instructions', runtimeInfo?.capabilities?.instructions?.status],
                            ['Skills', runtimeInfo?.capabilities?.skills?.status],
                            ['Subagents', runtimeInfo?.capabilities?.subagents?.status],
                            ['Images', runtimeInfo?.capabilities?.attachments?.status],
                            ['Memory', runtimeInfo?.capabilities?.memory?.status]
                          ].map(([label, status]) => (
                            <span
                              key={label}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${statusPill(status as string | undefined)}`}
                            >
                              {label}
                              <span className="font-mono text-[11px] opacity-75">{status || 'unknown'}</span>
                            </span>
                          ))}
                        </div>
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-2">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('RcodeRuntimeModel')}: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.model?.id ?? 'unknown'}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('RcodeRuntimePid')}: <span className="font-mono text-ds-ink">{runtimeInfo?.pid ?? 'unknown'}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            MCP: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.mcp?.connectedServers ?? 0}/{runtimeInfo?.capabilities?.mcp?.configuredServers ?? 0}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            Web: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.web?.provider ?? 'none'}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            Instructions: <span className="font-mono text-ds-ink">{toolDiagnostics?.instructions?.lastInjection?.sources?.length ?? runtimeInfo?.capabilities?.instructions?.lastSourceCount ?? 0}</span>
                          </div>
                          {runtimeInfo?.capabilities?.subagents?.enabled ? (
                            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              Subagents: <span className="font-mono text-ds-ink">
                                {runtimeInfo?.capabilities?.subagents?.maxParallel ?? 0}∥ · {runtimeInfo?.capabilities?.subagents?.maxChildRuns ?? 0} max
                                {runtimeInfo?.capabilities?.subagents?.defaultToolPolicy ? ` · ${runtimeInfo.capabilities.subagents.defaultToolPolicy}` : ''}
                                {runtimeInfo?.capabilities?.subagents?.profiles?.length ? ` · ${runtimeInfo.capabilities.subagents.profiles.length} profile(s)` : ''}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void refreshRcodeDiagnostics()}
                            disabled={runtimeDiagnosticsBusy}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${runtimeDiagnosticsBusy ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('RcodeDiagnosticsRefresh')}
                          </button>
                          {runtimeDiagnosticsNotice ? <InlineNoticeView notice={runtimeDiagnosticsNotice} /> : null}
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeToolDiagnostics')}
                    description={t('RcodeToolDiagnosticsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-2">
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('RcodeDiagnosticsProviders')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.providers?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('RcodeDiagnosticsMcpServers')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpServers?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('RcodeDiagnosticsSkills')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.skills?.skills?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('RcodeDiagnosticsAttachments')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.attachments?.count ?? 0}</span>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('RcodeMemoryRecords')}
                    description={t('RcodeMemoryRecordsDesc')}
                    wideControl
                    control={
                      <div className="flex flex-col gap-2">
                        {memoryRecords.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('RcodeMemoryEmpty')}
                          </div>
                        ) : (
                          memoryRecords.slice(0, 8).map((memory: any) => (
                            <div key={memory.id} className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-semibold text-ds-ink">{memory.content}</div>
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                                    <span className="font-mono">{memory.scope}</span>
                                    <span className="font-mono">{memory.id}</span>
                                    {memory.disabledAt ? <span>{t('RcodeMemoryDisabled')}</span> : null}
                                    {memory.tags?.length ? <span>{compactList(memory.tags, '')}</span> : null}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  {memory.disabledAt ? (
                                    <button
                                      type="button"
                                      onClick={() => void restoreMemoryRecord(memory.id)}
                                      className="rounded-lg p-1.5 text-ds-muted transition hover:bg-emerald-500/10 hover:text-emerald-600"
                                      aria-label={t('memoryRestore')}
                                      title={t('memoryRestore')}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => void disableMemoryRecord(memory.id)}
                                      className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                                      aria-label={t('RcodeMemoryDisable')}
                                      title={t('RcodeMemoryDisable')}
                                    >
                                      <Ban className="h-3.5 w-3.5" strokeWidth={1.8} />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void deleteMemoryRecord(memory.id)}
                                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                                    aria-label={t('RcodeMemoryDelete')}
                                    title={t('RcodeMemoryDelete')}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>
            </>
  )
}

function permissionBadgeClass(state: ComputerUsePermissionState): string {
  if (state === 'granted') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (state === 'denied') {
    return 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
  }
  return 'border-ds-border-muted bg-ds-card text-ds-faint'
}

function ComputerUsePermissionRow({ t }: { t: (key: string) => string }): ReactElement | null {
  const [permissions, setPermissions] = useState<ComputerUsePermissions | null>(null)

  const refresh = (): void => {
    void window.RcodeGui?.getComputerUsePermissions?.().then(setPermissions).catch(() => undefined)
  }
  useEffect(() => {
    refresh()
  }, [])

  // Non-macOS hosts have no OS permission gate; nothing useful to show.
  if (permissions && !permissions.needsPermission) return null

  const request = (kind: ComputerUsePermissionKind): void => {
    void window.RcodeGui
      ?.requestComputerUsePermission?.(kind)
      .then(setPermissions)
      .catch(() => undefined)
  }

  const badge = (label: string, state: ComputerUsePermissionState): ReactNode => (
    <span className={`rounded-lg border px-2 py-0.5 text-[12px] font-medium ${permissionBadgeClass(state)}`}>
      {label}: {t(`computerUsePermission_${state}`)}
    </span>
  )

  return (
    <SettingRow
      title={t('computerUsePermissions')}
      description={t('computerUsePermissionsDesc')}
      control={
        <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {permissions?.accessibilityNeedsRestart ? (
              <span className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[12px] font-medium text-amber-700 dark:text-amber-200">
                {t('computerUseAccessibility')}: {t('computerUsePermissionNeedsRestart')}
              </span>
            ) : (
              badge(t('computerUseAccessibility'), permissions?.accessibility ?? 'unknown')
            )}
            {badge(t('computerUseScreenRecording'), permissions?.screenRecording ?? 'unknown')}
          </div>
          {permissions?.accessibilityNeedsRestart ? (
            <p className="max-w-full text-[12px] leading-5 text-amber-700 dark:text-amber-200">
              {t('computerUseRestartHint')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={() => request('accessibility')}
            >
              {t('computerUseGrantAccessibility')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={() => request('screenRecording')}
            >
              {t('computerUseGrantScreenRecording')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={refresh}
            >
              {t('computerUseRecheck')}
            </button>
          </div>
        </div>
      }
    />
  )
}
