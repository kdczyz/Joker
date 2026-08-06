import type { RcodeGuiApi } from '../shared/Rcode-gui-api'

export type * from '../shared/Rcode-gui-api'

declare global {
  interface Window {
    RcodeGui: RcodeGuiApi
  }
}
