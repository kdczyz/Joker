import type { ReactElement } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { FileText, FolderOpen, Search } from 'lucide-react'
import type { DesignDocument } from '../../design/design-types'
import { ChatDesignTreePanel } from '../chat/ChatDesignTreePanel'
import { ChatFileTreePanel, type ChatFileTreeReference } from '../chat/ChatFileTreePanel'
import type { WorkbenchFileTreeSidePanelView } from './useWorkbenchFileTreeController'

export type WorkbenchFileTreeSidePanelProps = {
  open: boolean
  embedded?: boolean
  view: WorkbenchFileTreeSidePanelView
  width: number
  workspaceRoot: string
  designWorkspaceRoot?: string
  designDocuments?: readonly DesignDocument[]
  activeDesignDocumentId?: string | null
  selectedTarget?: WorkspaceFileTarget | null
  onViewChange: (view: WorkbenchFileTreeSidePanelView) => void
  onPreviewFile: (path: string) => void
  onAddReference: (reference: ChatFileTreeReference) => void
}

export function WorkbenchFileTreeSidePanel({
  open,
  embedded = false,
  view,
  width,
  workspaceRoot,
  designWorkspaceRoot,
  designDocuments,
  activeDesignDocumentId,
  selectedTarget,
  onViewChange,
  onPreviewFile,
  onAddReference
}: WorkbenchFileTreeSidePanelProps): ReactElement | null {
  const { t } = useTranslation()
  const [fileTreeSearch, setFileTreeSearch] = useState('')
  if (!open) return null
  return (
    <>
      {!embedded ? (
        <div
          role="separator"
          aria-orientation="vertical"
          className="ds-workbench-divider ds-no-drag relative z-20 shrink-0"
        />
      ) : null}
      <aside
        className={`ds-no-drag h-full min-h-0 shrink-0 bg-ds-sidebar ${embedded ? 'w-full' : 'border-l border-ds-border-muted'}`}
        style={embedded ? undefined : { width }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 gap-1 border-b border-ds-border-muted/70 p-2">
            <button
              type="button"
              onClick={() => onViewChange('workspace')}
              className={`inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12.5px] font-semibold transition ${
                view === 'workspace'
                  ? 'bg-ds-card text-ds-ink shadow-sm'
                  : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <span className="truncate">{t('fileTreeWorkspaceTab')}</span>
            </button>
            <button
              type="button"
              onClick={() => onViewChange('design')}
              className={`inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12.5px] font-semibold transition ${
                view === 'design'
                  ? 'bg-ds-card text-ds-ink shadow-sm'
                  : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <span className="truncate">{t('fileTreeDesignTab')}</span>
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {view === 'design' ? (
              designWorkspaceRoot ? (
                <ChatDesignTreePanel
                  workspaceRoot={designWorkspaceRoot}
                  documents={designDocuments ?? []}
                  activeDocumentId={activeDesignDocumentId}
                  onAddReference={onAddReference}
                  t={t}
                  fill
                />
              ) : (
                <div className="px-4 py-3 text-[12px] leading-5 text-ds-muted">
                  {t('workspaceRequiredToCreateThread')}
                </div>
              )
            ) : workspaceRoot ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="ds-no-drag flex shrink-0 items-center border-b border-ds-border-muted/70 px-2.5 py-2">
                  <div className="relative flex min-w-0 flex-1 items-center">
                    <Search className="absolute left-2 h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
                    <input
                      type="text"
                      value={fileTreeSearch}
                      onChange={(e) => setFileTreeSearch(e.target.value)}
                      placeholder={t('fileTreeSearchPlaceholder', { defaultValue: '筛选文件...' })}
                      className="h-7 w-full rounded-[8px] border border-black/[0.06] bg-[var(--ds-sidebar-field-bg)] pl-8 pr-3 text-[12.5px] text-ds-ink outline-none placeholder:text-[#9aa5b5] focus:border-black/20 dark:border-white/[0.08] dark:text-white dark:placeholder:text-white/30"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ChatFileTreePanel
                    workspaceRoot={workspaceRoot}
                    selectedPath={selectedTarget?.path}
                    searchQuery={fileTreeSearch}
                    onPreviewFile={onPreviewFile}
                    onAddReference={onAddReference}
                    t={t}
                    fill
                  />
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 text-[12px] leading-5 text-ds-muted">
                {t('workspaceRequiredToCreateThread')}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
