import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type PointerEventHandler,
  type ReactElement
} from 'react'
import { FolderOpen, Globe, TerminalSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DesignRightPanelContent,
  type DesignRightPanelContentProps
} from '../design/DesignRightPanelContent'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import type { ExtensionRightRailViewEntry } from '../../extensions/contribution-registry'
import { ExtensionViewOutlet } from '../../extensions/ControlledContributionSurfaces'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isExtensionContributionId,
  type RightPanelContributionId
} from '../../extensions/contribution-ids'
import type { CodeRightTabsState } from './code-right-tabs-state'
import { CodeRightPanelTabs, codeRightTabDomIds } from './CodeRightPanelTabs'
import {
  WorkbenchFileTreeSidePanel,
  type WorkbenchFileTreeSidePanelProps
} from './WorkbenchFileTreeSidePanel'

const ChangeInspector = lazy(() =>
  import('../ChangeInspector').then((module) => ({ default: module.ChangeInspector }))
)
const DevBrowserPanel = lazy(() =>
  import('../DevBrowserPanel').then((module) => ({ default: module.DevBrowserPanel }))
)
const WorkspaceFilePreviewPanel = lazy(() =>
  import('../WorkspaceFilePreviewPanel').then((module) => ({
    default: module.WorkspaceFilePreviewPanel
  }))
)
const TodoPanel = lazy(() =>
  import('../todo/TodoPanel').then((module) => ({ default: module.TodoPanel }))
)
const CodeCanvasPanel = lazy(() =>
  import('../design/canvas/CodeCanvasPanel').then((module) => ({ default: module.CodeCanvasPanel }))
)
const SubagentDetailPanel = lazy(() =>
  import('../subagents/SubagentDetailPanel').then((module) => ({ default: module.SubagentDetailPanel }))
)
const SddAssistantPanel = lazy(() =>
  import('../sdd/SddAssistantPanel').then((module) => ({ default: module.SddAssistantPanel }))
)
const SideConversationPanel = lazy(() =>
  import('../chat/SideConversationPanel').then((module) => ({ default: module.SideConversationPanel }))
)
const McpSkillsPanel = lazy(() =>
  import('./McpSkillsPanel').then((module) => ({ default: module.McpSkillsPanel }))
)
const TerminalPanel = lazy(() =>
  import('../terminal/TerminalPanel').then((module) => ({ default: module.TerminalPanel }))
)

type SddAssistantPanelProps = ComponentProps<typeof SddAssistantPanel>
type ChangeInspectorProps = ComponentProps<typeof ChangeInspector>
type TodoPanelProps = ComponentProps<typeof TodoPanel>
type DevBrowserPanelProps = ComponentProps<typeof DevBrowserPanel>
type CodeCanvasPanelProps = ComponentProps<typeof CodeCanvasPanel>
type WorkspaceFilePreviewPanelProps = ComponentProps<typeof WorkspaceFilePreviewPanel>
type TerminalPanelProps = ComponentProps<typeof TerminalPanel>

export type WorkbenchCodeRightWorkspaceProps = {
  state: CodeRightTabsState
  sideConversationCount: number
  sideConversationRunningCount: number
  files: WorkbenchFileTreeSidePanelProps
  extensionItems: readonly ExtensionRightRailViewEntry[]
  extensionViews: readonly RegisteredContribution<'views.rightSidebar'>[]
  onActivate: (id: RightPanelContributionId) => void
  onClose: (id: RightPanelContributionId) => void
  onOpenFiles: () => void
  /** 打开右侧"开发预览"浏览器 tab。 */
  onOpenBrowser: () => void
  /** 打开右侧终端 tab。 */
  onOpenTerminal: () => void
}

