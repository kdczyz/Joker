import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
  buildBridgedToolSpecs,
  bridgedToolModelNames,
  jsonSchemaToZodShape,
  mapRcodeResultToSdkContent,
  selectBridgeableTools,
  type BridgeableTool
} from './sdk-tool-bridge.js'

const tool = (name: string, inputSchema: Record<string, unknown> = {}): BridgeableTool => ({
  name,
  description: `${name} tool`,
  inputSchema
})

describe('selectBridgeableTools', () => {
  test('drops Claude Code overlap tools and excluded tools, keeps Rcode-exclusive', () => {
    const tools = [
      tool('read'),
      tool('bash'),
      tool('edit'),
      tool('echo'),
      tool('user_input'),
      tool('generate_image'),
      tool('memory_create'),
      tool('delegate_task'),
      tool('web_search')
    ]
    // overlap (read/bash/edit) and excluded (echo) are dropped; user_input is
    // now bridged so Rcode's GUI input panel handles interactive questions.
    const kept = selectBridgeableTools(tools).map((t) => t.name)
    expect(kept).toEqual([
      'user_input',
      'generate_image',
      'memory_create',
      'delegate_task',
      'web_search'
    ])
  })

  test('de-dupes by name and ignores blanks', () => {
    const kept = selectBridgeableTools([tool('lsp'), tool('lsp'), tool('  ')]).map((t) => t.name)
    expect(kept).toEqual(['lsp'])
  })

  test('honors custom overlap/excluded sets', () => {
    const kept = selectBridgeableTools([tool('a'), tool('b'), tool('c')], {
      overlap: new Set(['a']),
      excluded: new Set(['b'])
    }).map((t) => t.name)
    expect(kept).toEqual(['c'])
  })
})

describe('mapRcodeResultToSdkContent', () => {
  test('passes string output through', () => {
    expect(mapRcodeResultToSdkContent({ output: 'hello' })).toEqual({
      content: [{ type: 'text', text: 'hello' }]
    })
  })

  test('JSON-stringifies structured output', () => {
    const out = mapRcodeResultToSdkContent({ output: { a: 1 } })
    expect(out.content[0].text).toContain('"a": 1')
  })

  test('flags errors', () => {
    expect(mapRcodeResultToSdkContent({ output: 'bad', isError: true })).toMatchObject({ isError: true })
  })
})

describe('buildBridgedToolSpecs', () => {
  test('handler invokes the Rcode executor and maps the result', async () => {
    const execute = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ output: 'ok' }))
    const specs = buildBridgedToolSpecs([tool('generate_image')], execute)
    expect(specs).toHaveLength(1)
    const res = await specs[0].handler({ prompt: 'a cat' })
    expect(execute).toHaveBeenCalledWith('generate_image', { prompt: 'a cat' })
    expect(res).toEqual({ content: [{ type: 'text', text: 'ok' }] })
  })

  test('a throwing executor becomes an error result, not a crash', async () => {
    const execute = vi.fn(async () => {
      throw new Error('boom')
    })
    const specs = buildBridgedToolSpecs([tool('computer_use')], execute)
    const res = await specs[0].handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('computer_use')
    expect(res.content[0].text).toContain('boom')
  })

  test('a Rcode isError result is propagated', async () => {
    const execute = vi.fn(async () => ({ output: 'nope', isError: true }))
    const specs = buildBridgedToolSpecs([tool('web_fetch')], execute)
    const res = await specs[0].handler({})
    expect(res).toMatchObject({ isError: true, content: [{ type: 'text', text: 'nope' }] })
  })
})

describe('bridgedToolModelNames', () => {
  test('namespaces under mcp__Rcode__', () => {
    const specs = buildBridgedToolSpecs([tool('memory_create'), tool('lsp')], async () => ({ output: '' }))
    expect(bridgedToolModelNames(specs)).toEqual(['mcp__Rcode__memory_create', 'mcp__Rcode__lsp'])
  })
})

describe('jsonSchemaToZodShape', () => {
  test('maps primitive properties and marks required vs optional', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'the prompt' },
        count: { type: 'integer' },
        flag: { type: 'boolean' }
      },
      required: ['prompt']
    })
    expect(Object.keys(shape).sort()).toEqual(['count', 'flag', 'prompt'])
    // compose into an object schema to assert required vs optional behavior
    const obj = z.object(shape)
    expect(obj.safeParse({ prompt: 'x' }).success).toBe(true)
    expect(obj.safeParse({ count: 1 }).success).toBe(false) // missing required prompt
  })

  test('empty schema yields an empty shape', () => {
    expect(jsonSchemaToZodShape({})).toEqual({})
  })
})
