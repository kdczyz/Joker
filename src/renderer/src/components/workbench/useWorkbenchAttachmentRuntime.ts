import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoreRuntimeInfoJson } from '../../agent/Joker-contract'
import type { AttachmentReference, NormalizedThread, RuntimeConnectionStatus } from '../../agent/types'
import type { CanvasDocument } from '../../design/canvas/canvas-types'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { isChatAttachmentUploadEnabled } from '../../lib/attachment-upload-availability'
import { useSddDraftStore } from '../../sdd/sdd-draft-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useCanvasImageAutoAttachment } from '../design/useCanvasImageAutoAttachment'
import {
  composerAttachmentScopeForSurface,
  createEmptyComposerAttachmentsByScope,
  removeComposerAttachmentsById,
  updateComposerAttachmentsByScope,
  type ComposerAttachmentScope,
  type ComposerAttachmentUpdater,
  type ComposerAttachmentsByScope
} from '../workbench-composer-attachments'
import { useWorkbenchAttachmentController } from './useWorkbenchAttachmentController'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'

type WorkbenchAttachmentRuntimeOptions = {
  activeThreadId: string | null
  canvasDocument?: CanvasDocument
  canvasSelectedIds?: ReadonlySet<string>
  composerMode: 'plan' | 'agent'
  draftKey: string
  rightPanelMode: RightPanelMode | null
  route: string
  runtimeConnection: RuntimeConnectionStatus
  runtimeInfo: CoreRuntimeInfoJson | null
  threads: NormalizedThread[]
  workspaceRoot: string
  /**
   * Per-thread draft attachments loaded from the zustand store so images
   * survive route/unmount switches and thread switches.
   */
  draftAttachments?: AttachmentReference[]
  /**
   * Called whenever the chat-scope attachments change so the caller
   * can persist them under the current draftKey.
   */
  onChatAttachmentsChange?: (key: string, attachments: AttachmentReference[]) => void
}

