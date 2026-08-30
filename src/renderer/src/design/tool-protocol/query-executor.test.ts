import { describe, expect, it, beforeEach } from 'vitest'
import { executeDesignQueryInvocation } from './query-executor'
import { useCanvasShapeStore } from '../canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../canvas/canvas-selection-store'
import { useCanvasUndoStore } from '../canvas/canvas-undo-store'
import { createEmptyDocument } from '../canvas/canvas-types'
import { executeOps } from '../canvas/shape-ops'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
})

function addRect(x: number, name = 'Rect'): string {
  return executeOps([
    { op: 'add', shape: { type: 'rect', name, x, y: 0, width: 80, height: 80 } }
  ]).affectedIds[0]
}

type QueryOutput = {
  shapeCount: number
  returned: number
  truncated: boolean
  documentId: string
  rootId: string
  selectedIds: string[]
  shapes: Array<Record<string, unknown>>
}

describe('executeDesignQueryInvocation (design.query / design.snapshot)', () => {
  it('reads all current shapes when no id filter is given', () => {
    const a = addRect(0, 'A')
    const b = addRect(120, 'B')
    const result = executeDesignQueryInvocation({ toolId: 'design.query', input: {} })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('applied')
    expect(result.affectedIds).toEqual([])
    expect(result.errors).toEqual([])
    const output = result.output as QueryOutput
    expect(output.shapeCount).toBe(2)
    expect(output.returned).toBe(2)
    const ids = output.shapes.map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining([a, b]))
  })

  it('summarizes the compact shape fields (name/type/x/y/w/h/parentId/selected)', () => {
    const a = addRect(40, 'Card')
    const result = executeDesignQueryInvocation({ toolId: 'design.query', input: {} })
    const output = result.output as QueryOutput
    const shape = output.shapes[0]
    expect(shape).toMatchObject({
      id: a,
      name: 'Card',
      type: 'rect',
      x: 40,
      y: 0,
      w: 80,
      h: 80,
      selected: false
    })
  })

  it('filters by requested ids', () => {
    const a = addRect(0, 'A')
    addRect(120, 'B')
    addRect(240, 'C')
    const result = executeDesignQueryInvocation({ toolId: 'design.query', input: { ids: [a] } })
    const output = result.output as QueryOutput
    expect(output.shapeCount).toBe(1)
    expect(output.returned).toBe(1)
    expect(output.shapes[0].id).toBe(a)
  })

  it('respects the limit and flags truncation', () => {
    for (let i = 0; i < 5; i += 1) addRect(i * 100, `R${i}`)
    const result = executeDesignQueryInvocation({ toolId: 'design.query', input: { limit: 2 } })
    const output = result.output as QueryOutput
    expect(output.returned).toBe(2)
    expect(output.truncated).toBe(true)
    expect(output.shapeCount).toBe(5)
  })

  it('reports the current selection', () => {
    const a = addRect(0, 'A')
    useCanvasSelectionStore.getState().select([a])
    const result = executeDesignQueryInvocation({ toolId: 'design.query', input: {} })
    const output = result.output as QueryOutput
    expect(output.selectedIds).toContain(a)
    const shape = output.shapes.find((s) => s.id === a)
    expect(shape?.selected).toBe(true)
  })

  it('design.snapshot routes through the same read-only executor', () => {
    addRect(0, 'A')
    const result = executeDesignQueryInvocation({ toolId: 'design.snapshot', input: {} })
    expect(result.ok).toBe(true)
    const output = result.output as QueryOutput
    expect(output.shapeCount).toBe(1)
  })

  it('emits a human-readable summary line', () => {
    addRect(0, 'A')
    addRect(120, 'B')
    const result = executeDesignQueryInvocation({ toolId: 'design.query', input: {} })
    expect(result.summaryLines[0]).toContain('2 shape(s)')
  })
})
