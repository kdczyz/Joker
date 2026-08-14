import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { WorkspaceModeTabs } from '../WorkspaceModeTabs'

describe('WorkspaceModeTabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  function props(
    activeView: 'chat' | 'claw' | 'schedule' | 'workflow' | 'subagents' = 'chat'
  ) {
    return {
      activeView,
      onCodeOpen: vi.fn()
    }
  }

  it('renders a single Code mode tab button', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('Code')
    expect(html).not.toContain('Write')
    expect(html).not.toContain('Design')
    expect(html.match(/role="tab"/g)?.length).toBe(1)
  })

  it('uses horizontal row layout not vertical column', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    // Container should have flex-row, not flex-col
    expect(html).toContain('flex-row')
    expect(html).not.toContain('flex-col')
  })

  it('marks the Code tab active when the chat view is active', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props('chat')))

    expect(html.match(/aria-selected="true"/g)?.length).toBe(1)
  })

  it('does not mark the Code tab active while another view is active', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props('workflow')))

    expect(html).not.toContain('aria-selected="true"')
  })

  it('uses all-or-icon labels instead of truncating tab text', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('workspace-mode-tab-label')
    expect(html).not.toContain('truncate')
  })

  it('preserves min-w-0 on the button for flex sizing', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('min-w-0')
  })

  it('renders role="tablist" container with a descriptive aria-label', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceModeTabs, props()))

    expect(html).toContain('role="tablist"')
    expect(html).toContain('Code')
  })
})
