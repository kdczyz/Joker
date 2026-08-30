import { describe, expect, it, beforeEach } from 'vitest'
import { applyDesignToolCallByName } from './apply-shape-ops'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { createEmptyDocument } from './canvas-types'
import { setScreenArtifactFactory, setScreenCreationFactory } from './screen-artifact-bridge'
import { useDesignSystemStore } from './design-system-store'

beforeEach(() => {
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
  useCanvasSelectionStore.getState().clearSelection()
  setScreenArtifactFactory(() => 'art-fake')
  setScreenCreationFactory(null)
})

describe('bug repro: backend tool-result output shape', () => {
  it('design_create_screen tool_result applies add-screen ops', () => {
    const result = applyDesignToolCallByName('design_create_screen', {
      ok: true,
      tool: 'design_create_screen',
      action: 'create_screen',
      ops: [{ op: 'add-screen', name: 'Home', brief: 'Create a landing page' }],
      message: 'Queued 1 design operation for the design canvas.'
    })
    expect(result.errors).toEqual([])
    expect(result.affectedIds).toHaveLength(1)
    const id = result.affectedIds[0]
    const shape = useCanvasShapeStore.getState().document.objects[id]
    expect(shape).toBeTruthy()
    expect(shape.name).toBe('Home')
  })

  it('design_update_shapes tool_result applies shape ops', () => {
    const result = applyDesignToolCallByName('design_update_shapes', {
      ok: true,
      tool: 'design_update_shapes',
      action: 'update_shapes',
      ops: [{ op: 'add', shape: { type: 'rect', name: 'Box', x: 0, y: 0, width: 80, height: 80 } }],
      message: 'Queued 1 design operation for the design canvas.'
    })
    expect(result.errors).toEqual([])
    expect(result.affectedIds).toHaveLength(1)
  })

  it('design_system tool_result applies design-system ops', () => {
    const result = applyDesignToolCallByName('design_system', {
      ok: true,
      tool: 'design_system',
      action: 'design_system',
      operation: 'create',
      ops: [{ op: 'design-system-template', operation: 'create', name: 'Demo', seedColor: '#1677ff' }],
      message: 'Queued 1 design operation for the design canvas.'
    })
    expect(result.errors).toEqual([])
    // design-system-template defines tokens/components but never draws shapes,
    // so it must not error — and the tokens must actually be registered.
    expect(Object.keys(useDesignSystemStore.getState().system.tokens).length).toBeGreaterThan(0)
  })
})
