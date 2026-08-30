import { type ComponentProps, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock, RuntimeConnectionStatus } from '../../agent/types'
import { FloatingComposer } from '../chat/FloatingComposer'
import { FloatingComposerTodoProgress } from '../chat/FloatingComposerTodoProgress'
import { LazyMessageTimeline } from '../chat/LazyMessageTimeline'
import { SubagentReturnBar } from '../chat/message-timeline-empty'
import { WorkbenchCornerActions } from '../chat/WorkbenchTopBar'
import { ActiveUiPluginStagePresentation } from '../chat/UiPluginStagePresentation'
import { DevPreviewLaunchCard } from '../DevPreviewLaunchCard'
import { SessionHeader } from '../SessionHeader'
import { useChatStore } from '../../store/chat-store'
import type { JsonValue } from '@joker-code/extension-api'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import { DeclarativeActionBar } from '../../extensions/ControlledContributionSurfaces'

type FloatingComposerProps = ComponentProps<typeof FloatingComposer>

export type WorkbenchChatStageProps = {
  stageInsetClass: string
  leftSidebarCollapsed: boolean
  busy: boolean
  uiModeCameosEnabled: boolean
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  activeThreadId: string | null
  runtimeConnection: RuntimeConnectionStatus
  runtimeError?: string | null
  planActionsBusy: boolean
  devPreviewVisible: boolean
  devPreviewUrl: string | null
  devPreviewOpened: boolean
  returnParentTitle: string
  showReturnBar: boolean
  composerProps: FloatingComposerProps
  terminalTabActive: boolean
  rightWorkspaceExpanded: boolean
  onToggleLeftSidebar: () => void
  onRetryConnection: () => void
  onOpenSettings: () => void
  onSelectSuggestion: (text: string) => void
  onBuildPlan: () => void
  onOpenPlan: () => void
  onOpenDevPreview: () => void
  onBackToParent: () => void
  onToggleTerminal: () => void
  onToggleRightWorkspace: () => void
  extensionTopBarActions?: readonly RegisteredContribution<'actions.topBar'>[]
  extensionComposerActions?: readonly RegisteredContribution<'actions.composer'>[]
  extensionMessageActions?: readonly RegisteredContribution<'actions.message'>[]
  extensionContextMenus?: readonly RegisteredContribution<'contextMenus'>[]
  extensionAttachmentContextMenus?: readonly RegisteredContribution<'contextMenus'>[]
  extensionCommands?: readonly RegisteredContribution<'commands'>[]
  extensionResultPreviews?: readonly RegisteredContribution<'message.resultPreviews'>[]
  onExtensionCommand?: (commandId: string, context: JsonValue) => void | Promise<unknown>
}

function WorkbenchPaneFallback(): ReactElement {
  return <div className="h-full min-h-0 w-full bg-ds-main" aria-hidden />
}

