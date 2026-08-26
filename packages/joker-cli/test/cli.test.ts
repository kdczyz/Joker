import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/main.js';
import { resolveConfig } from '../src/config.js';
import { AgentClient } from '../src/client.js';

describe('parseArgs', () => {
  it('defaults to chat with no args', () => {
    const parsed = parseArgs([]);
    expect(parsed.command).toBe('chat');
    expect(parsed.rest).toEqual([]);
  });

  it('parses flags with values and keeps positionals', () => {
    const parsed = parseArgs(['exec', 'fix', 'the', 'bug', '--project', '/tmp/x', '--mode', 'plan']);
    expect(parsed.command).toBe('exec');
    expect(parsed.rest).toEqual(['fix', 'the', 'bug']);
    expect(parsed.overrides.projectPath).toBe('/tmp/x');
    expect(parsed.overrides.mode).toBe('plan');
  });

  it('supports mode aliases and no-server flag', () => {
    const parsed = parseArgs(['--mode', 'yolo', '--no-start-server', 'status']);
    expect(parsed.command).toBe('status');
    expect(parsed.overrides.mode).toBe('yolo');
    expect(parsed.overrides.noServerStart).toBe(true);
  });

  it('rejects unknown modes', () => {
    expect(() => parseArgs(['--mode', 'chaos'])).toThrow(/unknown mode/);
  });

  it('rejects unknown thinking modes', () => {
    expect(() => parseArgs(['--thinking', 'ultra'])).toThrow(/unknown thinking mode/);
  });
});

describe('resolveConfig', () => {
  it('applies defaults', () => {
    const config = resolveConfig({});
    expect(config.baseUrl).toContain('127.0.0.1');
    expect(config.mode).toBe('workspace_write');
    expect(config.thinking).toBe('balanced');
    expect(config.autoStartServer).toBe(true);
  });

  it('maps aliases to canonical permission modes', () => {
    const yolo = resolveConfig({ mode: 'yolo' as never });
    expect(yolo.mode).toBe('full_access');
  });

  it('respects noServerStart override', () => {
    const config = resolveConfig({ noServerStart: true });
    expect(config.autoStartServer).toBe(false);
  });
});

describe('AgentClient SSE parsing', () => {
  it('parses streamed SSE frames into events', async () => {
    const client = new AgentClient('http://127.0.0.1:1', 't');
    const frames = [
      'data: {"type":"run_started","conversationId":"abc"}\n\n',
      'data: {"type":"text_delta","content":"hi"}\n\ndata: {"type":"completed","conversationId":"abc","answer":"hi"}\n\n'
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      }
    });
    const fetchMock = (async () =>
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    const events: unknown[] = [];
    try {
      await client.runStream({ prompt: 'test' }, (event) => events.push(event));
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(events).toHaveLength(3);
    expect((events[0] as { type: string }).type).toBe('run_started');
    expect((events[2] as { type: string; answer?: string }).answer).toBe('hi');
  });

  it('throws on non-OK responses with server error payload', async () => {
    const client = new AgentClient('http://127.0.0.1:1', '');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'local API token is required' }), { status: 401 })) as typeof fetch;
    try {
      await expect(client.runStream({ prompt: 'x' }, () => {})).rejects.toThrow(/token is required/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
