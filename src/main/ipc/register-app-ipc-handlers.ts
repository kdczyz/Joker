import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  getJokerRuntimeSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ClawRunResult,
  type ClawTaskFromTextResult,
  type ClawRuntimeStatus,
  type ScheduleRunResult,
  type ScheduleRuntimeStatus,
  type ScheduleTaskFromTextResult,
  type WorkflowCodeCheckResult,
  type WorkflowNodeTestResult,
  type WorkflowRunResult,
  type WorkflowRuntimeStatus
} from '../../shared/app-settings'
import type {
  ClawImInstallPollResult,
  ClawImInstallQrResult,
  ConversationWorkspaceCreateResult,
  DesktopCommand,
  RuntimeRequestResult,
  SystemNotificationResult,
  TurnCompleteNotificationPayload,
  UpstreamModelsResult,
  WorkspacePickResult
} from '../../shared/Joker-gui-api'
import type { WorkspaceFileSaveAsResult } from '../../shared/workspace-file'
import {
  clawMirrorPayloadSchema,
  clawDeliverFilesPayloadSchema,
  clawImInstallPollPayloadSchema,
  clawImTelegramTokenPayloadSchema,
  alertDialogPayloadSchema,
  confirmDialogPayloadSchema,
  clawTaskFromTextPayloadSchema,
  computerUsePermissionKindSchema,
  conversationExportPayloadSchema,
  deepseekConfigContentSchema,
  desktopCommandSchema,
  defaultPathSchema,
  gitBranchPayloadSchema,
  gitCheckpointCreatePayloadSchema,
  gitCheckpointRestorePayloadSchema,
  gitRestoreFilePayloadSchema,
  gitWorktreeRemoveSchema,
  localPdfTextTargetPayloadSchema,
  logErrorPayloadSchema,
  notificationPayloadSchema,
  openEditorPathPayloadSchema,
  providerProbePayloadSchema,
  projectDesignMdLintPayloadSchema,
  promptOptimizationPayloadSchema,
  rootPathSchema,
  worktreeCommitSchema,
  worktreeContinueMergeSchema,
  worktreeMergeSchema,
  worktreePoolIndexSchema,
  worktreePoolSchema,
  worktreeProjectPathSchema,
  worktreeOptionalRootSchema,
  worktreePathSchema,
  runtimeRequestPayloadSchema,
  runtimeImageAttachmentUploadPayloadSchema,
  JokerProtectedApprovalPayloadSchema,
  JokerProjectConfigTrustPayloadSchema,
  JokerProjectConfigWorkspacePayloadSchema,
  JokerProjectConfigWritePayloadSchema,
  scheduleTaskFromTextPayloadSchema,
  shellOpenExternalUrlSchema,
  skillGithubImportPayloadSchema,
  skillListPayloadSchema,
  skillSaveFilePayloadSchema,
  settingsPatchSchema,
  streamIdSchema,
  workflowRunNodePayloadSchema,
  workflowTestNodePayloadSchema,
  workflowResolveApprovalPayloadSchema,
  workflowCodeCheckPayloadSchema,
  uiPluginIdPayloadSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceClipboardImageSavePayloadSchema,
  workspaceImageBytesSavePayloadSchema,
  workspaceImagePickPayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  workspaceFileCreatePayloadSchema,
  workspaceFileSaveAsPayloadSchema,
  workspaceFileTargetPayloadSchema,
  workspaceFileWatchPayloadSchema,
  workspaceFileWritePayloadSchema,
  localWhisperDownloadPayloadSchema,
  localWhisperModelIdPayloadSchema,
  localWhisperSourceStatusPayloadSchema,
  speechTranscribePayloadSchema,
  writeExportPayloadSchema,
  memoryMarkdownExportPayloadSchema,
  designExportPayloadSchema,
  writeRichClipboardPayloadSchema,
  writeInfographicPayloadSchema,
  writeInlineCompletionPayloadSchema,
  writePrototypeFilePayloadSchema,
  writeRetrievalPayloadSchema,
  workspaceRootSchema,
  legacySessionImportPayloadSchema
} from './app-ipc-schemas'
import { uploadRuntimeImageAttachmentQueued } from '../services/runtime-image-attachment-service'
import {
  createApprovalConsentToken,
  JOKER_APPROVAL_CONSENT_HEADER
} from '../approval-consent'
import {
  JokerExecutionSettingsConsentService,
  executionSettingsEqual,
  JokerExecutionSettingsChange,
  type JokerExecutionSettingsConsentAction
} from '../execution-settings-consent'
import {
  DEFAULT_JOKER_DATA_DIR,
  resolveJokerRuntimeSettings,
  resolveModelProviderProxyUrl
} from '../../shared/app-settings'
import { detectLegacySessions, importLegacySessions } from '../services/legacy-session-import-service'
import { lintProjectDesignMd } from '../services/project-design-md-lint'
import { claudeSubscriptionStatus, runClaudeSetupToken } from '../claude-subscription-auth'
import { fetchSdkModels } from '../claude-subscription-models'
import {
  agentSdkDownloadState,
  agentSdkStatus,
  resolveClaudeBinary,
  startAgentSdkInstall
} from '../agent-sdk-installer'
import type { JsonSettingsStore } from '../settings-store'
import { probeModelProvider } from '../provider-connection'
import type { ClawRuntime } from '../claw-runtime'
import type { ScheduleRuntime } from '../schedule-runtime'
import { reloadRenderer } from '../dev-renderer-cache'
import { verifyTelegramBotToken } from '../telegram-runtime'
import {
  startCodexDeviceAuth,
  pollCodexDeviceAuth,
  startCodexBrowserAuth,
  parseCodexCredentials,
  refreshCodexToken,
  encodeCodexCredentials,
  fetchCodexAccountUsage
} from '../codex-auth'
import { startGithubOAuth } from '../github-oauth'
import {
  startCloudflareOAuth,
  revokeCloudflareToken
} from '../cloudflare-oauth'
import {
  enableCloudflareMcp,
  disableCloudflareMcp,
  isCloudflareMcpEnabled
} from '../cloudflare-mcp'
import {
  storeCloudflareCredentials,
  getCloudflareCredentials,
  clearCloudflareCredentials,
  storeCloudflareClientId,
  getCloudflareClientId,
  clearCloudflareClientId
} from '../services/cloudflare-credential-store'
import {
  syncGithubAccountToEnvironment,
  clearGithubAccountFromEnvironment
} from '../github-environment-bridge'
import { enableGithubMcp, disableGithubMcp, isGithubMcpEnabled } from '../github-mcp'
import { resolveJokerMcpJsonPath } from '../claw-schedule-mcp-config'
import {
  storeGithubCredentials,
  getGithubCredentials,
  clearGithubCredentials,
  storeGithubClientId,
  getGithubClientId,
  storeGithubClientSecret,
  getGithubClientSecret,
  clearGithubClientSecret
} from '../services/github-credential-store'
import {
  listUserRepos,
  cloneRepository,
  pushRepository,
  pullRepository,
  createPullRequest
} from '../services/github-service'
import type { WorkflowRuntime } from '../workflow-runtime'
import { checkWorkflowCode } from '../workflow-runtime'
import {
  checkoutGitBranchWorktree,
  createAndSwitchGitBranch,
  createGitBranchWorktree,
  getGitBranches,
  listGitBranchWorktrees,
  removeGitBranchWorktree,
  switchGitBranch
} from '../services/git-service'
import { createGitCheckpoint, restoreGitCheckpoint, type GitCheckpointStorageOptions } from '../services/git-checkpoint-service'
import {
  abortMerge,
  abortRebase,
  acquireWorktree,
  cleanupWorktrees,
  commitWorktree,
  continueMerge,
  findAvailablePoolIndex,
  getWorktreeChanges,
  listWorktrees,
  mergeWorktreeToMain,
  releaseWorktree,
  removeWorktree,
  syncWorktreeFromMain
} from '../services/worktree-service'
import {
  installUiPluginFromDirectory,
  listUiPlugins,
  loadUiPluginFigures,
  removeUiPlugin
} from '../services/ui-plugin-service'
import { UiPluginCdpThemeController } from '../services/ui-plugin-cdp-theme-controller'
import {
  buildUiPluginBackgroundCss,
  buildUiPluginPresentationCss,
  buildUiPluginSceneCss,
  buildUiPluginTokenCss
} from '../../shared/ui-plugin'
import { ensureBundledUiPlugins } from '../ui-plugin-bundled'
import { ensureBundledSkills } from '../skill-bundled'
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  expandHomePath,
  listEditorsResult,
  listWorkspaceDirectory,
  openEditorPath,
  openPathWithShell,
  readClipboardImage,
  readWorkspaceImage,
  readWorkspaceFile,
  readWorkspacePdf,
  renameWorkspaceEntry,
  resolveOpenTargetPath,
  resolveWorkspaceFile,
  pickAndSaveWorkspaceImage,
  saveWorkspaceClipboardImage,
  saveWorkspaceImageBytes,
  writeWorkspaceFile
} from '../services/workspace-service'
import {
  clearWriteInlineCompletionDebugEntries,
  listWriteInlineCompletionDebugEntries,
  requestWriteInlineCompletion
} from '../services/write-inline-completion-service'
import { retrieveWriteContext } from '../services/write-retrieval-service'
import { requestWriteInfographic } from '../services/write-infographic-service'
import { authorizePrototypePath } from '../services/prototype-embed-registry'
import { requestSpeechTranscription } from '../services/speech-to-text-service'
import { optimizePrompt } from '../services/prompt-optimization-service'
import {
  cancelLocalWhisperModel,
  deleteLocalWhisperModel,
  checkLocalWhisperDownloadSources,
  downloadLocalWhisperModel,
  getLocalWhisperModelStatus,
  setLocalWhisperProgressEmitter
} from '../services/local-whisper-service'
import {
  getComputerUsePermissions,
  requestComputerUsePermission
} from '../services/computer-use-permissions'
import {
  copyWriteDocumentAsRichText,
  exportDesignPrototype,
  exportWriteDocument
} from '../services/write-export-service'
import { exportConversation } from '../services/conversation-export-service'
import { exportMemoryMarkdown } from '../services/memory-export-service'
import { importGithubSkillsToRoot } from '../services/github-skill-import-service'
import { readLocalPdfText } from '../services/write-pdf-text-service'
import { ensurePptMaster } from '../services/ppt-master-service'
import { saveGuiSkillPackage } from '../services/skill-save-service'
import {
  comparableSkillRootPath,
  listGuiSkillRoots,
  listGuiSkills,
  normalizeSkillRootPath
} from '../services/skill-service'
import {
  ensureJokerProjectConfigDirectory,
  loadJokerProjectConfig,
  readJokerProjectConfigSource,
  writeJokerProjectConfig
} from '../../../Joker/src/config/project-config.js'
import { readProjectConfigState } from '../services/project-config-service'