export function useWorkbenchAttachmentRuntime({
  activeThreadId,
  canvasDocument,
  canvasSelectedIds,
  composerMode,
  draftKey,
  rightPanelMode,
  route,
  runtimeConnection,
  runtimeInfo,
  threads,
  workspaceRoot,
  draftAttachments,
  onChatAttachmentsChange
}: WorkbenchAttachmentRuntimeOptions) {
  const [composerAttachmentsByScope, setComposerAttachmentsByScope] = useState<ComposerAttachmentsByScope>(() => {
    const chatAttachments = draftAttachments ?? []
    return { ...createEmptyComposerAttachmentsByScope(), chat: chatAttachments }
  })
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)
  const [attachmentUploadError, setAttachmentUploadError] = useState<string | null>(null)
  const composerAttachmentScope = composerAttachmentScopeForSurface(route, rightPanelMode)
  const composerAttachmentScopeRef = useRef<ComposerAttachmentScope>(composerAttachmentScope)

  useEffect(() => {
    composerAttachmentScopeRef.current = composerAttachmentScope
  }, [composerAttachmentScope])

  // ── Thread-switch handling ──────────────────────────────────────────
  // When the user switches threads, Workbench stays mounted so React state
  // persists.  We must:
  //   1. Save the CURRENT thread's chat attachments under the OLD draftKey.
  //   2. Replace React state with the NEW thread's stored attachments.
  const prevDraftKeyRef = useRef(draftKey)
  useEffect(() => {
    if (prevDraftKeyRef.current === draftKey) return
    const oldKey = prevDraftKeyRef.current
    prevDraftKeyRef.current = draftKey

    // Read the latest scope map synchronously so we can save the old
    // thread's attachments before swapping in the new thread's data.
    let oldChatAttachments: AttachmentReference[] = []
    setComposerAttachmentsByScope((currentScopeMap) => {
      oldChatAttachments = currentScopeMap.chat
      const restored = draftAttachments ?? []
      return { ...currentScopeMap, chat: restored }
    })
    // Persist old thread's attachments under its own key.
    if (oldChatAttachments.length > 0) {
      onChatAttachmentsChange?.(oldKey, oldChatAttachments)
    }
    setAttachmentUploadError(null)
  }, [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const composerAttachments = composerAttachmentsByScope[composerAttachmentScope]
  const setComposerAttachmentsForScope = useCallback((
    scope: ComposerAttachmentScope,
    updater: ComposerAttachmentUpdater
  ): void => {
    setComposerAttachmentsByScope((current) => updateComposerAttachmentsByScope(current, scope, updater))
  }, [])
  const setComposerAttachments = useCallback((updater: ComposerAttachmentUpdater): void => {
    setComposerAttachmentsForScope(composerAttachmentScopeRef.current, updater)
  }, [setComposerAttachmentsForScope])
  const attachmentUploadEnabled = isChatAttachmentUploadEnabled({
    runtimeConnection,
    route,
    mode: composerMode,
    attachmentStoreAvailable: runtimeInfo?.capabilities.attachments.available
  })
  const webAccessAvailable =
    runtimeInfo?.capabilities.web.fetch.available === true || runtimeInfo?.capabilities.web.search.available === true

  useEffect(() => {
    setAttachmentUploadError(null)
  }, [composerAttachmentScope])

  // Persist chat-scope attachments to the zustand store whenever they
  // change so images survive route/unmount switches (e.g. opening Settings).
  useEffect(() => {
    onChatAttachmentsChange?.(draftKey, composerAttachmentsByScope.chat)
  }, [composerAttachmentsByScope.chat, draftKey, onChatAttachmentsChange])

  const activeComposerWorkspace = (): string | undefined => {
    const sddDraft = useSddDraftStore.getState().activeDraft
    if (rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi && sddDraft?.workspaceRoot) return sddDraft.workspaceRoot
    const designWorkspace = useDesignWorkspaceStore.getState().workspaceRoot
    if (route === 'design' && designWorkspace.trim()) return designWorkspace
    return threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot || undefined
  }

  const { clearAutoAttachment: clearCanvasImageAutoAttachment } = useCanvasImageAutoAttachment({
    route,
    selectedIds: canvasSelectedIds ?? new Set<string>(),
    document: canvasDocument ?? ({} as CanvasDocument),
    workspaceRoot,
    activeThreadId,
    attachmentCapabilities: runtimeInfo?.capabilities.attachments,
    setComposerAttachmentsForScope,
    getActiveWorkspace: activeComposerWorkspace
  })

  const clearComposerAttachments = (scope = composerAttachmentScopeRef.current): void => {
    setComposerAttachmentsForScope(scope, [])
    if (scope === 'design') clearCanvasImageAutoAttachment()
  }

  const removeComposerAttachments = (
    ids: readonly string[],
    scope = composerAttachmentScopeRef.current
  ): void => {
    if (ids.length === 0) return
    setComposerAttachmentsForScope(
      scope,
      (current) => removeComposerAttachmentsById(current, ids)
    )
  }

  const {
    handlePickAttachments,
    handlePasteClipboardImage,
    removeComposerAttachment
  } = useWorkbenchAttachmentController({
    attachmentUploadEnabled,
    attachmentCapabilities: runtimeInfo?.capabilities.attachments,
    activeThreadId,
    setAttachmentUploadBusy,
    setAttachmentUploadError,
    setComposerAttachmentsForScope,
    setComposerAttachments,
    getAttachmentScope: () => composerAttachmentScopeRef.current,
    getActiveWorkspace: activeComposerWorkspace
  })

  return {
    attachmentUploadBusy,
    attachmentUploadEnabled,
    attachmentUploadError,
    clearComposerAttachments,
    composerAttachments,
    getAttachmentScope: () => composerAttachmentScopeRef.current,
    handlePasteClipboardImage,
    handlePickAttachments,
    removeComposerAttachments,
    removeComposerAttachment,
    setAttachmentUploadError,
    webAccessAvailable
  }
}
