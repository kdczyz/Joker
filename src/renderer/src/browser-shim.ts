/**
 * Browser-mode shim for `window.JokerGui`.
 *
 * When the renderer is opened directly in a browser (e.g. http://127.0.0.1:5173)
 * instead of inside an Electron window, the preload script never runs so
 * `window.JokerGui` is undefined.  This module detects that situation and
 * installs a lightweight proxy object that allows the UI to load and render.
 *
 * Core runtime communication goes through the Joker HTTP server; Electron-only
 * features (file dialogs, terminal, Git, etc.) are stubbed with safe no-ops.
 */

const DEFAULT_RUNTIME_PORT = 18899

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getRuntimeBaseUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const portParam = params.get('joker-port')
  const port = portParam ? Number(portParam) : DEFAULT_RUNTIME_PORT
  return `http://127.0.0.1:${port}`
}

function noopUnsubscribe(): () => void {
  return () => {}
}

function noopAsync<T>(value: T): () => Promise<T> {
  return async () => value
}

function notAvailable(
  name: string
): (..._args: any[]) => Promise<{ ok: false; message: string }> {
  return async () => ({
    ok: false,
    message: `${name} is not available in browser mode`,
  })
}

/* ------------------------------------------------------------------ */
/*  SSE event bus                                                     */
/* ------------------------------------------------------------------ */

type SseHandler = (payload: unknown) => void

class SseEventBus {
  private _listeners = new Map<string, Set<SseHandler>>()

  on(event: string, handler: SseHandler): () => void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set())
    this._listeners.get(event)!.add(handler)
    return () => {
      this._listeners.get(event)?.delete(handler)
    }
  }

  emit(event: string, payload: unknown): void {
    this._listeners.get(event)?.forEach((h) => {
      try {
        h(payload)
      } catch {
        /* swallow */
      }
    })
  }
}

const sseBus = new SseEventBus()

/* ------------------------------------------------------------------ */
/*  localStorage-backed settings (minimal subset for UI rendering)    */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = 'joker-browser-settings'

function readStoredSettings(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStoredSettings(data: Record<string, unknown>): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data))
}

function defaultBrowserSettings(): Record<string, unknown> {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 1,
    chatContentMaxWidthPx: 896,
    cursorSpotlight: true,
    provider: { providers: [] },
    agents: { Joker: {} },
    workspaceRoot: '',
    conversationWorkspaceRoot: '',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: { enabled: true },
    write: { enabled: false },
    claw: { enabled: false },
    schedule: { enabled: false },
    workflow: { enabled: false },
    design: {},
    terminal: { fontSize: 14, fontFamily: 'monospace' },
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: [],
    browserMode: { enabled: true, port: DEFAULT_RUNTIME_PORT },
  }
}

/* ------------------------------------------------------------------ */
/*  Build the shim API                                                */
/* ------------------------------------------------------------------ */

