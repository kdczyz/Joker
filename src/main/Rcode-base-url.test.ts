import { describe, expect, it } from 'vitest'
import { getRcodeBaseUrl, normalizeLocalRcodeHost } from './Rcode-base-url'

describe('getRcodeBaseUrl', () => {
  it('uses 127.0.0.1 by default', () => {
    expect(getRcodeBaseUrl(18899)).toBe('http://127.0.0.1:18899')
  })

  it('formats IPv6 loopback hosts for URL use', () => {
    expect(getRcodeBaseUrl(18899, '::1')).toBe('http://[::1]:18899')
    expect(getRcodeBaseUrl(18899, '[::1]')).toBe('http://[::1]:18899')
  })

  it('accepts localhost aliases only', () => {
    expect(normalizeLocalRcodeHost('localhost')).toBe('localhost')
    expect(() => getRcodeBaseUrl(18899, 'example.com')).toThrow(/local host/)
  })
})
