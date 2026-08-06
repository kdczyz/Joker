import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { LogOut, ShieldCheck, User } from 'lucide-react'
import { useAuth } from '../auth/AuthGate'

export function ProfileSettingsSection(): ReactElement {
  const { t } = useTranslation('settings')
  const auth = useAuth()
  const user = auth.user

  return (
    <div className="space-y-6">
      <h2 className="text-[15px] font-semibold text-ds-ink">{t('profile')}</h2>

      <div className="rounded-2xl border border-ds-border bg-ds-card p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8470ed] to-[#5aa7dc] text-lg font-bold text-white shadow-[0_3px_10px_rgba(111,93,221,0.3)]">
            {user.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold text-ds-ink">{user.displayName}</div>
            <div className="truncate text-[13px] text-ds-muted">
              {user.isGuest ? t('guestAccount') : user.email}
            </div>
            <div className="mt-1 text-[11px] text-ds-faint">
              @{user.username}
              {user.isGuest ? ` · ${t('guestDescription')}` : ` · ${t('cloudAccount')}`}
            </div>
          </div>
        </div>
      </div>

      {user.isGuest ? (
        <div className="rounded-2xl border border-ds-border bg-ds-card p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ds-muted" strokeWidth={1.75} />
            <div>
              <div className="text-[14px] font-medium text-ds-ink">{t('guestModeTitle')}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ds-muted">
                {t('guestModeDescription')}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-ds-border bg-ds-card p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" strokeWidth={1.75} />
            <div>
              <div className="text-[14px] font-medium text-ds-ink">{t('cloudAccountTitle')}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ds-muted">
                {t('cloudAccountDescription')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-ds-border bg-ds-card p-5">
        <button
          type="button"
          onClick={() => void auth.logout()}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t('logout')}
        </button>
      </div>
    </div>
  )
}