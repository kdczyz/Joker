export type GitDiffStatFile = {
  path: string
  added: number
  removed: number
}

export type GitDiffStatResult =
  | {
      ok: true
      /** Total inserted lines across all uncommitted tracked changes. */
      added: number
      /** Total deleted lines across all uncommitted tracked changes. */
      removed: number
      /**
       * Unique paths that differ from the remote (upstream) branch, including
       * untracked files the cloud doesn't have yet.
       */
      fileCount: number
      stagedFiles: number
      unstagedFiles: number
      untrackedFiles: number
      files: GitDiffStatFile[]
      /** Deterministic commit-message fallback built from the busiest paths. */
      suggestion: string
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type GitCommitResult =
  | {
      ok: true
      commitHash: string
      pushed: boolean
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'nothing_to_commit' | 'error'
      message: string
    }

export type GitPushResult =
  | {
      ok: true
      output: string
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type GitFileDiffResult =
  | {
      ok: true
      /** Unified patch of the file's changes vs the remote-diff base. */
      patch: string
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }
