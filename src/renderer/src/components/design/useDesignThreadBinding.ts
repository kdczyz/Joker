import { useCallback, useEffect, useMemo } from 'react'
import type { NormalizedThread } from '../../agent/types'
import { refreshDesignChatTranscriptFromProvider } from '../../design/design-chat-transcript'
import {
  designThreadSelectionSyncForDocument,
  designThreadsForDocument,
  switchDesignThreadForDocument
} from '../../design/design-thread-workbench'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'

export type DesignThreadBindingOptions = {
  threads: NormalizedThread[]
  workspaceRoot: string
  designWorkspaceRoot: string
  activeDocumentId: string | null
  activeArtifactId: string | null
  activeThreadId: string | null
  route: string
  selectThread: (threadId: string) => Promise<void>
  clearActiveThreadSelection?: () => void
}

export type DesignThreadBindingState = {
  designThreads: NormalizedThread[]
  switchDesignThread: (threadId: string) => Promise<void>
}

export function useDesignThreadBinding({
  threads,
  workspaceRoot,
  designWorkspaceRoot,
  activeDocumentId,
  activeArtifactId,
  activeThreadId,
  route,
  selectThread,
  clearActiveThreadSelection
}: DesignThreadBindingOptions): DesignThreadBindingState {
  const effectiveWorkspaceRoot = designWorkspaceRoot || workspaceRoot
  const designThreads = useMemo(() => {
    return designThreadsForDocument({
      threads,
      workspaceRoot: effectiveWorkspaceRoot,
      docId: activeDocumentId,
      artifactId: activeArtifactId
    })
  }, [activeDocumentId, activeArtifactId, effectiveWorkspaceRoot, threads])

  const switchDesignThread = useCallback(async (threadId: string): Promise<void> => {
    const designStore = useDesignWorkspaceStore.getState()
    await switchDesignThreadForDocument({
      workspaceRoot: designStore.workspaceRoot || workspaceRoot,
      docId: designStore.activeDocumentId,
      artifactId: designStore.activeArtifactId,
      threadId,
      selectThread
    })
  }, [selectThread, workspaceRoot])

  useEffect(() => {
    const sync = designThreadSelectionSyncForDocument({
      route,
      activeThreadId,
      threads,
      workspaceRoot: effectiveWorkspaceRoot,
      docId: activeDocumentId,
      artifactId: activeArtifactId
    })
    if (sync.action === 'select') {
      void selectThread(sync.threadId)
      return
    }
    if (sync.action === 'clear') {
      clearActiveThreadSelection?.()
    }
  }, [
    activeArtifactId,
    activeDocumentId,
    activeThreadId,
    clearActiveThreadSelection,
    effectiveWorkspaceRoot,
    route,
    selectThread,
    threads
  ])

  useEffect(() => {
    if (route !== 'design' || !activeDocumentId || !effectiveWorkspaceRoot) return
    void refreshDesignChatTranscriptFromProvider({
      workspaceRoot: effectiveWorkspaceRoot,
      docId: activeDocumentId
    })
  }, [activeDocumentId, effectiveWorkspaceRoot, route])

  return { designThreads, switchDesignThread }
}
