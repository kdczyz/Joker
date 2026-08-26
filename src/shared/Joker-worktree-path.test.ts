import { describe, expect, it } from 'vitest'
import {
  isJokerBranchWorktreePath,
  parseJokerBranchWorktreeLayout,
  resolveJokerBranchWorktreeProjectPath
} from './Joker-worktree-path'

describe('Joker-worktree-path', () => {
  it('recognizes default Joker branch worktree paths', () => {
    const path = '/Users/zxy/.Joker/worktrees/0ff7/Kook-VoiceShop-Bot'
    expect(isJokerBranchWorktreePath(path)).toBe(true)
    expect(parseJokerBranchWorktreeLayout(path)).toEqual({
      poolId: '0ff7',
      repoName: 'Kook-VoiceShop-Bot'
    })
    expect(
      resolveJokerBranchWorktreeProjectPath(path, ['/Users/zxy/code/Kook-VoiceShop-Bot'])
    ).toBe('/Users/zxy/code/Kook-VoiceShop-Bot')
  })

  it('only treats paths under the Joker worktree root (.Joker/worktrees) as worktrees', () => {
    // A user project that merely sits under some other `worktrees/<hex>/<name>`
    // directory must NOT be misclassified as a Joker-managed worktree — otherwise
    // it would be hidden from the sidebar project list.
    expect(isJokerBranchWorktreePath('/data/worktrees/ab12/my-repo')).toBe(false)
    expect(isJokerBranchWorktreePath('/Users/zxy/projects/worktrees/2024/app')).toBe(false)
    expect(isJokerBranchWorktreePath('/Users/zxy/.Joker/worktrees/ab12/my-repo')).toBe(true)
  })

  it('rejects regular project directories', () => {
    expect(isJokerBranchWorktreePath('/Users/zxy/code/Kook-VoiceShop-Bot')).toBe(false)
    expect(isJokerBranchWorktreePath('/Users/zxy/.Joker/default_workspace')).toBe(false)
  })

  it('resolves a worktree path back to a known project root by repo basename', () => {
    const projectPath = '/Users/zxy/code/Kook-VoiceShop-Bot'
    const worktreePath = '/Users/zxy/.Joker/worktrees/38e2/Kook-VoiceShop-Bot'
    expect(
      resolveJokerBranchWorktreeProjectPath(worktreePath, [projectPath, '/Users/zxy/code/DeepSeek-GUI'])
    ).toBe(projectPath)
  })

  it('ignores worktree paths when matching project roots by repo basename', () => {
    expect(
      resolveJokerBranchWorktreeProjectPath(
        '/Users/zxy/.Joker/worktrees/ab12/Kook-VoiceShop-Bot',
        [
          '/Users/zxy/.Joker/worktrees/ab12/Kook-VoiceShop-Bot',
          '/Users/zxy/code/Kook-VoiceShop-Bot'
        ]
      )
    ).toBe('/Users/zxy/code/Kook-VoiceShop-Bot')
  })
})