function createBrowserShim(): void {
  const shim = {
    platform: 'browser' as string,
    homeDir: '',

    // ---- Window chrome ----
    windowChrome: {
      isFullscreen: noopAsync(false),
      onFullscreenChange: (_handler: (fs: boolean) => void) => noopUnsubscribe(),
    },

    // ---- Settings (localStorage-backed) ----
    getSettings: async () => {
      const stored = readStoredSettings()
      return stored ?? defaultBrowserSettings()
    },
    setSettings: async (partial: Record<string, unknown>) => {
      const current = readStoredSettings() ?? defaultBrowserSettings()
      const merged = { ...current, ...partial }
      // Deep merge browserMode
      if (partial.browserMode && typeof partial.browserMode === 'object') {
        merged.browserMode = {
          ...(current as any).browserMode,
          ...(partial.browserMode as any),
        }
      }
      writeStoredSettings(merged)
      return merged
    },
    saveSettingsSilent: async (partial: Record<string, unknown>) => {
      try {
        const current = readStoredSettings() ?? defaultBrowserSettings()
        const merged = { ...current, ...partial }
        if (partial.browserMode && typeof partial.browserMode === 'object') {
          merged.browserMode = {
            ...(current as any).browserMode,
            ...(partial.browserMode as any),
          }
        }
        writeStoredSettings(merged)
      } catch {
        /* swallow */
      }
    },

    // ---- Runtime requests (direct HTTP to Joker server) ----
    runtimeRequest: (path: string, method?: string, body?: string) =>
      fetch(`${getRuntimeBaseUrl()}${path}`, {
        method: method ?? 'GET',
        headers:
          body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body ?? undefined,
      }).then(async (res) => ({
        status: res.status,
        body: await res.text(),
      })) as Promise<{ status: number; body: string }>,

    restartRuntime: async () => {
      /* no-op in browser mode */
    },

    // ---- SSE (via EventSource) ----
    startSse: (
      threadId: string,
      sinceSeq: number,
      streamId?: string,
      options?: any
    ) => {
      const baseUrl = getRuntimeBaseUrl()
      const params = new URLSearchParams({
        threadId,
        sinceSeq: String(sinceSeq),
      })
      if (streamId) params.set('streamId', streamId)
      if (options?.acknowledgedBatches) params.set('acknowledgedBatches', '1')
      const eventSource = new EventSource(
        `${baseUrl}/v1/gui/sse?${params.toString()}`
      )
      const id = streamId ?? `browser-${Date.now()}`
      eventSource.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          sseBus.emit('sse-event', data)
        } catch {
          /* ignore */
        }
      }
      eventSource.onerror = () => {
        sseBus.emit('sse-error', { message: 'SSE connection error' })
        sseBus.emit('sse-end', { streamId: id })
      }
      ;(window as any).__browserSseES = eventSource
      return { streamId: id }
    },

    stopSse: async (_streamId: string) => {
      const es = (window as any).__browserSseES as EventSource | undefined
      if (es) {
        es.close()
        ;(window as any).__browserSseES = null
      }
      return true
    },

    ackSse: async (_streamId: string, _batchId: string) => true,

    onSseEvent: (handler: SseHandler) => sseBus.on('sse-event', handler),
    onSseEnd: (handler: SseHandler) => sseBus.on('sse-end', handler),
    onSseError: (handler: SseHandler) => sseBus.on('sse-error', handler),

    // ---- Extension notifications (stub) ----
    onExtensionNotifications: (_handler: any) => noopUnsubscribe(),

    // ---- Auth ----
    authGithubLogin: notAvailable('GitHub login'),

    // ---- Approval ----
    resolveJokerApproval: notAvailable('approval'),

    // ---- Prompt / model ----
    fetchUpstreamModels: notAvailable('fetchUpstreamModels'),
    probeModelProvider: notAvailable('probeModelProvider'),
    optimizePrompt: notAvailable('optimizePrompt'),

    // ---- Attachment upload ----
    uploadRuntimeImageAttachment: notAvailable(
      'uploadRuntimeImageAttachment'
    ),

    // ---- File system (stubs) ----
    pickWorkspaceDirectory: notAvailable('pickWorkspaceDirectory'),
    workspaceDirectoryExists: async () => false,
    pickLocalFiles: notAvailable('pickLocalFiles'),
    createConversationWorkspace: notAvailable('createConversationWorkspace'),
    alertDialog: notAvailable('alertDialog'),
    confirmDialog: notAvailable('confirmDialog'),

    // ---- Claude subscription ----
    claudeSubscriptionStatus: notAvailable('claudeSubscriptionStatus'),
    claudeSubscriptionLogin: notAvailable('claudeSubscriptionLogin'),
    claudeSubscriptionModels: notAvailable('claudeSubscriptionModels'),
    claudeSubscriptionSdkStatus: notAvailable('claudeSubscriptionSdkStatus'),
    claudeSubscriptionSdkInstall: notAvailable(
      'claudeSubscriptionSdkInstall'
    ),
    onClaudeSubscriptionSdkProgress: (_handler: any) => noopUnsubscribe(),

    // ---- Open external ----
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener')
    },

    // ---- Log ----
    logError: async () => {},
    logWarn: async () => {},
    logInfo: async () => {},

    // ---- Claw ----
    getClawStatus: notAvailable('getClawStatus'),
    runClawTask: notAvailable('runClawTask'),
    getScheduleStatus: notAvailable('getScheduleStatus'),
    runScheduleTask: notAvailable('runScheduleTask'),
    stopScheduleTask: notAvailable('stopScheduleTask'),
    getWorkflowStatus: notAvailable('getWorkflowStatus'),
    runWorkflow: notAvailable('runWorkflow'),
    stopWorkflow: notAvailable('stopWorkflow'),
    runWorkflowNode: notAvailable('runWorkflowNode'),
    testWorkflowNode: notAvailable('testWorkflowNode'),
    resolveWorkflowApproval: notAvailable('resolveWorkflowApproval'),
    checkWorkflowCode: notAvailable('checkWorkflowCode'),
    startClawImInstallQr: notAvailable('startClawImInstallQr'),
    pollClawImInstall: notAvailable('pollClawImInstall'),
    connectTelegramBot: notAvailable('connectTelegramBot'),

    // ---- Device migration ----
    detectLegacySessions: notAvailable('detectLegacySessions'),
    importLegacySessions: notAvailable('importLegacySessions'),
    pickLegacySessionDir: notAvailable('pickLegacySessionDir'),

    // ---- Claw channel mirror ----
    mirrorClawChannelMessageToFeishu: notAvailable(
      'mirrorClawChannelMessageToFeishu'
    ),
    deliverClawGeneratedFiles: notAvailable('deliverClawGeneratedFiles'),
    createClawTaskFromText: notAvailable('createClawTaskFromText'),

    // ---- Schedule ----
    createScheduleTaskFromText: notAvailable('createScheduleTaskFromText'),

    // ---- Data migration ----
    dataMigration: {
      pickExportPackage: notAvailable('pickExportPackage'),
      pickImportPackage: notAvailable('pickImportPackage'),
      pickDestinationDirectory: notAvailable('pickDestinationDirectory'),
      estimateExport: notAvailable('estimateExport'),
      inspectPackage: notAvailable('inspectPackage'),
      planImport: notAvailable('planImport'),
      startExport: notAvailable('startExport'),
      startImport: notAvailable('startImport'),
      cancel: notAvailable('cancel'),
      recover: notAvailable('recover'),
      getStatus: notAvailable('getStatus'),
      listReports: notAvailable('listReports'),
      getReport: notAvailable('getReport'),
      deleteReport: notAvailable('deleteReport'),
      onProgress: (_handler: any) => noopUnsubscribe(),
      onRendererRequest: (_handler: any) => noopUnsubscribe(),
      respondRendererRequest: notAvailable('respondRendererRequest'),
    },

    // ---- Grok build ----
    grok: {
      connect: notAvailable('grok.connect'),
      onEvent: (_handler: any) => noopUnsubscribe(),
      sendPrompt: notAvailable('grok.sendPrompt'),
      cancel: notAvailable('grok.cancel'),
    },

    // ---- Write ----
    writeInfographic: notAvailable('writeInfographic'),
    writeInlineCompletion: notAvailable('writeInlineCompletion'),

    // ---- Speech ----
    speechTranscribe: notAvailable('speechTranscribe'),

    // ---- Whisper ----
    whisperModelList: notAvailable('whisperModelList'),
    whisperModelDownload: notAvailable('whisperModelDownload'),
    whisperModelDelete: notAvailable('whisperModelDelete'),
    whisperModelDownloadStatus: notAvailable('whisperModelDownloadStatus'),
    onWhisperModelDownloadProgress: (_handler: any) => noopUnsubscribe(),

    // ---- Local PDF ----
    readLocalPdfText: notAvailable('readLocalPdfText'),

    // ---- Project design ----
    projectDesignMdLint: notAvailable('projectDesignMdLint'),

    // ---- Workspace file operations ----
    workspaceFileRead: notAvailable('workspaceFileRead'),
    workspaceFileWrite: notAvailable('workspaceFileWrite'),
    workspaceFileSaveAs: notAvailable('workspaceFileSaveAs'),
    workspaceFileCreate: notAvailable('workspaceFileCreate'),
    workspaceFileResolve: notAvailable('workspaceFileResolve'),
    workspaceFileWatch: notAvailable('workspaceFileWatch'),
    workspaceFileChange: notAvailable('workspaceFileChange'),
    workspaceEntryRename: notAvailable('workspaceEntryRename'),
    workspaceEntryDelete: notAvailable('workspaceEntryDelete'),
    workspaceImageRead: notAvailable('workspaceImageRead'),
    workspaceImageBytesSave: notAvailable('workspaceImageBytesSave'),
    workspaceImagePick: notAvailable('workspaceImagePick'),
    workspaceClipboardImageSave: notAvailable('workspaceClipboardImageSave'),
    workspacePdfRead: notAvailable('workspacePdfRead'),
    workspaceDirectoryCreate: notAvailable('workspaceDirectoryCreate'),
    workspaceDirectoryList: notAvailable('workspaceDirectoryList'),
    clipboardImageRead: notAvailable('clipboardImageRead'),

    // ---- Editor ----
    openInEditor: notAvailable('openInEditor'),
    openEditorPath: notAvailable('openEditorPath'),

    // ---- Git (stubs) ----
    getGitBranches: notAvailable('getGitBranches'),
    getGitDiffStat: notAvailable('getGitDiffStat'),
    getGitFileDiff: notAvailable('getGitFileDiff'),
    commitGitChanges: notAvailable('commitGitChanges'),
    pushGitChanges: notAvailable('pushGitChanges'),
    switchGitBranch: notAvailable('switchGitBranch'),
    createAndSwitchGitBranch: notAvailable('createAndSwitchGitBranch'),
    createGitCheckpoint: notAvailable('createGitCheckpoint'),
    restoreGitCheckpoint: notAvailable('restoreGitCheckpoint'),
    restoreGitFile: notAvailable('restoreGitFile'),
    checkoutGitBranchWorktree: notAvailable('checkoutGitBranchWorktree'),
    createGitBranchWorktree: notAvailable('createGitBranchWorktree'),
    listGitBranchWorktrees: notAvailable('listGitBranchWorktrees'),
    removeGitBranchWorktree: notAvailable('removeGitBranchWorktree'),

    // ---- Worktree ----
    acquireWorktree: notAvailable('acquireWorktree'),
    releaseWorktree: notAvailable('releaseWorktree'),
    listWorktrees: notAvailable('listWorktrees'),
    removeWorktree: notAvailable('removeWorktree'),
    getWorktreeChanges: notAvailable('getWorktreeChanges'),
    commitWorktree: notAvailable('commitWorktree'),
    mergeWorktree: notAvailable('mergeWorktree'),
    abortWorktreeMerge: notAvailable('abortWorktreeMerge'),
    continueWorktreeMerge: notAvailable('continueWorktreeMerge'),
    syncWorktreeFromMain: notAvailable('syncWorktreeFromMain'),
    abortWorktreeRebase: notAvailable('abortWorktreeRebase'),
    cleanupWorktrees: notAvailable('cleanupWorktrees'),

    // ---- Skills / plugins ----
    listSkills: notAvailable('listSkills'),
    listSkillRoots: notAvailable('listSkillRoots'),
    saveSkillFile: notAvailable('saveSkillFile'),
    importSkillsFromGitHub: notAvailable('importSkillsFromGitHub'),
    openSkillRoot: notAvailable('openSkillRoot'),
    ensurePptMaster: notAvailable('ensurePptMaster'),
    listUiPlugins: notAvailable('listUiPlugins'),
    installUiPlugin: notAvailable('installUiPlugin'),
    removeUiPlugin: notAvailable('removeUiPlugin'),
    loadUiPlugin: notAvailable('loadUiPlugin'),
    activateUiPluginTheme: notAvailable('activateUiPluginTheme'),
    deactivateUiPluginTheme: notAvailable('deactivateUiPluginTheme'),

    // ---- Config files ----
    getJokerConfigFile: notAvailable('getJokerConfigFile'),
    setJokerConfigFile: notAvailable('setJokerConfigFile'),
    openJokerConfigDir: notAvailable('openJokerConfigDir'),
    getJokerProjectConfigFile: notAvailable('getJokerProjectConfigFile'),
    setJokerProjectConfigFile: notAvailable('setJokerProjectConfigFile'),
    setJokerProjectConfigTrust: notAvailable('setJokerProjectConfigTrust'),
    openJokerProjectConfigDir: notAvailable('openJokerProjectConfigDir'),

    // ---- Codex ----
    startCodexAuth: notAvailable('startCodexAuth'),
    pollCodexAuth: notAvailable('pollCodexAuth'),
    startCodexBrowserAuth: notAvailable('startCodexBrowserAuth'),
    codexAccountUsage: notAvailable('codexAccountUsage'),

    // ---- GitHub OAuth ----
    githubOAuthConnect: notAvailable('githubOAuthConnect'),
    githubOAuthDisconnect: notAvailable('githubOAuthDisconnect'),
    githubGetClientId: notAvailable('githubGetClientId'),
    githubSetClientId: notAvailable('githubSetClientId'),
    githubGetClientSecret: notAvailable('githubGetClientSecret'),
    githubSetClientSecret: notAvailable('githubSetClientSecret'),
    githubClearClientSecret: notAvailable('githubClearClientSecret'),
    githubStatus: notAvailable('githubStatus'),
    githubListRepos: notAvailable('githubListRepos'),
    githubCloneRepo: notAvailable('githubCloneRepo'),
    githubPush: notAvailable('githubPush'),
    githubPull: notAvailable('githubPull'),
    githubCreatePr: notAvailable('githubCreatePr'),
    githubEnableMcp: notAvailable('githubEnableMcp'),
    githubDisableMcp: notAvailable('githubDisableMcp'),
    githubMcpStatus: notAvailable('githubMcpStatus'),

    // ---- Cloudflare ----
    cloudflareOAuthConnect: notAvailable('cloudflareOAuthConnect'),
    cloudflareOAuthDisconnect: notAvailable('cloudflareOAuthDisconnect'),
    cloudflareStatus: notAvailable('cloudflareStatus'),
    cloudflareGetClientId: notAvailable('cloudflareGetClientId'),
    cloudflareSetClientId: notAvailable('cloudflareSetClientId'),
    cloudflareClearClientId: notAvailable('cloudflareClearClientId'),
    cloudflareEnableMcp: notAvailable('cloudflareEnableMcp'),
    cloudflareDisableMcp: notAvailable('cloudflareDisableMcp'),
    cloudflareMcpStatus: notAvailable('cloudflareMcpStatus'),

    // ---- Extension-specific ----
    extensionRespondNotification: notAvailable(
      'extensionRespondNotification'
    ),
    composerContextAttach: notAvailable('composerContextAttach'),
    extensionArtifactAction: notAvailable('extensionArtifactAction'),
  }

  ;(window as any).JokerGui = shim
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Call this as early as possible (before React renders) to install the
 * browser shim when `window.JokerGui` is not already provided by the
 * Electron preload script.
 *
 * In Electron, this is a no-op.
 */
export function installBrowserShimIfNeeded(): void {
  if (typeof (window as any).JokerGui !== 'undefined') return
  const isElectron = navigator.userAgent.includes('Electron')
  if (isElectron) return
  createBrowserShim()
  console.info(
    '[browser-shim] Installed browser-mode shim for window.JokerGui'
  )
}
