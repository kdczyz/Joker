import { paint } from './render.js';
import type { AgentClient } from './client.js';

/** Read-only management subcommands (`rcode status`, `rcode tools`, ...). */

async function getJson(client: AgentClient, path: string): Promise<Record<string, unknown>> {
  return (await client.getJson(path)) as Record<string, unknown>;
}

export async function commandStatus(client: AgentClient): Promise<void> {
  const health = (await getJson(client, '/api/health')) as Record<string, unknown>;
  console.log(paint('1', 'Rcode runtime'));
  console.log(`  provider   ${health.provider ?? '?'} / ${health.model ?? '?'}`);
  console.log(`  configured ${health.providerConfigured ? 'yes' : paint('33', 'missing key')}`);
  console.log(`  executor   ${health.executor ?? 'portable-guarded-execution'}`);
  try {
    const tools = (await getJson(client, '/api/tools')) as { tools?: unknown[] };
    console.log(`  tools      ${tools.tools?.length ?? 0}`);
  } catch {
    /* token-gated endpoints are optional for status */
  }
}

export async function commandTools(client: AgentClient): Promise<void> {
  const data = (await getJson(client, '/api/tools')) as {
    tools?: Array<{ name: string; risk?: string; description?: string; source?: string }>;
  };
  for (const tool of data.tools ?? []) {
    console.log(`${String(tool.name).padEnd(20)}${String(tool.risk ?? '').padEnd(8)}${tool.description ?? ''}`);
  }
}

export async function commandAudit(client: AgentClient, limit = 30): Promise<void> {
  const data = (await getJson(client, '/api/audit')) as {
    events?: Array<{ createdAt: string; ok?: boolean; toolName?: string; permissionEffect?: string; outputSummary?: string }>;
  };
  for (const event of (data.events ?? []).slice(0, limit)) {
    const ok = event.ok === false ? paint('31', 'fail') : paint('32', 'ok');
    console.log(`${event.createdAt} ${ok} ${event.toolName ?? ''} ${event.permissionEffect ?? ''} ${event.outputSummary ?? ''}`.trimEnd());
  }
}
