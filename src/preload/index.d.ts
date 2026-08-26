import type { JokerGuiApi } from '../shared/Joker-gui-api'

export type * from '../shared/Joker-gui-api'

declare global {
  interface Window {
    JokerGui: JokerGuiApi
  }
}
