import { useTranslation } from 'react-i18next'
import type { AttachmentReference } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import type { ImageAttachmentUploadCapabilities } from '../../lib/image-attachment-upload'
import {
  runtimeImagePreviewUrl,
  runtimeImageSourceForFile,
  uploadRuntimeImageAttachment
} from '../../lib/runtime-image-attachment'
import type {
  ComposerAttachmentScope,
  ComposerAttachmentUpdater
} from '../workbench-composer-attachments'

export type WorkbenchAttachmentControllerOptions = {
  attachmentUploadEnabled: boolean
  selectedModelSupportsImageInput: boolean
  attachmentCapabilities?: ImageAttachmentUploadCapabilities
  activeThreadId: string | null
  setAttachmentUploadBusy: (busy: boolean) => void
  setAttachmentUploadError: (error: string | null) => void
  setComposerAttachmentsForScope: (
    scope: ComposerAttachmentScope,
    updater: ComposerAttachmentUpdater
  ) => void
  setComposerAttachments: (updater: ComposerAttachmentUpdater) => void
  getAttachmentScope: () => ComposerAttachmentScope
  getActiveWorkspace: () => string | undefined
}

function fileNameFromPath(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'image'
}

function isPdfAttachmentFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export function useWorkbenchAttachmentController({
  attachmentUploadEnabled,
  selectedModelSupportsImageInput,
  attachmentCapabilities,
  activeThreadId,
  setAttachmentUploadBusy,
  setAttachmentUploadError,
  setComposerAttachmentsForScope,
  setComposerAttachments,
  getAttachmentScope,
  getActiveWorkspace
}: WorkbenchAttachmentControllerOptions) {
  const { t } = useTranslation()

  async function handlePickAttachments(
    files: File[],
    options: { localFilePaths?: string[] } = {}
  ): Promise<void> {
    if (!files.length || !attachmentUploadEnabled) return
    const provider = getProvider()
    const attachmentScope = getAttachmentScope()
    setAttachmentUploadBusy(true)
    setAttachmentUploadError(null)
    try {
      const workspace = getActiveWorkspace()
      const uploaded: AttachmentReference[] = []
      for (const [index, file] of files.entries()) {
        const localFilePath =
          options.localFilePaths?.[index] ||
          (typeof window.RcodeGui?.getPathForFile === 'function' ? window.RcodeGui.getPathForFile(file) : '')
        if (isPdfAttachmentFile(file)) {
          if (!localFilePath || typeof window.RcodeGui?.readLocalPdfText !== 'function') {
            throw new Error(t('composerPdfAttachmentUnavailable'))
          }
          if (!attachmentCapabilities || typeof provider.uploadAttachment !== 'function') {
            throw new Error(t('composerAttachmentUnavailable'))
          }
          const result = await window.RcodeGui.readLocalPdfText({ path: localFilePath })
          if (!result.ok) throw new Error(result.message)
          const documentText = result.text.trim()
          if (!documentText) throw new Error(t('composerPdfAttachmentNoText'))
          const attachment = await provider.uploadAttachment({
            name: file.name || fileNameFromPath(result.path),
            mimeType: 'application/pdf',
            dataBase64: arrayBufferToBase64(await file.arrayBuffer()),
            documentText,
            pageCount: result.pageCount,
            localFilePath,
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(workspace ? { workspace } : {})
          })
          uploaded.push({
            id: attachment.id,
            kind: 'document',
            name: attachment.name,
            mimeType: attachment.mimeType,
            byteSize: attachment.byteSize,
            pageCount: attachment.pageCount,
            truncated: attachment.truncated,
            textPreview: documentText.slice(0, 240)
          })
          continue
        }
        if (!file.type.startsWith('image/')) {
          throw new Error(t('composerAttachmentUnsupportedType'))
        }
        if (
          !attachmentCapabilities ||
          (typeof window.RcodeGui?.uploadRuntimeImageAttachment !== 'function' &&
            typeof provider.uploadAttachment !== 'function')
        ) {
          throw new Error(t('composerAttachmentUnavailable'))
        }
        if (typeof window.RcodeGui?.uploadRuntimeImageAttachment === 'function') {
          const result = await uploadRuntimeImageAttachment({
            source: await runtimeImageSourceForFile(file, localFilePath),
            name: file.name || 'image',
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(workspace ? { workspace } : {})
          })
          const attachment = result.attachment
          uploaded.push({
            id: attachment.id,
            kind: 'image',
            name: attachment.name,
            mimeType: attachment.mimeType,
            width: attachment.width,
            height: attachment.height,
            previewUrl: runtimeImagePreviewUrl(result)
          })
        } else if (typeof provider.uploadAttachment === 'function') {
          const base64Data = arrayBufferToBase64(await file.arrayBuffer())
          const mimeType = file.type || 'image/png'
          const attachment = await provider.uploadAttachment({
            name: file.name || 'image',
            mimeType,
            dataBase64: base64Data,
            localFilePath,
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(workspace ? { workspace } : {})
          })
          uploaded.push({
            id: attachment.id,
            kind: 'image',
            name: attachment.name,
            mimeType: attachment.mimeType,
            width: attachment.width,
            height: attachment.height,
            previewUrl: attachment.textFallback?.dataBase64
              ? `data:${attachment.mimeType || 'image/png'};base64,${attachment.textFallback.dataBase64}`
              : `data:${mimeType};base64,${base64Data}`
          })
        } else {
          throw new Error(t('composerAttachmentUnavailable'))
        }
      }
      if (uploaded.length > 0) {
        setComposerAttachmentsForScope(attachmentScope, (current) => {
          const byId = new Map(current.map((attachment) => [attachment.id, attachment]))
          for (const attachment of uploaded) {
            byId.set(attachment.id, attachment)
          }
          return [...byId.values()]
        })
      }
    } catch (error) {
      setAttachmentUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setAttachmentUploadBusy(false)
    }
  }

  function removeComposerAttachment(id: string): void {
    setComposerAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  async function handlePasteClipboardImage(options: { silentNoImage?: boolean } = {}): Promise<void> {
    if (!attachmentUploadEnabled) return
    if (
      !attachmentCapabilities ||
      typeof window.RcodeGui?.uploadRuntimeImageAttachment !== 'function'
    ) {
      setAttachmentUploadError(t('composerAttachmentUnavailable'))
      return
    }
    const attachmentScope = getAttachmentScope()
    setAttachmentUploadBusy(true)
    setAttachmentUploadError(null)
    try {
      const workspace = getActiveWorkspace()
      const result = await uploadRuntimeImageAttachment({
        source: { kind: 'clipboard' },
        ...(activeThreadId ? { threadId: activeThreadId } : {}),
        ...(workspace ? { workspace } : {})
      })
      const attachment = result.attachment
      const reference: AttachmentReference = {
        id: attachment.id,
        kind: 'image',
        name: attachment.name,
        mimeType: attachment.mimeType,
        width: attachment.width,
        height: attachment.height,
        previewUrl: runtimeImagePreviewUrl(result)
      }
      setComposerAttachmentsForScope(attachmentScope, (current) => {
        const byId = new Map(current.map((item) => [item.id, item]))
        byId.set(reference.id, reference)
        return [...byId.values()]
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!options.silentNoImage || !/clipboard does not currently contain an image/i.test(message)) {
        setAttachmentUploadError(message)
      }
    } finally {
      setAttachmentUploadBusy(false)
    }
  }

  return {
    handlePickAttachments,
    handlePasteClipboardImage,
    removeComposerAttachment
  }
}
