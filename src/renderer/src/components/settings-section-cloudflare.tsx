import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Cloud, Loader2, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { InlineNoticeView, SettingsCard, SettingRow } from './settings-controls'
import type { CloudflareStatusResult } from '@shared/Joker-gui-api'

const inputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

export function CloudflareSettingsSection(): ReactElement {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<CloudflareStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientIdLoaded, setClientIdLoaded] = useState(false)

  const loadAccount = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const s = await window.JokerGui.cloudflareStatus()
      setStatus(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccount()
  }, [loadAccount])

  useEffect(() => {
    if (clientIdLoaded) return
    void window.JokerGui
      .cloudflareGetClientId()
      .then(({ clientId: saved }) => {
        if (saved) setClientId(saved)
      })
      .catch(() => undefined)
      .finally(() => setClientIdLoaded(true))
  }, [clientIdLoaded])

  const connect = async (): Promise<void> => {
    setConnecting(true)
    setError('')
    try {
      const result = await window.JokerGui.cloudflareOAuthConnect({
        clientId: clientId.trim() || undefined
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setClientIdLoaded(false)
      await loadAccount()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    setError('')
    try {
      await window.JokerGui.cloudflareOAuthDisconnect()
      await loadAccount()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return (
      <SettingsCard title={t('cloudflare')}>
        <div className="flex items-center gap-2 text-[12px] text-ds-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('loading')}
        </div>
      </SettingsCard>
    )
  }

  const user = status?.user ?? null

  return (
    <SettingsCard title={t('cloudflare')}>
      <SettingRow
        title={t('cloudflareDesc')}
        description={t('cloudflareLoginDesc')}
        wideControl
        control={
          <div className="grid gap-3">
            {!status?.connected ? (
              <button
                type="button"
                disabled={connecting}
                onClick={() => void connect()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#f6821f] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[#e6781a] disabled:opacity-60"
              >
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                {connecting ? t('cloudflareConnecting') : t('cloudflareLogin')}
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {user?.picture ? <img src={user.picture} alt={user?.email ?? 'Cloudflare'} className="h-9 w-9 rounded-full" /> : null}
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold text-ds-ink">
                    {user?.name || user?.preferredUsername || user?.email || user?.sub}
                  </div>
                  <div className="truncate text-[12px] text-ds-faint">
                    {user?.email ? user.email : user ? `${t('cloudflareConnectedAs')} ${user.sub}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {t('cloudflareDisconnect')}
                </button>
              </div>
            )}

            {error ? <InlineNoticeView notice={{ tone: 'error', message: error }} /> : null}
          </div>
        }
      />

      <SettingRow
        title={t('cloudflareClientId')}
        description={t('cloudflareClientIdDesc')}
        wideControl
        control={
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputClass} flex-1`}
                placeholder="OAuth Client ID"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void connect()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#f6821f] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#e6781a]"
              >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t('cloudflareLogin')}
              </button>
            </div>
            <div className="rounded-xl border border-ds-border bg-ds-main/50 px-3 py-2.5 text-[12px] leading-5 text-ds-muted">
              {t('cloudflareRedirectHint')}
              <code className="ml-1 select-all rounded-md bg-ds-subtle px-1.5 py-0.5 font-mono text-[11.5px] text-ds-ink">
                http://127.0.0.1:41824/cloudflare-oauth/callback
              </code>
            </div>
          </div>
        }
      />
    </SettingsCard>
  )
}