export function WorkbenchChatStage({
  stageInsetClass,
  leftSidebarCollapsed,
  busy,
  uiModeCameosEnabled,
  blocks,
  liveReasoning,
  liveAssistant,
  activeThreadId,
  runtimeConnection,
  runtimeError,
  planActionsBusy,
  devPreviewVisible,
  devPreviewUrl,
  devPreviewOpened,
  returnParentTitle,
  showReturnBar,
  composerProps,
  terminalTabActive,
  rightWorkspaceExpanded,
  onRetryConnection,
  onOpenSettings,
  onSelectSuggestion,
  onBuildPlan,
  onOpenPlan,
  onOpenDevPreview,
  onBackToParent,
  onToggleTerminal,
  onToggleRightWorkspace,
  extensionTopBarActions = [],
  extensionComposerActions = [],
  extensionMessageActions = [],
  extensionContextMenus = [],
  extensionAttachmentContextMenus = [],
  extensionCommands = [],
  extensionResultPreviews = [],
  onExtensionCommand
}: WorkbenchChatStageProps): ReactElement {
  const { t } = useTranslation('common')
  const activeThreadTodos = useChatStore((s) => s.activeThreadTodos)
  const showTodoProgress =
    Boolean(activeThreadId)
    && activeThreadTodos?.threadId === activeThreadId
    && activeThreadTodos.items.length > 0
  return (
    <section
      className="ds-chat-stage ds-drag relative isolate flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ActiveUiPluginStagePresentation />
      {/* 右上角固定按钮群:悬浮在窗口右上角(含右侧工作区上方),不随布局移动 */}
      <WorkbenchCornerActions
        terminalActive={terminalTabActive}
        onToggleTerminal={onToggleTerminal}
        rightWorkspaceExpanded={rightWorkspaceExpanded}
        onToggleRightWorkspace={onToggleRightWorkspace}
      />
      {showTodoProgress ? (
        <div className="pointer-events-auto absolute right-4 top-14 z-50">
          <FloatingComposerTodoProgress todos={activeThreadTodos} />
        </div>
      ) : null}
      <div
        className={`${stageInsetClass} ds-ui-plugin-stage-content relative z-[3] flex min-h-0 min-w-0 flex-1 flex-col`}
      >
        <header className="chat-topbar ds-chat-topbar-floating ds-topbar-surface absolute inset-x-0 top-0 z-20 flex w-full shrink-0 items-stretch overflow-visible">
          <div className="chat-topbar-grid grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`chat-topbar-session flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
              }`}
            >
              <SessionHeader compact className="min-w-0 flex-1" />
            </div>
            <div className="chat-topbar-actions flex min-w-0 flex-wrap items-center justify-end gap-2 self-center">
              {extensionTopBarActions.length && onExtensionCommand ? (
                <DeclarativeActionBar
                  contributions={extensionTopBarActions}
                  context={{ surface: 'topBar', threadId: activeThreadId }}
                  onCommand={onExtensionCommand}
                  compact
                />
              ) : null}
              {busy ? (
                <span className="inline-flex shrink-0 rounded-full bg-amber-500/16 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 dark:text-amber-100">
                  {t('running')}
                </span>
              ) : null}
            </div>
          </div>
        </header>
        <div className="ds-chat-topbar-float-gap relative flex min-h-0 min-w-0 flex-1 flex-col">
          <LazyMessageTimeline
            fallback={<WorkbenchPaneFallback />}
            blocks={blocks}
            liveReasoning={liveReasoning}
            live={liveAssistant}
            activeThreadId={activeThreadId}
            runtimeConnection={runtimeConnection}
            runtimeError={runtimeError}
            onRetryConnection={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={onSelectSuggestion}
            planActionsBusy={planActionsBusy}
            onBuildPlan={onBuildPlan}
            onOpenPlan={onOpenPlan}
            onComponentPrototypePrompt={composerProps.setInput}
            devPreviewCard={
              devPreviewVisible && devPreviewUrl ? (
                <DevPreviewLaunchCard
                  url={devPreviewUrl}
                  opened={devPreviewOpened}
                  onOpen={onOpenDevPreview}
                />
              ) : null
            }
            extensionMessageActions={extensionMessageActions}
            extensionContextMenus={extensionContextMenus}
            extensionAttachmentContextMenus={extensionAttachmentContextMenus}
            extensionCommands={extensionCommands}
            extensionResultPreviews={extensionResultPreviews}
            onExtensionCommand={onExtensionCommand}
          />
        </div>
        <div className="ds-composer-dock ds-no-drag relative flex shrink-0 justify-center px-2 pb-1 pt-0 sm:px-4 md:px-6 lg:px-8">
          {showReturnBar ? (
            <SubagentReturnBar
              parentTitle={returnParentTitle}
              onBack={onBackToParent}
            />
          ) : (
            <div className="flex w-full min-w-0 flex-col items-center gap-1">
              {extensionComposerActions.length && onExtensionCommand ? (
                <DeclarativeActionBar
                  contributions={extensionComposerActions}
                  context={{ surface: 'composer', threadId: activeThreadId }}
                  onCommand={onExtensionCommand}
                />
              ) : null}
              <FloatingComposer {...composerProps} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
