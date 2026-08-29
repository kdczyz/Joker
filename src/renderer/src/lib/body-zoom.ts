/**
 * The app scales its UI with `zoom: var(--ds-ui-scale)` on <body>. Under CSS
 * zoom, `position: fixed` coordinates on descendants are interpreted in the
 * zoomed (local) space and multiplied by the zoom factor when painted, while
 * `getBoundingClientRect()` and mouse `clientX/clientY` report viewport-space
 * (visual) coordinates. Fixed-position popovers/tooltips therefore must divide
 * viewport-space measurements by this factor before assigning them to
 * `left/top/right/bottom`, or they drift (right/down when zoom > 1).
 */
export function currentBodyZoom(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 1
  const raw = window.getComputedStyle(document.body).zoom
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}
