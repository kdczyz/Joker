import type { PermissionMode } from './types.js';

/**
 * Codex-compatible surface mapping.
 *
 * Codex exposes two orthogonal axes (approval policy + sandbox); Rcode folds
 * them into a single permission mode. This module translates the codex-style
 * flags onto that axis so the CLI feels identical while staying honest about
 * what the runtime enforces:
 *
 *   --sandbox read-only            → default
 *   --sandbox workspace-write      → workspace_write
 *   --sandbox danger-full-access   → full_access
 *   --full-auto                    → workspace_write (approvals on failure)
 *   --yolo                         → full_access (no approvals)
 *   --ask-for-approval never       → full_access
 *   --ask-for-approval on-failure  → workspace_write
 *   anything else                  → per-sandbox mapping above
 */

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';

export const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access'];
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['untrusted', 'on-failure', 'on-request', 'never'];

export function isSandboxMode(value: string): value is SandboxMode {
  return (SANDBOX_MODES as readonly string[]).includes(value);
}

export function isApprovalPolicy(value: string): value is ApprovalPolicy {
  return (APPROVAL_POLICIES as readonly string[]).includes(value);
}

/** Resolves the effective Rcode permission mode from codex-style flags. */
export function resolvePermissionMode(flags: {
  yolo?: boolean;
  fullAuto?: boolean;
  approval?: ApprovalPolicy;
  sandbox?: SandboxMode;
}): PermissionMode {
  if (flags.yolo || flags.approval === 'never') return 'full_access';
  if (flags.fullAuto || flags.approval === 'on-failure') return 'workspace_write';
  switch (flags.sandbox) {
    case 'danger-full-access':
      return 'full_access';
    case 'workspace-write':
      return 'workspace_write';
    case 'read-only':
    case undefined:
    default:
      // codex defaults to read-only; Rcode's "default" mode is the equivalent
      return 'default';
  }
}
