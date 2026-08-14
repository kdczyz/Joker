import type { ReactElement } from 'react'
import { Code2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  activeView: 'chat' | 'claw' | 'schedule' | 'workflow' | 'subagents'
  onCodeOpen: () => void
}

export function WorkspaceModeTabs({
  activeView,
  onCodeOpen
}: Props): ReactElement {
  const { t } = useTranslation('common')

  return (
    <div
      role="tablist"
      aria-label={t('code')}
      className="workspace-mode-tabs mb-1.5 flex flex-row gap-1 rounded-[8px] bg-[color-mix(in_srgb,var(--ds-sidebar-field-bg)_72%,transparent)] p-0.5 shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] dark:bg-white/[0.045] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
    >
      <button
        type="button"
        data-workspace-mode="chat"
        data-cursor-spotlight-target
        role="tab"
        aria-selected={activeView === 'chat'}
        onClick={onCodeOpen}
        className="workspace-mode-tab group inline-flex min-h-[28px] flex-1 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 py-0.5 text-[13px] outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-black/10 dark:focus-visible:ring-white/20 bg-white font-medium text-[#1f2733] shadow-[0_1px_2px_rgba(20,47,95,0.12),0_2px_5px_rgba(20,47,95,0.06)] dark:bg-white/[0.12] dark:text-white dark:shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
        title={t('code')}
      >
        <Code2 className="h-[15px] w-[15px] shrink-0 text-[#1f2733] dark:text-white" strokeWidth={1.9} />
        <span className="workspace-mode-tab-label whitespace-nowrap">{t('code')}</span>
      </button>
    </div>
  )
}
