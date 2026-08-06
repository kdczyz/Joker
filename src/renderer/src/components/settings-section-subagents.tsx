import type { ReactElement } from 'react'
import type { RcodeRuntimeSettingsPatchV1, RcodeRuntimeSettingsV1 } from '@shared/app-settings'
import { SubagentSettingsEditor } from './subagents/SubagentSettingsEditor'

type SubagentsSettingsContext = {
  Rcode: RcodeRuntimeSettingsV1
  updateRcode: (patch: RcodeRuntimeSettingsPatchV1) => void | Promise<void>
}

export function SubagentsSettingsSection({
  ctx
}: {
  ctx: SubagentsSettingsContext
}): ReactElement {
  return (
    <SubagentSettingsEditor Rcode={ctx.Rcode} onPatch={ctx.updateRcode} variant="settings" />
  )
}