export type WorkbenchRightPanelProps = {
  visible: boolean
  width: number
  route: string
  rightPanelMode: RightPanelMode | null
  onBeginResize: PointerEventHandler<HTMLDivElement>
  design: DesignRightPanelContentProps
  sdd: Omit<SddAssistantPanelProps, 'draft' | 'className'> & {
    draft: SddAssistantPanelProps['draft'] | null
  }
  changes: Omit<ChangeInspectorProps, 'className'>
  todo: Omit<TodoPanelProps, 'className'>
  browser: Omit<DevBrowserPanelProps, 'className'>
  planPanel: ReactElement
  canvas: Omit<CodeCanvasPanelProps, 'className'>
  file: Omit<WorkspaceFilePreviewPanelProps, 'className'>
  terminal: Pick<TerminalPanelProps, 'workspaceRoot' | 'onCollapse'>
  mcpSkills: {
    onOpenSettings: () => void
  }
  extensionView?: RegisteredContribution<'views.rightSidebar'>
  code?: WorkbenchCodeRightWorkspaceProps
  workspaceRoot?: string
  onCollapse: () => void
}

export function WorkbenchRightPanel({
  visible,
  width,
  route,
  rightPanelMode,
  onBeginResize,
  design,
  sdd,
  changes,
  todo,
  browser,
  planPanel,
  canvas,
  file,
  terminal,
  mcpSkills,
  extensionView,
  code,
  workspaceRoot,
  onCollapse
}: WorkbenchRightPanelProps): ReactElement | null {
  if (route === 'chat' && rightPanelMode !== BUILTIN_RIGHT_PANEL_IDS.sddAi && code) {
    return (
      <CodeRightPanelWorkspace
        visible={visible}
        width={width}
        onBeginResize={onBeginResize}
        code={code}
        changes={changes}
        todo={todo}
        browser={browser}
        planPanel={planPanel}
        canvas={canvas}
        file={file}
        terminal={terminal}
        mcpSkills={mcpSkills}
        workspaceRoot={workspaceRoot}
        onCollapse={onCollapse}
      />
    )
  }
  if (!visible) return null
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
        onPointerDown={onBeginResize}
      />
      <div className="h-full min-h-0 shrink-0" style={{ width }}>
        <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
          {design.panelMode !== 'hidden' ? (
            <DesignRightPanelContent {...design} />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi && sdd.draft ? (
            <SddAssistantPanel {...sdd} draft={sdd.draft} className="h-full max-h-full w-full" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.subagents ? (
            <SubagentDetailPanel className="h-full max-h-full w-full" onCollapse={onCollapse} />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.changes ? (
            <ChangeInspector {...changes} className="h-full max-h-full w-full flex-col" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.todo ? (
            <TodoPanel {...todo} className="h-full max-h-full w-full" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.browser ? (
            <DevBrowserPanel {...browser} className="h-full max-h-full w-full flex-col" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.plan ? (
            planPanel
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.canvas ? (
            <CodeCanvasPanel {...canvas} className="h-full max-h-full w-full" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.file ? (
            <WorkspaceFilePreviewPanel {...file} className="h-full max-h-full w-full" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.terminal ? (
            <TerminalPanel {...terminal} embedded className="h-full max-h-full w-full" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.mcpSkills ? (
            <McpSkillsPanel workspaceRoot={workspaceRoot} onOpenSettings={mcpSkills.onOpenSettings} />
          ) : rightPanelMode && isExtensionContributionId(rightPanelMode) && extensionView?.id === rightPanelMode ? (
            <ExtensionViewOutlet contribution={extensionView} workspaceRoot={workspaceRoot} onClose={onCollapse} />
          ) : (
            <div role="alert" className="flex h-full items-center justify-center bg-ds-sidebar px-6 text-center text-[12px] text-ds-muted">
              This workbench contribution is unavailable.
            </div>
          )}
        </Suspense>
      </div>
    </>
  )
}

function CodeRightPanelWorkspace({
  visible,
  width,
  onBeginResize,
  code,
  changes,
  todo,
  browser,
  planPanel,
  canvas,
  file,
  terminal,
  mcpSkills,
  workspaceRoot,
  onCollapse
}: Pick<
  WorkbenchRightPanelProps,
  | 'visible'
  | 'width'
  | 'onBeginResize'
  | 'changes'
  | 'todo'
  | 'browser'
  | 'planPanel'
  | 'canvas'
  | 'file'
  | 'terminal'
  | 'mcpSkills'
  | 'workspaceRoot'
  | 'onCollapse'
> & { code: WorkbenchCodeRightWorkspaceProps }): ReactElement {
  const reactId = useId()
  const domIdPrefix = `code-right-${reactId}`
  const [visited, setVisited] = useState<Set<RightPanelContributionId>>(() =>
    new Set(code.state.activeId ? [code.state.activeId] : []))
  const [dynamicTitles, setDynamicTitles] = useState<Record<string, string>>({})

  useEffect(() => {
    setDynamicTitles({})
  }, [workspaceRoot])

  useEffect(() => {
    const activeId = code.state.activeId
    setVisited((current) => {
      const next = new Set([...current].filter((id) => code.state.tabs.includes(id)))
      if (activeId) next.add(activeId)
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current
      return next
    })
  }, [code.state.activeId, code.state.tabs])

  const updateTitle = useCallback((id: RightPanelContributionId, title: string): void => {
    const bounded = title.trim().slice(0, 128)
    if (!bounded) return
    setDynamicTitles((current) => current[id] === bounded ? current : { ...current, [id]: bounded })
  }, [])

  const fileTitle = file.target?.path?.replaceAll('\\', '/').split('/').at(-1)
  const titles = fileTitle
    ? { ...dynamicTitles, [BUILTIN_RIGHT_PANEL_IDS.file]: fileTitle }
    : dynamicTitles

  if (code.state.tabs.length === 0) {
    return (
      <CodeRightWorkspaceEmptyState
        visible={visible}
        width={width}
        onOpenFiles={code.onOpenFiles}
        onOpenBrowser={code.onOpenBrowser}
        onOpenTerminal={code.onOpenTerminal}
        onBeginResize={onBeginResize}
      />
    )
  }

  const renderPanel = (id: RightPanelContributionId, active: boolean): ReactElement => {
    if (id === BUILTIN_RIGHT_PANEL_IDS.subagents) {
      return <SubagentDetailPanel className="h-full max-h-full w-full" onCollapse={onCollapse} />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.changes) {
      return <ChangeInspector {...changes} className="h-full max-h-full w-full flex-col" />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.todo) {
      return <TodoPanel {...todo} className="h-full max-h-full w-full" />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.browser) {
      return (
        <DevBrowserPanel
          key={workspaceRoot || '__global__'}
          {...browser}
          embedded
          className="h-full max-h-full w-full flex-col"
          onTitleChange={(title) => updateTitle(id, title)}
        />
      )
    }
    /* 终端在右侧栏里作为一个标签页嵌入:非激活标签用 active={false}
       暂停 xterm 渲染与会话输出,切回来再恢复。 */
    if (id === BUILTIN_RIGHT_PANEL_IDS.terminal) {
      return (
        <TerminalPanel
          key={workspaceRoot || '__global__'}
          {...terminal}
          embedded
          active={active}
          className="h-full max-h-full w-full"
          onTitleChange={(title) => updateTitle(id, title)}
        />
      )
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.plan) return planPanel
    if (id === BUILTIN_RIGHT_PANEL_IDS.canvas) {
      return <CodeCanvasPanel {...canvas} className="h-full max-h-full w-full" />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.files) {
      return <WorkbenchFileTreeSidePanel {...code.files} open embedded />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.file) {
      return <WorkspaceFilePreviewPanel {...file} className="h-full max-h-full w-full" />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.sideConversations) {
      return (
        <SideConversationPanel
          variant="docked"
          onRequestClose={() => code.onClose(id)}
          onTitleChange={(title) => updateTitle(id, title)}
        />
      )
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.mcpSkills) {
      return <McpSkillsPanel workspaceRoot={workspaceRoot} onOpenSettings={mcpSkills.onOpenSettings} />
    }
    if (isExtensionContributionId(id)) {
      const contribution = code.extensionViews.find((view) => view.id === id)
      if (contribution) {
        return <ExtensionViewOutlet contribution={contribution} workspaceRoot={workspaceRoot} />
      }
    }
    return (
      <div role="alert" className="flex h-full items-center justify-center bg-ds-sidebar px-6 text-center text-[12px] text-ds-muted">
        This workbench contribution is unavailable.
      </div>
    )
  }

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        className={`${visible ? '' : 'hidden '}ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize`}
        onPointerDown={onBeginResize}
      />
      <div
        aria-hidden={!visible}
        className={`ds-code-right-workspace${visible ? ' ds-code-right-workspace-expanded' : ''} flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-ds-sidebar`}
        style={{ width: visible ? width : 0 }}
      >
        {/* 右上角固定按钮群悬浮在本面板上方,内容整体下移为其让位 */}
        <div className="ds-workbench-corner-actions-spacer shrink-0" aria-hidden />
        <CodeRightPanelTabs
          state={code.state}
          domIdPrefix={domIdPrefix}
          titles={titles}
          sideConversationCount={code.sideConversationCount}
          sideConversationRunningCount={code.sideConversationRunningCount}
          extensionItems={code.extensionItems}
          onActivate={code.onActivate}
          onClose={code.onClose}
        />
        <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
          <div className="relative min-h-0 flex-1 bg-ds-sidebar">
            {code.state.tabs.map((id) => {
              const active = code.state.activeId === id
              if (!visited.has(id) && !active) return null
              const { tabId, panelId } = codeRightTabDomIds(domIdPrefix, id)
              return (
                <div
                  key={id}
                  id={panelId}
                  role="tabpanel"
                  aria-labelledby={tabId}
                  hidden={!active}
                  className="absolute inset-0 min-h-0"
                >
                  {renderPanel(id, active)}
                </div>
              )
            })}
          </div>
        </Suspense>
      </div>
    </>
  )
}

/* 右侧工作区无任何标签时的空状态:提供「打开文件 / 打开浏览器 / 打开终端」三个快捷入口 */
function CodeRightWorkspaceEmptyState({
  visible,
  width,
  onOpenFiles,
  onOpenBrowser,
  onOpenTerminal,
  onBeginResize
}: {
  visible: boolean
  width: number
  onOpenFiles: () => void
  onOpenBrowser: () => void
  onOpenTerminal: () => void
  onBeginResize: PointerEventHandler<HTMLDivElement>
}): ReactElement {
  const { t } = useTranslation('common')
  const hintTexts = [
    { titleKey: 'rightPanelEmptyOpenFiles', descKey: 'rightPanelEmptyHintBrowse' },
    { titleKey: 'rightPanelEmptyOpenBrowser', descKey: 'rightPanelEmptyHintBrowser' },
    { titleKey: 'rightPanelEmptyOpenTerminal', descKey: 'rightPanelEmptyHintTerminal' }
  ] as const
  const actions: { icon: typeof FolderOpen; onClick: () => void; titleKey: string; descKey: string }[] = [
    { icon: FolderOpen, onClick: onOpenFiles, ...hintTexts[0] },
    { icon: Globe, onClick: onOpenBrowser, ...hintTexts[1] },
    { icon: TerminalSquare, onClick: onOpenTerminal, ...hintTexts[2] }
  ]
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        className={`${visible ? '' : 'hidden '}ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize`}
        onPointerDown={onBeginResize}
      />
      <div
        aria-hidden={!visible}
        className={`ds-code-right-workspace${visible ? ' ds-code-right-workspace-expanded' : ''} flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-ds-sidebar`}
        style={{ width: visible ? width : 0 }}
      >
        {/* 右上角固定按钮群悬浮在本面板上方,内容整体下移为其让位 */}
        <div className="ds-workbench-corner-actions-spacer shrink-0" aria-hidden />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pb-6 text-center">
          <p className="max-w-[220px] text-[12px] leading-relaxed text-ds-faint">
            {t('rightPanelEmptyHint')}
          </p>
          <div className="flex w-full max-w-[260px] flex-col gap-2">
            {actions.map(({ icon: Icon, onClick, titleKey, descKey }) => (
              <button
                key={titleKey}
                type="button"
                onClick={onClick}
                className="group flex items-center gap-3 rounded-2xl border border-dashed border-ds-border-strong/60 px-4 py-3 text-left text-ds-muted transition hover:border-accent/50 hover:bg-ds-hover/40 hover:text-ds-ink"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ds-border bg-ds-card text-ds-faint shadow-sm transition group-hover:text-accent">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-semibold leading-tight">{t(titleKey)}</span>
                  <span className="mt-0.5 text-[11px] leading-snug text-ds-faint">{t(descKey)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
