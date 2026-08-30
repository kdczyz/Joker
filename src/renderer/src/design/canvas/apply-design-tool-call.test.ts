import { describe, expect, it, beforeEach } from 'vitest'
import {
  normalizeDesignCreateScreen,
  normalizeDesignArrange,
  normalizeDesignValidate,
  applyDesignToolCallByName
} from './apply-shape-ops'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { createEmptyDocument } from './canvas-types'
import { setScreenArtifactFactory, setScreenCreationFactory } from './screen-artifact-bridge'
import { executeOps } from './shape-ops'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
  setScreenArtifactFactory(() => 'art-fake')
  setScreenCreationFactory(null)
})

function addRect(x: number, name = 'Rect'): string {
  return executeOps([
    { op: 'add', shape: { type: 'rect', name, x, y: 0, width: 80, height: 80 } }
  ]).affectedIds[0]
}

describe('normalizeDesignCreateScreen', () => {
  it('maps a single { name } payload to one add-screen op', () => {
    expect(normalizeDesignCreateScreen({ name: 'Login' })).toEqual([{ op: 'add-screen', name: 'Login' }])
  })

  it('maps a screens array to one add-screen op per entry', () => {
    const ops = normalizeDesignCreateScreen({ screens: [{ name: 'A' }, { name: 'B' }] })
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ op: 'add-screen', name: 'A' })
    expect(ops[1]).toMatchObject({ op: 'add-screen', name: 'B' })
  })

  it('carries optional brief/geometry/device fields through', () => {
    const [op] = normalizeDesignCreateScreen({
      name: 'Dashboard',
      brief: 'overview',
      x: 10,
      y: 20,
      width: 390,
      height: 844,
      devicePreset: 'iphone-14'
    })
    expect(op).toMatchObject({
      op: 'add-screen',
      name: 'Dashboard',
      brief: 'overview',
      x: 10,
      y: 20,
      width: 390,
      height: 844,
      devicePreset: 'iphone-14'
    })
  })

  it('returns [] for a non-record or missing name (no screens)', () => {
    expect(normalizeDesignCreateScreen(null)).toEqual([])
    expect(normalizeDesignCreateScreen({})).toEqual([])
    expect(normalizeDesignCreateScreen('nope')).toEqual([])
  })
})

describe('normalizeDesignArrange', () => {
  it('maps align + ids + axis', () => {
    expect(normalizeDesignArrange({ operation: 'align', ids: ['a', 'b'], axis: 'left' })).toEqual([
      { op: 'align', ids: ['a', 'b'], axis: 'left' }
    ])
  })

  it('maps distribute', () => {
    expect(normalizeDesignArrange({ operation: 'distribute', ids: ['a', 'b', 'c'], axis: 'top' })).toEqual([
      { op: 'distribute', ids: ['a', 'b', 'c'], axis: 'top' }
    ])
  })

  it('maps stack with optional direction/gap/name/asFrame', () => {
    const [op] = normalizeDesignArrange({
      operation: 'stack',
      ids: ['a', 'b'],
      direction: 'vertical',
      gap: 12,
      name: 'Col',
      asFrame: true
    })
    expect(op).toMatchObject({ op: 'stack', ids: ['a', 'b'], direction: 'vertical', gap: 12, name: 'Col', asFrame: true })
  })

  it('maps grid with id + optional cols/rowGap/colGap', () => {
    const [op] = normalizeDesignArrange({ operation: 'grid', id: 'frame1', cols: 3, rowGap: 8, colGap: 8 })
    expect(op).toMatchObject({ op: 'grid', id: 'frame1', cols: 3, rowGap: 8, colGap: 8 })
  })

  it('maps responsive_reflow with frameId + optional device', () => {
    const [op] = normalizeDesignArrange({ operation: 'responsive_reflow', frameId: 'frame1', device: 'tablet' })
    expect(op).toMatchObject({ op: 'responsive-reflow', frameId: 'frame1', device: 'tablet' })
  })

  it('returns [] for unknown operation or missing id arrays', () => {
    expect(normalizeDesignArrange({ operation: 'bogus' })).toEqual([])
    expect(normalizeDesignArrange({ operation: 'align', ids: 'a' })).toEqual([])
    expect(normalizeDesignArrange(null)).toEqual([])
  })
})

describe('normalizeDesignValidate', () => {
  it('maps to a bare lint-design-system op', () => {
    expect(normalizeDesignValidate({})).toEqual([{ op: 'lint-design-system' }])
  })

  it('carries targetIds when present', () => {
    expect(normalizeDesignValidate({ targetIds: ['a', 'b'] })).toEqual([
      { op: 'lint-design-system', targetIds: ['a', 'b'] }
    ])
  })
})

describe('applyDesignToolCallByName — ops-based tools', () => {
  it('design_create_screen actually creates a screen artifact shape', () => {
    const result = applyDesignToolCallByName('design_create_screen', {
      name: 'Login',
      brief: 'auth screen',
      width: 390,
      height: 844
    })
    expect(result.errors).toEqual([])
    expect(result.affectedIds).toHaveLength(1)
    const id = result.affectedIds[0]
    const shape = useCanvasShapeStore.getState().document.objects[id]
    expect(shape).toBeTruthy()
    expect(shape.name).toBe('Login')
  })

  it('design_arrange align actually aligns the shapes on the canvas', () => {
    const a = addRect(0, 'A')
    const b = addRect(200, 'B')
    expect(useCanvasShapeStore.getState().document.objects[b].x).toBe(200)
    const result = applyDesignToolCallByName('design_arrange', { operation: 'align', ids: [a, b], axis: 'left' })
    expect(result.errors).toEqual([])
    // Both shapes end up flush-left (x === 0); the one that moved is reported.
    expect(useCanvasShapeStore.getState().document.objects[a].x).toBe(0)
    expect(useCanvasShapeStore.getState().document.objects[b].x).toBe(0)
    expect(result.affectedIds).toContain(b)
  })

  it('design_validate (lint) runs without mutating and reports no affected ids', () => {
    const a = addRect(0, 'A')
    const result = applyDesignToolCallByName('design_validate', { targetIds: [a] })
    expect(result).toHaveProperty('errors')
    expect(Array.isArray(result.errors)).toBe(true)
    expect(result.affectedIds).toEqual([])
  })
})

describe('applyDesignToolCallByName — read-only structured tools', () => {
  it('design.query returns no affected ids and no errors (delegates to query executor)', () => {
    addRect(0, 'A')
    addRect(100, 'B')
    const result = applyDesignToolCallByName('design.query', {})
    expect(result.errors).toEqual([])
    expect(result.affectedIds).toEqual([])
  })

  it('design.snapshot behaves like design.query (read-only)', () => {
    addRect(0, 'A')
    const result = applyDesignToolCallByName('design.snapshot', {})
    expect(result.errors).toEqual([])
    expect(result.affectedIds).toEqual([])
  })
})

describe('applyDesignToolCallByName — legacy + unknown', () => {
  it('still applies a fenced design_canvas action block through the unified entry', () => {
    const result = applyDesignToolCallByName('design_canvas', { action: 'add_screen', name: 'Legacy' })
    expect(result.errors).toEqual([])
    expect(result.affectedIds).toHaveLength(1)
  })

  it('returns an empty, well-formed result for an unknown tool with no ops', () => {
    const result = applyDesignToolCallByName('design_mysterious', { foo: 'bar' })
    expect(result.affectedIds).toEqual([])
    expect(result.errors).toEqual([])
  })
})
