import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ChangeInspector } from './ChangeInspector'
import { InspectorFileDiff } from './InspectorFileDiff'

const storeState = vi.hoisted(() => ({
  inspectorSelectedId: null as string | null,
  selectInspectorItem: (path: string | null): void => {
    storeState.inspectorSelectedId = path
  },
  workspaceRoot: '/tmp/workspace' as string | null
}))

vi.mock('../store/chat-store', () => ({
  useChatStore: (selector: (state: typeof storeState) => unknown) => selector(storeState)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count != null ? `${key}:${options.count}` : key
  })
}))

describe('ChangeInspector', () => {
  it('renders the review header and empty state without changes', () => {
    const html = renderToStaticMarkup(
      createElement(ChangeInspector, { onCollapse: () => {} })
    )

    expect(html).toContain('inspectorUncommitted')
    expect(html).toContain('inspectorRefresh')
    expect(html).toContain('inspectorEmptyTitle')
    expect(html).toContain('inspectorEmpty')
  })
})

describe('InspectorFileDiff', () => {
  const patch = [
    '--- a/src/main/index.ts',
    '+++ b/src/main/index.ts',
    '@@ -12,17 +12,18 @@',
    ...Array.from({ length: 12 }, (_, i) => ` context line ${12 + i}`),
    '-old line',
    '+new line'
  ].join('\n')

  it('renders tinted change rows with line numbers and a collapsed gap expander', () => {
    const html = renderToStaticMarkup(
      createElement(InspectorFileDiff, { patch, filePath: 'src/main/index.ts' })
    )

    expect(html).toContain('bg-ds-diff-removed-soft')
    expect(html).toContain('bg-ds-diff-added-soft')
    expect(html).toContain('repeating-linear-gradient')
    expect(html).toContain('<span>old line</span>')
    expect(html).toContain('<span>new line</span>')
    expect(html).toContain('inspectorUnmodifiedLines:12')
  })

  it('renders an empty preview hint for patches without usable rows', () => {
    const html = renderToStaticMarkup(
      createElement(InspectorFileDiff, { patch: 'binary-does-not-match', filePath: 'a.bin' })
    )

    expect(html).toContain('inspectorNoDiffPreview')
  })
})
