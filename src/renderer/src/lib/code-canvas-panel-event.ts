export const CODE_CANVAS_OPEN_REQUEST_EVENT = 'Joker:code-canvas-open-request'

export function requestCodeCanvasPanelOpen(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new Event(CODE_CANVAS_OPEN_REQUEST_EVENT))
}
