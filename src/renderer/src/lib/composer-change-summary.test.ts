import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { collectComposerChangeSummary } from './composer-change-summary'

describe('collectComposerChangeSummary', () => {
  it('summarizes successful file changes by display path', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'edit',
        status: 'success',
        toolKind: 'file_change',
        detail: [
          'diff --git a/src/a.ts b/src/a.ts',
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1,2 +1,3 @@',
          ' old',
          '-remove',
          '+add',
          '+more'
        ].join('\n')
      },
      {
        kind: 'tool',
        id: 'tool_2',
        summary: 'edit',
        status: 'success',
        toolKind: 'file_change',
        filePath: 'src/a.ts',
        detail: [
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1 +1 @@',
          '-again',
          '+next'
        ].join('\n')
      }
    ]

    expect(collectComposerChangeSummary(blocks, '/repo')).toEqual({
      files: [{ path: 'src/a.ts', added: 3, removed: 2 }],
      added: 3,
      removed: 2
    })
  })

  it('ignores pending tools and non-diff details without filePath', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'edit',
        status: 'running',
        toolKind: 'file_change',
        detail: 'diff --git a/a b/a'
      },
      {
        kind: 'tool',
        id: 'tool_2',
        summary: 'tool',
        status: 'success',
        toolKind: 'tool_call',
        detail: 'ok'
      }
    ]

    expect(collectComposerChangeSummary(blocks, '/repo')).toBeNull()
  })

  it('falls back to filePath when detail has no unified diff markers', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'write',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/repo/src/app.ts',
        detail: 'File written successfully'
      },
      {
        kind: 'tool',
        id: 'tool_2',
        summary: 'write',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/repo/src/util.ts',
        detail: 'ok'
      }
    ]

    const result = collectComposerChangeSummary(blocks, '/repo')
    expect(result).not.toBeNull()
    expect(result!.files).toHaveLength(2)
    // Without unified diff and without content in output, stats are 0/0
    expect(result!.files.find((f) => f.path === 'src/app.ts')).toEqual({
      path: 'src/app.ts', added: 0, removed: 0
    })
    expect(result!.files.find((f) => f.path === 'src/util.ts')).toEqual({
      path: 'src/util.ts', added: 0, removed: 0
    })
  })

  it('estimates added lines when tool output contains JSON with content', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'write',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/repo/file.txt',
        // Some runtimes echo the written content in the output
        detail: '{"content": "line1\nline2\nline3\n"}'
      }
    ]
    const result = collectComposerChangeSummary(blocks, '/repo')
    expect(result).not.toBeNull()
    expect(result!.files[0].added).toBe(3)
  })

  it('extracts content lines from various JSON field names', () => {
    const fields = ['content', 'new_content', 'newContent', 'text', 'source', 'file_content']
    for (const field of fields) {
      const blocks: ChatBlock[] = [
        {
          kind: 'tool',
          id: 'tool_1',
          summary: 'write',
          status: 'success',
          toolKind: 'file_change',
          filePath: '/repo/file.txt',
          detail: JSON.stringify({ [field]: 'a\nb\nc' })
        }
      ]
      const result = collectComposerChangeSummary(blocks, '/repo')
      expect(result).not.toBeNull()
      expect(result!.files[0].added).toBe(3)
    }
  })

  it('merges fallback entries for the same file path', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'write',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/repo/file.txt',
        detail: '{"content": "a\nb"}'
      },
      {
        kind: 'tool',
        id: 'tool_2',
        summary: 'write',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/repo/file.txt',
        detail: '{"content": "c\nd\ne"}'
      }
    ]

    const result = collectComposerChangeSummary(blocks, '/repo')
    expect(result).not.toBeNull()
    expect(result!.files).toHaveLength(1)
    expect(result!.files[0].added).toBe(5)
  })
})
