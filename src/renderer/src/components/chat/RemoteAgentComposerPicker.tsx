import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Smartphone } from 'lucide-react'
import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type SandboxMode
} from '@shared/app-settings'
import { FloatingComposerExecutionPicker } from './FloatingComposerExecutionPicker'

type AgentState = 'offline' | 'connecting' | 'online' | 'waiting'

type Props = {
  disabled?: boolean
}

export function RemoteAgentComposerPicker({ disabled = false }: Props): ReactElement | null {
  const [agentState, setAgentState] = useState<AgentState>('offline')
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(DEFAULT_APPROVAL_POLICY)
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>(DEFAULT_SANDBOX_MODE)

  // Load remote-agent permission on mount (falls back to global agent policy)
  useEffect(() => {
    if (typeof window.JokerGui?.getSettings !== 'function') return
    void window.JokerGui.getSettings().then((settings) => {
      setApprovalPolicy(
        settings.remoteAgent?.approvalPolicy ?? settings.agents.Joker.approvalPolicy
      )
      setSandboxMode(
        settings.remoteAgent?.sandboxMode ?? settings.agents.Joker.sandboxMode
      )
    })
  }, [])

  // Subscribe to remote agent status
  useEffect(() => {
    if (typeof window.JokerGui?.remoteAgent?.getStatus !== 'function') return
    void window.JokerGui.remoteAgent.getStatus().then((s) => {
      setAgentState(s.state as AgentState)
    })
    const unsub = window.JokerGui.remoteAgent.onStatus((payload) => {
      setAgentState(payload.state as AgentState)
    })
    return unsub
  }, [])

  const handleChange = useCallback(
    (patch: { approvalPolicy?: ApprovalPolicy; sandboxMode?: SandboxMode }) => {
      const nextApproval = patch.approvalPolicy ?? approvalPolicy
      const nextSandbox = patch.sandboxMode ?? sandboxMode
      if (patch.approvalPolicy) setApprovalPolicy(patch.approvalPolicy)
      if (patch.sandboxMode) setSandboxMode(patch.sandboxMode)
      void window.JokerGui?.saveSettingsSilent?.({
        remoteAgent: {
          approvalPolicy: nextApproval,
          sandboxMode: nextSandbox
        }
      })
    },
    [approvalPolicy, sandboxMode]
  )

  const isOnline = agentState === 'online'

  return (
    <span className="ds-no-drag inline-flex shrink-0 items-center gap-1">
      {isOnline ? (
        <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-600">
          <Smartphone className="h-3 w-3" strokeWidth={2} />
        </span>
      ) : null}
      <FloatingComposerExecutionPicker
        value={{ approvalPolicy, sandboxMode }}
        disabled={disabled}
        onChange={handleChange}
      />
    </span>
  )
}