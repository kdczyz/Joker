import { describe, expect, it } from 'vitest'
import { buildWebSearchProactiveInstruction } from './Rcode-system-prompt.js'

describe('buildWebSearchProactiveInstruction', () => {
  it('includes the base proactive guidance when no retrieval signal is given', () => {
    const text = buildWebSearchProactiveInstruction()
    expect(text).toContain('web_search')
    expect(text).not.toContain('MUST call')
  })

  it('forces web search when the knowledge base has no relevant hit', () => {
    const text = buildWebSearchProactiveInstruction({ scoredHitCount: 0, totalActive: 5 })
    expect(text).toContain('No relevant internal knowledge')
    expect(text).toContain('MUST call `web_search`')
  })

  it('advises verification when the retrieved knowledge is stale', () => {
    const stale = new Date(Date.now() - 400 * 86_400_000).toISOString()
    const text = buildWebSearchProactiveInstruction({ scoredHitCount: 1, totalActive: 5, freshestUpdatedAt: stale })
    expect(text).toContain('may be outdated')
    expect(text).not.toContain('MUST call')
  })

  it('stays at the base level when the retrieved knowledge is fresh', () => {
    const fresh = new Date().toISOString()
    const text = buildWebSearchProactiveInstruction({ scoredHitCount: 1, totalActive: 5, freshestUpdatedAt: fresh })
    expect(text).not.toContain('may be outdated')
    expect(text).not.toContain('MUST call')
  })
})
