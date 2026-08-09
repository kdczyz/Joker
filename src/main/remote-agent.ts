import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { hostname } from 'node:os'
import type { AppSettingsV1, ScheduleRunMode } from '../shared/app-settings'

/* ------------------------------------------------------------------ */
/*  Types (mirror Fwq protocol — keep in sync with remote-room.ts)     */
/* ------------------------------------------------------------------ */

export type RemoteAgentState = 'offline' | 'connecting' | 'online' | 'waiting'

export interface RemoteDeviceMetadata {
  id: string
  name: string
  platform: string
  appVersion?: string
  projectName?: string
  ready: boolean
  workspace?: unknown
}

export interface RemoteCommand {
  id: string
  requestId: string
  deviceId: string
  action: string
  status: string
  summary?: string
  createdAt: number
  updatedAt: number
}

export interface RemoteCommandEvent {
  type: string
  [key: string]: unknown
}

export interface AgentRunResult {
  ok: boolean
  text?: string
  message: string
}

/* ------------------------------------------------------------------ */
/*  Deps injected from main process                                    */
/* ------------------------------------------------------------------ */

export interface RemoteAgentExecuteOptions {
  /** Provider id chosen on the controller (may not match desktop providers). */
  providerId?: string | null
  /** Model chosen on the controller (e.g. "mimo-v2.5"). */
  model?: string | null
  /** Thinking mode chosen on the controller: fast | balanced | deep. */
  thinkingMode?: string | null
}

export interface RemoteAgentDeps {
  /** Execute an agent prompt headlessly via Rcode runtime. */
  executeAgent: (
    prompt: string,
    mode: ScheduleRunMode,
    signal: AbortSignal,
    options?: RemoteAgentExecuteOptions
  ) => Promise<AgentRunResult>
  /** Push status change to renderer. */
  onStatusChange: (state: RemoteAgentState, message?: string) => void
  /** Push command update to renderer. */
  onCommandUpdate: (command: RemoteCommand) => void
  /** Push command event to renderer. */
  onCommandEvent: (commandId: string, event: RemoteCommandEvent) => void
  /** Push config sync notification to renderer (cloud config changed on another device). */
  onConfigSync: (source: string) => void
  /** Load current settings (for workspace metadata). */
  getSettings: () => Promise<AppSettingsV1>
}

/* ------------------------------------------------------------------ */
/*  Device identity — persist a stable UUID per install                */
/* ------------------------------------------------------------------ */

let cachedDeviceId: string | null = null

export async function getOrCreateDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId
  const dir = app.getPath('userData')
  const file = join(dir, 'remote-device-id.json')
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as { id?: unknown }
    if (typeof data.id === 'string' && data.id.length > 0 && data.id.length <= 128) {
      cachedDeviceId = data.id
      return cachedDeviceId
    }
  } catch { /* not yet created */ }
  const id = randomUUID()
  await mkdir(dir, { recursive: true })
  await writeFile(file, JSON.stringify({ id }), 'utf8')
  cachedDeviceId = id
  return id
}

