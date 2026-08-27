/**
 * Renderer-side cache for AttachmentReference data that is not persisted by the
 * runtime in user-message metadata.
 *
 * When a user sends a message with image attachments, only the attachment IDs
 * are stored in the message metadata (`meta.attachmentIds`). The `previewUrl`
 * (tiny fallback data URL) and `localFilePath` exist only in the composer state
 * at upload time. After the message is sent, this data is lost.
 *
 * This module-level cache bridges the gap: we write when uploading and read
 * when rendering UserAttachmentPreviews so the image tile can display a preview.
 */

import type { AttachmentReference } from '../agent/types'

const cache = new Map<string, AttachmentReference>()

/**
 * Store an AttachmentReference (with previewUrl/localFilePath) keyed by its ID.
 * Call this immediately after a successful upload, before the message is sent.
 */
export function cacheAttachmentReference(attachment: AttachmentReference): void {
  if (attachment.id) {
    cache.set(attachment.id, attachment)
  }
}

/**
 * Retrieve a previously cached AttachmentReference, or undefined if not found.
 */
export function getCachedAttachmentReference(id: string): AttachmentReference | undefined {
  return cache.get(id)
}

/**
 * Enrich a bare/stub AttachmentReference (e.g. `{ id }` from runtime metadata)
 * with cached fields like previewUrl, localFilePath, name, mimeType, etc.
 *
 * If the input already has a previewUrl, it is returned as-is (no overwrite).
 */
export function enrichAttachmentFromCache(
  attachment: AttachmentReference
): AttachmentReference {
  if (attachment.previewUrl) return attachment
  const cached = cache.get(attachment.id)
  if (!cached) return attachment
  return {
    ...cached,
    ...attachment,
  }
}
