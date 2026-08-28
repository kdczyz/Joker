import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultJokerRuntimeSettings } from '@shared/app-settings'
import { SettingsSidebar } from './SettingsSidebar'
import { SubagentsSettingsSection } from './settings-section-subagents'

vi.mock('./subagents/SubagentSettingsEditor', () => ({
  SubagentSettingsEditor: (props: {
    Joker: { model: string }
    onPatch: unknown
    variant: string
  }) => createElement('div', {
    'data-testid': 'subagent-settings-editor',
    'data-model': props.Joker.model,
    'data-on-patch': typeof props.onPatch,
    'data-variant': props.variant
  })
}))

const labels: Record<string, string> = {
  back: 'Back',
  general: 'General',
  providers: 'Providers',
  write: 'Write',
  design: 'Design',
  mediaGeneration: 'Media generation',
  speechToText: 'Speech to text',
  agents: 'AI assistant',
  subagents: 'Subagents',
  archives: 'Archived chats',
  worktree: 'Worktrees',
  memory: 'Memory',
  keyboardShortcuts: 'Keyboard shortcuts',
  easterEgg: 'Mode workshop',
  updates: 'Version & updates',
  claw: 'Connect phone',
  terminal: 'Terminal',
  debug: 'Troubleshooting',
  settingsFooter: 'Settings'
}

function t(key: string): string {
  return labels[key] ?? key
}

describe('SubagentsSettingsSection', () => {
  it('renders the settings editor with the current Joker settings and settings layout', () => {
    const html = renderToStaticMarkup(createElement(SubagentsSettingsSection, {
      ctx: {
        Joker: defaultJokerRuntimeSettings(),
        updateJoker: () => undefined
      }
    }))

    expect(html).toContain('data-testid="subagent-settings-editor"')
    expect(html).toContain('data-model="big-pickle"')
    expect(html).toContain('data-on-patch="function"')
    expect(html).toContain('data-variant="settings"')
  })

  it('places the Subagents navigation item immediately after AI assistant', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      category: 'subagents',
      goBack: () => undefined,
      goToChat: () => undefined,
      setCategory: () => undefined,
      t
    }))

    const agentsIndex = html.indexOf('AI assistant')
    const subagentsIndex = html.indexOf('Subagents')
    const archivesIndex = html.indexOf('Archived chats')

    expect(agentsIndex).toBeGreaterThanOrEqual(0)
    expect(subagentsIndex).toBeGreaterThan(agentsIndex)
    expect(archivesIndex).toBeGreaterThan(subagentsIndex)
    expect(html).toContain('lucide-users-round')
    expect(html).toContain('bg-ds-subtle text-ds-ink')
  })
})
