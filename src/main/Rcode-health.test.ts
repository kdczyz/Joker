import { describe, expect, it } from 'vitest'
import { isRcodeHealthResponseBody } from './Rcode-health'

describe('isRcodeHealthResponseBody', () => {
  it('accepts Rcode serve health responses', () => {
    expect(isRcodeHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'Rcode',
      mode: 'serve'
    }))).toBe(true)
  })

  it('rejects generic or legacy runtime health responses', () => {
    expect(isRcodeHealthResponseBody(JSON.stringify({ status: 'ok' }))).toBe(false)
    expect(isRcodeHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'codewhale',
      mode: 'serve'
    }))).toBe(false)
  })
})
