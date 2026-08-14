import { Suspense, type ComponentProps, type PointerEventHandler, type ReactElement } from 'react'
import type { SettingsRouteSection } from '../../store/chat-store'
import { Sidebar } from '../chat/Sidebar'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import { ExtensionViewOutlet } from '../../extensions/ControlledContributionSurfaces'

type CodeSidebarProps = ComponentProps<typeof Sidebar>

// 左侧栏独立缩放系数 —— 必须与 base-shell.css 中 --ds-ui-scale-sidebar 保持一致。
// 渲染时把内联宽度除以该系数,配合 CSS 的 zoom,使内容放大但布局占位不变。
const LEFT_SIDEBAR_ZOOM = 1.08

export type WorkbenchLeftSidebarProps = {
  collapsed: boolean
  width: number
  route: string
  codeThreads: CodeSidebarProps['threads']
  activeThreadId: CodeSidebarProps['activeThreadId']
  sidebarView: CodeSidebarProps['activeView']
  connectPhoneSidebarOpen: boolean
  extensionsActive: boolean
  extensionView?: RegisteredContribution<'views.leftSidebar'>
  workspaceRoot?: string
  onCloseExtensionView?: () => void
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  onThreadSearchChange: CodeSidebarProps['onThreadSearchChange']
  onSelectThread: CodeSidebarProps['onSelectThread']
  onRenameThread: CodeSidebarProps['onRenameThread']
  onPinThread: CodeSidebarProps['onPinThread']
  onArchiveThread: CodeSidebarProps['onArchiveThread']
  onDeleteThread: CodeSidebarProps['onDeleteThread']
  onRestoreThread: CodeSidebarProps['onRestoreThread']
  onNewChat: CodeSidebarProps['onNewChat']
  onNewChatInWorkspace: CodeSidebarProps['onNewChatInWorkspace']
  onNewRequirement: CodeSidebarProps['onNewRequirement']
  onOpenRequirementDraft: CodeSidebarProps['onOpenRequirementDraft']
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: CodeSidebarProps['onOpenPlugins']
  onOpenExtensions: CodeSidebarProps['onOpenExtensions']
  onToggleTheme: CodeSidebarProps['onToggleTheme']
  onToggleConnectPhone: CodeSidebarProps['onToggleConnectPhone']
  onCodeOpen: CodeSidebarProps['onCodeOpen']
  onScheduleOpen: CodeSidebarProps['onScheduleOpen']
  onWorkflowOpen: CodeSidebarProps['onWorkflowOpen']
  onNewConversation: CodeSidebarProps['onNewConversation']
  onBeginResize: PointerEventHandler<HTMLDivElement>
}

function SidebarFallback(): ReactElement {
  return <div className="h-full bg-ds-sidebar" />
}

export function WorkbenchLeftSidebar({
  collapsed,
  width,
  route,
  codeThreads,
  activeThreadId,
  sidebarView,
  connectPhoneSidebarOpen,
  extensionsActive,
  extensionView,
  workspaceRoot,
  onCloseExtensionView,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
  onThreadSearchChange,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onNewChat,
  onNewChatInWorkspace,
  onNewRequirement,
  onOpenRequirementDraft,
  onOpenSettings,
  onOpenPlugins,
  onOpenExtensions,
  onToggleTheme,
  onToggleConnectPhone,
  onCodeOpen,
  onScheduleOpen,
  onWorkflowOpen,
  onNewConversation,
  onBeginResize
}: WorkbenchLeftSidebarProps): ReactElement | null {
  if (collapsed) return null
  return (
    <>
      <div className="min-h-0 shrink-0 ds-workbench-left-sidebar" style={{ width: width / LEFT_SIDEBAR_ZOOM }}>
        {extensionView ? (
          <ExtensionViewOutlet
            contribution={extensionView}
            workspaceRoot={workspaceRoot}
            onClose={onCloseExtensionView}
          />
        ) : (
          <Sidebar
            threads={codeThreads}
            activeThreadId={activeThreadId}
            activeView={sidebarView}
            connectPhoneSidebarOpen={connectPhoneSidebarOpen}
            pluginsActive={route === 'plugins'}
            extensionsActive={extensionsActive}
            runtimeReady={runtimeReady}
            threadSearch={threadSearch}
            showArchivedThreads={showArchivedThreads}
            onThreadSearchChange={onThreadSearchChange}
            onSelectThread={onSelectThread}
            onRenameThread={onRenameThread}
            onPinThread={onPinThread}
            onArchiveThread={onArchiveThread}
            onDeleteThread={onDeleteThread}
            onRestoreThread={onRestoreThread}
            onNewChat={onNewChat}
            onNewChatInWorkspace={onNewChatInWorkspace}
            onNewRequirement={onNewRequirement}
            onOpenRequirementDraft={onOpenRequirementDraft}
            onOpenSettings={onOpenSettings}
            onOpenPlugins={onOpenPlugins}
            onOpenExtensions={onOpenExtensions}
            onToggleTheme={onToggleTheme}
            onToggleConnectPhone={onToggleConnectPhone}
            onCodeOpen={onCodeOpen}
            onScheduleOpen={onScheduleOpen}
            onWorkflowOpen={onWorkflowOpen}
            onNewConversation={onNewConversation}
          />
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
        onPointerDown={onBeginResize}
      />
    </>
  )
}
