import type { StreamEvent, PermissionMode, ThinkingMode } from './types.js';

/**
 * Thin typed client over the existing Joker server HTTP/SSE contract.
 * Routes used: /api/health, /api/agent/run, /api/agent/approve,
 * /api/tools, /api/usage, /api/audit.
 */
export class AgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(this.token ? { 'x-agent-token': this.token } : {})
    };
  }

  async getJson(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  }

  /** Generic POST returning the JSON payload (MCP management, tests). */
  async postJson(path: string, body: unknown = {}): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body)
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  }

  async deleteJson(path: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'DELETE', headers: this.headers() });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `${response.status} ${response.statusText}`);
    }
  }

  async listTools(): Promise<ToolSummary[]> {
    const data = (await this.getJson('/api/tools')) as { tools?: ToolSummary[] };
    return data.tools ?? [];
  }

  async usage(): Promise<unknown> {
    return this.getJson('/api/usage');
  }

  /**
   * Streams one agent turn. Returns when the stream ends with `completed`,
   * `error`, or connection close; every event is forwarded to `onEvent`.
   */
  async runStream(
    body: RunRequest,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await this.stream('/api/agent/run', body, onEvent, signal);
  }

  async approveStream(
    approvalId: string,
    allow: boolean,
    body: RunRequest,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await this.stream('/api/agent/approve', { approvalId, allow, ...body }, onEvent, signal);
  }

  private async stream(
    path: string,
    body: unknown,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            onEvent(JSON.parse(line.slice(6)) as StreamEvent);
          } catch {
            // ignore malformed frames — the GUI renderer does the same
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  }
}

export interface ToolSummary {
  name: string;
  description?: string;
  risk?: string;
  source?: string;
}

export interface RunRequest {
  prompt: string;
  conversationId?: string;
  mode?: PermissionMode;
  model?: string;
  thinkingMode?: ThinkingMode;
  projectPath?: string;
}
