export type PopoverPosition = {
  left: number
  top?: number
  bottom?: number
}

export function computePopoverPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverMaxHeight: number,
  preferredHorizontal: 'start' | 'end',
  options: { gap?: number; viewportPadding?: number } = {}
): PopoverPosition {
  const { gap = 8, viewportPadding = 16 } = options
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const maxH = Math.min(popoverMaxHeight, viewportH - 2 * viewportPadding)

  let left: number
  if (preferredHorizontal === 'end') {
    left = triggerRect.right - popoverWidth
    if (left < viewportPadding) {
      left = triggerRect.left
    }
  } else {
    left = triggerRect.left
    if (left + popoverWidth > viewportW - viewportPadding) {
      left = triggerRect.right - popoverWidth
    }
  }
  left = Math.max(viewportPadding, Math.min(left, viewportW - popoverWidth - viewportPadding))

  const spaceAbove = triggerRect.top - gap - viewportPadding
  const spaceBelow = viewportH - triggerRect.bottom - gap - viewportPadding
  if (spaceAbove >= maxH || spaceAbove >= spaceBelow) {
    return { left, bottom: viewportH - triggerRect.top + gap }
  }
  return { left, top: triggerRect.bottom + gap }
}
