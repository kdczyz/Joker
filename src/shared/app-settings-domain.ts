import type { AppSettingsV1 } from './app-settings-types'

export type SettingsFieldOwner =
  | 'core' | 'provider' | 'Rcode' | 'write' | 'claw' | 'schedule' | 'workflow'
  | 'design' | 'terminal' | 'keyboard' | 'update'

/** Compile-time complete inventory of every persisted top-level settings field. */
export const APP_SETTINGS_FIELD_OWNERS: { readonly [K in keyof AppSettingsV1]-?: SettingsFieldOwner } = {
  version: 'core', locale: 'core', theme: 'core', uiFontScale: 'core', chatContentMaxWidthPx: 'core',
  cursorSpotlight: 'core', cursorSpotlightColor: 'core', provider: 'provider', agents: 'Rcode',
  workspaceRoot: 'core', conversationWorkspaceRoot: 'core', log: 'core', checkpointCleanup: 'core',
  gitBranchPrefix: 'core', notifications: 'core', appBehavior: 'core', keyboardShortcuts: 'keyboard',
  write: 'write', claw: 'claw', remoteAgent: 'claw', schedule: 'schedule', workflow: 'workflow', design: 'design',
  guiUpdate: 'update', terminal: 'terminal', openaiProxy: 'provider', codePromptPrefix: 'core', disabledSkillIds: 'core'
}

