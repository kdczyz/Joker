import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertSourceByteLength,
  isUploadBusyMessage,
  MAX_RUNTIME_IMAGE_OUTPUT_BYTES,
  MAX_RUNTIME_IMAGE_SOURCE_PIXELS,
  prepareRuntimeImageAttachment,
  uploadRuntimeImageAttachment,
  uploadRuntimeImageAttachmentQueued
} from './runtime-image-attachment-service'
import { MAX_RUNTIME_IMAGE_SOURCE_BYTES } from '../ipc/app-ipc-schemas/runtime-image-attachment'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('runtime image attachment service', () => {
  it('loads clipboard bytes, prepares bounded variants, and uploads directly to Joker', async () => {
    const source = await sharp({
      create: { width: 640, height: 480, channels: 4, background: '#336699ff' }
    }).png().toBuffer()
    const runtimeRequest = vi.fn(async (path: string, method?: string, body?: string) => {
      if (path === '/v1/runtime/info') return runtimeInfoResponse()
      expect(path).toBe('/v1/attachments')
      expect(method).toBe('POST')
      const upload = JSON.parse(body ?? '{}') as Record<string, unknown>
      expect(upload.localFilePath).toBe('/tmp/clipboard-original.png')
      expect(Buffer.from(String(upload.dataBase64), 'base64').byteLength).toBeLessThanOrEqual(MAX_RUNTIME_IMAGE_OUTPUT_BYTES)
      expect(Buffer.byteLength(String((upload.textFallback as { dataBase64?: string }).dataBase64), 'utf8')).toBeLessThanOrEqual(512 * 1024)
      return attachmentResponse(upload)
    })

    const result = await uploadRuntimeImageAttachment({
      source: { kind: 'clipboard' },
      threadId: 'thr_1',
      workspace: '/tmp/ws'
    }, {
      runtimeRequest,
      readClipboardSource: async () => ({
        data: source,
        name: 'pasted-image.png',
        localFilePath: '/tmp/clipboard-original.png'
      })
    })

    expect(result).toMatchObject({
      ok: true,
      attachment: { id: 'att_test', name: 'pasted-image.png' },
      compression: { sourceBytes: source.byteLength }
    })
    if (result.ok) {
      expect(result.preview.dataBase64.length).toBeGreaterThan(0)
      expect(result.attachment.textFallback).toBeUndefined()
    }
    expect(runtimeRequest.mock.calls.map((call) => call[0])).toEqual([
      '/v1/runtime/info',
      '/v1/attachments'
    ])
  })

  it('supports local-path and Base64 sources without using generic runtime IPC', async () => {
    const root = await mkdtemp(join(tmpdir(), 'Joker-runtime-image-'))
    tempRoots.push(root)
    const filePath = join(root, 'picked.png')
    const source = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#abcdef' }
    }).png().toBuffer()
    await writeFile(filePath, source)
    const seenUploads: Array<Record<string, unknown>> = []
    const runtimeRequest = vi.fn(async (path: string, _method?: string, body?: string) => {
      if (path === '/v1/runtime/info') return runtimeInfoResponse()
      const upload = JSON.parse(body ?? '{}') as Record<string, unknown>
      seenUploads.push(upload)
      return attachmentResponse(upload)
    })

    await expect(uploadRuntimeImageAttachment({
      source: { kind: 'localPath', path: filePath },
      name: 'local.png'
    }, { runtimeRequest })).resolves.toMatchObject({ ok: true })
    await expect(uploadRuntimeImageAttachment({
      source: { kind: 'base64', dataBase64: source.toString('base64'), mimeType: 'image/png' },
      name: 'inline.png'
    }, { runtimeRequest })).resolves.toMatchObject({ ok: true })

    expect(seenUploads[0]?.localFilePath).toBe(filePath)
    expect(seenUploads[1]?.localFilePath).toBeUndefined()
    expect(runtimeRequest.mock.calls.every((call) => call[0] !== 'runtime:request')).toBe(true)
  })

  it('downsizes noisy images to primary, dimension, and fallback bounds', async () => {
    const width = 512
    const height = 512
    const source = await sharp(randomBytes(width * height * 3), {
      raw: { width, height, channels: 3 }
    }).png().toBuffer()
    const prepared = await prepareRuntimeImageAttachment(source, {
      maxImageBytes: 40_000,
      maxImageDimension: 180,
      allowedMimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
      textFallbackMaxBase64Bytes: 8_000,
      textFallbackMaxImageDimension: 80,
      textFallbackPreferredMimeType: 'image/webp'
    })

    expect(prepared.upload.data.byteLength).toBeLessThanOrEqual(40_000)
    expect(Math.max(prepared.upload.width, prepared.upload.height)).toBeLessThanOrEqual(180)
    expect(Buffer.byteLength(prepared.fallback.data.toString('base64'), 'utf8')).toBeLessThanOrEqual(8_000)
    expect(Math.max(prepared.fallback.width, prepared.fallback.height)).toBeLessThanOrEqual(80)
  })

  it('rejects byte, pixel, and malformed Base64 sources with bounded errors', async () => {
    expect(() => assertSourceByteLength(MAX_RUNTIME_IMAGE_SOURCE_BYTES + 1)).toThrow(/byte limit/)
    const oversizedSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10001" height="10001"><rect width="100%" height="100%"/></svg>`
    )
    await expect(prepareRuntimeImageAttachment(oversizedSvg, defaultCapabilities())).rejects.toThrow(/pixel|limit/i)

    const runtimeRequest = vi.fn(async () => runtimeInfoResponse())
    await expect(uploadRuntimeImageAttachment({
      source: { kind: 'base64', dataBase64: 'not-base64!', mimeType: 'image/png' }
    }, { runtimeRequest })).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/Base64/) })
    expect(MAX_RUNTIME_IMAGE_SOURCE_PIXELS).toBe(100_000_000)
  })

  it('serializes queued uploads so only one POST hits the runtime at a time', async () => {
    const source = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#112233' }
    }).png().toBuffer()
    let inFlight = 0
    let maxInFlight = 0
    let uploadCalls = 0
    const runtimeRequest = vi.fn(async (path: string, _method?: string, body?: string) => {
      if (path === '/v1/runtime/info') return runtimeInfoResponse()
      uploadCalls += 1
      const callIndex = uploadCalls
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      // Simulate a slow first upload so a concurrent second caller would
      // overlap unless the queue serializes them.
      if (callIndex === 1) await new Promise((resolve) => setTimeout(resolve, 50))
      inFlight -= 1
      return attachmentResponse(JSON.parse(body ?? '{}'))
    })
    const dependencies = { runtimeRequest }
    const base64Source = { kind: 'base64' as const, dataBase64: source.toString('base64'), mimeType: 'image/png' }

    const [first, second] = await Promise.all([
      uploadRuntimeImageAttachmentQueued({ source: base64Source, name: 'a.png' }, dependencies),
      uploadRuntimeImageAttachmentQueued({ source: base64Source, name: 'b.png' }, dependencies)
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(maxInFlight).toBe(1)
  })

  it('retries transient 429 busy responses before succeeding', async () => {
    const source = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#445566' }
    }).png().toBuffer()
    let uploadCalls = 0
    const runtimeRequest = vi.fn(async (path: string, _method?: string, body?: string) => {
      if (path === '/v1/runtime/info') return runtimeInfoResponse()
      uploadCalls += 1
      if (uploadCalls === 1) {
        return {
          ok: false,
          status: 429,
          body: JSON.stringify({ message: 'an attachment upload is already in progress' })
        }
      }
      return attachmentResponse(JSON.parse(body ?? '{}'))
    })

    const result = await uploadRuntimeImageAttachment({
      source: { kind: 'base64', dataBase64: source.toString('base64'), mimeType: 'image/png' },
      name: 'retry.png'
    }, { runtimeRequest })

    expect(result).toMatchObject({ ok: true, attachment: { name: 'retry.png' } })
    expect(uploadCalls).toBe(2)
  })

  it('classifies busy messages without retrying permanent failures', () => {
    expect(isUploadBusyMessage('an attachment upload is already in progress')).toBe(true)
    expect(isUploadBusyMessage('rate limited by runtime')).toBe(true)
    expect(isUploadBusyMessage('attachment validation failed')).toBe(false)
    expect(isUploadBusyMessage('attachment upload failed (HTTP 500)')).toBe(false)
  })
})

function defaultCapabilities() {
  return {
    maxImageBytes: 5 * 1024 * 1024,
    maxImageDimension: 4096,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    textFallbackMaxBase64Bytes: 512 * 1024,
    textFallbackMaxImageDimension: 1280,
    textFallbackPreferredMimeType: 'image/webp'
  }
}

function runtimeInfoResponse() {
  return {
    ok: true,
    status: 200,
    body: JSON.stringify({ capabilities: { attachments: defaultCapabilities() } })
  }
}

function attachmentResponse(upload: Record<string, unknown>) {
  return {
    ok: true,
    status: 201,
    body: JSON.stringify({
      attachment: {
        id: 'att_test',
        name: String(upload.name ?? 'image'),
        kind: 'image',
        mimeType: String(upload.mimeType),
        byteSize: Buffer.from(String(upload.dataBase64), 'base64').byteLength,
        hash: 'hash',
        localFilePath: upload.localFilePath,
        textFallback: upload.textFallback,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    })
  }
}
