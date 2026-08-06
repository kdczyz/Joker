/**
 * Re-exposes Rcode's own tools to the Claude Agent SDK as in-process MCP tools.
 * This is the inbound half of the fusion: the SDK owns the loop, but when the
 * model calls one of Rcode's tools the handler runs Rcode's real executor in-process
 * — so generate_image, computer_use, memory, web search, delegate_task (and thus
 * Rcode's richer subagents), etc. all keep working on a subscription turn.
 *
 * Decision (per design): tools that OVERLAP Claude Code's built-ins
 * (read/bash/edit/write/grep/find/ls) are NOT bridged — the model uses the SDK's
 * native ones. We only bridge Rcode-EXCLUSIVE tools. `delegate_task` is bridged
 * rather than mapped to the SDK `agents` option because Rcode's delegation is
 * richer (async detach, live profile overlays, per-child deny-lists).
 *
 * The selection + result-mapping + handler wiring is pure and unit-tested. The
 * final `toSdkMcpServer` binding (which touches the real SDK) is thin.
 */
import { z } from 'zod'
import type { SdkApi, SdkMcpServerInstance } from './sdk-protocol.js'

/** Structural view of a Rcode LocalTool (decoupled from Rcode's tool internals). */
export interface BridgeableTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface RcodeToolResult {
  output: unknown
  isError?: boolean
}

/** Executes a Rcode tool by name for the active turn (closes over ToolHostContext). */
export type RcodeToolExecutor = (toolName: string, args: Record<string, unknown>) => Promise<RcodeToolResult>

export interface SdkToolContent {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export interface BridgedToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<SdkToolContent>
}

/** Rcode built-ins that overlap Claude Code built-ins — use the SDK's instead. */
export const DEFAULT_OVERLAP_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls'
])

/**
 * Rcode tools better handled by the SDK's own surfaces or meaningless here.
 * NOTE: user_input/request_user_input are intentionally NOT excluded — they are
 * bridged so the model uses Rcode's own GUI input panel (wired via the tool
 * context's awaitUserInput). The SDK's native AskUserQuestion is suppressed
 * (disallowedTools) because it has no UI in this embedding.
 */
export const DEFAULT_EXCLUDED_TOOL_NAMES: ReadonlySet<string> = new Set(['echo'])

export interface SelectBridgeableOptions {
  overlap?: ReadonlySet<string>
  excluded?: ReadonlySet<string>
}

/** Filter a tool catalog down to the Rcode-exclusive tools worth bridging. */
export function selectBridgeableTools(
  tools: readonly BridgeableTool[],
  opts: SelectBridgeableOptions = {}
): BridgeableTool[] {
  const overlap = opts.overlap ?? DEFAULT_OVERLAP_TOOL_NAMES
  const excluded = opts.excluded ?? DEFAULT_EXCLUDED_TOOL_NAMES
  const seen = new Set<string>()
  const out: BridgeableTool[] = []
  for (const tool of tools) {
    const name = tool.name?.trim()
    if (!name || overlap.has(name) || excluded.has(name) || seen.has(name)) continue
    seen.add(name)
    out.push(tool)
  }
  return out
}

/** Collapse a Rcode tool result into the SDK MCP tool content shape. */
export function mapRcodeResultToSdkContent(result: RcodeToolResult): SdkToolContent {
  const text =
    typeof result.output === 'string'
      ? result.output
      : result.output === undefined
        ? ''
        : safeStringify(result.output)
  return { content: [{ type: 'text', text }], ...(result.isError ? { isError: true } : {}) }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Build SDK MCP tool specs whose handlers run Rcode's executor. A throwing or
 * rejecting executor is surfaced to the model as an error result rather than
 * crashing the SDK turn.
 */
export function buildBridgedToolSpecs(
  tools: readonly BridgeableTool[],
  execute: RcodeToolExecutor
): BridgedToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: async (args: Record<string, unknown>): Promise<SdkToolContent> => {
      try {
        const result = await execute(tool.name, args ?? {})
        return mapRcodeResultToSdkContent(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: `Rcode tool "${tool.name}" failed: ${message}` }],
          isError: true
        }
      }
    }
  }))
}

/**
 * Best-effort JSON-Schema(object) -> Zod raw shape for the SDK `tool()` helper.
 * Rcode validates arguments inside its own executor, so this only needs to convey
 * the parameter surface to the model; unknown/complex types fall back to a
 * permissive `z.any()`. Top-level only (the SDK tool schema is one object).
 */
export function jsonSchemaToZodShape(schema: Record<string, unknown>): z.ZodRawShape {
  const shape: Record<string, z.ZodTypeAny> = {}
  const properties = (schema?.properties as Record<string, Record<string, unknown>> | undefined) ?? {}
  const required = new Set((schema?.required as string[] | undefined) ?? [])
  for (const [key, prop] of Object.entries(properties)) {
    let base: z.ZodTypeAny
    switch (prop?.type) {
      case 'string':
        base = z.string()
        break
      case 'number':
      case 'integer':
        base = z.number()
        break
      case 'boolean':
        base = z.boolean()
        break
      case 'array':
        base = z.array(z.any())
        break
      default:
        base = z.any()
    }
    if (typeof prop?.description === 'string') base = base.describe(prop.description)
    shape[key] = required.has(key) ? base : base.optional()
  }
  return shape
}

/**
 * Thin binding to the real SDK: wraps the bridged specs into an in-process MCP
 * server named `Rcode`. The model sees these as `mcp__Rcode__<toolName>`.
 * Not unit-tested (needs the real SDK); kept deliberately trivial.
 */
export function toSdkMcpServer(
  sdk: SdkApi,
  specs: readonly BridgedToolSpec[],
  serverName = 'Rcode'
): SdkMcpServerInstance {
  const tools = specs.map((spec) =>
    sdk.tool(spec.name, spec.description, jsonSchemaToZodShape(spec.inputSchema), async (args) =>
      spec.handler((args ?? {}) as Record<string, unknown>)
    )
  )
  return sdk.createSdkMcpServer({ name: serverName, version: '1.0.0', tools })
}

/** The `mcp__<server>__<tool>` names the model will see, for allowedTools wiring. */
export function bridgedToolModelNames(specs: readonly BridgedToolSpec[], serverName = 'Rcode'): string[] {
  return specs.map((spec) => `mcp__${serverName}__${spec.name}`)
}
