import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { FloatingComposer } from '../chat/FloatingComposer'
import { DesignWorkspaceView } from '../design/DesignWorkspaceView'

type DesignWorkspaceViewProps = ComponentProps<typeof DesignWorkspaceView>
type FloatingComposerProps = ComponentProps<typeof FloatingComposer>

type WorkbenchDesignStageProps = Pick<
  DesignWorkspaceViewProps,
  | 'leftSidebarCollapsed'
  | 'onToggleLeftSidebar'
  | 'busy'
  | 'onOpenAgentSettings'
  | 'onImplementDesign'
  | 'onScreenCreated'
  | 'onSvgCreated'
  | 'onUseElementAsContext'
  | 'onRuntimeQualityFindings'
  | 'onRequestQualityRepair'
> & {
  rightPanel: ReactNode
  composerProps: FloatingComposerProps
}

export function WorkbenchDesignStage({
  rightPanel,
  composerProps,
  ...workspaceProps
}: WorkbenchDesignStageProps): ReactElement {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <DesignWorkspaceView {...workspaceProps} />
        {rightPanel}
      </div>
      <div className="ds-composer-dock ds-no-drag relative flex shrink-0 justify-center px-2 pb-1 pt-0 sm:px-4 md:px-6 lg:px-8">
        <div className="flex w-full min-w-0 flex-col items-center gap-1">
          <FloatingComposer variant="compact" {...composerProps} />
        </div>
      </div>
    </div>
  )
}
