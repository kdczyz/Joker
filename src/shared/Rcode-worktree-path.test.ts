import { describe, expect, it } from 'vitest'
import {
  isRcodeBranchWorktreePath,
  parseRcodeBranchWorktreeLayout,
  resolveRcodeBranchWorktreeProjectPath
} from './Rcode-worktree-path'

describe('Rcode-worktree-path', () => {
  it('recognizes default Rcode branch worktree paths', () => {
    const path = '/Users/zxy/.Rcode/worktrees/0ff7/Kook-VoiceShop-Bot'
    expect(isRcodeBranchWorktreePath(path)).toBe(true)
    expect(parseRcodeBranchWorktreeLayout(path)).toEqual({
      poolId: '0ff7',
      repoName: 'Kook-VoiceShop-Bot'
    })
    expect(
      resolveRcodeBranchWorktreeProjectPath(path, ['/Users/zxy/code/Kook-VoiceShop-Bot'])
    ).toBe('/Users/zxy/code/Kook-VoiceShop-Bot')
  })

  it('only treats paths under the Rcode worktree root (.Rcode/worktrees) as worktrees', () => {
    // A user project that merely sits under some other `worktrees/<hex>/<name>`
    // directory must NOT be misclassified as a Rcode-managed worktree — otherwise
    // it would be hidden from the sidebar project list.
    expect(isRcodeBranchWorktreePath('/data/worktrees/ab12/my-repo')).toBe(false)
    expect(isRcodeBranchWorktreePath('/Users/zxy/projects/worktrees/2024/app')).toBe(false)
    expect(isRcodeBranchWorktreePath('/Users/zxy/.Rcode/worktrees/ab12/my-repo')).toBe(true)
  })

  it('rejects regular project directories', () => {
    expect(isRcodeBranchWorktreePath('/Users/zxy/code/Kook-VoiceShop-Bot')).toBe(false)
    expect(isRcodeBranchWorktreePath('/Users/zxy/.Rcode/default_workspace')).toBe(false)
  })

  it('resolves a worktree path back to a known project root by repo basename', () => {
    const projectPath = '/Users/zxy/code/Kook-VoiceShop-Bot'
    const worktreePath = '/Users/zxy/.Rcode/worktrees/38e2/Kook-VoiceShop-Bot'
    expect(
      resolveRcodeBranchWorktreeProjectPath(worktreePath, [projectPath, '/Users/zxy/code/DeepSeek-GUI'])
    ).toBe(projectPath)
  })

  it('ignores worktree paths when matching project roots by repo basename', () => {
    expect(
      resolveRcodeBranchWorktreeProjectPath(
        '/Users/zxy/.Rcode/worktrees/ab12/Kook-VoiceShop-Bot',
        [
          '/Users/zxy/.Rcode/worktrees/ab12/Kook-VoiceShop-Bot',
          '/Users/zxy/code/Kook-VoiceShop-Bot'
        ]
      )
    ).toBe('/Users/zxy/code/Kook-VoiceShop-Bot')
  })
})
