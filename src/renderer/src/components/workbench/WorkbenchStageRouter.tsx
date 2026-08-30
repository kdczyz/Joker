import { lazy, Suspense, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { WorkbenchConversationStage, type WorkbenchConversationStageProps } from './WorkbenchConversationStage'

const PluginMarketplaceView = lazy(() =>
  import('../PluginMarketplaceView').then((module) => ({ default: module.PluginMarketplaceView }))
)
const ScheduleTasksView = lazy(() =>
  import('../schedule/ScheduleTasksView').then((module) => ({ default: module.ScheduleTasksView }))
)
const WorkflowView = lazy(() =>
  import('../workflow/WorkflowView').then((module) => ({ default: module.WorkflowView }))
)
const WorkflowRunPanel = lazy(() =>
  import('../workflow/WorkflowRunPanel').then((module) => ({ default: module.WorkflowRunPanel }))
)
const ExtensionManagementCenter = lazy(() =>
  import('../../extensions/ExtensionManagementCenter').then((module) => ({
    default: module.ExtensionManagementCenter
  }))
)
const WorkspaceFileBrowserView = lazy(() =>
  import('../WorkspaceFileBrowserView').then((module) => ({
    default: module.WorkspaceFileBrowserView
  }))
)
const WorkbenchDesignStage = lazy(() =>
  import('./WorkbenchDesignStage').then((module) => ({
    default: module.WorkbenchDesignStage
  }))
)

export type WorkbenchStageRouterProps = {
  route: string
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenThread: (threadId: string) => void
  conversation: WorkbenchConversationStageProps
  imageAnnotationHost: ReactNode
  planOverlay: ReactNode
  extensions: {
    workspaceRoot: string
    onOpenIntegrations: () => void
    onOpenView: (contributionId: string) => Promise<void>
  }
  fileBrowser?: {
    workspaceRoot: string
    designWorkspaceRoot?: string
    onClose: () => void
  }
  design?: {
    busy?: boolean
    onOpenAgentSettings?: () => void
    onImplementDesign?: (artifact: import('../../design/design-types').DesignArtifact) => void
    onScreenCreated?: (shapeId: string, userPrompt: string, brief?: string) => void
    onSvgCreated?: (
      artifactId: string,
      shapeId: string,
      userPrompt: string,
      brief: string
    ) => boolean | Promise<boolean>
    onUseElementAsContext?: (context: import('../../design/design-composer-context').DesignHtmlElementContext | null, promptSeed?: string) => void
    onRuntimeQualityFindings?: (payload: import('../../design/design-html-quality').DesignRuntimeQualityPayload) => void
    onRequestQualityRepair?: (payload: import('../../design/design-html-quality').DesignRuntimeQualityPayload) => void
    rightPanel?: ReactNode
  }
}

function WorkbenchPaneFallback(): ReactElement {
  return <div className="h-full min-h-0 w-full bg-ds-main" aria-hidden />
}

export function WorkbenchStageRouter({
  route,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenThread,
  conversation,
  imageAnnotationHost,
  planOverlay,
  extensions,
  fileBrowser,
  design
}: WorkbenchStageRouterProps): ReactElement {
  return (
    <main
      className={`ds-drag ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
        route === 'plugins' ? 'px-0' : ''
      }`}
    >
      <div className="ds-stage-route-host relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {route === 'fileBrowser' && fileBrowser ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <WorkspaceFileBrowserView
              workspaceRoot={fileBrowser.workspaceRoot}
              designWorkspaceRoot={fileBrowser.designWorkspaceRoot}
              onClose={fileBrowser.onClose}
            />
          </Suspense>
        ) : route === 'extensions' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <ExtensionManagementCenter
              key={extensions.workspaceRoot || '__global__'}
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
              workspaceRoot={extensions.workspaceRoot}
              onOpenIntegrations={extensions.onOpenIntegrations}
              onOpenView={extensions.onOpenView}
            />
          </Suspense>
        ) : route === 'plugins' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <PluginMarketplaceView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
            />
          </Suspense>
        ) : route === 'schedule' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <ScheduleTasksView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
              onOpenThread={onOpenThread}
            />
          </Suspense>
        ) : route === 'workflow' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <WorkflowView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
              onOpenThread={onOpenThread}
            />
          </Suspense>
        ) : route === 'design' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <WorkbenchDesignStage
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
              busy={design?.busy}
              onOpenAgentSettings={design?.onOpenAgentSettings}
              onImplementDesign={design?.onImplementDesign}
              onScreenCreated={design?.onScreenCreated}
              onSvgCreated={design?.onSvgCreated}
              onUseElementAsContext={design?.onUseElementAsContext}
              onRuntimeQualityFindings={design?.onRuntimeQualityFindings}
              onRequestQualityRepair={design?.onRequestQualityRepair}
              rightPanel={design?.rightPanel}
            />
          </Suspense>
        ) : (
          <WorkbenchConversationStage {...conversation} />
        )}
      </div>
      {imageAnnotationHost}
      {planOverlay}
      {route === 'chat' ? (
        <Suspense fallback={null}>
          <WorkflowRunPanel enabled />
        </Suspense>
      ) : null}
    </main>
  )
}
