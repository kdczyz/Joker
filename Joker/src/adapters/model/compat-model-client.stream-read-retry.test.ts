import { describe, expect, it } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import type { ModelRequestRetryConfig } from '../../config/Joker-config.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

// Exercises the real streaming SSE path (`streamSse`) plus the stream-read
// retry: a connection that terminates before any assistant output is emitted
// must be retried (fixed interval), while a termination after content was
// already produced must fail immediately to avoid duplicating partial output.

function request(signal?: AbortSignal): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model: 'test-model',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: signal ?? new AbortController().signal
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    }
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

/** A 200 SSE response whose body rejects the first read with "terminated". */
function terminatedResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('terminated'))
    }
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

/** A 200 SSE response that emits content and then terminates. */
function contentThenTerminatedResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  let delivered = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!delivered) {
        delivered = true
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        return
      }
      controller.error(new Error('terminated'))
    }
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

const textFrame = frame({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] })
const finishFrame = frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
const okFrames = [textFrame, finishFrame, 'data: [DONE]\n\n']

function client(fetchImpl: typeof fetch, retry?: ModelRequestRetryConfig): CompatModelClient {
  return new CompatModelClient({
    baseUrl: 'https://provider.example/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    endpointFormat: 'chat_completions',
    retry,
    fetchImpl
  })
}

describe('CompatModelClient stream-read retry', () => {
  it('retries a stream terminated before any content and then recovers', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return calls === 1 ? terminatedResponse() : sseResponse(okFrames)
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 1, initialDelayMs: 0, httpStatusCodes: [429] }).stream(request())
    )

    expect(calls).toBe(2)
    expect(chunks).toContainEqual({ kind: 'retrying', status: 0, attempt: 1, maxAttempts: 1, delayMs: 0 })
    expect(chunks.some((c) => c.kind === 'assistant_text_delta')).toBe(true)
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((c) => c.kind === 'error')).toBe(false)
  })

  it('fails with stream_read_error once retries are exhausted', async () => {
    const fetchImpl = (async () => terminatedResponse()) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 2, initialDelayMs: 0, httpStatusCodes: [429] }).stream(request())
    )

    const retrying = chunks.filter((c) => c.kind === 'retrying')
    expect(retrying).toHaveLength(2)
    expect(chunks.at(-1)).toEqual({
      kind: 'error',
      message: 'model stream read failed: terminated',
      code: 'stream_read_error'
    })
  })

  it('does not retry once assistant content has been emitted', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return contentThenTerminatedResponse([textFrame])
    }) as unknown as typeof fetch

    const chunks = await drain(
      client(fetchImpl, { maxAttempts: 3, initialDelayMs: 0, httpStatusCodes: [429] }).stream(request())
    )

    // Exactly one request: the partial output must not be duplicated.
    expect(calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'retrying')).toBe(false)
    expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'ok' })
    expect(chunks.at(-1)).toEqual({
      kind: 'error',
      message: 'model stream read failed: terminated',
      code: 'stream_read_error'
    })
  })
})