function buildDeviceMetadata(deviceId: string, settings: AppSettingsV1): RemoteDeviceMetadata {
  const providers = settings.provider?.providers ?? []
  const models = providers.flatMap((p) => p.models ?? [])
  const defaultModel = settings.agents?.Rcode?.model || models[0] || ''
  // Sync lightweight provider info (no apiKey/baseUrl) so the controller can
  // pick a providerId that matches the desktop's configured providers — this
  // is critical for correct model→provider routing on the agent side.
  const workspaceProviders = providers
    .map((p) => ({
      id: p.id,
      displayName: p.name || p.id,
      model: p.models?.[0] || '',
      models: [...new Set((p.models ?? []).filter((m) => typeof m === 'string' && m))].slice(0, 40)
    }))
    .filter((p) => p.id)
    .slice(0, 20)
  return {
    id: deviceId,
    name: hostname() || 'Desktop',
    platform: process.platform,
    appVersion: app.getVersion(),
    projectName: 'Rcode',
    ready: true,
    workspace: {
      projects: [],
      models: [...new Set(models.filter((m) => typeof m === 'string' && m))].slice(0, 60),
      defaultModel: defaultModel || undefined,
      providers: workspaceProviders
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Mode mapping: remote protocol → Rcode ScheduleRunMode                */
/* ------------------------------------------------------------------ */

function mapRemoteMode(remoteMode: string | undefined): ScheduleRunMode {
  if (remoteMode === 'plan') return 'plan'
  // default, workspace_write, custom, full_access → agent
  return 'agent'
}

/* ------------------------------------------------------------------ */
/*  RemoteAgent — WebSocket client for RemoteRoom "agent" role         */
/* ------------------------------------------------------------------ */

const AUTH_API_URL = 'https://lxqandlzy.me'
const HEARTBEAT_MS = 25_000
const STALE_MS = 60_000

interface PendingTask {
  commandId: string
  requestId: string
  controller: AbortController
}

export class RemoteAgent {
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wanted = false
  private token = ''
  private deviceId = ''
  private generation = 0
  private attempt = 0
  private lastMessageAt = 0
  private pendingTasks = new Map<string, PendingTask>()

  constructor(private readonly deps: RemoteAgentDeps) {}

  get state(): RemoteAgentState {
    if (!this.wanted) return 'offline'
    if (this.ws?.readyState === WebSocket.OPEN) return 'online'
    if (this.ws?.readyState === WebSocket.CONNECTING) return 'connecting'
    return 'waiting'
  }

  async start(token: string): Promise<void> {
    if (this.wanted) return
    this.wanted = true
    this.token = token
    this.deviceId = await getOrCreateDeviceId()
    this.attempt = 0
    console.log('[remote-agent] starting, deviceId=', this.deviceId)
    this.deps.onStatusChange('connecting')
    void this.connect()
  }

  stop(): void {
    this.wanted = false
    this.generation += 1
    this.clearTimers()
    this.abortAllTasks()
    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState < WebSocket.CLOSING) {
      try { ws.close(1000, 'agent stopped') } catch { /* ignore */ }
    }
    this.deps.onStatusChange('offline')
  }

  /* ---------------------------------------------------------- */
  /*  Connection lifecycle                                       */
  /* ---------------------------------------------------------- */

  private async connect(): Promise<void> {
    if (!this.wanted) return
    const gen = ++this.generation
    this.clearTimers()
    this.deps.onStatusChange('connecting')

    try {
      const settings = await this.deps.getSettings()
      const device = buildDeviceMetadata(this.deviceId, settings)
      console.log('[remote-agent] requesting ticket, device=', device.name, device.platform)

      // 1. Request one-time ticket
      const ticketRes = await fetch(`${AUTH_API_URL}/v1/remote/ticket`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`
        },
        body: JSON.stringify({ role: 'agent', device })
      })
      if (!ticketRes.ok) {
        const body = await ticketRes.json().catch(() => ({}))
        throw new Error(body.error || `Ticket request failed (${ticketRes.status})`)
      }
      const ticket = (await ticketRes.json()) as { url?: string }
      console.log('[remote-agent] ticket received, url=', ticket.url?.slice(0, 60) + '...')
      if (!ticket.url || !/^wss?:\/\//i.test(ticket.url)) {
        throw new Error('远程服务返回了无效连接地址')
      }
      if (!this.wanted || gen !== this.generation) return

      // 2. Open WebSocket
      console.log('[remote-agent] opening WebSocket')
      const ws = new WebSocket(ticket.url)
      this.ws = ws

      ws.onopen = () => {
        if (this.ws !== ws || gen !== this.generation) return
        console.log('[remote-agent] WebSocket connected')
        this.attempt = 0
        this.lastMessageAt = Date.now()
        this.deps.onStatusChange('online')
        this.startHeartbeat(ws, gen)
      }

      ws.onmessage = (ev: MessageEvent) => {
        if (this.ws !== ws) return
        this.lastMessageAt = Date.now()
        this.handleMessage(ev.data as string)
      }

      ws.onerror = (ev: Event) => {
        console.error('[remote-agent] WebSocket error:', ev)
        if (this.ws === ws) this.deps.onStatusChange('waiting', '远程连接暂时不可用，正在重试')
      }

      ws.onclose = (ev: CloseEvent) => {
        console.log('[remote-agent] WebSocket closed:', ev.code, ev.reason)
        if (this.ws !== ws) return
        this.ws = null
        this.clearHeartbeat()
        this.scheduleReconnect()
      }
    } catch (err) {
      console.error('[remote-agent] connect failed:', err)
      if (!this.wanted || gen !== this.generation) return
      this.ws = null
      this.deps.onStatusChange('waiting', err instanceof Error ? err.message : '远程连接失败')
      this.scheduleReconnect()
    }
  }

  private startHeartbeat(ws: WebSocket, gen: number): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws !== ws || gen !== this.generation) return
      if (Date.now() - this.lastMessageAt > STALE_MS) {
        try { ws.close(4000, 'heartbeat timeout') } catch { /* ignore */ }
        return
      }
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'ping' })) } catch { /* ignore */ }
      }
    }, HEARTBEAT_MS)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (!this.wanted) return
    this.deps.onStatusChange('waiting')
    const delay = Math.min(30_000, 2_000 * Math.pow(1.7, this.attempt++))
    this.reconnectTimer = setTimeout(() => void this.connect(), delay)
  }

  /* ---------------------------------------------------------- */
  /*  Message handling                                           */
  /* ---------------------------------------------------------- */

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)) } catch { /* ignore */ }
    }
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch { return }

    switch (msg.type) {
      case 'remote.ready':
      case 'remote.snapshot':
        // Server sends snapshot — we don't need to act on it as an agent
        break
      case 'command.execute':
        void this.executeCommand(msg)
        break
      case 'command.stop':
        this.handleStopCommand(msg)
        break
      case 'config.sync':
        // Another device changed cloud AI config — notify renderer to re-fetch
        console.log('[remote-agent] config.sync received from', msg.source)
        this.deps.onConfigSync(typeof msg.source === 'string' ? msg.source : 'unknown')
        break
      case 'remote.error':
        // Server-side error — notify renderer
        this.deps.onStatusChange(this.state, typeof msg.error === 'string' ? msg.error : undefined)
        break
    }
  }

  private async executeCommand(msg: Record<string, unknown>): Promise<void> {
    const command = msg.command as Record<string, unknown> | undefined
    const payload = msg.payload as Record<string, unknown> | undefined
    if (!command || !payload) return

    const commandId = typeof command.id === 'string' ? command.id : ''
    const requestId = typeof command.requestId === 'string' ? command.requestId : ''
    if (!commandId) return

    const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
    const mode = typeof payload.mode === 'string' ? payload.mode : 'default'
    const providerId = typeof payload.providerId === 'string' ? payload.providerId : null
    const model = typeof payload.model === 'string' ? payload.model : null
    const thinkingMode = typeof payload.thinkingMode === 'string' ? payload.thinkingMode : null
    if (!prompt) {
      this.send({ type: 'command.updated', command: { ...command, status: 'failed', summary: 'Empty prompt' } })
      this.send({ type: 'command.event', commandId, event: { type: 'error', message: '任务内容为空' } })
      return
    }

    // Mark as running
    this.send({
      type: 'command.updated',
      command: { ...command, status: 'running', updatedAt: Date.now() }
    })
    this.send({
      type: 'command.event',
      commandId,
      event: { type: 'workflow_state', label: '正在执行远程任务' }
    })

    // Setup abort controller
    const controller = new AbortController()
    const task: PendingTask = { commandId, requestId, controller }
    this.pendingTasks.set(commandId, task)

    try {
      const result = await this.deps.executeAgent(
        prompt,
        mapRemoteMode(mode),
        controller.signal,
        { providerId, model, thinkingMode }
      )

      if (result.ok) {
        // Send final text as a text_delta event
        if (result.text) {
          this.send({ type: 'command.event', commandId, event: { type: 'text_delta', text: result.text } })
        }
        this.send({
          type: 'command.event',
          commandId,
          event: { type: 'completed', text: result.text || '' }
        })
        this.send({
          type: 'command.updated',
          command: { ...command, status: 'completed', summary: result.text?.slice(0, 200) || '已完成', updatedAt: Date.now() }
        })
      } else {
        this.send({ type: 'command.event', commandId, event: { type: 'error', message: result.message } })
        this.send({
          type: 'command.updated',
          command: { ...command, status: 'failed', summary: result.message.slice(0, 200), updatedAt: Date.now() }
        })
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Already handled by stopCommand
        return
      }
      const message = err instanceof Error ? err.message : '执行失败'
      this.send({ type: 'command.event', commandId, event: { type: 'error', message } })
      this.send({
        type: 'command.updated',
        command: { ...command, status: 'failed', summary: message.slice(0, 200), updatedAt: Date.now() }
      })
    } finally {
      this.pendingTasks.delete(commandId)
    }
  }

  private handleStopCommand(msg: Record<string, unknown>): void {
    const commandId = typeof msg.commandId === 'string' ? msg.commandId : ''
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : ''
    const task = commandId ? this.pendingTasks.get(commandId) : null
    if (task) {
      task.controller.abort()
      this.pendingTasks.delete(commandId)
    }
    this.send({
      type: 'command.event',
      commandId,
      event: { type: 'stopped', message: '已从手机端终止本次会话' }
    })
  }

  private abortAllTasks(): void {
    for (const task of this.pendingTasks.values()) {
      task.controller.abort()
    }
    this.pendingTasks.clear()
  }

  /** Notify other devices that cloud AI config has changed (call after saving to cloud). */
  notifyConfigSync(): void {
    this.send({ type: 'config.sync', source: this.deviceId })
    console.log('[remote-agent] config.sync sent')
  }
}
