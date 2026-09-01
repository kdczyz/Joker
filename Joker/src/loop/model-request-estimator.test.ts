import { describe, expect, it } from 'vitest'
import { estimateModelRequestInputTokens } from './model-request-estimator.js'
import type { ModelRequest } from '../ports/model-client.js'

describe('estimateModelRequestInputTokens', () => {
  it('includes document and image attachment payloads', () => {
    const request: ModelRequest = {
      threadId: 'thr_estimate',
      turnId: 'turn_estimate',
      model: 'model',
      systemPrompt: 'system',
      prefix: [],
      history: [],
      tools: [],
      attachments: [{ id: 'image', name: 'image.png', mimeType: 'image/png', dataBase64: 'a'.repeat(400) }],
      attachmentDocuments: [{ id: 'doc', name: 'doc.txt', mimeType: 'text/plain', text: 'b'.repeat(400), byteSize: 400 }],
      abortSignal: new AbortController().signal
    }

    expect(estimateModelRequestInputTokens(request)).toBeGreaterThanOrEqual(2_100)
  })

  it('counts CJK text per character instead of the naive length/4 heuristic', () => {
    // Regression: a local `length / CHARS_PER_TOKEN` helper used to bypass the
    // CJK-aware ContextEstimator, under-counting Chinese/Japanese/Korean
    // request text by ~4x and silently disarming the measured-overflow safety
    // net for CJK-heavy system prompts, instructions and documents.
    const cjk = '你好世界'.repeat(250) // 1000 CJK chars
    const request: ModelRequest = {
      threadId: 'thr_cjk',
      turnId: 'turn_cjk',
      model: 'model',
      systemPrompt: cjk,
      prefix: [],
      history: [],
      tools: [],
      attachments: [],
      attachmentDocuments: [],
      abortSignal: new AbortController().signal
    }

    const tokens = estimateModelRequestInputTokens(request)
    expect(tokens).toBeGreaterThanOrEqual(1_000)
    // The naive heuristic would report ~250 here.
    expect(tokens).toBeGreaterThan(500)
  })
})
