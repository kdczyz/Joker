import type { JokerRuntimeStatusPayload } from '@shared/Joker-gui-api'

export function shouldSuppressRuntimeErrorBanner(
  status: JokerRuntimeStatusPayload | null | undefined
): boolean {
  return status?.state === 'restarting' || status?.state === 'crashed'
}
