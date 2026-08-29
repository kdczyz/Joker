import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { CodeRightPanelTabs } from './CodeRightPanelTabs'
import { emptyCodeRightTabsState, openCodeRightTab } from './code-right-tabs-state'

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

describe('CodeRightPanelTabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders dynamic titles and activates tabs with Arrow/Home/End navigation', () => {
    let state = openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.browser)
    state = openCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.file)
    const onActivate = vi.fn()
    let renderer: ReactTestRenderer

    act(() => {
      renderer = create(createElement(CodeRightPanelTabs, {
        state,
        domIdPrefix: 'test-tabs',
        titles: {
          [BUILTIN_RIGHT_PANEL_IDS.browser]: 'Joker docs',
          [BUILTIN_RIGHT_PANEL_IDS.file]: 'README.md'
        },
        sideConversationCount: 2,
        sideConversationRunningCount: 1,
        extensionItems: [],
        onActivate,
        onClose: vi.fn()
      }))
    })

    const tabs = renderer!.root.findAll((node) => node.props.role === 'tab')
    expect(tabs.map(textContent)).toEqual(['Joker docs', 'README.md'])

    act(() => tabs[0].props.onKeyDown({ key: 'End', preventDefault: vi.fn() }))
    expect(onActivate).toHaveBeenLastCalledWith(BUILTIN_RIGHT_PANEL_IDS.file)
    act(() => tabs[1].props.onKeyDown({ key: 'Home', preventDefault: vi.fn() }))
    expect(onActivate).toHaveBeenLastCalledWith(BUILTIN_RIGHT_PANEL_IDS.browser)
    act(() => tabs[0].props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() }))
    expect(onActivate).toHaveBeenLastCalledWith(BUILTIN_RIGHT_PANEL_IDS.file)
  })

  it('omits the redundant add-tool menu and the collapse control', () => {
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(CodeRightPanelTabs, {
        state: openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.canvas),
        domIdPrefix: 'test-no-menu',
        sideConversationCount: 0,
        sideConversationRunningCount: 0,
        extensionItems: [],
        onActivate: vi.fn(),
        onClose: vi.fn()
      }))
    })

    expect(renderer!.root.findAllByProps({ 'aria-label': 'Open right workspace tool' })).toHaveLength(0)
    expect(renderer!.root.findAll((node) => node.props.role === 'menu')).toHaveLength(0)
    // 收起入口统一由右上角固定按钮群(WorkbenchCornerActions)承担,标签栏不再重复
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Collapse right sidebar' })).toHaveLength(0)
  })

  it('keeps empty tab chrome as an Electron no-drag region without an add button', () => {
    let renderer: ReactTestRenderer
    act(() => {
      renderer = create(createElement(CodeRightPanelTabs, {
        state: { ...emptyCodeRightTabsState(), expanded: true },
        domIdPrefix: 'empty-tabs',
        sideConversationCount: 0,
        sideConversationRunningCount: 0,
        extensionItems: [],
        onActivate: vi.fn(),
        onClose: vi.fn()
      }))
    })

    const chrome = renderer!.root.find((node) =>
      typeof node.props.className === 'string' && node.props.className.includes('ds-code-right-tabs'))
    expect(chrome.props.className).toContain('ds-no-drag')
    expect(renderer!.root.findAll((node) => node.props.role === 'tab')).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Open right workspace tool' })).toHaveLength(0)
  })
})
