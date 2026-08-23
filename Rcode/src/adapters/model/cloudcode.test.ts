import { describe, expect, it } from 'vitest'
import { decodeCloudCodeStreamPayload } from './cloudcode-stream-decoder.js'
import { decodeCompatNonStreamingResponse } from './compat-non-streaming-decoder.js'
import { type CompatChatMessage } from './compat-request-codecs.js'
import { createCompatRequestCodecs } from './compat-request-builder.js'
import {
  DEFAULT_MODEL_STREAM_LIMITS,
  ModelStreamResourceBudget
} from './model-stream-resource-budget.js'

describe('CloudCode / Antigravity Model Adapter', () => {
  const codecs = createCompatRequestCodecs()

  it('preserves historical reasoning_content, merges consecutive turns, and formats functionResponse properly', () => {
    const messages: CompatChatMessage[] = [
      { role: 'user', content: 'What is this project?' },
      {
        role: 'assistant',
        content: 'Let me inspect the files.',
        reasoning_content: 'I need to check the project structure using repo_map.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'repo_map', arguments: '{"depth":2}' }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: JSON.stringify({ files: ['backend', 'frontend', 'README.md'] })
      }
    ]

    const encoded = codecs.build({
      endpointFormat: 'cloudcode',
      model: 'gemini-3.7-flash-high',
      messages,
      tools: [
        {
          name: 'repo_map',
          description: 'Get project repo map',
          inputSchema: { type: 'object', properties: { depth: { type: 'number' } } }
        }
      ],
      stream: true,
      baseUrl: 'https://daily-cloudcode-pa.googleapis.com/v1internal',
      request: {
        threadId: 't1',
        turnId: 'u1',
        model: 'gemini-3.7-flash-high',
        systemPrompt: 'You are an expert coder.',
        prefix: [],
        history: [],
        tools: [],
        abortSignal: new AbortController().signal,
        reasoningEffort: 'high'
      },
      isCodex: false,
      isCodexLite: false,
      codexNativeImageGeneration: false
    })

    const request = encoded.request as Record<string, unknown>
    expect(encoded.model).toBe('gemini-3.7-flash-tiered')
    expect(request.generationConfig).toEqual({
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: 8192,
        thinkingBudgetTokens: 8192
      }
    })

    const contents = request.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
    expect(contents).toHaveLength(3)

    // Turn 1: user
    expect(contents[0].role).toBe('user')
    expect(contents[0].parts).toEqual([{ text: 'What is this project?' }])

    // Turn 2: model with thought, text, and functionCall
    expect(contents[1].role).toBe('model')
    expect(contents[1].parts[0]).toEqual({
      text: 'I need to check the project structure using repo_map.',
      thought: true
    })
    expect(contents[1].parts[1]).toEqual({ text: 'Let me inspect the files.' })
    expect(contents[1].parts[2].functionCall).toEqual({
      name: 'repo_map',
      args: { depth: 2 }
    })
    expect(contents[1].parts[2].thoughtSignature).toBe('skip_thought_signature_validator')
    expect(request.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'repo_map',
            description: 'Get project repo map',
            parameters: { type: 'object', properties: { depth: { type: 'number' } } }
          }
        ]
      }
    ])

    // Turn 3: user with parsed structured functionResponse
    expect(contents[2].role).toBe('user')
    expect(contents[2].parts[0].functionResponse).toEqual({
      name: 'repo_map',
      response: { files: ['backend', 'frontend', 'README.md'] }
    })
  })

  it('merges consecutive tool results into a single user turn parts array', () => {
    const messages: CompatChatMessage[] = [
      { role: 'user', content: 'Inspect these' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'read_a', arguments: '{}' } },
          { id: 'c2', type: 'function', function: { name: 'read_b', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'c1', content: 'file a content' },
      { role: 'tool', tool_call_id: 'c2', content: 'file b content' }
    ]

    const encoded = codecs.build({
      endpointFormat: 'cloudcode',
      model: 'gemini-3.1-pro',
      messages,
      tools: [],
      stream: true,
      baseUrl: 'https://daily-cloudcode-pa.googleapis.com/v1internal',
      request: {
        threadId: 't1',
        turnId: 'u1',
        model: 'gemini-3.1-pro',
        systemPrompt: '',
        prefix: [],
        history: [],
        tools: [],
        abortSignal: new AbortController().signal
      },
      isCodex: false,
      isCodexLite: false,
      codexNativeImageGeneration: false
    })

    const request = encoded.request as Record<string, unknown>
    const contents = request.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
    expect(contents).toHaveLength(3)
    expect(contents[2].role).toBe('user')
    expect(contents[2].parts).toHaveLength(2)
    expect(contents[2].parts[0].functionResponse).toEqual({
      name: 'read_a',
      response: { output: 'file a content' }
    })
    expect(contents[2].parts[1].functionResponse).toEqual({
      name: 'read_b',
      response: { output: 'file b content' }
    })
  })

  it('omits thinkingConfig when reasoningEffort is off to avoid Google 400 error', () => {
    const encoded = codecs.build({
      endpointFormat: 'cloudcode',
      model: 'gemini-3.1-pro-low',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'render_html',
          description: 'Render html content',
          inputSchema: {
            type: 'object',
            properties: {
              html: { type: 'string', maxLength: '786432' as unknown as number }
            }
          }
        }
      ],
      stream: true,
      baseUrl: 'https://daily-cloudcode-pa.googleapis.com/v1internal',
      request: {
        threadId: 't1',
        turnId: 'u1',
        model: 'gemini-3.1-pro-low',
        systemPrompt: '',
        prefix: [],
        history: [],
        tools: [],
        abortSignal: new AbortController().signal,
        reasoningEffort: 'off'
      },
      isCodex: false,
      isCodexLite: false,
      codexNativeImageGeneration: false
    })

    const request = encoded.request as Record<string, unknown>
    expect(encoded.model).toBe('gemini-pro-agent')
    expect(request.generationConfig).toBeUndefined()
    expect(request.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'render_html',
            description: 'Render html content',
            parameters: {
              type: 'object',
              properties: {
                html: { type: 'string', maxLength: 786432 }
              }
            }
          }
        ]
      }
    ])
  })

  it('decodes streaming thought and functionCall properly', () => {
    const budget = new ModelStreamResourceBudget(DEFAULT_MODEL_STREAM_LIMITS)
    const pendingArguments = new Map()
    const pendingByIndex = new Map()

    const parseToolArguments = (raw: string) => JSON.parse(raw)
    const normalizeUsage = (u: Record<string, unknown>) => ({
      promptTokens: Number(u.prompt_tokens) || 0,
      completionTokens: Number(u.completion_tokens) || 0,
      totalTokens: Number(u.total_tokens) || 0, cacheHitRate: null, turns: 1,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0
    })

    // Chunk 1: Thought delta
    const res1 = decodeCloudCodeStreamPayload({
      payload: {
        response: {
          candidates: [
            {
              content: {
                parts: [{ text: 'Thinking about the codebase...', thought: true }]
              }
            }
          ]
        }
      },
      pendingArguments,
      pendingByIndex,
      completedToolCalls: new Set(), sawTextDelta: false,
      budget,
      parseToolArguments,
      normalizeUsage
    })

    expect(res1.chunks).toEqual([
      { kind: 'assistant_reasoning_delta', text: 'Thinking about the codebase...' }
    ])
    expect(res1.finishReason).toBeNull()

    // Chunk 2: Function call
    const res2 = decodeCloudCodeStreamPayload({
      payload: {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'read_file',
                      args: { path: '/src/index.ts' }
                    }
                  }
                ]
              },
              finishReason: 'STOP'
            }
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            totalTokenCount: 150
          }
        }
      },
      pendingArguments,
      pendingByIndex,
      completedToolCalls: new Set(), sawTextDelta: false,
      budget,
      parseToolArguments,
      normalizeUsage
    })

    expect(res2.chunks).toEqual([
      {
        kind: 'tool_call_complete',
        callId: 'call_1',
        toolName: 'read_file',
        arguments: { path: '/src/index.ts' }
      }
    ])
    expect(res2.finishReason).toBe('tool_calls')
    expect(res2.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0
    })
  })

  it('decodes non-streaming thought and functionCall properly', () => {
    const payload = {
      response: {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Planning to read file', thought: true },
                {
                  functionCall: {
                    name: 'read_file',
                    args: { path: 'README.md' }
                  }
                }
              ]
            },
            finishReason: 'STOP'
          }
        ],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 20,
          totalTokenCount: 70
        }
      }
    }

    const chunks = decodeCompatNonStreamingResponse(payload, 'cloudcode', {
      payloadError: () => null,
      normalizeUsage: (u) => ({
        promptTokens: Number(u.prompt_tokens) || 0,
        completionTokens: Number(u.completion_tokens) || 0,
        totalTokens: Number(u.total_tokens) || 0, cacheHitRate: null, turns: 1,
        reasoningTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0
      }),
      parseToolArguments: (raw) => JSON.parse(raw)
    })

    expect(chunks).toEqual([
      { kind: 'assistant_reasoning_delta', text: 'Planning to read file' },
      {
        kind: 'tool_call_complete',
        callId: 'call_1',
        toolName: 'read_file',
        arguments: { path: 'README.md' }
      },
      {
        kind: 'usage',
        usage: {
          promptTokens: 50,
          completionTokens: 20,
          totalTokens: 70,
          reasoningTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0
        }
      },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])
  })
})
