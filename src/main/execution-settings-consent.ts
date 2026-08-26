import { randomBytes } from 'node:crypto'
import type {
  AppSettingsPatch,
  AppSettingsV1,
  ApprovalPolicy,
  SandboxMode
} from '../shared/app-settings'

export type JokerExecutionSecuritySettings = {
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
}

export type JokerExecutionSettingsChange = {
  current: JokerExecutionSecuritySettings
  next: JokerExecutionSecuritySettings
}

export type JokerExecutionSettingsConsentAction = JokerExecutionSettingsChange & {
  senderId: number
  senderProcessId: number
  senderRoutingId: number
}

type ConsentRecord = {
  actionKey: string
  expiresAt: number
}

const CONSENT_LIFETIME_MS = 30_000
const MAX_PENDING_CONSENTS = 32

/**
 * Detect a renderer request that would change Joker's approval/sandbox boundary.
 * Full settings snapshots are common, so equal values are deliberately ignored.
 */
export function JokerExecutionSettingsChange(
  current: AppSettingsV1,
  patch: AppSettingsPatch
): JokerExecutionSettingsChange | undefined {
  const JokerPatch = patch.agents?.Joker
  if (!JokerPatch || (
    !Object.prototype.hasOwnProperty.call(JokerPatch, 'approvalPolicy') &&
    !Object.prototype.hasOwnProperty.call(JokerPatch, 'sandboxMode')
  )) return undefined

  const currentSettings: JokerExecutionSecuritySettings = {
    approvalPolicy: current.agents.Joker.approvalPolicy,
    sandboxMode: current.agents.Joker.sandboxMode
  }
  const next: JokerExecutionSecuritySettings = {
    approvalPolicy: JokerPatch.approvalPolicy ?? currentSettings.approvalPolicy,
    sandboxMode: JokerPatch.sandboxMode ?? currentSettings.sandboxMode
  }
  return executionSettingsEqual(currentSettings, next)
    ? undefined
    : { current: currentSettings, next }
}

export function executionSettingsEqual(
  left: JokerExecutionSecuritySettings,
  right: JokerExecutionSecuritySettings
): boolean {
  return left.approvalPolicy === right.approvalPolicy && left.sandboxMode === right.sandboxMode
}

/**
 * Main-only, action-bound, one-shot consent. The opaque token never crosses
 * preload; it makes the native decision a required input to the persistence
 * call instead of treating a renderer settings payload as authorization.
 */
export class JokerExecutionSettingsConsentService {
  private readonly pending = new Map<string, ConsentRecord>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly randomToken: () => string = () => randomBytes(32).toString('base64url')
  ) {}

  issue(action: JokerExecutionSettingsConsentAction): string {
    const now = this.now()
    this.prune(now)
    if (this.pending.size >= MAX_PENDING_CONSENTS) {
      throw new Error('Too many pending execution-settings consents.')
    }
    const token = this.randomToken()
    this.pending.set(token, {
      actionKey: actionKey(action),
      expiresAt: now + CONSENT_LIFETIME_MS
    })
    return token
  }

  consume(token: string, action: JokerExecutionSettingsConsentAction): boolean {
    const record = this.pending.get(token)
    // A presented token is consumed even when its binding is wrong.
    this.pending.delete(token)
    if (!record || record.expiresAt <= this.now()) return false
    return record.actionKey === actionKey(action)
  }

  private prune(now: number): void {
    for (const [token, record] of this.pending) {
      if (record.expiresAt <= now) this.pending.delete(token)
    }
  }
}

function actionKey(action: JokerExecutionSettingsConsentAction): string {
  return JSON.stringify([
    action.current.approvalPolicy,
    action.current.sandboxMode,
    action.next.approvalPolicy,
    action.next.sandboxMode,
    action.senderId,
    action.senderProcessId,
    action.senderRoutingId
  ])
}
