import { describe, expect, it } from 'vitest'
import { getJokerBaseUrl, normalizeLocalJokerHost } from './Joker-base-url'

describe('getJokerBaseUrl', () => {
  it('uses 127.0.0.1 by default', () => {
    expect(getJokerBaseUrl(18899)).toBe('http://127.0.0.1:18899')
  })

  it('formats IPv6 loopback hosts for URL use', () => {
    expect(getJokerBaseUrl(18899, '::1')).toBe('http://[::1]:18899')
    expect(getJokerBaseUrl(18899, '[::1]')).toBe('http://[::1]:18899')
  })

  it('accepts localhost aliases only', () => {
    expect(normalizeLocalJokerHost('localhost')).toBe('localhost')
    expect(() => getJokerBaseUrl(18899, 'example.com')).toThrow(/local host/)
  })
})
