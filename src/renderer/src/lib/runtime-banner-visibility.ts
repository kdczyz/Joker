import type { RcodeRuntimeStatusPayload } from '@shared/Rcode-gui-api'

export function shouldSuppressRuntimeErrorBanner(
  status: RcodeRuntimeStatusPayload | null | undefined
): boolean {
  return status?.state === 'restarting' || status?.state === 'crashed'
}
