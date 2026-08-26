import { describe, expect, it } from 'vitest'
import { isChatAttachmentUploadEnabled } from './attachment-upload-availability'

describe('isChatAttachmentUploadEnabled', () => {
  it('enables composer attachments in chat when the runtime is ready', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true
    })).toBe(true)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'plan',
      attachmentStoreAvailable: true
    })).toBe(true)
  })

  it('enables composer attachments in Write mode assistants', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'write',
      mode: 'agent',
      attachmentStoreAvailable: true
    })).toBe(true)
  })

  it('disables composer attachments outside ready supported modes', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'connecting',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true
    })).toBe(false)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'settings',
      mode: 'agent',
      attachmentStoreAvailable: true
    })).toBe(false)
  })

  it('enables composer attachments regardless of model image capability', () => {
    // 所有模型均可上传图片，上传可用性不再依赖模型视觉能力。
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: true
    })).toBe(true)
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'chat',
      mode: 'agent',
      attachmentStoreAvailable: false
    })).toBe(false)
  })

  it('enables composer attachments in Design mode assistants', () => {
    expect(isChatAttachmentUploadEnabled({
      runtimeConnection: 'ready',
      route: 'design',
      mode: 'agent',
      attachmentStoreAvailable: true
    })).toBe(true)
  })
})
