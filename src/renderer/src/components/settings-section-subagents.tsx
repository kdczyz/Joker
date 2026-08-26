import type { ReactElement } from 'react'
import type { JokerRuntimeSettingsPatchV1, JokerRuntimeSettingsV1 } from '@shared/app-settings'
import { SubagentSettingsEditor } from './subagents/SubagentSettingsEditor'

type SubagentsSettingsContext = {
  Joker: JokerRuntimeSettingsV1
  updateJoker: (patch: JokerRuntimeSettingsPatchV1) => void | Promise<void>
}

export function SubagentsSettingsSection({
  ctx
}: {
  ctx: SubagentsSettingsContext
}): ReactElement {
  return (
    <SubagentSettingsEditor Joker={ctx.Joker} onPatch={ctx.updateJoker} variant="settings" />
  )
}
