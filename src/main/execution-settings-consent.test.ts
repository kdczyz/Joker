import { describe, expect, it } from 'vitest'
import {
  RcodeExecutionSettingsConsentService,
  RcodeExecutionSettingsChange,
  type RcodeExecutionSettingsConsentAction
} from './execution-settings-consent'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultRcodeRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultTerminalSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    provider: defaultModelProviderSettings(),
    agents: { Rcode: defaultRcodeRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Rcode',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

describe('protected Rcode execution settings consent', () => {
  it('detects changed execution security settings but ignores equal snapshots', () => {
    const current = settings()
    expect(RcodeExecutionSettingsChange(current, {
      agents: { Rcode: {
        approvalPolicy: current.agents.Rcode.approvalPolicy,
        sandboxMode: current.agents.Rcode.sandboxMode
      } }
    })).toBeUndefined()
    expect(RcodeExecutionSettingsChange(current, {
      agents: { Rcode: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access' } }
    })).toEqual({
      current: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' },
      next: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access' }
    })
  })

  it('binds a short-lived token to one exact sender and settings transition', () => {
    let now = 1_000
    let tokenNumber = 0
    const service = new RcodeExecutionSettingsConsentService(
      () => now,
      () => `token-${++tokenNumber}`
    )
    const action: RcodeExecutionSettingsConsentAction = {
      current: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' },
      next: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access' },
      senderId: 7,
      senderProcessId: 10,
      senderRoutingId: 20
    }
    const wrongToken = service.issue(action)
    expect(service.consume(wrongToken, {
      ...action,
      next: { ...action.next, approvalPolicy: 'always' }
    })).toBe(false)
    expect(service.consume(wrongToken, action)).toBe(false)

    const validToken = service.issue(action)
    expect(service.consume(validToken, action)).toBe(true)
    expect(service.consume(validToken, action)).toBe(false)

    const expiredToken = service.issue(action)
    now += 30_001
    expect(service.consume(expiredToken, action)).toBe(false)
  })
})
