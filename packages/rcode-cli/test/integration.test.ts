import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AgentClient } from '../src/client.js';
import { runExec } from '../src/exec.js';
import { runSession } from '../src/session.js';
import { runTurn } from '../src/session.js';
import type { PermissionMode } from '../src/types.js';

/**
 * Deterministic integration tests over a local mock of the Rcode SSE contract
 * (`/api/agent/run` + `/api/agent/approve`). These cover the interactive
 * approval paths that cannot be exercised against a live model in CI.
 */

interface MockState {
  server: Server;
  baseUrl: string;
  runBodies: Array<Record<string, unknown>>;
  approveBodies: Array<Record<string, unknown>>;
}

type RunBehavior = (
  body: Record<string, unknown>,
  res: ServerResponse
) => void;

function sse(res: ServerResponse, events: Array<Record<string, unknown>>): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

const APPROVAL_EVENT = {
  type: 'approval_required',
  conversationId: 'conv-1',
  answer: '',
  approvals: [
    {
      id: 'ap-1',
      conversationId: 'conv-1',
      reason: 'write_file requires approval in default mode',
      risk: 'high',
      toolCall: { id: 'tc-1', name: 'write_file', arguments: { path: 'x.txt', content: 'hi' } }
    }
  ]
};

function startMockServer(behavior: RunBehavior, approveBehavior?: RunBehavior): Promise<MockState> {
  const state: MockState = {
    server: undefined as unknown as Server,
    baseUrl: '',
    runBodies: [],
    approveBodies: []
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (req.url === '/api/agent/run') {
        state.runBodies.push(body);
        behavior(body, res);
        return;
      }
      if (req.url === '/api/agent/approve') {
        state.approveBodies.push(body);
        (approveBehavior ?? behavior)(body, res);
        return;
      }
      res.writeHead(404).end('{}');
    });
  });
  state.server = server;
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      state.baseUrl = `http://127.0.0.1:${port}`;
      resolvePromise(state);
    });
  });
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((item) => new Promise<void>((r) => item.close(() => r()))));
});

describe('interactive approval flow (runTurn)', () => {
  it('sends allow=true when the approver accepts, and continues the turn', async () => {
    const mock = await startMockServer(
      (_body, res) =>
        sse(res, [
          { type: 'run_started', conversationId: 'conv-1' },
          APPROVAL_EVENT
        ]),
      (body, res) =>
        sse(res, [{ type: 'completed', conversationId: 'conv-1', answer: 'done after approval' }])
    );
    servers.push(mock.server);

    const client = new AgentClient(mock.baseUrl, '');
    const events: string[] = [];
    const conversationId = await runTurn(
      client,
      async () => true,
      { onEvent: (event) => events.push(event.type) },
      { prompt: 'write x', mode: 'default' as PermissionMode }
    );

    expect(conversationId).toBe('conv-1');
    expect(mock.approveBodies).toHaveLength(1);
    expect(mock.approveBodies[0]?.allow).toBe(true);
    expect(mock.approveBodies[0]?.approvalId).toBe('ap-1');
    expect(events).toContain('completed');
  });

  it('sends allow=false when the approver rejects', async () => {
    const mock = await startMockServer(
      (_body, res) => sse(res, [APPROVAL_EVENT]),
      (_body, res) => sse(res, [{ type: 'completed', conversationId: 'conv-1', answer: '' }])
    );
    servers.push(mock.server);

    const client = new AgentClient(mock.baseUrl, '');
    await runTurn(client, async () => false, { onEvent: () => {} }, { prompt: 'x' });
    expect(mock.approveBodies[0]?.allow).toBe(false);
  });

  it('resolves multiple queued approvals in order', async () => {
    const twoApprovals = {
      ...APPROVAL_EVENT,
      approvals: [
        APPROVAL_EVENT.approvals[0],
        {
          id: 'ap-2',
          conversationId: 'conv-1',
          reason: 'second',
          risk: 'medium',
          toolCall: { id: 'tc-2', name: 'run_shell', arguments: { command: 'ls' } }
        }
      ]
    };
    const mock = await startMockServer(
      (_body, res) => sse(res, [twoApprovals]),
      (_body, res) => sse(res, [{ type: 'completed', conversationId: 'conv-1', answer: '' }])
    );
    servers.push(mock.server);

    const client = new AgentClient(mock.baseUrl, '');
    await runTurn(client, async () => true, { onEvent: () => {} }, { prompt: 'x' });
    expect(mock.approveBodies.map((item) => item.approvalId)).toEqual(['ap-1', 'ap-2']);
  });
});

