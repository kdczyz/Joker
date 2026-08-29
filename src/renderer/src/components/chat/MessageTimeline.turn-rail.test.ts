import { describe, expect, it } from 'vitest'
import {
  activeTimelineTurnKey,
  timelineJumpPreviewMetadata
} from './MessageTimeline'

describe('activeTimelineTurnKey', () => {
  const positions = [
    { key: 'turn-1', top: -220 },
    { key: 'turn-2', top: 40 },
    { key: 'turn-3', top: 280 }
  ]

  it('keeps the latest turn that crossed the viewport threshold active', () => {
    expect(activeTimelineTurnKey(positions)).toBe('turn-2')
  })

  it('uses the first turn before any later turn crosses the threshold', () => {
    expect(activeTimelineTurnKey([
      { key: 'turn-1', top: 180 },
      { key: 'turn-2', top: 420 }
    ])).toBe('turn-1')
  })

  it('returns null for an empty timeline', () => {
    expect(activeTimelineTurnKey([])).toBeNull()
  })
})


describe('timelineJumpPreviewMetadata', () => {
  it('collects unique edited file labels and detects a git commit command', () => {
    expect(timelineJumpPreviewMetadata({
      user: { kind: 'user', id: 'user-1', text: 'Update the rail' },
      blocks: [
        {
          kind: 'tool',
          id: 'file-1',
          summary: 'edit file',
          status: 'success',
          toolKind: 'file_change',
          filePath: '/workspace/src/base-shell.css'
        },
        {
          kind: 'tool',
          id: 'file-2',
          summary: 'edit file again',
          status: 'success',
          toolKind: 'file_change',
          filePath: 'src/base-shell.css'
        },
        {
          kind: 'tool',
          id: 'commit-1',
          summary: 'run command',
          status: 'success',
          toolKind: 'command_execution',
          meta: { command: 'git add src/base-shell.css && git commit -m "fix rail"' }
        }
      ]
    })).toEqual({ fileLabels: ['base-shell.css'], hasCommit: true })
  })

  it('ignores failed file changes and non-commit git commands', () => {
    expect(timelineJumpPreviewMetadata({
      blocks: [
        {
          kind: 'tool',
          id: 'file-failed',
          summary: 'edit file',
          status: 'error',
          toolKind: 'file_change',
          filePath: '/workspace/failed.ts'
        },
        {
          kind: 'tool',
          id: 'status-1',
          summary: 'run command',
          status: 'success',
          toolKind: 'command_execution',
          meta: { command: 'git status --short' }
        }
      ]
    })).toEqual({ fileLabels: [], hasCommit: false })
  })
})


