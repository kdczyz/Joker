import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { WorkbenchConversationStage } from './WorkbenchConversationStage'
import type { WorkbenchChatStageProps } from './WorkbenchChatStage'

vi.mock('./WorkbenchChatStage', () => ({
  WorkbenchChatStage: () => createElement('section', { 'data-chat-stage': true })
}))

describe('WorkbenchConversationStage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders the chat stage and right panel when activeSddDraft is false', () => {
    let renderer: ReactTestRenderer

    act(() => {
      renderer = create(createElement(WorkbenchConversationStage, {
        route: 'chat',
        runtimeBanner: null,
        activeSddDraft: false,
        sdd: {} as never,
        chat: {} as WorkbenchChatStageProps,
        rightPanel: createElement('aside', { 'data-right-workspace': true })
      }))
    })

    expect(renderer!.root.findByProps({ 'data-chat-stage': true })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'data-right-workspace': true })).toBeTruthy()
    act(() => renderer!.unmount())
  })
})
