import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GitToolsPanel } from './GitToolsPanel'
import i18n from '../../i18n'
import type { GitDiffStatResult } from '@shared/git-changes'

const stat: GitDiffStatResult = {
  ok: true,
  added: 523,
  removed: 568,
  fileCount: 4,
  stagedFiles: 1,
  unstagedFiles: 2,
  untrackedFiles: 1,
  files: [{ path: 'src/main/ipc/app-ipc-schemas.ts', added: 171, removed: 1 }],
  suggestion: 'Update ipc/app-ipc-schemas.ts'
}

describe('GitToolsPanel', () => {
  it('renders real Git diff stats with changes, branch and commit rows', () => {
    const html = renderToStaticMarkup(
      createElement(GitToolsPanel, {
        workspaceRoot: '/repo',
        stat,
        onOpenChanges: () => undefined,
        onRefreshStat: () => undefined,
        onCommitted: () => undefined
      })
    )

    expect(html).toContain('Git tools')
    expect(html).toContain('Changes')
    expect(html).toContain('Commit or push')
    expect(html).toContain('Open changes')
  })

  it('renders an empty state when Git reports no changes', () => {
    const html = renderToStaticMarkup(
      createElement(GitToolsPanel, {
        workspaceRoot: '/repo',
        stat: null,
        onOpenChanges: () => undefined,
        onRefreshStat: () => undefined,
        onCommitted: () => undefined
      })
    )

    expect(html).toContain('No changes')
  })
})
