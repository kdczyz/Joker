import { z } from 'zod'

export const MemoryScope = z.enum(['user', 'workspace', 'project'])
export type MemoryScope = z.infer<typeof MemoryScope>

/**
 * Memory category — orthogonal to {@link MemoryScope} (which scopes *who* a
 * memory applies to). Category controls *how long* it lives and *whether* it
 * is prioritized for injection:
 * - `long`    : persistent long-term memory (default). Confidence decays on a
 *               180-day half-life; never auto-expires.
 * - `short`   : short-term memory. Auto-expires after `shortTtlDays` (default 7d)
 *               and decays on the same half-life.
 * - `session` : session-scoped memory. Auto-expires after `sessionTtlHours`
 *               (default 24h). Used for context worth remembering only within
 *               the current working session.
 * - `pinned`  : user-pinned memory. Never decays, never auto-expires, and is
 *               injected with top priority ahead of scored retrieval. Reserved
 *               for critical identity/preferences; the auto-review service will
 *               not create or overwrite pinned memories.
 */
export const MemoryCategory = z.enum(['long', 'short', 'session', 'pinned'])
export type MemoryCategory = z.infer<typeof MemoryCategory>

export const MemorySourceKind = z.enum(['user', 'tool', 'inference', 'file', 'web'])
export type MemorySourceKind = z.infer<typeof MemorySourceKind>

export const MemoryProvenance = z.object({
  kind: MemorySourceKind,
  turnId: z.string().optional(),
  file: z.string().optional(),
  origin: z.string().optional()
}).strict()
export type MemoryProvenance = z.infer<typeof MemoryProvenance>

export const MemoryRecord = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  scope: MemoryScope,
  category: MemoryCategory.default('long'),
  workspace: z.string().optional(),
  project: z.string().optional(),
  sourceThreadId: z.string().optional(),
  sourceTurnId: z.string().optional(),
  provenance: MemoryProvenance.optional(),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().datetime().optional(),
  supersedes: z.string().optional(),
  supersededAt: z.string().optional(),
  correctedFrom: z.string().optional(),
  disabledAt: z.string().optional(),
  deletedAt: z.string().optional()
}).strict()
export type MemoryRecord = z.infer<typeof MemoryRecord>

export const MemoryCreateRequest = z.object({
  content: z.string().min(1),
  scope: MemoryScope.default('workspace'),
  category: MemoryCategory.default('long'),
  workspace: z.string().optional(),
  project: z.string().optional(),
  sourceThreadId: z.string().optional(),
  sourceTurnId: z.string().optional(),
  provenance: MemoryProvenance.optional(),
  ttlMs: z.number().int().positive().optional(),
  supersedes: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional()
}).strict()
export type MemoryCreateRequest = z.input<typeof MemoryCreateRequest>

export const MemoryUpdateRequest = z.object({
  content: z.string().min(1).optional(),
  category: MemoryCategory.optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  disabled: z.boolean().optional()
}).strict()
export type MemoryUpdateRequest = z.input<typeof MemoryUpdateRequest>

export const MemoryDiagnostics = z.object({
  enabled: z.boolean(),
  rootDir: z.string(),
  activeCount: z.number().int().nonnegative(),
  tombstoneCount: z.number().int().nonnegative(),
  lastInjectedIds: z.array(z.string()).default([])
}).strict()
export type MemoryDiagnostics = z.infer<typeof MemoryDiagnostics>