const extensionArtifactActionSchema = z.strictObject({
  artifactId: z.string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/),
  ownerExtensionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/),
  ownerExtensionVersion: z.string().min(1).max(64),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceRoot: z.string().min(1).max(16_384).refine(isAbsolute),
  action: z.enum(['open', 'reveal'])
})
const extensionArtifactResolutionSchema = z.strictObject({
  artifactId: z.string().min(16).max(512),
  absolutePath: z.string().min(1).max(16_384).refine(isAbsolute),
  displayName: z.string().min(1).max(256),
  mimeType: z.string().min(3).max(128)
})

type WorkspaceFileWatchRecord = {
  watcher: FSWatcher
  sender: WebContents
  path: string
  workspaceRoot: string
  timer: ReturnType<typeof setTimeout> | null
}

type WorkspaceFileWatchSenderRecord = {
  sender: WebContents
  onDestroyed: () => void
}

type RegisterAppIpcHandlersOptions = {
  store: JsonSettingsStore
  getMainWindow: () => BrowserWindow | null
  applySettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  saveSettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  runtimeRequest: (
    path: string,
    method?: string,
    body?: string,
    headers?: Record<string, string>
  ) => Promise<RuntimeRequestResult>
  restartRuntime: () => Promise<void>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  getClawRuntime: () => ClawRuntime | null
  getScheduleRuntime: () => ScheduleRuntime | null
  getWorkflowRuntime: () => WorkflowRuntime | null
  startFeishuInstallQrcode: (isLark: boolean) => Promise<ClawImInstallQrResult>
  pollFeishuInstall: (deviceCode: string) => Promise<ClawImInstallPollResult>
  startWeixinInstallQrcode: (weixinBridgeUrl?: string) => Promise<ClawImInstallQrResult>
  pollWeixinInstall: (deviceCode: string, weixinBridgeUrl?: string) => Promise<ClawImInstallPollResult>
  resolveJokerConfigPath: () => string
  onJokerMcpConfigWritten?: (path: string, content: string) => Promise<void> | void
  onJokerProjectConfigChanged?: (path: string, content: string) => Promise<void> | void
  showTurnCompleteNotification: (
    payload: TurnCompleteNotificationPayload
  ) => Promise<SystemNotificationResult>
  getAppVersion: () => string
  resolveLogDirectory: () => string
  logError: (category: string, message: string, detail?: unknown) => void
}

function parseIpcPayload<T>(channel: string, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new Error(`Invalid payload for ${channel}: ${issue?.message ?? 'Bad request.'}`)
}

function withoutRendererProjectConfigGrants(partial: AppSettingsPatch): AppSettingsPatch {
  const Joker = partial.agents?.Joker
  if (!Joker || Joker.projectConfig === undefined) return partial
  const { projectConfig: _projectConfig, ...safeJoker } = Joker
  void _projectConfig
  return {
    ...partial,
    agents: {
      ...partial.agents,
      Joker: safeJoker
    }
  }
}

function assertTrustedWorkbenchSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: () => BrowserWindow | null
): void {
  const window = getMainWindow()
  const senderFrame = event.senderFrame
  const mainFrame = window?.webContents.mainFrame
  if (
    !window ||
    window.isDestroyed() ||
    event.sender.id !== window.webContents.id ||
    !senderFrame ||
    !mainFrame ||
    senderFrame.processId !== mainFrame.processId ||
    senderFrame.routingId !== mainFrame.routingId
  ) {
    throw new Error('IPC sender is not the trusted workbench frame.')
  }
}

// node:fs/promises 没有内置 pathExists;用 access 实现。
async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function safeSaveAsFileName(input: string | undefined, fallback = 'generated-file'): string {
  const candidate = (input ?? '').trim().replace(/\0/g, '')
  const name = basename(candidate) || fallback
  if (name === '.' || name === '..') return fallback
  return name
}

function saveDialogFilters(fileName: string, mimeType: string | undefined): Electron.FileFilter[] {
  const ext = extname(fileName).replace(/^\./, '').trim()
  const mime = mimeType?.toLowerCase().trim() ?? ''
  const filters: Electron.FileFilter[] = []
  if (mime.startsWith('image/')) {
    filters.push({ name: 'Images', extensions: ext ? [ext] : ['png', 'jpg', 'jpeg', 'webp', 'gif'] })
  } else if (mime.startsWith('video/')) {
    filters.push({ name: 'Videos', extensions: ext ? [ext] : ['mp4', 'webm', 'mov', 'm4v'] })
  } else if (ext) {
    filters.push({ name: `${ext.toUpperCase()} file`, extensions: [ext] })
  }
  filters.push({ name: 'All Files', extensions: ['*'] })
  return filters
}

