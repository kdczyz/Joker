import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'
import { PanelRightClose, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { ChatFileTreeReference } from './chat/ChatFileTreePanel'
import { ChatFileTreePanel } from './chat/ChatFileTreePanel'
import {
  targetKey,
  WorkspaceFilePreviewPanel
} from './WorkspaceFilePreviewPanel'

type Props = {
  workspaceRoot: string
  designWorkspaceRoot?: string
  onClose: () => void
}

/** 全屏文件浏览器视图：左侧文件内容预览 + 右侧文件目录树，类似 VS Code explorer 布局。 */
export function WorkspaceFileBrowserView({
  workspaceRoot,
  designWorkspaceRoot,
  onClose
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [previewTarget, setPreviewTarget] = useState<WorkspaceFileTarget | null>(null)
  const [openTargets, setOpenTargets] = useState<WorkspaceFileTarget[]>([])
  const [pinnedTargetKeys, setPinnedTargetKeys] = useState<string[]>([])
  const [preserveAcrossThreads, setPreserveAcrossThreads] = useState(false)
  const [fileTreeSearch, setFileTreeSearch] = useState('')

  const handlePreviewFile = useCallback((path: string) => {
    const target: WorkspaceFileTarget = { path, workspaceRoot }
    setPreviewTarget(target)
    setOpenTargets((prev) => {
      const key = targetKey(target)
      if (prev.some((item) => targetKey(item) === key)) return prev
      return [...prev, target]
    })
  }, [workspaceRoot])

  const handleSelectTarget = useCallback((target: WorkspaceFileTarget) => {
    setPreviewTarget(target)
  }, [])

  const handleCloseTarget = useCallback((target: WorkspaceFileTarget) => {
    const key = targetKey(target)
    setOpenTargets((prev) => {
      const next = prev.filter((item) => targetKey(item) !== key)
      if (targetKey(previewTarget) === key && next.length > 0) {
        // 切换到最后一个剩余的 tab
        const lastTarget = next[next.length - 1]
        setTimeout(() => setPreviewTarget(lastTarget), 0)
      } else if (next.length === 0) {
        setTimeout(() => setPreviewTarget(null), 0)
      }
      return next
    })
  }, [previewTarget])

  const handleTogglePinnedTarget = useCallback((target: WorkspaceFileTarget) => {
    const key = targetKey(target)
    setPinnedTargetKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }, [])

  const handleAddReference = useCallback((_reference: ChatFileTreeReference) => {
    // 文件浏览器模式下，引用操作可以暂时留空或直接预览
  }, [])

  if (!workspaceRoot) return null

  return (
    <div className="ds-drag flex h-full min-h-0 w-full min-w-0 flex-row overflow-hidden bg-ds-main">
      {/* ===== 左侧：文件内容预览区（占主要空间） ===== */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <WorkspaceFilePreviewPanel
          target={previewTarget}
          openTargets={openTargets}
          workspaceRoot={workspaceRoot}
          onSelectTarget={handleSelectTarget}
          onCloseTarget={handleCloseTarget}
          pinnedTargetKeys={pinnedTargetKeys}
          preserveAcrossThreads={preserveAcrossThreads}
          onTogglePinnedTarget={handleTogglePinnedTarget}
          onTogglePreserveAcrossThreads={() => setPreserveAcrossThreads((v) => !v)}
          onClose={onClose}
        />
      </div>

      {/* 分隔线 */}
      <div
        role="separator"
        aria-orientation="vertical"
        className="ds-no-drag relative z-20 shrink-0 w-px border-l border-ds-border-muted"
      />

      {/* ===== 右侧：文件目录树（固定宽度） ===== */}
      <aside className="ds-no-drag flex h-full min-h-0 w-[280px] shrink-0 flex-col overflow-hidden bg-ds-sidebar">
        {/* 文件树顶部工具栏：搜索 + 关闭按钮 */}
        <div className="ds-no-drag flex shrink-0 items-center gap-1.5 border-b border-ds-border-muted/70 px-2.5 py-2">
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
          <button
            type="button"
            onClick={onClose}
            className="ds-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            title={t('fileBrowserClose', { defaultValue: '关闭文件浏览器' })}
            aria-label={t('fileBrowserClose', { defaultValue: '关闭文件浏览器' })}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>

        {/* 文件树内容区 */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatFileTreePanel
            workspaceRoot={workspaceRoot}
            selectedPath={previewTarget?.path}
            searchQuery={fileTreeSearch}
            onPreviewFile={handlePreviewFile}
            onAddReference={handleAddReference}
            t={t}
            fill
          />
        </div>
      </aside>
    </div>
  )
}
