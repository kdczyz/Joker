import { describe, expect, it, vi } from 'vitest'
import { installSpaceActivationSuppressor, isButtonLikeElement } from './suppress-space-activation'

function fakeElement(tagName: string, role?: string): EventTarget {
  return {
    tagName,
    getAttribute: (name: string) => (name === 'role' ? (role ?? null) : null)
  } as unknown as EventTarget
}

function makeEvent(key: string, target: EventTarget | null): KeyboardEvent {
  return {
    key,
    target,
    defaultPrevented: false,
    preventDefault: vi.fn()
  } as unknown as KeyboardEvent
}

describe('isButtonLikeElement', () => {
  it('treats button elements and button-like roles as activatable', () => {
    expect(isButtonLikeElement(fakeElement('BUTTON'))).toBe(true)
    expect(isButtonLikeElement(fakeElement('DIV', 'button'))).toBe(true)
    expect(isButtonLikeElement(fakeElement('DIV', 'menuitemradio'))).toBe(true)
  })

  it('ignores non-button elements and non-event targets', () => {
    expect(isButtonLikeElement(fakeElement('INPUT'))).toBe(false)
    expect(isButtonLikeElement(fakeElement('DIV'))).toBe(false)
    expect(isButtonLikeElement(null)).toBe(false)
  })
})

describe('installSpaceActivationSuppressor', () => {
  it('preventDefaults space keydown on focused buttons', () => {
    const listeners = new Map<string, EventListener>()
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    })

    const uninstall = installSpaceActivationSuppressor()
    const event = makeEvent(' ', fakeElement('BUTTON'))
    listeners.get('keydown')?.(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    uninstall()
    expect(listeners.has('keydown')).toBe(false)
  })

  it('leaves space in text inputs and non-space keys untouched', () => {
    const listeners = new Map<string, EventListener>()
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    })

    const uninstall = installSpaceActivationSuppressor()
    const inInput = makeEvent(' ', fakeElement('INPUT'))
    const enterOnButton = makeEvent('Enter', fakeElement('BUTTON'))
    listeners.get('keydown')?.(inInput)
    listeners.get('keydown')?.(enterOnButton)

    expect(inInput.preventDefault).not.toHaveBeenCalled()
    expect(enterOnButton.preventDefault).not.toHaveBeenCalled()
    uninstall()
  })
})
