import { useCanvasSelectionStore } from '../canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../canvas/canvas-shape-store'
import { invocationInputRecord, type DesignToolInvocation, type DesignToolInvocationResult } from './protocol-types'

/**
 * Read-only canvas introspection tool (`design.query` / `design.snapshot`).
 *
 * The agent previously could only *infer* canvas state from the snapshot that is
 * injected into the prompt at turn start — which goes stale the moment the board
 * changes mid-conversation, and never reflects a prior agent mutation within the
 * same turn. This executor lets the agent pull a fresh, structured view of the
 * live canvas document on demand. It does not mutate anything.
 */
function summarizeFillColor(shape: { fills?: Array<{ type: string; color?: string }> }): string | undefined {
  const fill = shape.fills?.find((f) => f.type === 'solid' && typeof f.color === 'string')
  return fill?.color
}

function summarizeStrokeColor(shape: { strokes?: Array<{ color?: string; width?: number }> }): string | undefined {
  const stroke = shape.strokes?.find((s) => typeof s.color === 'string')
  return stroke?.color
}

export function executeDesignQueryInvocation(invocation: DesignToolInvocation): DesignToolInvocationResult {
  const doc = useCanvasShapeStore.getState().document
  const selectedIds = useCanvasSelectionStore.getState().selectedIds
  const selectedSet = new Set(selectedIds)
  const input = invocationInputRecord(invocation.input) ?? {}

  const allShapes = Object.values(doc.objects)
    .filter((shape) => shape.id !== doc.rootId)
    .map((shape) => {
      const entry: Record<string, unknown> = {
        id: shape.id,
        name: shape.name,
        type: shape.type,
        x: Math.round(shape.x * 100) / 100,
        y: Math.round(shape.y * 100) / 100,
        w: Math.round(shape.width * 100) / 100,
        h: Math.round(shape.height * 100) / 100,
        parentId: shape.parentId,
        selected: selectedSet.has(shape.id)
      }
      if (typeof shape.rotation === 'number' && shape.rotation !== 0) entry.rotation = Math.round(shape.rotation * 100) / 100
      if (shape.type === 'text' && shape.textContent) entry.textContent = shape.textContent.slice(0, 200)
      if (shape.imageUrl && !shape.imageUrl.startsWith('data:')) entry.imageUrl = shape.imageUrl
      const fillColor = summarizeFillColor(shape)
      if (fillColor) entry.fill = fillColor
      const strokeColor = summarizeStrokeColor(shape)
      if (strokeColor) entry.stroke = strokeColor
      if (typeof shape.cornerRadius === 'number' && shape.cornerRadius > 0) entry.cornerRadius = shape.cornerRadius
      if (shape.tokenBindings && Object.keys(shape.tokenBindings).length > 0) {
        entry.tokenBindings = shape.tokenBindings
      }
      return entry
    })

  const requestedIds = Array.isArray(input.ids)
    ? input.ids.filter((id): id is string => typeof id === 'string')
    : null
  const matched = requestedIds ? allShapes.filter((shape) => requestedIds.includes(shape.id as string)) : allShapes

  const limit = typeof input.limit === 'number' && input.limit > 0 ? Math.min(input.limit, 500) : 250
  const shapes = matched.slice(0, limit)

  const output = {
    shapeCount: matched.length,
    returned: shapes.length,
    truncated: matched.length > shapes.length,
    documentId: doc.graph?.projectId ?? 'canvas',
    rootId: doc.rootId,
    selectedIds: [...selectedIds],
    shapes
  }

  return {
    ok: true,
    toolId: invocation.toolId,
    status: 'applied',
    affectedIds: [],
    errors: [],
    output,
    summaryLines: [
      `${invocation.toolId}: ${shapes.length} shape(s) of ${matched.length} total`,
      `selected: ${selectedIds.size}`
    ]
  }
}
