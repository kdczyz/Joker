import type { ReactElement } from 'react'
import { Code2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  activeView: 'chat' | 'claw' | 'schedule' | 'workflow' | 'subagents' | 'design'
  onCodeOpen: () => void
  onWriteOpen?: () => void
  onDesignOpen?: () => void
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
      className="workspace-mode-tabs mb-1 flex flex-row gap-1 rounded-[10px] border border-black/[0.06] bg-black/[0.03] p-[3px] dark:border-white/[0.08] dark:bg-white/[0.04]"
    >
      <button
        type="button"
        data-workspace-mode="chat"
        data-cursor-spotlight-target
        role="tab"
        aria-selected={activeView === 'chat'}
        onClick={onCodeOpen}
        className="workspace-mode-tab group inline-flex min-h-[28px] flex-1 min-w-0 items-center justify-center gap-1.5 rounded-[7px] bg-white px-2.5 py-1 text-[12.5px] font-medium text-[#18181b] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)] outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-black/10 dark:bg-white/[0.12] dark:text-white dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] dark:focus-visible:ring-white/20"
        title={t('code')}
      >
        <Code2 className="h-[14px] w-[14px] shrink-0 text-[#18181b] transition group-hover:scale-105 dark:text-white" strokeWidth={2} />
        <span className="workspace-mode-tab-label whitespace-nowrap">{t('code')}</span>
      </button>
    </div>
  )
}
