import type { ChatBlock } from '../agent/types'
import {
  countDiffStats,
  extractDiffFilePath,
  extractUnifiedDiffText,
  formatFilePathForDisplay
} from './diff-stats'

export type ComposerChangedFile = {
  path: string
  added: number
  removed: number
}

export type ComposerChangeSummary = {
  files: ComposerChangedFile[]
  added: number
  removed: number
}

/**
 * Try to extract the content string from a tool's JSON arguments/output
 * and count its lines. Works for write/edit tools whose detail is a
 * JSON object with a `content` / `new_content` / `newContent` field.
 */
function tryCountContentLines(detail: string | undefined): number | undefined {
  if (!detail) return undefined
  try {
    const parsed: unknown = JSON.parse(detail)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    for (const key of ['content', 'new_content', 'newContent', 'text', 'source', 'file_content']) {
      const value = record[key]
      if (typeof value === 'string' && value.length > 0) {
        // Count non-empty lines as a rough estimate of added lines
        return value.split('\n').filter((l) => l.length > 0).length || undefined
      }
    }
  } catch {
    // detail is not JSON — skip
  }
  return undefined
}

export function collectComposerChangeSummary(
  blocks: ChatBlock[],
  workspaceRoot: string
): ComposerChangeSummary | null {
  const byPath = new Map<string, ComposerChangedFile>()

  for (const block of blocks) {
    if (!(block.kind === 'tool' && block.toolKind === 'file_change' && block.status === 'success')) {
      continue
    }

    // Try unified-diff path first (built-in tools return diffs)
    const patch = extractUnifiedDiffText(block.detail)
    if (patch) {
      const path = formatFilePathForDisplay(extractDiffFilePath(patch, block.filePath), workspaceRoot)
      if (!path) continue
      const stats = countDiffStats(patch) ?? { added: 0, removed: 0 }
      const existing = byPath.get(path)
      if (existing) {
        existing.added += stats.added
        existing.removed += stats.removed
      } else {
        byPath.set(path, { path, added: stats.added, removed: stats.removed })
      }
      continue
    }

    // Fallback: no unified diff (e.g. non-git project or external model).
    // Still register the file and try to estimate added lines from content.
    const path = formatFilePathForDisplay(block.filePath, workspaceRoot)
    if (!path) continue
    const contentLines = tryCountContentLines(block.detail)
    const added = contentLines ?? 0
    const existing = byPath.get(path)
    if (existing) {
      existing.added += added
    } else {
      byPath.set(path, { path, added, removed: 0 })
    }
  }

  if (byPath.size === 0) return null

  const files = [...byPath.values()]
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0)
  }
}
