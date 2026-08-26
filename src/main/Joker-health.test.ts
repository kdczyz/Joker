import { describe, expect, it } from 'vitest'
import { isJokerHealthResponseBody } from './Joker-health'

describe('isJokerHealthResponseBody', () => {
  it('accepts Joker serve health responses', () => {
    expect(isJokerHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'Joker',
      mode: 'serve'
    }))).toBe(true)
  })

  it('rejects generic or legacy runtime health responses', () => {
    expect(isJokerHealthResponseBody(JSON.stringify({ status: 'ok' }))).toBe(false)
    expect(isJokerHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'codewhale',
      mode: 'serve'
    }))).toBe(false)
  })
})
