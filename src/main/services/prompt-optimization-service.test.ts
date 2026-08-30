import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultJokerRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultTerminalSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { PromptOptimizationResult } from '../../shared/Joker-gui-api'
import { optimizePrompt } from './prompt-optimization-service'

function createSettings(patch: Partial<AppSettingsV1['agents']['Joker']> = {}): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    provider: defaultModelProviderSettings(),
    agents: {
      Joker: {
        ...defaultJokerRuntimeSettings(),
        apiKey: 'sk-runtime',
        promptOptimization: {
          ...defaultJokerRuntimeSettings().promptOptimization,
          enabled: true
        },
        ...patch
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Joker',
    log: {
      enabled: true,
      retentionDays: 2
    },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    design: defaultDesignSettings(),
    codePromptPrefix: '',
    disabledSkillIds: [],
    claw: defaultClawSettings(),
    browserMode: {
      enabled: false,
      port: 18899
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Never actually waits: retries stay instant while the delay math is asserted. */
function instantTransport(): {
  sleep: (ms: number) => Promise<void>
  now: () => number
  random: () => number
  delays: number[]
} {
  const delays: number[] = []
  return {
    sleep: async (ms) => {
      delays.push(ms)
    },
    // A frozen clock keeps the deadline check out of the way of retry counting.
    now: () => 0,
    random: () => 0,
    delays
  }
}

const RATE_LIMIT_BODY = JSON.stringify({
  type: 'error',
  error: {
    type: 'FreeUsageLimitError',
    message: 'Error from provider (Console): Rate limit exceeded. Please try again later.'
  }
})

describe('optimizePrompt', () => {
  it('uses the default prompt and replaces rough text with the model response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Implement prompt optimization with a composer button.' } }]
      }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await optimizePrompt(createSettings(), '嗯 加个按钮 优化一下 prompt')

    // When no explicit provider/model is configured, prompt optimization
    // falls back to the session model (opencode-zen / big-pickle defaults).
    expect(result).toEqual({
      ok: true,
      text: 'Implement prompt optimization with a composer button.',
      model: 'big-pickle',
      providerId: 'opencode-zen'
    })
    expect(fetchMock).toHaveBeenCalled()
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(firstCall[1].body)) as {
      model: string
      messages: Array<{ role: string; content: string }>
    }
    expect(body.model).toBe('big-pickle')
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: DEFAULT_PROMPT_OPTIMIZATION_PROMPT
    })
    // The source text is fenced so small models cannot mistake a short or
    // colloquial instruction for "no input yet".
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: '<instruction>\n嗯 加个按钮 优化一下 prompt\n</instruction>'
    })
  })

  it('always uses session model even when promptOptimization providerId is set', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Use the configured optimizer model.' } }]
      }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const settings = createSettings({
      promptOptimization: {
        enabled: true,
        providerId: 'deepseek',
        model: 'deepseek-v4-flash',
        prompt: 'Rewrite only.',
        timeoutMs: 12345
      }
    })
    settings.provider.providers.push({
      id: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      endpointFormat: 'chat_completions',
      models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      modelProfiles: {}
    })

    const result = await optimizePrompt(settings, 'rewrite this')

    // promptOptimization.providerId is now ignored; always uses session model.
    expect(result).toEqual({
      ok: true,
      text: 'Use the configured optimizer model.',
      model: 'big-pickle',
      providerId: 'opencode-zen'
    })
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(firstCall[1].body)) as {
      model: string
      messages: Array<{ role: string; content: string }>
    }
    expect(body.model).toBe('big-pickle')
    expect(body.messages[0].content).toBe('Rewrite only.')
  })

  it('uses session model when promptOptimization providerId is not set', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Session model used.' } }]
      }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const settings = createSettings({
      promptOptimization: {
        enabled: true,
        providerId: '',
        model: 'some-orphan-model',
        prompt: 'Optimize.',
        timeoutMs: 12345
      }
    })

    const result = await optimizePrompt(settings, 'rewrite this')

    // When providerId is empty (not explicitly configured), the model setting
    // is also ignored and the session model is used instead.
    expect(result).toEqual({
      ok: true,
      text: 'Session model used.',
      model: 'big-pickle',
      providerId: 'opencode-zen'
    })
  })

  it('uses session model even when promptOptimization providerId differs from session', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: 'Use the session provider.' } }]
      }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const settings = createSettings({
      providerId: 'deepseek',
      smallModelProviderId: 'deepseek',
      smallModel: 'deepseek-v4-flash',
      promptOptimization: {
        enabled: true,
        providerId: 'other',
        model: '',
        prompt: '',
        timeoutMs: 60000
      }
    })
    settings.provider.providers.push({
      id: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      endpointFormat: 'chat_completions',
      models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      modelProfiles: {}
    })
    settings.provider.providers.push({
      id: 'other',
      name: 'Other',
      apiKey: 'sk-other',
      baseUrl: 'https://other.example',
      endpointFormat: 'chat_completions',
      models: ['other-chat'],
      modelProfiles: {}
    })

    const result = await optimizePrompt(settings, 'rewrite this')

    // promptOptimization.providerId is ignored; session provider (deepseek) is used.
    expect(result).toEqual({
      ok: true,
      text: 'Use the session provider.',
      model: 'deepseek-v4-flash',
      providerId: 'deepseek'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-deepseek'
        })
      })
    )
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(firstCall[1].body)) as { model: string }
    expect(body.model).toBe('deepseek-v4-flash')
  })

  it('uses unwrapped ChatGPT OAuth and Responses Lite for GPT-5.6', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output_text: 'Optimized.' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    // Set codex as the SESSION provider (not just promptOptimization.providerId)
    const settings = createSettings({
      providerId: 'codex',
      model: 'gpt-5.6-sol',
      promptOptimization: {
        enabled: true,
        providerId: '',
        model: '',
        prompt: 'Optimize.',
        timeoutMs: 60_000
      }
    })
    settings.provider.providers.push({
      id: 'codex',
      name: 'ChatGPT 订阅',
      apiKey: JSON.stringify({
        kind: 'codex-oauth', accessToken: 'oauth-token', refreshToken: 'refresh',
        accountId: 'account', expiresAt: Date.now() + 60_000
      }),
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      endpointFormat: 'responses',
      models: ['gpt-5.6-sol'],
      modelProfiles: {
        'gpt-5.6-sol': {
          inputModalities: ['text', 'image'], outputModalities: ['text'],
          supportsToolCalling: true, messageParts: ['text', 'image_url'], responsesMode: 'lite'
        }
      }
    })

    await optimizePrompt(settings, 'rough prompt')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer oauth-token',
      'ChatGPT-Account-Id': 'account',
      'x-openai-internal-codex-responses-lite': 'true'
    })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ store: false, parallel_tool_calls: false, reasoning: { context: 'all_turns' } })
    expect(body).not.toHaveProperty('instructions')
    expect(body.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'additional_tools', role: 'developer' })
    ]))
  })

  it('retries a transient 429 and returns the optimized text', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(RATE_LIMIT_BODY, { status: 429 }))
      .mockResolvedValueOnce(new Response(RATE_LIMIT_BODY, { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Optimized after retries.' } }]
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const transport = instantTransport()

    const result = await optimizePrompt(createSettings(), 'rough', undefined, transport)

    expect(result).toEqual({
      ok: true,
      text: 'Optimized after retries.',
      model: 'big-pickle',
      providerId: 'opencode-zen'
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // Exponential backoff without jitter: 1s then 2s.
    expect(transport.delays).toEqual([1000, 2000])
  })

  it('gives up after the retry budget and reports a structured rate-limit failure', async () => {
    const fetchMock = vi.fn(async () => new Response(RATE_LIMIT_BODY, { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    const transport = instantTransport()

    const result = await optimizePrompt(createSettings(), 'rough', undefined, transport)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({
      reason: 'rate_limited',
      status: 429,
      attempts: 3,
      detail: 'Error from provider (Console): Rate limit exceeded. Please try again later.'
    })
    if (result.ok) throw new Error('expected failure')
    expect(result.message).toBe(
      'Rate limited by the model provider (HTTP 429): Error from provider (Console): '
      + 'Rate limit exceeded. Please try again later. (retried 2 times)'
    )
    // The raw upstream JSON must never reach the composer.
    expect(result.message).not.toContain('FreeUsageLimitError')
    expect(result.message).not.toContain('{')
  })

  it('honours Retry-After while keeping the wait bounded', async () => {
    const fetchMock = vi.fn(async () => new Response(RATE_LIMIT_BODY, {
      status: 429,
      headers: { 'retry-after': '2' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const transport = instantTransport()

    await optimizePrompt(createSettings(), 'rough', undefined, transport)

    expect(transport.delays).toEqual([2000, 2000])
  })

  it('caps an oversized Retry-After at the retry ceiling', async () => {
    const fetchMock = vi.fn(async () => new Response(RATE_LIMIT_BODY, {
      status: 429,
      headers: { 'retry-after': '120' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const transport = instantTransport()

    await optimizePrompt(createSettings(), 'rough', undefined, transport)

    expect(transport.delays).toEqual([5000, 5000])
  })

  it('retries 5xx but never retries a non-retryable 4xx', async () => {
    const retryable = vi.fn(async () => new Response('boom', { status: 503 }))
    vi.stubGlobal('fetch', retryable)
    const retryableTransport = instantTransport()
    const retryableResult = await optimizePrompt(createSettings(), 'rough', undefined, retryableTransport)
    expect(retryable).toHaveBeenCalledTimes(3)
    expect(retryableResult).toMatchObject({ ok: false, reason: 'unavailable', status: 503, attempts: 3 })

    const fatal = vi.fn(async () => new Response('bad model', { status: 400 }))
    vi.stubGlobal('fetch', fatal)
    const fatalTransport = instantTransport()
    const fatalResult = await optimizePrompt(createSettings(), 'rough', undefined, fatalTransport)
    expect(fatal).toHaveBeenCalledTimes(1)
    expect(fatalTransport.delays).toEqual([])
    expect(fatalResult).toMatchObject({ ok: false, reason: 'request', status: 400, attempts: 1 })
  })

  it('reports network failures without dumping a stack', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND opencode.ai')
    })
    vi.stubGlobal('fetch', fetchMock)
    const transport = instantTransport()

    const result = await optimizePrompt(createSettings(), 'rough', undefined, transport)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      ok: false,
      reason: 'network',
      status: 0,
      attempts: 3,
      detail: 'getaddrinfo ENOTFOUND opencode.ai'
    })
    if (result.ok) throw new Error('expected failure')
    expect(result.message).toBe(
      'Could not reach the model provider: getaddrinfo ENOTFOUND opencode.ai (retried 2 times)'
    )
  })

  it('sends the OpenCode Zen client headers the chat runtime sends', async () => {
    // Regression: the free tier meters per client. Without these headers the
    // request lands in the anonymous "Console" bucket and is answered
    // `429 FreeUsageLimitError` for every free model, while normal chat —
    // which goes through the runtime and does send them — keeps working.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Optimized.' } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await optimizePrompt(createSettings(), 'rough', undefined, instantTransport())

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({
      'User-Agent': 'opencode/1.2.0',
      'x-opencode-client': 'desktop'
    })
  })

  it('does not send Zen client headers to other providers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Optimized.' } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const settings = createSettings({ providerId: 'deepseek', model: 'deepseek-v4-flash' })
    settings.provider.providers.push({
      id: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com',
      endpointFormat: 'chat_completions',
      models: ['deepseek-v4-flash'],
      modelProfiles: {}
    })

    await optimizePrompt(settings, 'rough', undefined, instantTransport())

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('x-opencode-client')
  })

  it('never sends a model the provider does not offer', async () => {
    // Regression: a stale `promptOptimization.model` (or a composer pick from
    // another provider) used to be forwarded to Joker-free / opencode-zen,
    // which relays unknown ids to a paid upstream and answers
    // `429 FreeUsageLimitError` while normal chat keeps working.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Optimized.' } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await optimizePrompt(
      createSettings(),
      'rough',
      { modelOverride: 'openai/gpt-oss-120b' },
      instantTransport()
    )

    expect(result).toMatchObject({ ok: true, model: 'big-pickle', providerId: 'opencode-zen' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { model: string }
    expect(body.model).toBe('big-pickle')
    expect(body.model).not.toBe('openai/gpt-oss-120b')
  })

  it('keeps a free-form model id for providers without a model list', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Optimized.' } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const settings = createSettings({ providerId: 'openai', model: 'gpt-5.2' })
    settings.provider.providers.push({
      id: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
      endpointFormat: 'chat_completions',
      models: [],
      modelProfiles: {}
    })

    const result = await optimizePrompt(settings, 'rough', undefined, instantTransport())

    expect(result).toMatchObject({ ok: true, model: 'gpt-5.2', providerId: 'openai' })
  })

  it('reports the model and provider that produced a failure', async () => {
    const fetchMock = vi.fn(async () => new Response(RATE_LIMIT_BODY, { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await optimizePrompt(createSettings(), 'rough', undefined, instantTransport())

    expect(result).toMatchObject({
      ok: false,
      reason: 'rate_limited',
      status: 429,
      model: 'big-pickle',
      providerId: 'opencode-zen'
    })
  })

  describe('only rewritten text reaches the composer', () => {
    const respondWith = async (raw: string): Promise<PromptOptimizationResult> => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: raw } }]
      }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      return optimizePrompt(createSettings(), '加个按钮 优化一下 prompt', undefined, instantTransport())
    }

    it('strips markdown fences, labels and wrapping quotes', async () => {
      const fenced = await respondWith(
        '```markdown\n优化后的提示词：\n"Add a button that rewrites the selected prompt."\n```'
      )
      expect(fenced).toMatchObject({
        ok: true,
        text: 'Add a button that rewrites the selected prompt.'
      })
    })

    it('retries a stray answer and only gives up after the last attempt', async () => {
      const stray = '这是一个提示词重写工具。请提供你想要重写的原始指令。'
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: stray } }]
      }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const transport = instantTransport()

      const result = await optimizePrompt(createSettings(), '加个按钮', undefined, transport)

      // Sampling is the culprit, so the same request is worth another try.
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(transport.delays).toEqual([1000, 2000])
      expect(result).toMatchObject({
        ok: false,
        reason: 'unusable_output',
        status: 200,
        attempts: 3
      })
      if (result.ok) throw new Error('expected failure')
      expect(result.detail).toBe(stray)
    })

    it('accepts the rewrite when a later attempt behaves', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          choices: [{ message: { content: '这是一个提示词重写工具。请提供原始指令。' } }]
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          choices: [{ message: { content: 'Add a button that optimizes the composer prompt.' } }]
        }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await optimizePrompt(createSettings(), '加个按钮', undefined, instantTransport())

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({
        ok: true,
        text: 'Add a button that optimizes the composer prompt.'
      })
    })

    it('refuses to overwrite the composer with a clarifying question', async () => {
      const result = await respondWith('您希望添加什么样的按钮？这个按钮的功能是什么？')

      expect(result).toMatchObject({
        ok: false,
        reason: 'unusable_output',
        status: 200,
        attempts: 3
      })
      if (result.ok) throw new Error('expected failure')
      expect(result.detail).toBe('您希望添加什么样的按钮？这个按钮的功能是什么？')
    })

    it('keeps a rewrite that asks the agent to provide something', async () => {
      // The source asks for output, so "请提供" in the rewrite is legitimate.
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: '请提供一个调用示例，并说明每个参数的含义。' } }]
      }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await optimizePrompt(
        createSettings(),
        '请提供一个调用示例',
        undefined,
        instantTransport()
      )

      expect(result).toMatchObject({ ok: true, text: '请提供一个调用示例，并说明每个参数的含义。' })
    })

    it('keeps a rewrite that ends in a question when the source does too', async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: 'Why does this button do nothing when the thread is busy?' } }]
      }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await optimizePrompt(
        createSettings(),
        '为什么这个按钮没反应？',
        undefined,
        instantTransport()
      )

      expect(result).toMatchObject({ ok: true })
    })

    it('refuses a polite preamble instead of a rewrite', async () => {
      const result = await respondWith('好的，我来帮你优化这段提示词。')
      expect(result).toMatchObject({ ok: false, reason: 'unusable_output' })
    })
  })

  it('explains an empty answer that a reasoning model crowded out', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: null, reasoning_content: 'think '.repeat(40) } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await optimizePrompt(createSettings(), 'rough', undefined, instantTransport())

    expect(result).toMatchObject({
      ok: false,
      reason: 'empty_response',
      attempts: 1,
      detail: 'The model used the whole output budget on reasoning (240 chars) and returned no answer.'
    })
  })

  it('does not retry a 200 with empty content', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '   ' } }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const transport = instantTransport()

    const result = await optimizePrompt(createSettings(), 'rough', undefined, transport)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      ok: false,
      reason: 'empty_response',
      status: 200,
      attempts: 1
    })
  })
})
