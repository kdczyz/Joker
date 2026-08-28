import type { ComponentProps, ReactElement } from 'react'
import type { SettingsRouteSection } from '../../store/chat-store'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { WorkbenchPlanPanel, type WorkbenchPlanPanelProps } from './WorkbenchPlanPanelHost'
import { WorkbenchRightPanelHost } from './WorkbenchRightPanelHost'

type RightPanelHostProps = ComponentProps<typeof WorkbenchRightPanelHost>
type DesignImplementProps = RightPanelHostProps['design']['implement']
type DesignAssistantProps = RightPanelHostProps['design']['assistant']
type SddAssistantProps = RightPanelHostProps['sdd']
type BrowserPanelProps = RightPanelHostProps['browser']
type FilePanelProps = RightPanelHostProps['file']
type CanvasPanelProps = RightPanelHostProps['canvas']

type ComposerModelProps<T extends {
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  setComposerModel: (modelId: string, providerId?: string) => void
}> = Pick<T, 'composerModel' | 'composerProviderId' | 'composerPickList' | 'setComposerModel'>

type WorkbenchRightPanelDesignOptions = {
  implementOpen: boolean
  assistantOpen: boolean
  implementTitle: DesignImplementProps['title']
  implementationWorkspaceRoot: DesignImplementProps['workspaceRoot']
  implementationComposer: ComposerModelProps<DesignImplementProps>
  assistantComposer: ComposerModelProps<DesignAssistantProps>
  contextChips: DesignAssistantProps['contextChips']
  input: string
  onRemoveContextChip: DesignAssistantProps['onRemoveContextChip']
  onSendPrompt: (prompt: string) => void
  createThread: (workspaceRoot?: string, docId?: string) => Promise<string | null>
  threads: DesignAssistantProps['designThreads']
  onSwitchThread: DesignAssistantProps['onSwitchThread']
  fallbackWorkspaceRoot: string
}

const EMPTY_DESIGN_PANEL: WorkbenchRightPanelDesignOptions = {
  implementOpen: false,
  assistantOpen: false,
  implementTitle: '',
  implementationWorkspaceRoot: '',
  implementationComposer: { composerModel: '', composerProviderId: undefined, composerPickList: [], setComposerModel: () => {} },
  assistantComposer: { composerModel: '', composerProviderId: undefined, composerPickList: [], setComposerModel: () => {} },
  contextChips: [],
  input: '',
  onRemoveContextChip: () => {},
  onSendPrompt: () => {},
  createThread: async () => null,
  threads: [],
  onSwitchThread: () => {},
  fallbackWorkspaceRoot: ''
}

type WorkbenchRightPanelElementOptions = Pick<
  RightPanelHostProps,
  'visible' | 'width' | 'route' | 'rightPanelMode' | 'onBeginResize'
> & {
  shared: RightPanelHostProps['design']['shared']
  planPanelProps: WorkbenchPlanPanelProps
  onCollapse: () => void
  openSettings: (section?: SettingsRouteSection) => void
  onSend: () => void
  design?: WorkbenchRightPanelDesignOptions
  sdd: Pick<
    SddAssistantProps,
    | 'draft'
    | 'composerModel'
    | 'composerProviderId'
    | 'composerPickList'
    | 'setComposerModel'
    | 'onApplyFramework'
    | 'onNewConversation'
  >
  changes: Record<string, never>
  todo: {
    onOpenPlan: RightPanelHostProps['todo']['onOpenPlan']
  }
  browser: Pick<BrowserPanelProps, 'blocks' | 'preferredUrl'>
  canvas: Pick<CanvasPanelProps, 'workspaceRoot' | 'activeThreadId'>
  file: Pick<
    FilePanelProps,
    | 'target'
    | 'openTargets'
    | 'workspaceRoot'
    | 'onSelectTarget'
    | 'onCloseTarget'
    | 'pinnedTargetKeys'
    | 'preserveAcrossThreads'
    | 'onTogglePinnedTarget'
    | 'onCloseOtherTargets'
    | 'onTogglePreserveAcrossThreads'
  >
  extensionView?: RightPanelHostProps['extensionView']
  code?: RightPanelHostProps['code']
  workspaceRoot?: string
}

function resolveDesignPanelMode({
  route,
  implementOpen,
  assistantOpen
}: {
  route: string
  implementOpen: boolean
  assistantOpen: boolean
}): RightPanelHostProps['design']['panelMode'] {
  if (route !== 'design') return 'hidden'
  if (implementOpen) return 'implement'
  if (assistantOpen) return 'assistant'
  return 'hidden'
}

export function useWorkbenchRightPanelElement({
  visible,
  width,
  route,
  rightPanelMode,
  onBeginResize,
  shared,
  planPanelProps,
  onCollapse,
  openSettings,
  onSend,
  design,
  sdd,
  changes,
  todo,
  browser,
  canvas,
  file,
  extensionView,
  code,
  workspaceRoot
}: WorkbenchRightPanelElementOptions): ReactElement | null {
  const designValue = design ?? EMPTY_DESIGN_PANEL
  const designPanelMode = resolveDesignPanelMode({
    route,
    implementOpen: designValue.implementOpen,
    assistantOpen: designValue.assistantOpen
  })

  return (
    <WorkbenchRightPanelHost
      visible={visible}
      width={width}
      route={route}
      rightPanelMode={rightPanelMode}
      onBeginResize={onBeginResize}
      design={{
        panelMode: designPanelMode,
        shared,
        implement: {
          title: designValue.implementTitle,
          workspaceRoot: designValue.implementationWorkspaceRoot,
          ...designValue.implementationComposer,
          onSend,
          onOpenSettings: () => openSettings('agents'),
          onClose: onCollapse
        },
        assistant: {
          ...designValue.assistantComposer,
          contextChips: designValue.contextChips,
          onRemoveContextChip: designValue.onRemoveContextChip,
          onSend: () => designValue.onSendPrompt(designValue.input),
          onOpenSettings: (section) => openSettings((section ?? 'general') as SettingsRouteSection),
          onNewConversation: () => {
            const designStore = useDesignWorkspaceStore.getState()
            const root = designStore.workspaceRoot || designValue.fallbackWorkspaceRoot
            if (root) void designValue.createThread(root, designStore.ensureActiveDocument())
          },
          designThreads: designValue.threads,
          onSwitchThread: (id) => void designValue.onSwitchThread(id),
          onCollapse
        }
      }}
      sdd={{
        ...sdd,
        onSend,
        onOpenSettings: () => openSettings('agents'),
        onCollapse
      }}
      changes={{ onCollapse }}
      todo={{ onCollapse, onOpenPlan: todo.onOpenPlan }}
      browser={{
        blocks: browser.blocks,
        preferredUrl: browser.preferredUrl,
        onCollapse
      }}
      planPanel={<WorkbenchPlanPanel {...planPanelProps} />}
      canvas={{
        workspaceRoot: canvas.workspaceRoot,
        activeThreadId: canvas.activeThreadId,
        onCollapse
      }}
      file={{
        ...file,
        onClose: onCollapse
      }}
      mcpSkills={{
        onOpenSettings: () => openSettings('agents')
      }}
      extensionView={extensionView}
      code={code}
      workspaceRoot={workspaceRoot}
      onCollapse={onCollapse}
    />
  )
}