describe('headless exec over the SSE contract', () => {
  it('exits 0 and prints the final answer when the turn completes', async () => {
    const mock = await startMockServer((_body, res) =>
      sse(res, [
        { type: 'run_started', conversationId: 'c1' },
        { type: 'text_delta', content: '正常' },
        { type: 'completed', conversationId: 'c1', answer: '正常' }
      ])
    );
    servers.push(mock.server);

    const exit = await runExec({
      client: new AgentClient(mock.baseUrl, ''),
      prompt: 'test',
      projectPath: '/tmp',
      mode: 'default' as PermissionMode,
      output: 'quiet',
      autoApprove: false
    });
    expect(exit).toBe(0);
  });

  it('exits 2 when an approval is required but headless default is deny', async () => {
    const mock = await startMockServer(
      (_body, res) => sse(res, [APPROVAL_EVENT]),
      (_body, res) => sse(res, [{ type: 'completed', conversationId: 'conv-1', answer: '' }])
    );
    servers.push(mock.server);

    // Non-TTY stdin in vitest guarantees the deny path.
    const exit = await runExec({
      client: new AgentClient(mock.baseUrl, ''),
      prompt: 'test',
      projectPath: '/tmp',
      mode: 'default' as PermissionMode,
      output: 'json',
      autoApprove: false
    });
    expect(exit).toBe(2);
    expect(mock.approveBodies[0]?.allow).toBe(false);
  });

  it('emits JSONL events in --json mode', async () => {
    const mock = await startMockServer((_body, res) =>
      sse(res, [
        { type: 'run_started', conversationId: 'c9' },
        { type: 'completed', conversationId: 'c9', answer: 'ok' }
      ])
    );
    servers.push(mock.server);

    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await runExec({
        client: new AgentClient(mock.baseUrl, ''),
        prompt: 'test',
        projectPath: '/tmp',
        mode: 'default' as PermissionMode,
        output: 'json',
        autoApprove: false
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    const parsed = chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(parsed.map((event) => event.type)).toEqual(['run_started', 'completed']);
  });

  it('forwards mode/projectPath/conversationId in the run request', async () => {
    const mock = await startMockServer((_body, res) =>
      sse(res, [{ type: 'completed', conversationId: 'keep-id', answer: 'ok' }])
    );
    servers.push(mock.server);

    await runExec({
      client: new AgentClient(mock.baseUrl, ''),
      prompt: 'test',
      projectPath: '/tmp/demo',
      mode: 'plan' as PermissionMode,
      thinking: 'deep',
      conversationId: 'keep-id',
      output: 'quiet',
      autoApprove: false
    });

    expect(mock.runBodies[0]).toMatchObject({
      prompt: 'test',
      mode: 'plan',
      thinkingMode: 'deep',
      conversationId: 'keep-id'
    });
  });
});

describe('humanizeError', () => {
  it('adds actionable hints for opaque upstream failures', async () => {
    const { humanizeError } = await import('../src/exec.js');
    const hint = humanizeError('fetch failed');
    expect(hint).toContain('fetch failed');
    expect(hint).toContain('网络/代理');

    expect(humanizeError('local API token is required')).toContain('--token');
    expect(humanizeError('provider not configured')).toContain('桌面端');
    expect(humanizeError('some other failure')).toBe('some other failure');
  });
});

describe('piped (non-TTY) session input', () => {
  it('processes slash commands and prompts from a pipe, then exits cleanly', async () => {
    const mock = await startMockServer((_body, res) =>
      sse(res, [{ type: 'completed', conversationId: 'c2', answer: 'pong' }])
    );
    servers.push(mock.server);

    // Feed stdin deterministically instead of relying on the runner's TTY.
    const { PassThrough } = await import('node:stream');
    const fakeStdin = new PassThrough();
    fakeStdin.isTTY = false;
    fakeStdin.end('/help\nclean this up\n/exit\n');
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      await runSession({
        client: new AgentClient(mock.baseUrl, ''),
        projectPath: '/tmp',
        mode: 'workspace_write' as PermissionMode,
        thinking: 'balanced'
      });
    } finally {
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    }

    expect(mock.runBodies.map((item) => item.prompt)).toEqual(['clean this up']);
  });
});
