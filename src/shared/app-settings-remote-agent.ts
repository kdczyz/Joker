import {
  APPROVAL_POLICIES,
  SANDBOX_MODES,
  type ApprovalPolicy,
  type RemoteAgentSettingsV1,
  type SandboxMode
} from './app-settings-types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns the value when it is a known approval policy, otherwise `undefined` (→ fall back to global). */
function normalizeApprovalPolicy(value: unknown): ApprovalPolicy | undefined {
  return typeof value === 'string' && (APPROVAL_POLICIES as readonly string[]).includes(value)
    ? (value as ApprovalPolicy)
    : undefined
}

/** Returns the value when it is a known sandbox mode, otherwise `undefined` (→ fall back to global). */
function normalizeSandboxMode(value: unknown): SandboxMode | undefined {
  return typeof value === 'string' && (SANDBOX_MODES as readonly string[]).includes(value)
    ? (value as SandboxMode)
    : undefined
}

export function defaultRemoteAgentSettings(): RemoteAgentSettingsV1 {
  // Both fields intentionally omitted: remote-agent turns fall back to the
  // global agent permission policy (`agents.Joker.approvalPolicy`/`sandboxMode`)
  // until the user explicitly picks a mode in the remote-agent settings panel.
  return {}
}

export function normalizeRemoteAgentSettings(
  input: Partial<RemoteAgentSettingsV1> | undefined
): RemoteAgentSettingsV1 {
  const source = isRecord(input) ? (input as Partial<RemoteAgentSettingsV1>) : {}
  const approvalPolicy = normalizeApprovalPolicy(source.approvalPolicy)
  const sandboxMode = normalizeSandboxMode(source.sandboxMode)
  return {
    ...(approvalPolicy !== undefined ? { approvalPolicy } : {}),
    ...(sandboxMode !== undefined ? { sandboxMode } : {})
  }
}

export function mergeRemoteAgentSettings(
  current: RemoteAgentSettingsV1 | undefined,
  patch: Partial<RemoteAgentSettingsV1> | undefined
): RemoteAgentSettingsV1 {
  if (!patch) return normalizeRemoteAgentSettings(current)
  return normalizeRemoteAgentSettings({
    ...(current ?? {}),
    ...patch
  })
}