async function saveWorkspaceFileAs(
  payload: unknown,
  getMainWindow: () => BrowserWindow | null
): Promise<WorkspaceFileSaveAsResult> {
  const request = parseIpcPayload('file:save-as', workspaceFileSaveAsPayloadSchema, payload)
  try {
    const sourcePath = request.sourcePath
      ? await resolveOpenTargetPath(request.sourcePath, request.workspaceRoot, { allowBasenameFallback: false })
      : ''
    const fileName = safeSaveAsFileName(request.suggestedName || (sourcePath ? basename(sourcePath) : undefined))
    const defaultPath = request.workspaceRoot?.trim()
      ? join(expandHomePath(request.workspaceRoot), fileName)
      : fileName
    const options: Electron.SaveDialogOptions = {
      title: 'Save generated file',
      defaultPath,
      filters: saveDialogFilters(fileName, request.mimeType)
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, message: 'Save cancelled.' }
    }

    const targetPath = resolve(result.filePath)
    await mkdir(dirname(targetPath), { recursive: true })
    if (sourcePath) {
      if (resolve(sourcePath) !== targetPath) {
        await copyFile(sourcePath, targetPath)
      }
    } else if (request.dataBase64) {
      await writeFile(targetPath, Buffer.from(request.dataBase64, 'base64'))
    } else {
      return { ok: false, message: 'No file data was available to save.' }
    }
    return { ok: true, path: targetPath }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function validateMcpConfigContent(content: string): void {
  const trimmed = content.trim()
  if (!trimmed) return
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`MCP config must be JSON: ${message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP config must be a JSON object.')
  }
}

function sameProjectWorkspace(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const path = resolve(value).replaceAll('\\', '/').replace(/\/+$/g, '')
    return process.platform === 'win32' ? path.toLowerCase() : path
  }
  return normalize(left) === normalize(right)
}

function runDesktopCommand(
  command: DesktopCommand,
  sender: WebContents,
  getMainWindow: () => BrowserWindow | null
): void {
  const mainWindow = getMainWindow()
  const contents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : sender

  switch (command) {
    case 'undo':
      contents.undo()
      return
    case 'redo':
      contents.redo()
      return
    case 'cut':
      contents.cut()
      return
    case 'copy':
      contents.copy()
      return
    case 'paste':
      contents.paste()
      return
    case 'selectAll':
      contents.selectAll()
      return
    case 'reload':
      reloadRenderer(contents)
      return
    case 'zoomIn':
      contents.setZoomLevel(contents.getZoomLevel() + 1)
      return
    case 'zoomOut':
      contents.setZoomLevel(contents.getZoomLevel() - 1)
      return
    case 'resetZoom':
      contents.setZoomLevel(0)
      return
    case 'toggleDevTools':
      contents.toggleDevTools()
      return
    case 'minimize':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
      return
    case 'toggleMaximize':
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
      return
    case 'close':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
      return
    case 'quit':
      app.quit()
      return
  }
}

export function registerAppIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  // Seed the built-in "design system & craft" skill into ~/.Joker/skills/ once.
  void ensureBundledSkills(join(homedir(), '.Joker'))
  const {
    store,
    getMainWindow,
    applySettingsPatch,
    saveSettingsPatch,
    runtimeRequest,
    restartRuntime,
    fetchUpstreamModels,
    getClawRuntime,
    getScheduleRuntime,
    getWorkflowRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    startWeixinInstallQrcode,
    pollWeixinInstall,
    resolveJokerConfigPath,
    onJokerMcpConfigWritten,
    onJokerProjectConfigChanged,
    showTurnCompleteNotification,
    getAppVersion,
    resolveLogDirectory,
    logError
  } = options
  setLocalWhisperProgressEmitter((payload) => {
    getMainWindow()?.webContents.send('speech:local-whisper:progress', payload)
  })
  const workspaceFileWatchers = new Map<string, WorkspaceFileWatchRecord>()
  const workspaceFileWatchSenders = new Map<number, WorkspaceFileWatchSenderRecord>()
  const executionSettingsConsents = new JokerExecutionSettingsConsentService()
  const uiPluginThemeController = new UiPluginCdpThemeController({
    getWebContents: () => {
      const window = getMainWindow()
      return window && !window.isDestroyed() ? window.webContents : null
    },
    onBackgroundError: (scope, error) => {
      logError('ui-plugin-cdp', `UI plugin CDP theme ${scope} failed`, {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
  let uiPluginOperationQueue: Promise<void> = Promise.resolve()
  const enqueueUiPluginOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = uiPluginOperationQueue.then(operation, operation)
    uiPluginOperationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const applyProtectedSettingsPatch = async (
    event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
    partial: AppSettingsPatch,
    persist: (patch: AppSettingsPatch) => Promise<AppSettingsV1>
  ): Promise<AppSettingsV1> => {
    const current = await store.load()
    const change = JokerExecutionSettingsChange(current, partial)
    if (!change) return persist(partial)

    assertTrustedWorkbenchSender(event, getMainWindow)
    const parent = getMainWindow()
    const senderFrame = event.senderFrame
    if (!parent || parent.isDestroyed() || !senderFrame) {
      throw new Error('Protected execution-settings window is unavailable.')
    }
    const confirmation = await dialog.showMessageBox(parent, {
      type: 'warning',
      title: 'Change Joker execution permissions',
      message: 'Apply this tool approval and sandbox configuration?',
      detail: [
        `Current approval policy: ${change.current.approvalPolicy}`,
        `Current sandbox: ${change.current.sandboxMode}`,
        `New approval policy: ${change.next.approvalPolicy}`,
        `New sandbox: ${change.next.sandboxMode}`,
        '',
        'This protected native prompt cannot be confirmed by extension Webviews or Direct DOM content scripts.'
      ].join('\n'),
      buttons: ['Apply change', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      normalizeAccessKeys: true
    })
    if (confirmation.response !== 0) return current

    // Fail closed if another settings write raced the native decision. The
    // consent is for one exact transition, not whichever values are current
    // when the dialog eventually closes.
    const latest = await store.load()
    const latestExecution = {
      approvalPolicy: latest.agents.Joker.approvalPolicy,
      sandboxMode: latest.agents.Joker.sandboxMode
    }
    if (!executionSettingsEqual(latestExecution, change.current)) {
      throw new Error('Joker execution settings changed while confirmation was open; retry the change.')
    }

    const action: JokerExecutionSettingsConsentAction = {
      ...change,
      senderId: event.sender.id,
      senderProcessId: senderFrame.processId,
      senderRoutingId: senderFrame.routingId
    }
    const consent = executionSettingsConsents.issue(action)
    if (!executionSettingsConsents.consume(consent, action)) {
      throw new Error('Protected execution-settings consent is invalid or expired.')
    }
    return persist(partial)
  }

  const releaseWorkspaceFileWatchSender = (sender: WebContents): void => {
    const stillUsed = Array.from(workspaceFileWatchers.values()).some(
      (record) => record.sender.id === sender.id
    )
    if (stillUsed) return
    const record = workspaceFileWatchSenders.get(sender.id)
    if (!record) return
    record.sender.removeListener('destroyed', record.onDestroyed)
    workspaceFileWatchSenders.delete(sender.id)
  }

  const disposeWorkspaceFileWatch = (watchId: string): boolean => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return false
    if (record.timer) clearTimeout(record.timer)
    try {
      record.watcher.close()
    } catch (error) {
      logError('workspace-watch', 'Failed to close workspace file watcher', {
        watchId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    workspaceFileWatchers.delete(watchId)
    releaseWorkspaceFileWatchSender(record.sender)
    return true
  }

  const disposeWorkspaceFileWatchesForSender = (sender: WebContents): void => {
    for (const [watchId, record] of workspaceFileWatchers) {
      if (record.sender.id === sender.id) {
        disposeWorkspaceFileWatch(watchId)
      }
    }
  }

  const retainWorkspaceFileWatchSender = (sender: WebContents): void => {
    if (workspaceFileWatchSenders.has(sender.id)) return
    const onDestroyed = (): void => {
      workspaceFileWatchSenders.delete(sender.id)
      disposeWorkspaceFileWatchesForSender(sender)
    }
    workspaceFileWatchSenders.set(sender.id, { sender, onDestroyed })
    sender.once('destroyed', onDestroyed)
  }

  const emitWorkspaceFileChange = async (watchId: string): Promise<void> => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    const changedAt = new Date().toISOString()
    try {
      const result = await readWorkspaceFile({
        path: record.path,
        workspaceRoot: record.workspaceRoot
      })
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      if (result.ok) {
        latest.sender.send('file:workspace-changed', {
          ok: true,
          watchId,
          workspaceRoot: latest.workspaceRoot,
          path: result.path,
          content: result.content,
          size: result.size,
          truncated: result.truncated,
          changedAt
        })
        return
      }
      latest.sender.send('file:workspace-changed', {
        ok: false,
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: result.message,
        changedAt
      })
    } catch (error) {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      latest.sender.send('file:workspace-changed', {
        ok: false,
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: error instanceof Error ? error.message : String(error),
        changedAt
      })
    }
  }

  const scheduleWorkspaceFileChange = (watchId: string): void => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    if (record.timer) clearTimeout(record.timer)
    record.timer = setTimeout(() => {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest) return
      latest.timer = null
      void emitWorkspaceFileChange(watchId)
    }, 90)
  }

  ipcMain.handle('settings:get', async () => store.load())
  // Claude Pro/Max subscription login (compliant path: official CLI does the
  // OAuth; we only detect it / capture the setup-token).
  ipcMain.handle('claude-subscription:status', async () => claudeSubscriptionStatus())
  // The Claude Code binary (~222MB) is NOT bundled — it's downloaded on demand
  // into userData/agent-sdk and resolved from there (or Joker/node_modules in dev).
  const claudeSubJokerDirs = (): string[] =>
    [
      app.isPackaged ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked') : app.getAppPath(),
      process.cwd()
    ].map((root) => join(root, 'Joker'))
  const claudeSubBinary = (): string | undefined =>
    resolveClaudeBinary(app.getPath('userData'), claudeSubJokerDirs())
  ipcMain.handle('claude-subscription:sdk-status', async () => ({
    ...agentSdkStatus(app.getPath('userData'), claudeSubJokerDirs()),
    download: agentSdkDownloadState()
  }))
  ipcMain.handle('claude-subscription:sdk-install', async () =>
    startAgentSdkInstall(
      { userDataDir: app.getPath('userData'), proxyUrl: resolveModelProviderProxyUrl(await store.load()) },
      (state) => getMainWindow()?.webContents.send('claude-subscription:sdk-progress', state)
    )
  )
  ipcMain.handle('claude-subscription:login', async () =>
    runClaudeSetupToken({ binaryPath: claudeSubBinary() })
  )
  ipcMain.handle('claude-subscription:models', async (_event, token: unknown) =>
    fetchSdkModels({
      token: typeof token === 'string' ? token : undefined,
      JokerRoots: claudeSubJokerDirs(),
      binaryPath: claudeSubBinary()
    })
  )

  ipcMain.handle('settings:set', async (event, partial: unknown) =>
    applyProtectedSettingsPatch(
      event,
      withoutRendererProjectConfigGrants(
        parseIpcPayload('settings:set', settingsPatchSchema, partial) as AppSettingsPatch
      ),
      applySettingsPatch
    ))
  ipcMain.handle('settings:save-silent', async (event, partial: unknown) =>
    applyProtectedSettingsPatch(
      event,
      withoutRendererProjectConfigGrants(
        parseIpcPayload('settings:save-silent', settingsPatchSchema, partial) as AppSettingsPatch
      ),
      saveSettingsPatch
    ))

  ipcMain.handle('runtime:request', async (_, payload: unknown) => {
    const request = parseIpcPayload('runtime:request', runtimeRequestPayloadSchema, payload)
    return runtimeRequest(request.path, request.method, request.body)
  })

  ipcMain.handle('runtime:attachment:upload-image', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'runtime:attachment:upload-image',
      runtimeImageAttachmentUploadPayloadSchema,
      payload
    )
    return uploadRuntimeImageAttachmentQueued(request, { runtimeRequest })
  })

  ipcMain.handle('approval:decide', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'approval:decide',
      JokerProtectedApprovalPayloadSchema,
      payload
    )
    if (request.source === 'user') {
      const parent = getMainWindow()
      if (!parent || parent.isDestroyed()) throw new Error('Protected approval window is unavailable.')
      const allow = request.decision === 'allow'
      const confirmation = await dialog.showMessageBox(parent, {
        type: 'warning',
        title: allow ? 'Approve tool action' : 'Deny tool action',
        message: allow
          ? 'Allow this pending Joker tool action once?'
          : 'Deny this pending Joker tool action?',
        detail: `Approval: ${request.approvalId}\n\nThis protected native prompt cannot be controlled by extension Webviews or Direct DOM content scripts.`,
        buttons: [allow ? 'Allow once' : 'Deny', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        normalizeAccessKeys: true
      })
      if (confirmation.response !== 0) return { confirmed: false as const }
    }

    const settings = await store.load()
    const runtimeToken = getJokerRuntimeSettings(settings).runtimeToken.trim()
    const consentToken = createApprovalConsentToken({
      runtimeToken,
      approvalId: request.approvalId,
      decision: request.decision,
      expiresAt: Date.now() + 30_000
    })
    const response = await runtimeRequest(
      `/v1/approvals/${encodeURIComponent(request.approvalId)}`,
      'POST',
      JSON.stringify({ decision: request.decision }),
      { [JOKER_APPROVAL_CONSENT_HEADER]: consentToken }
    )
    return { confirmed: true as const, response }
  })

  ipcMain.handle('runtime:restart', async () => restartRuntime())

  ipcMain.handle('upstream:models', async () => fetchUpstreamModels())

  ipcMain.handle('provider:probe', async (_, payload: unknown) => {
    const request = parseIpcPayload('provider:probe', providerProbePayloadSchema, payload)
    return probeModelProvider(request, await store.load())
  })

  ipcMain.handle('prompt:optimize', async (_, payload: unknown) => {
    const request = parseIpcPayload('prompt:optimize', promptOptimizationPayloadSchema, payload)
    return optimizePrompt(await store.load(), request.text)
  })

  ipcMain.handle('claw:status', async (): Promise<ClawRuntimeStatus> =>
    getClawRuntime()?.status() ?? {
      imServerRunning: false,
      imUrl: '',
      runningTaskIds: []
    }
  )

  ipcMain.handle('claw:task:run', async (_, taskId: unknown): Promise<ScheduleRunResult> => {
    const normalizedTaskId = parseIpcPayload('claw:task:run', streamIdSchema, taskId)
    const scheduleRuntime = getScheduleRuntime()
    if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
    return scheduleRuntime.runTask(normalizedTaskId)
  })

  ipcMain.handle('schedule:status', async (): Promise<ScheduleRuntimeStatus> =>
    getScheduleRuntime()?.status() ?? {
      internalServerRunning: false,
      internalUrl: '',
      runningTaskIds: [],
      queuedTaskIds: [],
      powerSaveBlockerActive: false
    }
  )

  ipcMain.handle('schedule:task:run', async (_, taskId: unknown): Promise<ScheduleRunResult> => {
    const normalizedTaskId = parseIpcPayload('schedule:task:run', streamIdSchema, taskId)
    const scheduleRuntime = getScheduleRuntime()
    if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
    return scheduleRuntime.runTask(normalizedTaskId)
  })

  ipcMain.handle('workflow:status', async (): Promise<WorkflowRuntimeStatus> =>
    getWorkflowRuntime()?.status() ?? {
      runningWorkflowIds: [],
      nodeStatus: {},
      nodeResults: {},
      powerSaveBlockerActive: false,
      pendingApprovals: []
    }
  )

  ipcMain.handle('workflow:run', async (_, workflowId: unknown, input?: unknown): Promise<WorkflowRunResult> => {
    const normalizedId = parseIpcPayload('workflow:run', streamIdSchema, workflowId)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    // input is validated/coerced against the trigger's input schema inside runWorkflow.
    return workflowRuntime.runWorkflow(normalizedId, input)
  })

  ipcMain.handle('workflow:stop', async (_, workflowId: unknown): Promise<WorkflowRunResult> => {
    const normalizedId = parseIpcPayload('workflow:stop', streamIdSchema, workflowId)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.stopWorkflow(normalizedId)
  })

  ipcMain.handle('workflow:node:run', async (_, payload: unknown): Promise<WorkflowRunResult> => {
    const request = parseIpcPayload('workflow:node:run', workflowRunNodePayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.runSingleNode(request.workflowId, request.nodeId)
  })

  ipcMain.handle('workflow:node:test', async (_, payload: unknown): Promise<WorkflowNodeTestResult> => {
    const request = parseIpcPayload('workflow:node:test', workflowTestNodePayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false, message: 'Workflow runtime is not initialized.' }
    return workflowRuntime.testNode(request.workflowId, request.nodeId, request.mockJson)
  })

  ipcMain.handle('workflow:approval:resolve', async (_, payload: unknown): Promise<{ ok: boolean }> => {
    const request = parseIpcPayload('workflow:approval:resolve', workflowResolveApprovalPayloadSchema, payload)
    const workflowRuntime = getWorkflowRuntime()
    if (!workflowRuntime) return { ok: false }
    return { ok: workflowRuntime.resolveApproval(request.token, request.decision) }
  })

  ipcMain.handle('workflow:code:check', async (_, payload: unknown): Promise<WorkflowCodeCheckResult> => {
    const request = parseIpcPayload('workflow:code:check', workflowCodeCheckPayloadSchema, payload)
    return checkWorkflowCode(request.language, request.code)
  })

  ipcMain.handle(
    'claw:channel:mirror',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:channel:mirror', clawMirrorPayloadSchema, payload)
      const clawRuntime = getClawRuntime()
      if (!clawRuntime) return { ok: false as const, message: 'Claw runtime is not initialized.' }
      return clawRuntime.mirrorThreadMessageToIm(
        request.threadId,
        request.text,
        request.direction
      )
    }
  )

  ipcMain.handle(
    'claw:channel:mirror-to-feishu',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:channel:mirror-to-feishu', clawMirrorPayloadSchema, payload)
      const clawRuntime = getClawRuntime()
      if (!clawRuntime) return { ok: false as const, message: 'Claw runtime is not initialized.' }
      return clawRuntime.mirrorThreadMessageToIm(
        request.threadId,
        request.text,
        request.direction
      )
    }
  )

  ipcMain.handle(
    'claw:channel:deliver-files',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:channel:deliver-files', clawDeliverFilesPayloadSchema, payload)
      const clawRuntime = getClawRuntime()
      if (!clawRuntime) return { ok: false as const, message: 'Claw runtime is not initialized.' }
      return clawRuntime.deliverGeneratedFilesToIm(request.threadId, request.turnId)
    }
  )

  ipcMain.handle(
    'claw:task:create-from-text',
    async (_, payload: unknown): Promise<ClawTaskFromTextResult> => {
      const request = parseIpcPayload(
        'claw:task:create-from-text',
        clawTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      const settings = await store.load()
      const channel = request.channelId
        ? settings.claw.channels.find((item) => item.id === request.channelId)
        : undefined
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: channel?.workspaceRoot || settings.schedule.defaultWorkspaceRoot || settings.workspaceRoot,
        clawChannelId: channel?.id ?? request.channelId,
        providerId: request.providerId,
        modelHint: request.modelHint,
        reasoningEffort: request.reasoningEffort,
        mode: request.mode
      })
    }
  )

  ipcMain.handle(
    'schedule:task:create-from-text',
    async (_, payload: unknown): Promise<ScheduleTaskFromTextResult> => {
      const request = parseIpcPayload(
        'schedule:task:create-from-text',
        scheduleTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: request.workspaceRoot,
        clawChannelId: request.clawChannelId,
        providerId: request.providerId,
        modelHint: request.modelHint,
        reasoningEffort: request.reasoningEffort,
        mode: request.mode
      })
    }
  )

  ipcMain.handle(
    'claw:im-install:qrcode',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'claw:im-install:qrcode',
        z.object({ provider: z.enum(['feishu', 'weixin']), isLark: z.boolean().optional() }).strict(),
        payload
      )
      if (request.provider === 'weixin') {
        return startWeixinInstallQrcode()
      }
      return startFeishuInstallQrcode(request.isLark === true)
    }
  )

  ipcMain.handle(
    'claw:im-install:poll',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('claw:im-install:poll', clawImInstallPollPayloadSchema, payload)
      if (request.provider === 'weixin') {
        return pollWeixinInstall(request.deviceCode)
      }
      return pollFeishuInstall(request.deviceCode)
    }
  )

  ipcMain.handle(
    'claw:im-install:telegram-token',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'claw:im-install:telegram-token',
        clawImTelegramTokenPayloadSchema,
        payload
      )
      return verifyTelegramBotToken(request.botToken)
    }
  )

  ipcMain.handle('codex:auth:start', async () => {
    return startCodexDeviceAuth()
  })

  ipcMain.handle('codex:auth:poll', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'codex:auth:poll',
      z.object({ deviceCode: z.string().min(1), userCode: z.string().min(1) }).strict(),
      payload
    )
    return pollCodexDeviceAuth(request.deviceCode, request.userCode)
  })

  ipcMain.handle('codex:auth:browser', async () => {
    return startCodexBrowserAuth(async (url: string) => {
      await shell.openExternal(url)
    })
  })

  // --- GitHub OAuth + 仓库接管 ---
  ipcMain.handle('github:oauth:connect', async (_, payload: unknown) => {
    const { clientId, clientSecret } = parseIpcPayload(
      'github:oauth:connect',
      z.object({
        clientId: z.string().optional(),
        clientSecret: z.string().optional()
      }).strict(),
      payload
    )
    if (clientId?.trim()) {
      await storeGithubClientId(clientId.trim())
    }
    // 若用户在 UI 输入 secret（不持久化也走一次性传入），主进程优先使用它；
    // 否则任何此前持久化的 secret 都通过 main 的 getGithubClientSecret 兜底。
    // 这里不再重复持久化，避免 UI 误输入把磁盘上正确 secret 覆盖掉。
    const result = await startGithubOAuth(
      async (url: string) => {
        await shell.openExternal(url)
      },
      clientId,
      clientSecret
    )
    if (!result.ok) return { ok: false, message: result.message }
    await storeGithubCredentials(result.credentials)
    // 把新 GitHub 身份推给 runtime prefix，然后触发重启让 prefix 重建。
    // 不重启会让 agent 仍然按旧的（无身份 / 旧账号）上下文行动。
    await syncGithubAccountToEnvironment()
    await restartRuntime()
    return { ok: true, user: result.credentials.user }
  })

  // --- 登录界面 GitHub OAuth 登录（纯本地身份，不依赖账号服务器） ---
  // 复用「仓库接管」已连接的 GitHub 凭据（避免重复授权）；否则发起新的 PKCE 流程。
  // 仅把 GitHub 用户资料回传渲染层用于建立本地账号会话；GitHub token 全程留在主进程。
  ipcMain.handle('auth:github:login', async () => {
    let credentials = await getGithubCredentials()
    if (!credentials) {
      const result = await startGithubOAuth(async (url: string) => {
        await shell.openExternal(url)
      })
      if (!result.ok) return { ok: false, message: result.message }
      credentials = result.credentials
      await storeGithubCredentials(credentials)
      // 让 runtime 在下一轮初始化时拿到该 GitHub 身份（登录阶段不主动重启 runtime）。
      await syncGithubAccountToEnvironment()
    } else {
      // 复用旧凭据时也确保 env 同步（程序刚启动、credentials 已存在但 env 未设置的情况）。
      await syncGithubAccountToEnvironment()
    }
    const user = credentials.user
    return {
      ok: true,
      profile: {
        id: user.id,
        login: user.login,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl
      }
    }
  })

  ipcMain.handle('github:get-client-id', async () => {
    const clientId = await getGithubClientId()
    return { clientId }
  })

  ipcMain.handle('github:set-client-id', async (_, payload: unknown) => {
    const { clientId } = parseIpcPayload(
      'github:set-client-id',
      z.object({ clientId: z.string().min(1) }).strict(),
      payload
    )
    await storeGithubClientId(clientId.trim())
    return { ok: true }
  })

  ipcMain.handle('github:get-client-secret', async () => {
    // 只回传是否有 secret，不回传明文（避免在 renderer 内存或日志中泄漏）。
    const secret = await getGithubClientSecret()
    return { hasSecret: Boolean(secret) }
  })

  ipcMain.handle('github:set-client-secret', async (_, payload: unknown) => {
    const { secret } = parseIpcPayload(
      'github:set-client-secret',
      z.object({ secret: z.string().min(1) }).strict(),
      payload
    )
    await storeGithubClientSecret(secret)
    return { ok: true }
  })

  ipcMain.handle('github:clear-client-secret', async () => {
    await clearGithubClientSecret()
    return { ok: true }
  })

  ipcMain.handle('github:oauth:disconnect', async () => {
    await clearGithubCredentials()
    clearGithubAccountFromEnvironment()
    await restartRuntime()
    return { ok: true }
  })

  ipcMain.handle('github:status', async () => {
    const creds = await getGithubCredentials()
    return {
      connected: Boolean(creds),
      user: creds?.user ?? null,
      scope: creds?.scope ?? null
    }
  })

  // --- Cloudflare OAuth 授权 ---
  ipcMain.handle('cloudflare:oauth:connect', async (_, payload: unknown) => {
    const { clientId } = parseIpcPayload(
      'cloudflare:oauth:connect',
      z.object({ clientId: z.string().optional() }).strict(),
      payload
    )
    if (clientId?.trim()) {
      await storeCloudflareClientId(clientId.trim())
    }
    const result = await startCloudflareOAuth(
      async (url: string) => {
        await shell.openExternal(url)
      },
      clientId
    )
    if (!result.ok) return { ok: false, message: result.message }
    await storeCloudflareCredentials(result.credentials)
    return { ok: true, user: result.credentials.user }
  })

  ipcMain.handle('cloudflare:oauth:disconnect', async () => {
    const creds = await getCloudflareCredentials()
    if (creds) {
      await revokeCloudflareToken(creds.accessToken)
    }
    await clearCloudflareCredentials()
    return { ok: true }
  })

  ipcMain.handle('cloudflare:status', async () => {
    const creds = await getCloudflareCredentials()
    return {
      connected: Boolean(creds),
      user: creds?.user ?? null,
      scope: creds?.scope ?? null
    }
  })

  ipcMain.handle('cloudflare:get-client-id', async () => {
    const clientId = await getCloudflareClientId()
    return { clientId }
  })

  ipcMain.handle('cloudflare:set-client-id', async (_, payload: unknown) => {
    const { clientId } = parseIpcPayload(
      'cloudflare:set-client-id',
      z.object({ clientId: z.string().min(1) }).strict(),
      payload
    )
    await storeCloudflareClientId(clientId.trim())
    return { ok: true }
  })

  ipcMain.handle('cloudflare:clear-client-id', async () => {
    await clearCloudflareClientId()
    return { ok: true }
  })

  // --- Cloudflare MCP（官方远程 API MCP，复用 OAuth 凭据） ---
  ipcMain.handle('cloudflare:mcp:enable', async () => {
    return enableCloudflareMcp()
  })

  ipcMain.handle('cloudflare:mcp:disable', async () => {
    await disableCloudflareMcp()
    return { ok: true }
  })

  ipcMain.handle('cloudflare:mcp:status', async () => {
    return { enabled: await isCloudflareMcpEnabled() }
  })

  ipcMain.handle('github:list-repos', async () => {
    const creds = await getGithubCredentials()
    if (!creds) throw new Error('尚未连接 GitHub')
    return listUserRepos(creds.accessToken)
  })

  ipcMain.handle('github:clone-repo', async (_, payload: unknown) => {
    const creds = await getGithubCredentials()
    if (!creds) throw new Error('尚未连接 GitHub')
    const request = parseIpcPayload(
      'github:clone-repo',
      z.object({ cloneUrl: z.string().min(1), repoName: z.string().min(1) }).strict(),
      payload
    )
    const chosen = dialog.showOpenDialogSync({
      title: '选择克隆位置',
      properties: ['openDirectory', 'createDirectory', 'showHiddenFiles']
    })
    if (!chosen || chosen.length === 0) return { cancelled: true }
    const targetDir = join(chosen[0], request.repoName)
    const result = await cloneRepository({
      token: creds.accessToken,
      cloneUrl: request.cloneUrl,
      targetDir
    })
    return { ...result, cancelled: false }
  })

  ipcMain.handle('github:push', async (_, payload: unknown) => {
    const creds = await getGithubCredentials()
    if (!creds) throw new Error('尚未连接 GitHub')
    const request = parseIpcPayload(
      'github:push',
      z.object({ cwd: z.string().min(1), branch: z.string().min(1).optional() }).strict(),
      payload
    )
    await pushRepository({ token: creds.accessToken, cwd: request.cwd, branch: request.branch })
    return { ok: true }
  })

  ipcMain.handle('github:pull', async (_, payload: unknown) => {
    const creds = await getGithubCredentials()
    if (!creds) throw new Error('尚未连接 GitHub')
    const request = parseIpcPayload(
      'github:pull',
      z.object({ cwd: z.string().min(1), branch: z.string().min(1).optional() }).strict(),
      payload
    )
    await pullRepository({ token: creds.accessToken, cwd: request.cwd, branch: request.branch })
    return { ok: true }
  })

  ipcMain.handle('github:create-pr', async (_, payload: unknown) => {
    const creds = await getGithubCredentials()
    if (!creds) throw new Error('尚未连接 GitHub')
    const request = parseIpcPayload(
      'github:create-pr',
      z.object({
        owner: z.string().min(1),
        repo: z.string().min(1),
        title: z.string().min(1),
        head: z.string().min(1),
        base: z.string().min(1),
        body: z.string().optional()
      }).strict(),
      payload
    )
    const result = await createPullRequest({
      token: creds.accessToken,
      owner: request.owner,
      repo: request.repo,
      title: request.title,
      head: request.head,
      base: request.base,
      body: request.body
    })
    return { ok: true, htmlUrl: result.htmlUrl }
  })

  // --- GitHub MCP 服务器（一键把已登录 token 注入 Joker MCP 配置）---
  ipcMain.handle('github:mcp:enable', async () => {
    try {
      await enableGithubMcp()
      // 关键：写完 mcp.json 后必须触发与 GUI MCP 设置页相同的同步链路，
      // 否则运行中的 agent 运行时（config.json + 已 spawn 的 MCP 进程）不会
      // 感知到新服务器，对话里也就调不到 GitHub 工具。
      await onJokerMcpConfigWritten?.(resolveJokerMcpJsonPath(), '')
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('github:mcp:disable', async () => {
    await disableGithubMcp()
    await onJokerMcpConfigWritten?.(resolveJokerMcpJsonPath(), '')
    return { ok: true as const }
  })

  ipcMain.handle('github:mcp:status', async () => {
    const enabled = await isGithubMcpEnabled()
    return { enabled }
  })

  ipcMain.handle('codex:account:usage', async () => {
    try {
      const settings = await store.load()
      const provider = settings.provider.providers.find((p) => p.id === 'codex')
      if (!provider || !provider.apiKey) {
        return { ok: false, message: 'Codex provider not configured' }
      }
      let creds = parseCodexCredentials(provider.apiKey)
      if (!creds) {
        return { ok: false, message: 'Not an OAuth account' }
      }
      // access_token 即将过期时刷新；回写新凭据以应对 refresh_token rotation。
      if (creds.expiresAt <= Date.now() + 60_000) {
        const refreshed = await refreshCodexToken(creds)
        if (refreshed) {
          creds = refreshed
          const updatedProviders = settings.provider.providers.map((p) =>
            p.id === 'codex' ? { ...p, apiKey: encodeCodexCredentials(refreshed) } : p
          )
          await store.save({ ...settings, provider: { ...settings.provider, providers: updatedProviders } })
        }
      }
      const usageResult = await fetchCodexAccountUsage(creds)
      return usageResult
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('workspace:pick-directory', async (_, defaultPath: unknown): Promise<WorkspacePickResult> => {
    const normalizedDefaultPath = parseIpcPayload(
      'workspace:pick-directory',
      z.object({ defaultPath: defaultPathSchema }).strict(),
      { defaultPath }
    ).defaultPath
    const options: Electron.OpenDialogOptions = {
      title: 'Select working directory',
      defaultPath: normalizedDefaultPath,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  ipcMain.handle('workspace:directory-exists', async (_, workspaceRoot: unknown): Promise<boolean> => {
    const normalizedWorkspaceRoot = parseIpcPayload(
      'workspace:directory-exists',
      workspaceRootSchema,
      workspaceRoot
    )
    try {
      return (await stat(expandHomePath(normalizedWorkspaceRoot))).isDirectory()
    } catch {
      return false
    }
  })

  ipcMain.handle('file:pick-local-files', async (_, defaultPath: unknown) => {
    const normalizedDefaultPath = parseIpcPayload(
      'file:pick-local-files',
      z.object({ defaultPath: defaultPathSchema }).strict(),
      { defaultPath }
    ).defaultPath
    const options: Electron.OpenDialogOptions = {
      title: 'Add files to conversation',
      defaultPath: normalizedDefaultPath,
      properties: ['openFile', 'multiSelections', 'dontAddToRecent']
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      paths: result.canceled ? [] : result.filePaths
    }
  })

  // 在对话工作目录根下创建一个 YYYYMMDD-HHmmss 时间戳子目录作为新对话的工作目录。
  ipcMain.handle(
    'conversation:create-workspace',
    async (_, payload: unknown): Promise<ConversationWorkspaceCreateResult> => {
      try {
        const request = parseIpcPayload(
          'conversation:create-workspace',
          z.object({ root: defaultPathSchema }).strict(),
          payload ?? {}
        )
        const settings = await store.load()
        const rawRoot = request.root ?? settings.conversationWorkspaceRoot ?? ''
        const root = expandHomePath(rawRoot)
        if (!root) {
          return { ok: false, path: '', error: 'conversation workspace root is empty' }
        }
        const stamp = new Date()
        const pad = (n: number): string => String(n).padStart(2, '0')
        const base =
          `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
          `-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
        // 同秒内连建两个对话会得到相同时间戳目录。冲突时追加随机后缀保证唯一。
        let workspacePath = join(root, base)
        let suffixAttempt = 0
        while (await pathExists(workspacePath)) {
          suffixAttempt += 1
          // 形如 20260626-153012-a3f9;重试到上限仍未解决就用毫秒兜底。
          const suffix = suffixAttempt <= 6
            ? randomBytes(2).toString('hex')
            : `${stamp.getMilliseconds()}${randomBytes(1).toString('hex')}`
          workspacePath = join(root, `${base}-${suffix}`)
        }
        // 对话根目录由设置存储层创建；若用户改成自定义目录，则要求该目录已存在，
        // 禁止在这里递归补建用户选择的路径。
        await mkdir(workspacePath)
        return { ok: true, path: workspacePath }
      } catch (error) {
        return {
          ok: false,
          path: '',
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle('dialog:alert', async (_, payload: unknown): Promise<void> => {
    const request = parseIpcPayload('dialog:alert', alertDialogPayloadSchema, payload)
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: [request.buttonLabel ?? 'OK'],
      defaultId: 0,
      cancelId: 0,
      message: request.message,
      detail: request.detail,
      noLink: true
    }
    const mainWindow = getMainWindow()
    if (mainWindow) {
      await dialog.showMessageBox(mainWindow, options)
      return
    }
    await dialog.showMessageBox(options)
  })

  // Replaces window.confirm in the renderer: the synchronous native confirm
  // leaves the WebContents unable to focus inputs after it closes
  // (electron/electron#19977), which froze the composer after deleting threads.
  ipcMain.handle('dialog:confirm', async (_, payload: unknown): Promise<boolean> => {
    const request = parseIpcPayload('dialog:confirm', confirmDialogPayloadSchema, payload)
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: [request.confirmLabel ?? 'OK', request.cancelLabel ?? 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: request.message,
      detail: request.detail,
      noLink: true
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options)
    return result.response === 0
  })

  ipcMain.handle(
    'skill:save-file',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('skill:save-file', skillSaveFilePayloadSchema, payload)
      try {
        const result = await saveGuiSkillPackage(request)
        return { ok: true as const, path: result.path }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle('skill:import-github', async (_, payload: unknown) => {
    const request = parseIpcPayload('skill:import-github', skillGithubImportPayloadSchema, payload)
    return importGithubSkillsToRoot(request)
  })

  ipcMain.handle('ppt-master:ensure', async () => {
    const settings = await store.load()
    if (isManagedPptMasterSkillRootDisabled(settings)) {
      return {
        ok: false as const,
        message: 'PPT Master uses ~/.Joker/skills, which is disabled in Settings → Agents → Skills. Enable that skill directory, then try again.'
      }
    }
    const result = await ensurePptMaster({
      JokerHomeDir: join(homedir(), '.Joker'),
      proxyUrl: resolveModelProviderProxyUrl(settings)
    })
    if (!result.ok) return result
    try {
      // SkillRuntime discovers both skill entries and local tools only at
      // construction time. Reload even after a repair-only ensure: a prior
      // dependency install may have failed after the venv was created.
      await restartRuntime()
      return result
    } catch (error) {
      return {
        ok: false as const,
        message: `PPT Master installed, but Joker could not restart: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  })

  ipcMain.handle('skill:list', async (_, payload: unknown) => {
    const request = parseIpcPayload('skill:list', skillListPayloadSchema, payload)
    const settings = await store.load()
    return listGuiSkills(settings, request.workspaceRoot)
  })

  ipcMain.handle('skill:list-roots', async (_, payload: unknown) => {
    const request = parseIpcPayload('skill:list-roots', skillListPayloadSchema, payload)
    const settings = await store.load()
    return listGuiSkillRoots(settings, request.workspaceRoot)
  })

  ipcMain.handle('skill:open-root', async (_, rootPath: unknown) => {
    const normalizedRootPath = parseIpcPayload('skill:open-root', rootPathSchema, rootPath)
    try {
      const target = expandHomePath(normalizedRootPath)
      if (!target) {
        return { ok: false as const, message: 'Skill directory is required.' }
      }
      await mkdir(target, { recursive: true })
      return openPathWithShell(target)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('ui-plugin:list', async (event) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const JokerHomeDir = join(homedir(), '.Joker')
    await ensureBundledUiPlugins(JokerHomeDir)
    return { plugins: await listUiPlugins(JokerHomeDir) }
  })

  ipcMain.handle('ui-plugin:install', async (event) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const mainWindow = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Select a UI plugin folder',
      properties: ['openDirectory', 'dontAddToRecent']
    }
    const picked = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    const sourceDir = picked.filePaths[0]
    if (picked.canceled || !sourceDir) {
      return { canceled: true as const }
    }
    const result = await enqueueUiPluginOperation(() =>
      installUiPluginFromDirectory(join(homedir(), '.Joker'), sourceDir)
    )
    if (!result.ok) {
      return { canceled: false as const, ok: false as const, errors: result.errors }
    }
    return { canceled: false as const, ok: true as const, plugin: result.plugin }
  })

  ipcMain.handle('ui-plugin:remove', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload('ui-plugin:remove', uiPluginIdPayloadSchema, payload)
    return enqueueUiPluginOperation(async () => {
      if (uiPluginThemeController.activePluginId === request.id) {
        try {
          await uiPluginThemeController.deactivate()
        } catch (error) {
          logError('ui-plugin-cdp', 'Could not deactivate the UI plugin before removal', {
            pluginId: request.id,
            message: error instanceof Error ? error.message : String(error)
          })
          return { ok: false }
        }
      }
      return { ok: await removeUiPlugin(join(homedir(), '.Joker'), request.id) }
    })
  })

  ipcMain.handle('ui-plugin:load', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload('ui-plugin:load', uiPluginIdPayloadSchema, payload)
    const JokerHomeDir = join(homedir(), '.Joker')
    await ensureBundledUiPlugins(JokerHomeDir)
    return loadUiPluginFigures(JokerHomeDir, request.id)
  })

  ipcMain.handle('ui-plugin:theme:activate', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'ui-plugin:theme:activate',
      uiPluginIdPayloadSchema,
      payload
    )
    return enqueueUiPluginOperation(async () => {
      const JokerHomeDir = join(homedir(), '.Joker')
      await ensureBundledUiPlugins(JokerHomeDir)
      const loaded = await loadUiPluginFigures(JokerHomeDir, request.id)
      if (!loaded.ok) return { ok: false as const, error: loaded.error }

      // Only normalized manifest fields and main-validated image data reach the
      // CSS builders. The renderer cannot supply CSS or executable payloads.
      const css = [
        buildUiPluginTokenCss(loaded.manifest),
        buildUiPluginPresentationCss(loaded.manifest),
        buildUiPluginSceneCss(loaded.manifest),
        buildUiPluginBackgroundCss(loaded.manifest, loaded.backgrounds)
      ]
        .filter(Boolean)
        .join('\n\n')
      try {
        await uiPluginThemeController.activate(loaded.manifest.id, css)
        return {
          ok: true as const,
          manifest: loaded.manifest,
          figures: loaded.figures,
          sceneAssets: loaded.sceneAssets
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logError('ui-plugin-cdp', 'Could not activate a UI plugin theme', {
          pluginId: loaded.manifest.id,
          message
        })
        return { ok: false as const, error: message }
      }
    })
  })

  ipcMain.handle('ui-plugin:theme:deactivate', async (event) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    return enqueueUiPluginOperation(async () => {
      try {
        await uiPluginThemeController.deactivate()
        return { ok: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logError('ui-plugin-cdp', 'Could not deactivate the UI plugin theme', { message })
        return { ok: false as const, error: message }
      }
    })
  })

  ipcMain.handle('Joker:config:read', async () => {
    const path = resolveJokerConfigPath()
    try {
      const content = await readFile(path, 'utf8')
      return { path, content, exists: true as const }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path, content: '', exists: false as const }
      }
      throw error
    }
  })

  ipcMain.handle('Joker:config:write', async (_, content: unknown) => {
    const validatedContent = parseIpcPayload(
      'Joker:config:write',
      deepseekConfigContentSchema,
      content
    )
    const path = resolveJokerConfigPath()
    validateMcpConfigContent(validatedContent)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, validatedContent, 'utf8')
    try {
      await onJokerMcpConfigWritten?.(path, validatedContent)
    } catch (error: unknown) {
      logError('mcp-config', 'Failed to apply MCP config change after write', {
        path,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return { ok: true as const, path }
  })

  ipcMain.handle('Joker:config:open-dir', async () => {
    try {
      const path = resolveJokerConfigPath()
      const dirPath = dirname(path)
      await mkdir(dirPath, { recursive: true })
      return openPathWithShell(dirPath)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  const projectConfigFileResult = async (
    workspaceRoot: string,
    settingsOverride?: AppSettingsV1
  ) => {
    const settings = settingsOverride ?? await store.load()
    const state = await readProjectConfigState(settings, workspaceRoot)
    const source = await readJokerProjectConfigSource(workspaceRoot).catch(() => null)
    return {
      ...state,
      content: source?.content ?? '',
      exists: source?.exists ?? false
    }
  }

  ipcMain.handle('Joker:project-config:read', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'Joker:project-config:read',
      JokerProjectConfigWorkspacePayloadSchema,
      payload
    )
    return projectConfigFileResult(request.workspaceRoot)
  })

  ipcMain.handle('Joker:project-config:write', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'Joker:project-config:write',
      JokerProjectConfigWritePayloadSchema,
      payload
    )
    const written = await writeJokerProjectConfig(request.workspaceRoot, request.content)
    try {
      await onJokerProjectConfigChanged?.(written.path, request.content)
    } catch (error) {
      logError('project-config', 'Failed to apply project config change after write', {
        path: written.path,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return projectConfigFileResult(written.workspaceRoot)
  })

  ipcMain.handle('Joker:project-config:trust', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'Joker:project-config:trust',
      JokerProjectConfigTrustPayloadSchema,
      payload
    )
    const current = await store.load()
    const loaded = await loadJokerProjectConfig(request.workspaceRoot)
    if (request.trusted && loaded.status !== 'valid') {
      throw new Error(
        loaded.status === 'invalid'
          ? loaded.message
          : 'Project config must exist and be valid before it can be approved.'
      )
    }
    if (request.trusted && loaded.status === 'valid' &&
      loaded.digest !== request.expectedDigest.toLowerCase()) {
      throw new Error('Project config changed after confirmation. Refresh, review, and approve it again.')
    }
    const canonicalRoot = loaded.workspaceRoot
    const currentState = await readProjectConfigState(current, canonicalRoot)
    const enabledServers = currentState.serverSummaries.filter((server) => server.enabled)
    const isChinese = current.locale.toLowerCase().startsWith('zh')
    const detail = request.trusted
      ? [
          isChinese ? `工作区：${canonicalRoot}` : `Workspace: ${canonicalRoot}`,
          isChinese ? '将启用的 MCP：' : 'Enabled MCP servers:',
          enabledServers.length > 0
            ? enabledServers.map((server) => `${server.id}: ${server.target}`).join('\n')
            : isChinese ? '（无）' : '(none)',
          loaded.status === 'valid' ? `SHA-256: ${loaded.digest}` : '',
          isChinese
            ? '仅批准你已审查且信任的项目配置。批准后，Joker 可以启动其中声明的命令。'
            : 'Approve only a project configuration you reviewed and trust. Joker may start its declared commands.'
        ].filter(Boolean).join('\n\n')
      : isChinese
        ? `工作区：${canonicalRoot}\n\n撤销后，项目 MCP 将在下一次配置应用时被移除。`
        : `Workspace: ${canonicalRoot}\n\nProject MCP will be removed on the next configuration apply.`
    const confirmationOptions: Electron.MessageBoxOptions = {
      type: 'warning',
      title: request.trusted
        ? isChinese ? '批准项目 MCP' : 'Approve project MCP'
        : isChinese ? '撤销项目 MCP' : 'Revoke project MCP',
      message: request.trusted
        ? isChinese ? '批准当前项目 MCP 配置？' : 'Approve the current project MCP configuration?'
        : isChinese ? '撤销当前项目 MCP 授权？' : 'Revoke the current project MCP grant?',
      detail,
      buttons: request.trusted
        ? [isChinese ? '批准' : 'Approve', isChinese ? '取消' : 'Cancel']
        : [isChinese ? '撤销' : 'Revoke', isChinese ? '取消' : 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    }
    const mainWindow = getMainWindow()
    const confirmation = mainWindow
      ? await dialog.showMessageBox(mainWindow, confirmationOptions)
      : await dialog.showMessageBox(confirmationOptions)
    if (confirmation.response !== 0) {
      return projectConfigFileResult(canonicalRoot, current)
    }
    let confirmedDigest: string | undefined
    if (request.trusted) {
      const confirmed = await loadJokerProjectConfig(canonicalRoot)
      if (confirmed.status !== 'valid' ||
        !sameProjectWorkspace(confirmed.workspaceRoot, canonicalRoot) ||
        confirmed.digest !== request.expectedDigest.toLowerCase()) {
        throw new Error('Project config changed during confirmation. Refresh, review, and approve it again.')
      }
      confirmedDigest = confirmed.digest
    }
    const grants = getJokerRuntimeSettings(current).projectConfig.grants.filter((grant) =>
      !sameProjectWorkspace(grant.workspaceRoot, canonicalRoot)
    )
    if (request.trusted && confirmedDigest) {
      grants.push({ workspaceRoot: canonicalRoot, configDigest: confirmedDigest })
    }
    const saved = await applySettingsPatch({
      agents: { Joker: { projectConfig: { grants } } }
    })
    return projectConfigFileResult(canonicalRoot, saved)
  })

  ipcMain.handle('Joker:project-config:open-dir', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'Joker:project-config:open-dir',
      JokerProjectConfigWorkspacePayloadSchema,
      payload
    )
    try {
      const directory = await ensureJokerProjectConfigDirectory(request.workspaceRoot)
      return openPathWithShell(directory)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  const resolveJokerThreadsDataDir = async (): Promise<string> => {
    const settings = await store.load()
    const runtime = resolveJokerRuntimeSettings(settings)
    return expandHomePath(runtime.dataDir?.trim() || DEFAULT_JOKER_DATA_DIR)
  }

  // Map the user's checkpoint settings (issue #651) to the service storage
  // options: an optional directory override (e.g. another drive) and the
  // per-thread retention cap. Home-relative paths are expanded.
  const resolveCheckpointStorageOptions = (
    cfg: { directory?: string; maxPerThread?: number }
  ): GitCheckpointStorageOptions => ({
    ...(cfg.directory?.trim() ? { checkpointsRoot: expandHomePath(cfg.directory.trim()) } : {}),
    ...(cfg.maxPerThread !== undefined ? { maxPerThread: cfg.maxPerThread } : {})
  })

  ipcMain.handle('Joker:sessions:detect-legacy', async () =>
    detectLegacySessions({ homeDir: homedir(), destDataDir: await resolveJokerThreadsDataDir() })
  )

  ipcMain.handle('Joker:sessions:import-legacy', async (_, payload: unknown) => {
    const request = parseIpcPayload('Joker:sessions:import-legacy', legacySessionImportPayloadSchema, payload)
    try {
      const summary = await importLegacySessions({
        homeDir: homedir(),
        destDataDir: await resolveJokerThreadsDataDir(),
        ...(request.sourceDir ? { sourceDir: request.sourceDir } : {}),
        log: (message, detail) => logError('legacy-session-import', message, detail)
      })
      return { ok: true as const, ...summary }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('Joker:sessions:pick-source-dir', async (): Promise<WorkspacePickResult> => {
    const options: Electron.OpenDialogOptions = {
      title: 'Select a folder containing previous conversations',
      properties: ['openDirectory', 'dontAddToRecent']
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  ipcMain.handle('git:branches', async (_, workspaceRoot: unknown) =>
    getGitBranches(parseIpcPayload('git:branches', workspaceRootSchema, workspaceRoot))
  )
  ipcMain.handle(
    'git:switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:switch-branch', gitBranchPayloadSchema, payload)
      return switchGitBranch(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle(
    'git:create-and-switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'git:create-and-switch-branch',
        gitBranchPayloadSchema,
        payload
      )
      return createAndSwitchGitBranch(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle('git:checkpoint:create', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:checkpoint:create', gitCheckpointCreatePayloadSchema, payload)
    const settings = await store.load()
    return createGitCheckpoint({
      dataDir: await resolveJokerThreadsDataDir(),
      workspaceRoot: request.workspaceRoot,
      threadId: request.threadId,
      storage: resolveCheckpointStorageOptions(settings.checkpointCleanup)
    })
  })
  ipcMain.handle('git:checkpoint:restore', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:checkpoint:restore', gitCheckpointRestorePayloadSchema, payload)
    const settings = await store.load()
    return restoreGitCheckpoint({
      dataDir: await resolveJokerThreadsDataDir(),
      checkpointId: request.checkpointId,
      ...(request.allowPartialRestore ? { allowPartialRestore: true } : {}),
      ...(request.expectedThreadId ? { expectedThreadId: request.expectedThreadId } : {}),
      ...(request.expectedWorkspaceRoot ? { expectedWorkspaceRoot: request.expectedWorkspaceRoot } : {}),
      storage: resolveCheckpointStorageOptions(settings.checkpointCleanup),
      // Bridge the main-process runtimeRequest into the shape restoreGitCheckpoint
      // expects ((path, {method, body}) => {ok,status,body}). On a transport-level
      // failure (runtime not up, connection refused) we return a non-ok result so
      // the busy guard fails closed instead of throwing past the handler.
      runtimeRequest: async (path, init) => {
        try {
          return await runtimeRequest(path, init?.method, init?.body)
        } catch (error) {
          return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) }
        }
      }
    })
  })
  ipcMain.handle('git:restore-file', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:restore-file', gitRestoreFilePayloadSchema, payload)
    const { execFileAsync } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFile = promisify(execFileAsync)
    await execFile('git', ['-C', request.workspaceRoot, 'restore', '--', request.filePath], { timeout: 30_000 })
    return { ok: true as const }
  })
  ipcMain.handle(
    'git:checkout-branch-worktree',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:checkout-branch-worktree', gitBranchPayloadSchema, payload)
      return checkoutGitBranchWorktree(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle(
    'git:create-branch-worktree',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:create-branch-worktree', gitBranchPayloadSchema, payload)
      return createGitBranchWorktree(request.workspaceRoot, request.branch)
    }
  )
  ipcMain.handle('git:branch-worktrees', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:branch-worktrees', worktreePoolSchema, payload)
    return listGitBranchWorktrees(request.projectPath, request.worktreeRoot)
  })
  ipcMain.handle('git:remove-branch-worktree', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:remove-branch-worktree', gitWorktreeRemoveSchema, payload)
    return removeGitBranchWorktree(request)
  })

  // Worktree pool management
  ipcMain.handle('worktree:acquire', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:acquire', worktreeOptionalRootSchema, payload)
    return acquireWorktree({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      taskId: r.taskId,
      force: r.force,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:release', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:release', worktreePoolIndexSchema, payload)
    return releaseWorktree({ projectPath: r.projectPath, poolIndex: r.poolIndex })
  })
  ipcMain.handle('worktree:list', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:list', worktreePoolSchema, payload)
    return listWorktrees({ projectPath: r.projectPath, worktreeRoot: r.worktreeRoot })
  })
  ipcMain.handle('worktree:remove', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:remove', worktreePoolIndexSchema, payload)
    return removeWorktree({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:changes', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:changes', worktreePathSchema, payload)
    return getWorktreeChanges({ worktreePath: r.worktreePath })
  })
  ipcMain.handle('worktree:commit', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:commit', worktreeCommitSchema, payload)
    return commitWorktree({ worktreePath: r.worktreePath, message: r.message })
  })
  ipcMain.handle('worktree:merge', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:merge', worktreeMergeSchema, payload)
    return mergeWorktreeToMain({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      commitMessage: r.commitMessage,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:abort-merge', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:abort-merge', worktreeProjectPathSchema, payload)
    return abortMerge({ projectPath: r.projectPath })
  })
  ipcMain.handle('worktree:continue-merge', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:continue-merge', worktreeContinueMergeSchema, payload)
    return continueMerge({ projectPath: r.projectPath, message: r.message })
  })
  ipcMain.handle('worktree:sync', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:sync', worktreePoolIndexSchema, payload)
    return syncWorktreeFromMain({
      projectPath: r.projectPath,
      poolIndex: r.poolIndex,
      worktreeRoot: r.worktreeRoot
    })
  })
  ipcMain.handle('worktree:abort-rebase', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:abort-rebase', worktreePathSchema, payload)
    return abortRebase({ worktreePath: r.worktreePath })
  })
  ipcMain.handle('worktree:cleanup', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:cleanup', worktreePoolSchema, payload)
    return cleanupWorktrees({ projectPath: r.projectPath, worktreeRoot: r.worktreeRoot })
  })
  ipcMain.handle('worktree:find-available', async (_, payload: unknown) => {
    const r = parseIpcPayload('worktree:find-available', worktreePoolSchema, payload)
    return findAvailablePoolIndex({ projectPath: r.projectPath, worktreeRoot: r.worktreeRoot })
  })

  ipcMain.handle('editor:list', async () => listEditorsResult())
  ipcMain.handle('editor:open-path', async (_, payload: unknown) =>
    openEditorPath(parseIpcPayload('editor:open-path', openEditorPathPayloadSchema, payload))
  )

  ipcMain.handle('file:resolve-workspace', async (_, payload: unknown) =>
    resolveWorkspaceFile(
      parseIpcPayload('file:resolve-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:list-workspace-directory', async (_, payload: unknown) =>
    listWorkspaceDirectory(
      parseIpcPayload('file:list-workspace-directory', workspaceDirectoryTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace', async (_, payload: unknown) =>
    readWorkspaceFile(
      parseIpcPayload('file:read-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace-image', async (_, payload: unknown) =>
    readWorkspaceImage(
      parseIpcPayload('file:read-workspace-image', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-local-image', async (_, payload: unknown) => {
    const parsed = payload as { path?: string }
    const filePath = typeof parsed?.path === 'string' ? parsed.path : ''
    if (!filePath) return { ok: false, message: 'No file path provided.' }
    try {
      const fileInfo = await stat(filePath)
      if (fileInfo.isDirectory()) return { ok: false, message: 'Cannot preview a directory.' }
      if (fileInfo.size > 20 * 1024 * 1024)
        return { ok: false, message: 'This image is too large to preview.' }
      const ext = (filePath.split('.').pop() || '').toLowerCase()
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        tiff: 'image/tiff',
        tif: 'image/tiff',
        avif: 'image/avif'
      }
      const mimeType = mimeMap[ext]
      if (!mimeType) return { ok: false, message: 'Unsupported image type.' }
      const bytes = await readFile(filePath)
      return {
        ok: true,
        dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
        mimeType,
        size: fileInfo.size
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('file:read-workspace-pdf', async (_, payload: unknown) =>
    readWorkspacePdf(
      parseIpcPayload('file:read-workspace-pdf', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-local-pdf-text', async (_, payload: unknown) => {
    const result = await readLocalPdfText(
      parseIpcPayload('file:read-local-pdf-text', localPdfTextTargetPayloadSchema, payload)
    )
    if (!result.ok) return result
    return {
      ok: true,
      path: result.path,
      size: result.size,
      mtimeMs: result.mtimeMs,
      pageCount: result.pageCount,
      text: result.pages.map((page) => page.text).join('\n\n'),
      hasText: result.hasText,
      ocrApplied: result.ocrApplied,
      ocrPageCount: result.ocrPageCount,
      truncated: result.truncated
    }
  })
  ipcMain.handle('file:save-as', async (_, payload: unknown) =>
    saveWorkspaceFileAs(payload, getMainWindow)
  )
  ipcMain.handle('extension:artifact:open', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = parseIpcPayload(
      'extension:artifact:open',
      extensionArtifactActionSchema,
      payload
    )
    const result = await options.runtimeRequest(
      '/v1/extensions/media/artifacts/resolve',
      'POST',
      JSON.stringify({
        artifactId: input.artifactId,
        ownerExtensionId: input.ownerExtensionId,
        ownerExtensionVersion: input.ownerExtensionVersion,
        workspaceId: input.workspaceId,
        workspaceRoot: input.workspaceRoot
      })
    )
    if (!result.ok) {
      return { ok: false, message: 'Generated artifact is unavailable.' }
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(result.body)
    } catch {
      return { ok: false, message: 'Generated artifact metadata is invalid.' }
    }
    const resolved = extensionArtifactResolutionSchema.safeParse(decoded)
    if (!resolved.success || resolved.data.artifactId !== input.artifactId) {
      return { ok: false, message: 'Generated artifact metadata is invalid.' }
    }
    if (input.action === 'reveal') {
      shell.showItemInFolder(resolved.data.absolutePath)
      return { ok: true }
    }
    const error = await shell.openPath(resolved.data.absolutePath)
    return error
      ? { ok: false, message: 'The generated artifact could not be opened.' }
      : { ok: true }
  })
  ipcMain.handle('file:write-workspace', async (_, payload: unknown) =>
    writeWorkspaceFile(
      parseIpcPayload('file:write-workspace', workspaceFileWritePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:create-workspace', async (_, payload: unknown) =>
    createWorkspaceFile(
      parseIpcPayload('file:create-workspace', workspaceFileCreatePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:create-workspace-directory', async (_, payload: unknown) =>
    createWorkspaceDirectory(
      parseIpcPayload('file:create-workspace-directory', workspaceDirectoryCreatePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:save-workspace-clipboard-image', async (_, payload: unknown) =>
    saveWorkspaceClipboardImage(
      parseIpcPayload(
        'file:save-workspace-clipboard-image',
        workspaceClipboardImageSavePayloadSchema,
        payload
      )
    )
  )
  ipcMain.handle('file:pick-workspace-image', async (_, payload: unknown) =>
    pickAndSaveWorkspaceImage(
      parseIpcPayload('file:pick-workspace-image', workspaceImagePickPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('file:save-workspace-image-bytes', async (_, payload: unknown) =>
    saveWorkspaceImageBytes(
      parseIpcPayload('file:save-workspace-image-bytes', workspaceImageBytesSavePayloadSchema, payload)
    )
  )
  ipcMain.handle('clipboard:read-image', async () => readClipboardImage())
  ipcMain.handle('file:rename-workspace-entry', async (_, payload: unknown) =>
    renameWorkspaceEntry(
      parseIpcPayload('file:rename-workspace-entry', workspaceEntryRenamePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:delete-workspace-entry', async (_, payload: unknown) =>
    deleteWorkspaceEntry(
      parseIpcPayload('file:delete-workspace-entry', workspaceEntryDeletePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:watch-workspace', async (event, payload: unknown) => {
    const request = parseIpcPayload('file:watch-workspace', workspaceFileWatchPayloadSchema, payload)
    const initial = await readWorkspaceFile(request)
    let watchedPath: string
    let initialContent: string
    let initialSize: number
    let initialTruncated: boolean
    if (initial.ok) {
      watchedPath = initial.path
      initialContent = initial.content
      initialSize = initial.size
      initialTruncated = initial.truncated
    } else {
      const initialImage = await readWorkspaceImage(request)
      if (!initialImage.ok) return initial
      watchedPath = initialImage.path
      initialContent = ''
      initialSize = initialImage.size
      initialTruncated = false
    }

    const watchId = randomUUID()
    try {
      const watchedDirectory = dirname(watchedPath)
      const watchedName = basename(watchedPath)
      // Watch the containing directory rather than the file inode. Workspace
      // writes are atomic (`rename(temp, target)`), which replaces the inode and
      // permanently detaches a file-level watcher after its first update on
      // macOS/Linux. The directory remains stable across every replacement.
      const watcher = watch(watchedDirectory, { persistent: false }, (_eventType, filename) => {
        if (filename && basename(filename.toString()) !== watchedName) return
        scheduleWorkspaceFileChange(watchId)
      })
      workspaceFileWatchers.set(watchId, {
        watcher,
        sender: event.sender,
        path: watchedPath,
        workspaceRoot: request.workspaceRoot,
        timer: null
      })
      retainWorkspaceFileWatchSender(event.sender)
      // Close the read → watch race: a file can be atomically replaced after
      // the first read but before the directory watch starts. Re-read only
      // after the watch is live, so callers never bootstrap a stale SVG and a
      // later write is still delivered by the watcher.
      if (initial.ok) {
        const refreshed = await readWorkspaceFile(request)
        if (!refreshed.ok) {
          disposeWorkspaceFileWatch(watchId)
          return refreshed
        }
        initialContent = refreshed.content
        initialSize = refreshed.size
        initialTruncated = refreshed.truncated
      } else {
        const refreshed = await readWorkspaceImage(request)
        if (!refreshed.ok) {
          disposeWorkspaceFileWatch(watchId)
          return refreshed
        }
        initialSize = refreshed.size
      }
      return {
        ok: true as const,
        watchId,
        path: watchedPath,
        content: initialContent,
        size: initialSize,
        truncated: initialTruncated,
        startedAt: new Date().toISOString()
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('file:unwatch-workspace', async (_, watchId: unknown) =>
    disposeWorkspaceFileWatch(parseIpcPayload('file:unwatch-workspace', streamIdSchema, watchId))
  )
  ipcMain.handle('write:export', async (_, payload: unknown) =>
    exportWriteDocument(
      parseIpcPayload('write:export', writeExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('conversation:export', async (_, payload: unknown) =>
    exportConversation(
      parseIpcPayload('conversation:export', conversationExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('memory:export-markdown', async (_, payload: unknown) =>
    exportMemoryMarkdown(
      parseIpcPayload('memory:export-markdown', memoryMarkdownExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('design:export-prototype', async (_, payload: unknown) =>
    exportDesignPrototype(
      parseIpcPayload('design:export-prototype', designExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('design:lint-project-design-md', async (_, payload: unknown) => {
    const request = parseIpcPayload('design:lint-project-design-md', projectDesignMdLintPayloadSchema, payload)
    return lintProjectDesignMd(request.content)
  })
  ipcMain.handle('write:copy-rich-text', async (_, payload: unknown) =>
    copyWriteDocumentAsRichText(
      parseIpcPayload('write:copy-rich-text', writeRichClipboardPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:inline-completion', async (_, payload: unknown) =>
    requestWriteInlineCompletion(
      await store.load(),
      parseIpcPayload('write:inline-completion', writeInlineCompletionPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:retrieve-context', async (_, payload: unknown) => {
    try {
      const context = await retrieveWriteContext(
        parseIpcPayload('write:retrieve-context', writeRetrievalPayloadSchema, payload)
      )
      return { ok: true as const, context }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('write:generate-infographic', async (_, payload: unknown) =>
    requestWriteInfographic(
      await store.load(),
      parseIpcPayload('write:generate-infographic', writeInfographicPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:authorize-prototype', async (_, payload: unknown) => {
    const request = parseIpcPayload('write:authorize-prototype', writePrototypeFilePayloadSchema, payload)
    return authorizePrototypePath(request.path, request.workspaceRoot)
  })
  ipcMain.handle('write:open-prototype', async (_, payload: unknown) => {
    const request = parseIpcPayload('write:open-prototype', writePrototypeFilePayloadSchema, payload)
    const authorized = await authorizePrototypePath(request.path, request.workspaceRoot)
    if (!authorized.ok) return authorized
    return openPathWithShell(authorized.absolutePath)
  })
  ipcMain.handle('speech:transcribe', async (_, payload: unknown) =>
    requestSpeechTranscription(
      await store.load(),
      parseIpcPayload('speech:transcribe', speechTranscribePayloadSchema, payload)
    )
  )
  ipcMain.handle('speech:local-whisper:status', async (_, modelId: unknown) =>
    getLocalWhisperModelStatus(parseIpcPayload('speech:local-whisper:status', localWhisperModelIdPayloadSchema, modelId))
  )
  ipcMain.handle('speech:local-whisper:download', async (_, modelId: unknown) =>
    {
      const payload = parseIpcPayload('speech:local-whisper:download', localWhisperDownloadPayloadSchema, modelId)
      return downloadLocalWhisperModel(payload.modelId, payload.sourceId)
    }
  )
  ipcMain.handle('speech:local-whisper:cancel', async (_, modelId: unknown) =>
    cancelLocalWhisperModel(parseIpcPayload('speech:local-whisper:cancel', localWhisperModelIdPayloadSchema, modelId))
  )
  ipcMain.handle('speech:local-whisper:sources', async (_, payload: unknown) =>
    {
      const request = parseIpcPayload('speech:local-whisper:sources', localWhisperSourceStatusPayloadSchema, payload)
      return checkLocalWhisperDownloadSources(request.modelId)
    }
  )
  ipcMain.handle('speech:local-whisper:delete', async (_, modelId: unknown) =>
    deleteLocalWhisperModel(parseIpcPayload('speech:local-whisper:delete', localWhisperModelIdPayloadSchema, modelId))
  )
  ipcMain.handle('write:inline-completion-debug:list', async () => listWriteInlineCompletionDebugEntries())
  ipcMain.handle('write:inline-completion-debug:clear', async () => {
    clearWriteInlineCompletionDebugEntries()
    return true
  })
  ipcMain.handle('desktop:command', async (event, command: unknown) => {
    runDesktopCommand(
      parseIpcPayload('desktop:command', desktopCommandSchema, command),
      event.sender,
      getMainWindow
    )
  })
  ipcMain.handle('shell:open-external', async (_, url: unknown) => {
    const validatedUrl = parseIpcPayload('shell:open-external', shellOpenExternalUrlSchema, url)
    await shell.openExternal(validatedUrl)
  })
  ipcMain.handle('computer-use:permissions', async () => getComputerUsePermissions())
  ipcMain.handle('computer-use:request-permission', async (_, kind: unknown) => {
    const parsed = parseIpcPayload(
      'computer-use:request-permission',
      computerUsePermissionKindSchema,
      kind
    )
    return requestComputerUsePermission(parsed)
  })
  ipcMain.handle('notification:turn-complete', async (_, payload: unknown) =>
    showTurnCompleteNotification(
      parseIpcPayload('notification:turn-complete', notificationPayloadSchema, payload)
    )
  )
  ipcMain.handle('app:version', async () => getAppVersion())

  ipcMain.handle('log:error', async (_, payload: unknown) => {
    const request = parseIpcPayload('log:error', logErrorPayloadSchema, payload)
    logError(request.category, request.message, request.detail)
  })
  ipcMain.handle('log:get-path', async () => resolveLogDirectory())
  ipcMain.handle('log:open-dir', async () => {
    const dir = resolveLogDirectory()
    try {
      await mkdir(dir, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
    const error = await shell.openPath(dir)
    if (error) return { ok: false, message: error }
    return { ok: true }
  })
}

function isManagedPptMasterSkillRootDisabled(settings: AppSettingsV1): boolean {
  const target = comparableSkillRootPath(join(homedir(), '.Joker', 'skills'))
  const disabledDirectories = [
    ...settings.claw.skills.disabledDirs,
    ...settings.schedule.skills.disabledDirs
  ]
  return disabledDirectories.some((entry) =>
    entry.trim().toLowerCase() === 'global-deepseek' ||
    comparableSkillRootPath(normalizeSkillRootPath(entry)) === target
  )
}
