import { describe, expect, it, vi } from 'vitest'
import { computePopoverPosition } from './compute-popover-position'

describe('computePopoverPosition', () => {
  const makeRect = (left: number, top: number, width: number, height: number): DOMRect =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({})
    }) as DOMRect

  const setViewport = (width: number, height: number): void => {
    vi.stubGlobal('window', { innerWidth: width, innerHeight: height })
  }

  it('aligns usage popover to the left of the trigger', () => {
    setViewport(1200, 800)
    const rect = makeRect(100, 600, 200, 28)
    const pos = computePopoverPosition(rect, 360, 460, 'start')
    expect(pos.left).toBe(100)
    expect(pos.bottom).toBe(800 - 600 + 8)
  })

  it('aligns git tools popover to the right of the trigger', () => {
    setViewport(1200, 800)
    const rect = makeRect(400, 600, 120, 28)
    const pos = computePopoverPosition(rect, 320, 460, 'end')
    expect(pos.left).toBe(400 + 120 - 320)
    expect(pos.bottom).toBe(800 - 600 + 8)
  })

  it('flips to right-align when start-aligned popover would overflow the right edge', () => {
    setViewport(600, 800)
    const rect = makeRect(400, 600, 150, 28)
    const pos = computePopoverPosition(rect, 360, 460, 'start')
    // 400 + 360 = 760 > 600 - 16 = 584, so flip to right-align: 550 - 360 = 190
    expect(pos.left).toBe(550 - 360)
  })

  it('flips to left-align when end-aligned popover would overflow the left edge', () => {
    setViewport(600, 800)
    const rect = makeRect(20, 600, 80, 28)
    const pos = computePopoverPosition(rect, 320, 460, 'end')
    // 100 - 320 = -220 < 16, so flip to left-align: 20
    expect(pos.left).toBe(20)
  })

  it('clamps left to viewport padding', () => {
    setViewport(300, 800)
    const rect = makeRect(20, 600, 80, 28)
    const pos = computePopoverPosition(rect, 320, 460, 'start')
    expect(pos.left).toBe(16)
  })

  it('places popover below the trigger when space above is insufficient', () => {
    setViewport(1200, 400)
    const rect = makeRect(100, 20, 200, 28)
    const pos = computePopoverPosition(rect, 360, 460, 'start')
    expect(pos.top).toBe(20 + 28 + 8)
    expect(pos.bottom).toBeUndefined()
  })

  it('places popover above the trigger when there is enough space', () => {
    setViewport(1200, 800)
    const rect = makeRect(100, 600, 200, 28)
    const pos = computePopoverPosition(rect, 360, 460, 'start')
    expect(pos.bottom).toBe(800 - 600 + 8)
    expect(pos.top).toBeUndefined()
  })
})
