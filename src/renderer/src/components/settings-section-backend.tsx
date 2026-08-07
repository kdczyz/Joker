import { useBackendStore } from '../store/backend-store'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'
import { useState, useEffect } from 'react'

export function BackendSettingsSection() {
  const {
    backend,
    grokConnected,
    grokStatus,
    grokModel,
    grokProviderId,
    setBackend,
    connectGrok,
    disconnectGrok
  } = useBackendStore()

  const [cwd, setCwd] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [providerName, setProviderName] = useState('')

  const isGrok = backend === 'grok-build'

  // Resolve provider display name from settings
  useEffect(() => {
    if (!isGrok) return
    window.RcodeGui.getSettings().then(settings => {
      const pid = settings.agents?.Rcode?.providerId || settings.provider?.providers?.[0]?.id || ''
      const provider = settings.provider?.providers?.find(p => p.id === pid)
      setProviderName(provider?.name ?? pid)
    }).catch(() => {})
  }, [isGrok, grokProviderId])

  const handleToggle = () => {
    if (isGrok) {
      disconnectGrok()
      setBackend('Rcode')
    } else {
      setBackend('grok-build')
    }
  }

  const handleConnect = async () => {
    setConnecting(true)
    try {
      await connectGrok(cwd || '')
    } finally {
      setConnecting(false)
    }
  }

  // Navigate to model provider settings
  const handleGoToProviderSettings = () => {
    // Use history.pushState to trigger the settings category change
    const url = new URL(window.location.href)
    url.searchParams.set('settingsSection', 'providers')
    window.history.pushState({}, '', url.toString())
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <SettingsCard title="后端运行时">
      <SettingRow
        label="使用 Grok Build 作为后端"
        description="切换后将使用 grok-build 作为 AI agent 运行时。模型和 API Key 沿用「模型供应商」设置中的配置，支持所有兼容 OpenAI API 的供应商。"
      >
        <Toggle
          checked={isGrok}
          onChange={handleToggle}
        />
      </SettingRow>

      {isGrok && (
        <>
          <SettingRow
            label="当前模型供应商"
            description={grokConnected
              ? `正在使用: ${providerName || grokProviderId || '默认'} / ${grokModel || '默认模型'}`
              : '连接后将使用模型供应商设置中的当前选中模型'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--ds-text-secondary)' }}>
                {providerName || grokProviderId || '默认'} / {grokModel || '默认模型'}
              </span>
              <button
                onClick={handleGoToProviderSettings}
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--ds-border)',
                  background: 'var(--ds-bg-secondary)',
                  color: 'var(--ds-text-primary)',
                  cursor: 'pointer'
                }}
              >
                更改
              </button>
            </div>
          </SettingRow>

          <SettingRow
            label="连接状态"
            description={grokConnected ? '已连接到 grok-build 运行时' : '未连接'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: grokConnected ? '#22c55e' : '#ef4444'
              }} />
              <span style={{ fontSize: '13px', color: 'var(--ds-text-secondary)' }}>
                {grokStatus || (grokConnected ? '已连接' : '未连接')}
              </span>
              <button
                onClick={handleConnect}
                disabled={connecting}
                style={{
                  marginLeft: '4px',
                  padding: '4px 12px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--ds-border)',
                  background: 'var(--ds-bg-secondary)',
                  color: 'var(--ds-text-primary)',
                  cursor: connecting ? 'not-allowed' : 'pointer'
                }}
              >
                {connecting ? '连接中...' : grokConnected ? '重新连接' : '连接'}
              </button>
            </div>
          </SettingRow>
        </>
      )}
    </SettingsCard>
  )
}