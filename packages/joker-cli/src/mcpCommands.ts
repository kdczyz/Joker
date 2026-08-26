import type { AgentClient } from './client.js';
import { paint } from './render.js';

/**
 * Codex-style MCP management: `joker mcp <add|list|remove|tools|test> ...`
 * Backed by the same routes the GUI settings page uses.
 */
export async function commandMcp(client: AgentClient, args: string[]): Promise<void> {
  const action = args[0] ?? 'list';
  switch (action) {
    case 'list':
      return mcpList(client);
    case 'add':
      return mcpAdd(client, args.slice(1));
    case 'remove':
      return mcpRemove(client, args[1]);
    case 'tools':
      return mcpTools(client, args[1]);
    case 'test':
      return mcpTest(client, args[1]);
    default:
      throw new Error(`unknown mcp action: ${action} (expected add|list|remove|tools|test)`);
  }
}

interface McpServerRow {
  id: string;
  name?: string;
  enabled?: boolean;
  transport?: string;
  url?: string;
  command?: string;
}

async function mcpList(client: AgentClient): Promise<void> {
  const data = (await client.getJson('/api/mcp/servers')) as { servers?: McpServerRow[] };
  const servers = data.servers ?? [];
  if (!servers.length) {
    console.log('No MCP servers configured. Add one: joker mcp add <name> <command-or-url>');
    return;
  }
  for (const server of servers) {
    const target = server.url ?? server.command ?? '';
    console.log(
      `${server.enabled === false ? paint('2', 'off') : 'on '}  ${server.id.padEnd(20)} ${String(server.transport ?? '').padEnd(8)} ${target}`
    );
  }
}

async function mcpAdd(client: AgentClient, args: string[]): Promise<void> {
  const name = args[0];
  const target = args.slice(1).join(' ').trim();
  if (!name || !target) {
    throw new Error('usage: joker mcp add <name> <command-or-url>');
  }
  const isHttp = /^https?:\/\//i.test(target);
  const data = (await client.postJson('/api/mcp/servers', {
    name,
    transport: isHttp ? 'http' : 'stdio',
    url: isHttp ? target : undefined,
    command: isHttp ? undefined : target,
    enabled: true,
    defaultApproval: 'ask'
  })) as { server?: McpServerRow };
  console.log(`Added MCP server ${data.server?.id ?? name}`);
}

async function mcpRemove(client: AgentClient, id: string | undefined): Promise<void> {
  if (!id) throw new Error('usage: joker mcp remove <id>');
  await client.deleteJson(`/api/mcp/servers/${encodeURIComponent(id)}`);
  console.log(`Removed ${id}`);
}

async function mcpTools(client: AgentClient, id: string | undefined): Promise<void> {
  if (!id) throw new Error('usage: joker mcp tools <id>');
  const data = (await client.getJson(`/api/mcp/servers/${encodeURIComponent(id)}/tools`)) as {
    tools?: Array<{ name: string; description?: string }>;
  };
  for (const tool of data.tools ?? []) {
    console.log(`${tool.name}\t${tool.description ?? ''}`);
  }
}

async function mcpTest(client: AgentClient, id: string | undefined): Promise<void> {
  if (!id) throw new Error('usage: joker mcp test <id>');
  const data = (await client.postJson(`/api/mcp/servers/${encodeURIComponent(id)}/test`)) as {
    ok?: boolean;
    tools?: unknown[];
  };
  console.log(`MCP ${id}: ${data.ok ? 'ok' : 'failed'} (${(data.tools ?? []).length} tools)`);
}
