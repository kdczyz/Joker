import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONVERSATION_WORKSPACE_ROOT,
  defaultConversationWorkspaceRoot,
  isConversationWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  workspaceRootScopeKey
} from './workspace-path'

describe('workspaceRootScopeKey', () => {
  it('normalizes separators and trailing slashes without merging case-sensitive roots', () => {
    expect(workspaceRootScopeKey('/workspace/project///')).toBe('/workspace/project')
    expect(workspaceRootScopeKey('C:\\workspace\\project\\')).toBe('C:/workspace/project')
    expect(workspaceRootScopeKey('/workspace/Project')).not.toBe(workspaceRootScopeKey('/workspace/project'))
    expect(workspaceRootScopeKey('/')).toBe('/')
  })
})

describe('defaultConversationWorkspaceRoot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses ~/Documents/Joker on macOS', () => {
    vi.stubGlobal('window', { JokerGui: { platform: 'darwin' } })
    expect(defaultConversationWorkspaceRoot()).toBe('~/Documents/Joker')
  })

  it('uses ~/.local/share/Joker/conversations on Linux', () => {
    vi.stubGlobal('window', { JokerGui: { platform: 'linux' } })
    expect(defaultConversationWorkspaceRoot()).toBe('~/.local/share/Joker/conversations')
  })

  it('falls back to ~/Documents/Joker when platform is unknown', () => {
    vi.stubGlobal('window', { JokerGui: { platform: '' } })
    expect(defaultConversationWorkspaceRoot()).toBe('~/Documents/Joker')
  })

  it('DEFAULT_CONVERSATION_WORKSPACE_ROOT resolves at import time from the platform', () => {
    expect(typeof DEFAULT_CONVERSATION_WORKSPACE_ROOT).toBe('string')
    expect(DEFAULT_CONVERSATION_WORKSPACE_ROOT.length).toBeGreaterThan(0)
  })
})

describe('isInternalDeepSeekGuiWorkspace', () => {
  it('treats write and design workspaces as internal GUI workspaces', () => {
    expect(isInternalDeepSeekGuiWorkspace('/Users/alice/.Joker/write_workspace')).toBe(true)
    expect(isInternalDeepSeekGuiWorkspace('/Users/alice/.Joker/design-workspace')).toBe(true)
    expect(isInternalDeepSeekGuiWorkspace('~/.Joker/design-workspace')).toBe(true)
    expect(isInternalDeepSeekGuiWorkspace('/Users/alice/projects/design-workspace')).toBe(false)
  })
})

describe('isConversationWorkspacePath', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('matches a path directly under the conversation root', () => {
    vi.stubGlobal('window', { JokerGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('/Users/alice/Documents/Joker/20260626-153012', '~/Documents/Joker')).toBe(true)
  })

  it('matches the conversation root itself', () => {
    vi.stubGlobal('window', { JokerGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('/Users/alice/Documents/Joker', '~/Documents/Joker')).toBe(true)
  })

  it('expands ~ in the candidate path', () => {
    vi.stubGlobal('window', { JokerGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('~/Documents/Joker/sub', '~/Documents/Joker')).toBe(true)
  })

  it('does not match a sibling that merely shares a prefix segment', () => {
    // /Users/alice/Documents/Joker-other 必须不被当成对话目录,否则会误伤真实项目。
    vi.stubGlobal('window', { JokerGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('/Users/alice/Documents/Joker-other', '~/Documents/Joker')).toBe(false)
  })

  it('does not match a path outside the conversation root', () => {
    vi.stubGlobal('window', { JokerGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('/Users/alice/projects/app', '~/Documents/Joker')).toBe(false)
  })

  it('handles backslash separators (Windows)', () => {
    vi.stubGlobal('window', { JokerGui: { platform: 'win32', homeDir: 'C:\\Users\\alice' } })
    expect(isConversationWorkspacePath('C:\\Users\\alice\\Documents\\Joker\\20260626-153012', '~/Documents/Joker')).toBe(true)
    expect(isConversationWorkspacePath('C:\\Users\\alice\\Documents\\Joker-other', '~/Documents/Joker')).toBe(false)
  })

  it('returns false for empty input', () => {
    vi.stubGlobal('window', { JokerGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('', '~/Documents/Joker')).toBe(false)
  })

  it('falls back to the platform default when no root is given', () => {
    vi.stubGlobal('window', { JokerGui: { platform: 'linux', homeDir: '/home/alice' } })
    expect(
      isConversationWorkspacePath('/home/alice/.local/share/Joker/conversations/20260626-153012')
    ).toBe(true)
  })
})
