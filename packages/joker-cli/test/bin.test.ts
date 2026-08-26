import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Binary-level integration tests: spawns the real built `dist/cli.js` against
 * a local mock of the Joker SSE contract and asserts on exit codes and stdout.
 * This proves the full chain (argv parsing → ensureServer attach → SSE
 * streaming → renderer → exit code) without needing a live model upstream.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, '..', 'dist', 'cli.js');

function sse(res: ServerResponse, events: Array<Record<string, unknown>>): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

interface BinResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runBin(args: string[], input?: string): Promise<BinResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: here,
      env: { ...process.env, JOKER_CLI_E2E: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((item) => new Promise<void>((r) => item.close(() => r()))));
});

describe('built CLI binary against a mock runtime', () => {
  it('exec completes with exit 0 and prints the final answer', async () => {
    expect(existsSync(cliPath)).toBe(true);
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on('end', () => {
        if (req.url === '/api/health') {
          res.writeHead(200).end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url === '/api/agent/run') {
          sse(res, [
            { type: 'run_started', conversationId: 'bin-1' },
            { type: 'text_delta', content: '正常' },
            { type: 'completed', conversationId: 'bin-1', answer: '正常' }
          ]);
          return;
        }
        res.writeHead(404).end('{}');
      });
    });
    servers.push(server);
    const port = await new Promise<number>((resolvePromise) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolvePromise(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const result = await runBin([
      'exec',
      '只回复两个字：正常',
      '--url',
      `http://127.0.0.1:${port}`
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('正常');
  });

  it('piped REPL processes slash commands and exits cleanly (no unsettled top-level await)', async () => {
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200).end(JSON.stringify({ ok: true }));
    });
    servers.push(server);
    const port = await new Promise<number>((resolvePromise) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolvePromise(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const result = await runBin([`--url`, `http://127.0.0.1:${port}`], '/help\n/exit\n');
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('unsettled top-level await');
    expect(result.stdout).toContain('/clear');
  });

  it('reports an unreachable server with exit 1 when --no-start-server is set', async () => {
    // Port 1 is reserved and refuses connections on macOS CI.
    const result = await runBin(['status', '--url', 'http://127.0.0.1:1', '--no-start-server']);
    expect(result.code).toBe(1);
    expect(result.stderr + result.stdout).toContain('not reachable');
  });

  it('prints help with exit 0', async () => {
    const result = await runBin(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Interactive session');
    expect(result.stdout).toContain('--json');
  });
});
