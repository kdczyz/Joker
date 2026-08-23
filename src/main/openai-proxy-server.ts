import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  ANTIGRAVITY_CLOUDCODE_BASE_URL,
  ANTIGRAVITY_SUBSCRIPTION_MODEL_IDS,
  ANTIGRAVITY_SUBSCRIPTION_PROVIDER_ID
} from '../shared/model-provider-presets'
import { getModelProviderSettings } from '../shared/app-settings-provider'
import type { AppSettingsV1, OpenAiProxySettingsV1 } from '../shared/app-settings-types'
import {
  antigravityRequestHeaders,
  encodeAntigravityCredentials,
  parseAntigravityCredentials,
  refreshAntigravityToken,
  resolveAntigravityApiKey,
  type AntigravityOAuthCredentials
} from './antigravity-auth'
import { readRequestBody, writeJson } from './schedule-runtime-helpers'
import type { JsonSettingsStore } from './settings-store'
import {
  cloudCodeResponseToOpenAiChat,
  cloudCodeSseToOpenAiSse,
  createCloudCodeStreamContext,
  openAiChatToCloudCodeBody
} from '../../Rcode/src/adapters/model/cloudcode-openai-adapter.js'

export type OpenAiProxyDeps = {
  store: JsonSettingsStore
  logError: (category: string, message: string, detail?: unknown) => void
}

const KEEPALIVE_MS = 15_000

type OpenAiProxyHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => void | Promise<void>

/**
 * Hosts a local OpenAI-compatible endpoint (`/v1/chat/completions`,
 * `/v1/models`) that proxies to the configured Antigravity (Google Cloud Code
 * Assist) subscription. Incoming OpenAI requests are translated to the
 * CloudCode wire format and the responses back to OpenAI SSE/JSON, reusing the
 * same adapter the in-app model channel uses — so any OpenAI client
 * (Cline/Cherry Studio/Codex) can drive the Antigravity subscription.
 *
 * Mirrors the lifecycle of the workflow webhook server: created once at boot,
 * `sync(settings)` toggles the listener, `stop()` tears it down.
 */
export class OpenAiProxyServer {
  private readonly deps: OpenAiProxyDeps
  private server: Server | null = null
  private serverKey = ''
  private current: OpenAiProxySettingsV1 | null = null

  constructor(deps: OpenAiProxyDeps) {
    this.deps = deps
  }

  sync(settings: AppSettingsV1): void {
    const proxy = settings.openaiProxy
    this.current = proxy ?? null
    if (!proxy || !proxy.enabled) {
      this.closeServer()
      return
    }
    const key = String(proxy.port)
    if (this.server && this.serverKey === key) return
    this.closeServer()
    const handler: OpenAiProxyHandler = (req, res) => {
      void this.handleRequest(req, res, proxy)
    }
    const server = createServer((req, res) => {
      void handler(req, res)
    })
    server.on('error', (error) => {
      this.deps.logError('openai-proxy', 'OpenAI proxy server failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (this.server === server) this.closeServer()
    })
    // Bind to localhost only — never expose the listener to the network.
    server.listen(proxy.port, '127.0.0.1')
    this.server = server
    this.serverKey = key
  }

  stop(): void {
    this.closeServer()
  }

  private closeServer(): void {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.serverKey = ''
    server.close()
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    proxy: OpenAiProxySettingsV1
  ): Promise<void> {
    // CORS + preflight (handy if a browser-based client calls the proxy).
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Rcode-Proxy-Token')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }

    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (req.method === 'GET' && pathname === '/v1/models') {
      this.handleModels(res)
      return
    }
    if (req.method === 'POST' && pathname === '/v1/chat/completions') {
      await this.handleChatCompletions(req, res, proxy)
      return
    }
    if (pathname === '/' || pathname === '/health') {
      writeJson(res, 200, { ok: true, service: 'rcode-openai-proxy' })
      return
    }
    writeJson(res, 404, { error: { message: `Not found: ${req.method} ${pathname}` } })
  }

  private handleModels(res: ServerResponse): void {
    const objects = ANTIGRAVITY_SUBSCRIPTION_MODEL_IDS.map((id) => ({
      id,
      object: 'model',
      created: 0,
      owned_by: 'antigravity'
    }))
    writeJson(res, 200, { object: 'list', data: objects })
  }

  private requireAuth(req: IncomingMessage, proxy: OpenAiProxySettingsV1): boolean {
    if (!proxy.token) return true
    const header = req.headers['x-Rcode-proxy-token']
    const token = Array.isArray(header) ? header[0] : header
    return token === proxy.token
  }

  private resolveBaseUrl(proxy: OpenAiProxySettingsV1, settings: AppSettingsV1): string {
    if (proxy.providerId) {
      const provider = getModelProviderSettings(settings).providers.find(
        (p) => p.id === proxy.providerId
      )
      if (provider?.baseUrl?.trim()) return provider.baseUrl.trim()
    }
    return ANTIGRAVITY_CLOUDCODE_BASE_URL
  }

  private buildEndpointUrl(baseUrl: string, stream: boolean): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    return stream
      ? `${normalized}:streamGenerateContent?alt=sse`
      : `${normalized}:generateContent`
  }

