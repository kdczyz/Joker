import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { app } from 'electron'
import { logError, logInfo, logWarn } from '../logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JsonRpcId = string | number

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification

interface TextContent {
  type: 'text'
  text: string
}

interface AgentMessageChunk {
  sessionUpdate: 'agent_message_chunk'
  content: TextContent
}

interface ToolCallUpdate {
  sessionUpdate: 'tool_call'
  toolCallId: string
  toolName: string
  toolInput: unknown
  status: 'pending' | 'running' | 'completed' | 'error'
  output?: string
}

interface SessionUpdateParams {
  update: AgentMessageChunk | ToolCallUpdate | { sessionUpdate: string; [key: string]: unknown }
}

interface SessionPromptResult {
  sessionId: string
  stopReason: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

interface SessionNewResult {
  sessionId: string
}

interface InitializeResult {
  protocolVersion: number
  serverCapabilities: unknown
  authMethods: Array<{ id: string; name: string }>
}

// ---------------------------------------------------------------------------
// GrokBuild ACP Adapter
// ---------------------------------------------------------------------------

const GROK_RUNTIME_ID = 'grok-build' as const

/** Provider configuration passed from the renderer to configure the grok runtime. */
export type GrokProviderConfig = {
  apiKey: string
  baseUrl?: string
  model?: string
  providerId?: string
}

export type GrokSessionState = {
  sessionId: string
  cwd: string
  text: string
  stopReason: string | null
  isRunning: boolean
  toolCalls: Map<string, { name: string; status: string; input: unknown; output?: string }>
}

export type GrokBuildEvent =
  | { type: 'text-chunk'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; toolInput: unknown; status: string }
  | { type: 'tool-output'; toolCallId: string; output: string }
  | { type: 'turn-complete'; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; message: string; code?: string }
  | { type: 'status'; state: 'connecting' | 'authenticating' | 'ready' | 'running' | 'idle'; message?: string }

/**
 * Adapter that spawns grok-build in ACP stdio mode and manages the
 * JSON-RPC lifecycle. Designed to mirror the JokerRuntimeAdapter
 * interface so it can be swapped in with minimal changes to the
 * Electron main process.
 */
export const GrokBuildAdapter = {
  id: GROK_RUNTIME_ID,

  // --- child process state ---
  _proc: null as ChildProcess | null,
  _pending: new Map<JsonRpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(),
  _nextId: 0,
  _session: null as GrokSessionState | null,
  _eventHandler: null as ((event: GrokBuildEvent) => void) | null,
  _authenticated: false,
  _initialized: false,
  _providerConfig: null as GrokProviderConfig | null,

  // ------------------------------------------------------------------
  // Public API (mirrors JokerRuntimeAdapter)
  // ------------------------------------------------------------------

  /** Resolve the grok binary path. */
  resolveExecutable(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'grok-runtime', 'grok')
    }
    return join(app.getAppPath(), 'resources', 'grok-runtime', 'grok')
  },

  /** Start the grok ACP child process and authenticate. */
  async ensureRunning(cwd: string, config: GrokProviderConfig): Promise<void> {
    if (this._proc && this._authenticated) return

    await this.stopAndWait()
    const binPath = this.resolveExecutable()
    this._providerConfig = config

    // Build spawn args with optional model and base URL
    const spawnArgs = ['agent']
    if (config.model) {
      spawnArgs.push('--model', config.model)
    }
    if (config.baseUrl) {
      spawnArgs.push('--xai-api-base-url', config.baseUrl)
    }
    spawnArgs.push('stdio')

    logInfo(GROK_RUNTIME_ID, `Starting grok agent stdio: ${binPath} model=${config.model ?? 'default'} baseUrl=${config.baseUrl ?? 'default'}`)
    this._emitEvent({ type: 'status', state: 'connecting' })

    this._proc = spawn(binPath, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        XAI_API_KEY: config.apiKey,
        HOME: process.env.HOME ?? ''
      }
    })

    this._proc.stderr?.on('data', (chunk: Buffer) => {
      logWarn(GROK_RUNTIME_ID, `grok stderr: ${chunk.toString().trim()}`)
    })

    this._proc.on('exit', (code, signal) => {
      logInfo(GROK_RUNTIME_ID, `grok exited code=${code} signal=${signal}`)
      this._authenticated = false
      this._initialized = false
      this._proc = null
      this._pending.clear()
    })

    this._proc.on('error', (err) => {
      logError(GROK_RUNTIME_ID, 'grok process error', { message: err.message })
      this._emitEvent({ type: 'error', message: err.message, code: 'process_error' })
    })

    // Read JSON-RPC messages line-by-line
    const rl = createInterface({ input: this._proc.stdout! })
    rl.on('line', (line: string) => this._handleLine(line))

    // Initialize
    const initResult = await this._request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true
      }
    }) as InitializeResult

    this._initialized = true
    this._emitEvent({ type: 'status', state: 'authenticating' })

    // Authenticate with API key. For non-xAI providers this may fail,
    // but the model calls should still work through the custom base URL.
    try {
      await this._request('authenticate', {
        methodId: 'xai.api_key',
        _meta: { headless: true }
      })
      this._authenticated = true
      logInfo(GROK_RUNTIME_ID, 'grok ACP initialized and authenticated')
    } catch (authErr) {
      // Non-xAI providers may not support xai.api_key auth.
      // Still mark as authenticated so the adapter can proceed —
      // model calls go through the configured base URL.
      logWarn(GROK_RUNTIME_ID, `grok auth failed (non-xAI provider?): ${(authErr as Error).message}`)
      this._authenticated = true
    }

    this._emitEvent({ type: 'status', state: 'ready' })
  },

  /** Stop the grok child process. */
  async stopAndWait(): Promise<void> {
    if (!this._proc) return
    this._proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (!this._proc || this._proc.killed) {
          this._proc = null
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      this._proc?.once('exit', () => {
        this._proc = null
        resolve()
      })
      check()
    })
    this._authenticated = false
    this._initialized = false
    this._pending.clear()
    this._session = null
  },

  /** Whether the grok child process is currently running. */
  isChildRunning(): boolean {
    return this._proc !== null && !this._proc.killed
  },

  // ------------------------------------------------------------------
  // Session management
  // ------------------------------------------------------------------

  /** Create a new session. */
  async createSession(cwd: string): Promise<GrokSessionState> {
    const result = await this._request('session/new', {
      cwd,
      mcpServers: []
    }) as SessionNewResult

    this._session = {
      sessionId: result.sessionId,
      cwd,
      text: '',
      stopReason: null,
      isRunning: false,
      toolCalls: new Map()
    }
    return this._session
  },

  /** Send a prompt and start streaming the response. */
  async sendPrompt(
    prompt: string,
    options?: { sessionId?: string; cwd?: string }
  ): Promise<GrokSessionState> {
    let session = this._session
    if (!session || options?.cwd !== session.cwd) {
      session = await this.createSession(options?.cwd ?? process.cwd())
    }
    if (options?.sessionId) {
      session.sessionId = options.sessionId
    }

    session.text = ''
    session.stopReason = null
    session.isRunning = true
    session.toolCalls.clear()

    this._emitEvent({ type: 'status', state: 'running' })

    this._request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: prompt }]
    }).then((result) => {
      const promptResult = result as SessionPromptResult
      session!.stopReason = promptResult.stopReason
      session!.isRunning = false
      this._emitEvent({
        type: 'turn-complete',
        stopReason: promptResult.stopReason,
        usage: promptResult.usage
      })
      this._emitEvent({ type: 'status', state: 'idle' })
    }).catch((err) => {
      session!.isRunning = false
      this._emitEvent({ type: 'error', message: err.message, code: 'prompt_error' })
    })

    return session
  },

  /** Continue a session with a follow-up prompt. */
  async continueSession(
    sessionId: string,
    prompt: string
  ): Promise<GrokSessionState> {
    const session: GrokSessionState = {
      sessionId,
      cwd: this._session?.cwd ?? process.cwd(),
      text: '',
      stopReason: null,
      isRunning: true,
      toolCalls: new Map()
    }
    this._session = session

    this._emitEvent({ type: 'status', state: 'running' })

    this._request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: prompt }]
    }).then((result) => {
      const promptResult = result as SessionPromptResult
      session.stopReason = promptResult.stopReason
      session.isRunning = false
      this._emitEvent({
        type: 'turn-complete',
        stopReason: promptResult.stopReason,
        usage: promptResult.usage
      })
      this._emitEvent({ type: 'status', state: 'idle' })
    }).catch((err) => {
      session.isRunning = false
      this._emitEvent({ type: 'error', message: err.message, code: 'prompt_error' })
    })

    return session
  },

  /** Register an event listener for streaming updates. */
  onEvent(handler: (event: GrokBuildEvent) => void): void {
    this._eventHandler = handler
  },

  /** Remove event listener. */
  removeEventListener(): void {
    this._eventHandler = null
  },

  // ------------------------------------------------------------------
  // Internal: JSON-RPC
  // ------------------------------------------------------------------

  _handleLine(line: string): void {
    if (!line.trim()) return
    try {
      const message = JSON.parse(line) as JsonRpcMessage
      if ('id' in message) {
        // Response
        const pending = this._pending.get(message.id)
        if (pending) {
          this._pending.delete(message.id)
          if (message.error) {
            pending.reject(
              new Error(message.error.message ?? JSON.stringify(message.error))
            )
          } else {
            pending.resolve(message.result ?? {})
          }
        }
      } else if ('method' in message) {
        // Notification
        this._handleNotification(message as JsonRpcNotification)
      }
    } catch {
      // Non-JSON line (stderr may bleed through)
    }
  },

  _handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'session/update': {
        const params = notification.params as SessionUpdateParams | undefined
        if (!params?.update) return
        const update = params.update

        if (update.sessionUpdate === 'agent_message_chunk') {
          const chunk = update as AgentMessageChunk
          if (chunk.content?.text) {
            if (this._session) this._session.text += chunk.content.text
            this._emitEvent({ type: 'text-chunk', text: chunk.content.text })
          }
        } else if (update.sessionUpdate === 'tool_call') {
          const tc = update as ToolCallUpdate
          if (this._session) {
            this._session.toolCalls.set(tc.toolCallId, {
              name: tc.toolName,
              status: tc.status,
              input: tc.toolInput,
              output: tc.output
            })
          }
          this._emitEvent({
            type: 'tool-call',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            toolInput: tc.toolInput,
            status: tc.status
          })
          if (tc.output) {
            this._emitEvent({
              type: 'tool-output',
              toolCallId: tc.toolCallId,
              output: tc.output
            })
          }
        }
        break
      }
      default:
        // Ignore unknown notifications
        break
    }
  },

  _request(method: string, params?: unknown, timeoutMs = 120_000): Promise<unknown> {
    if (!this._proc) {
      return Promise.reject(new Error('grok process is not running'))
    }

    const id = String(++this._nextId)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this._pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {})
      }

      this._proc!.stdin!.write(JSON.stringify(request) + '\n')
    })
  },

  _emitEvent(event: GrokBuildEvent): void {
    try {
      this._eventHandler?.(event)
    } catch {
      // Don't let handler errors break the pipeline
    }
  }
}