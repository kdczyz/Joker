import type { PointerEventHandler, ReactElement } from 'react'
import { WorkbenchRightPanel, type WorkbenchRightPanelProps } from './WorkbenchRightPanel'
import type { WorkbenchRightPanelSharedProps } from './useWorkbenchRightPanelSharedProps'

type SharedKey = keyof WorkbenchRightPanelSharedProps

export type WorkbenchRightPanelHostProps = Pick<
  WorkbenchRightPanelProps,
  | 'visible'
  | 'width'
  | 'route'
  | 'rightPanelMode'
  | 'changes'
  | 'todo'
  | 'browser'
  | 'planPanel'
  | 'canvas'
  | 'file'
  | 'mcpSkills'
  | 'extensionView'
  | 'code'
  | 'workspaceRoot'
  | 'onCollapse'
> & {
  onBeginResize: PointerEventHandler<HTMLDivElement>
  design: {
    panelMode: WorkbenchRightPanelProps['design']['panelMode']
    shared: WorkbenchRightPanelSharedProps
    implement: WorkbenchRightPanelProps['design']['implement']
    assistant: WorkbenchRightPanelProps['design']['assistant']
  }
  sdd: Omit<WorkbenchRightPanelProps['sdd'], SharedKey>
}

export function WorkbenchRightPanelHost({
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
  mcpSkills,
  extensionView,
  code,
  workspaceRoot,
  onCollapse
}: WorkbenchRightPanelHostProps): ReactElement | null {
  return (
    <WorkbenchRightPanel
      visible={visible}
      width={width}
      route={route}
      rightPanelMode={rightPanelMode}
      onBeginResize={onBeginResize}
      design={design}
      sdd={{ ...design.shared, ...sdd }}
      changes={changes}
      todo={todo}
      browser={browser}
      planPanel={planPanel}
      canvas={canvas}
      file={file}
      mcpSkills={mcpSkills}
      extensionView={extensionView}
      code={code}
      workspaceRoot={workspaceRoot}
      onCollapse={onCollapse}
    />
  )
}