  private async handleChatCompletions(
    req: IncomingMessage,
    res: ServerResponse,
    proxy: OpenAiProxySettingsV1
  ): Promise<void> {
    if (!this.requireAuth(req, proxy)) {
      writeJson(res, 401, { error: { message: 'Missing or invalid X-Rcode-Proxy-Token' } })
      return
    }

    const bodyText = await readRequestBody(req).catch(() => '')
    let body: Record<string, unknown>
    try {
      body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {}
    } catch {
      writeJson(res, 400, { error: { message: 'Invalid JSON body' } })
      return
    }

    const stream = body.stream === true
    const model = typeof body.model === 'string' && body.model ? body.model : 'gemini-pro-agent'
    const settings = await this.deps.store.load()

    const providerId = proxy.providerId?.trim() || ANTIGRAVITY_SUBSCRIPTION_PROVIDER_ID
    const provider = getModelProviderSettings(settings).providers.find((p) => p.id === providerId)
    if (!provider || !provider.apiKey?.trim()) {
      writeJson(res, 503, {
        error: { message: `Antigravity provider "${providerId}" is not configured. Log in to the Antigravity subscription first.` }
      })
      return
    }

    // Resolve OAuth credentials, refreshing transparently when expired.
    let creds = parseAntigravityCredentials(provider.apiKey)
    if (creds && creds.expiresAt <= Date.now()) {
      const refreshed = await refreshAntigravityToken(creds)
      if (refreshed) {
        creds = refreshed
        await this.persistRefreshedToken(providerId, refreshed)
      }
    }
    const resolved = resolveAntigravityApiKey(provider.apiKey)
    if (!resolved.apiKey) {
      writeJson(res, 503, { error: { message: 'Antigravity credentials are missing or invalid.' } })
      return
    }

    const baseUrl = this.resolveBaseUrl(proxy, settings)
    const url = this.buildEndpointUrl(baseUrl, stream)
    const cloudCodeBody = openAiChatToCloudCodeBody(
      body as Parameters<typeof openAiChatToCloudCodeBody>[0]
    )

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolved.apiKey}`,
      ...(resolved.headers ?? {})
    }

    let upstream: Response
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(cloudCodeBody)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('openai-proxy', 'Upstream request failed', { message })
      writeJson(res, 502, { error: { message: `Upstream request failed: ${message}` } })
      return
    }

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '')
      writeJson(res, upstream.status || 502, {
        error: { message: text.slice(0, 800) || `Upstream returned ${upstream.status}` }
      })
      return
    }

    if (!stream) {
      const data = await upstream.json().catch(() => ({}))
      const openAi = cloudCodeResponseToOpenAiChat(data as Parameters<typeof cloudCodeResponseToOpenAiChat>[0], {
        model
      })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(openAi))
      return
    }

    await this.streamUpstream(upstream, res, model)
  }

  private async streamUpstream(
    upstream: Response,
    res: ServerResponse,
    model: string
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    const ctx = createCloudCodeStreamContext({ includeUsage: true })
    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let closed = false

    const keepalive = setInterval(() => {
      if (!closed) {
        try {
          res.write(': keepalive\n\n')
        } catch {
          /* ignore */
        }
      }
    }, KEEPALIVE_MS)

    const finish = (): void => {
      if (closed) return
      closed = true
      clearInterval(keepalive)
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const rawLine = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          this.emitSseLine(rawLine, res, ctx, model)
          if (closed) break
        }
      }
      // Flush any trailing line without a final newline.
      if (!closed && buffer.trim().length) {
        this.emitSseLine(buffer, res, ctx, model)
        buffer = ''
      }
      if (!closed) {
        res.write('data: [DONE]\n\n')
      }
    } catch (error) {
      if (!closed) {
        const message = error instanceof Error ? error.message : String(error)
        res.write(
          `data: ${JSON.stringify({ error: { message } })}\n\n`
        )
      }
    } finally {
      finish()
    }
  }

  private emitSseLine(
    rawLine: string,
    res: ServerResponse,
    ctx: ReturnType<typeof createCloudCodeStreamContext>,
    model: string
  ): void {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) return
    const dataStr = line.slice(5).trim()
    if (dataStr === '[DONE]' || dataStr.length === 0) return
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(dataStr) as Record<string, unknown>
    } catch {
      return
    }
    const frames = cloudCodeSseToOpenAiSse(payload, ctx, { model })
    for (const frame of frames) {
      res.write(`data: ${frame.data}\n\n`)
      if (frame.done) res.write('data: [DONE]\n\n')
    }
  }

  private async persistRefreshedToken(
    providerId: string,
    creds: AntigravityOAuthCredentials
  ): Promise<void> {
    try {
      await this.deps.store.patch({
        provider: { providers: [{ id: providerId, apiKey: encodeAntigravityCredentials(creds) }] }
      })
    } catch (error) {
      this.deps.logError('openai-proxy', 'Failed to persist refreshed Antigravity token', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export function createOpenAiProxyServer(deps: OpenAiProxyDeps): OpenAiProxyServer {
  return new OpenAiProxyServer(deps)
}
