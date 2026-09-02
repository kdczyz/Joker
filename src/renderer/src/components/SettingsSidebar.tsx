import type { Dispatch, ReactElement, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Bot,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Github,
  Globe,
  Keyboard,
  Layers,
  Moon,
  Puzzle,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Sun,
  User,
  UsersRound,
  PackageOpen,
  Smartphone,
  Wifi
} from 'lucide-react'
import { useAuth } from '../auth/AuthGate'
import { SidebarIconButton } from './sidebar/SidebarPrimitives'

type SettingsCategory = 'profile' | 'general' | 'providers' | 'speechToText' | 'agents' | 'subagents' | 'archives' | 'permissions' | 'worktree' | 'memory' | 'shortcuts' | 'updates' | 'extensions' | 'dataMigration' | 'webSearch' | 'github' | 'claw' | 'remote'

export function SettingsSidebar({
  category,
  goBack,
  goToChat,
  setCategory,
  extensionSettingsAvailable = false,
  onToggleTheme,
  onOpenClaw,
  t
}: {
  category: SettingsCategory
  goBack: () => void
  goToChat: () => void
  setCategory: Dispatch<SetStateAction<SettingsCategory>>
  extensionSettingsAvailable?: boolean
  onToggleTheme: () => void
  onOpenClaw: () => void
  t: (key: string) => string
}): ReactElement {
  const { t: tCommon } = useTranslation('common')
  const auth = useAuth()
  const accountDisplayName = auth.user.displayName
  const accountInitials = auth.user.displayName.slice(0, 2).toUpperCase()
  const accountIsGuest = Boolean(auth.user.isGuest)
  const catCls = (c: SettingsCategory): string =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium transition ${
      category === c
        ? 'bg-ds-subtle text-ds-ink shadow-sm ring-1 ring-ds-border-muted'
        : 'text-ds-muted hover:bg-ds-hover'
    }`

  return (
    <aside className="ds-settings-sidebar ds-drag flex h-full min-h-0 w-[248px] shrink-0 flex-col border-r border-ds-border bg-ds-sidebar backdrop-blur-md">
      <div className="shrink-0 px-3 pb-3 pt-3">
        <div aria-hidden className="ds-titlebar-safe-block" />
        <button
          type="button"
          data-cursor-spotlight-target
          onClick={goToChat}
          className="ds-no-drag flex items-center gap-2 rounded-xl px-2 py-2 text-[14px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          {t('back')}
        </button>
      </div>
      <nav className="ds-no-drag flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pb-2">
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('general')}
          onClick={() => setCategory('general')}
        >
          <Globe className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('general')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('webSearch')}
          onClick={() => setCategory('webSearch')}
        >
          <Search className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('webSearch')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('github')}
          onClick={() => setCategory('github')}
        >
          <Github className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('github')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('claw')}
          onClick={() => setCategory('claw')}
        >
          <Smartphone className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('claw')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('remote')}
          onClick={() => setCategory('remote')}
        >
          <Wifi className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('remote')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('profile')}
          onClick={() => setCategory('profile')}
        >
          <User className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('profile')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('providers')}
          onClick={() => setCategory('providers')}
        >
          <ServerCog className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('providers')}
        </button>
        {extensionSettingsAvailable ? (
          <button
            type="button"
            data-cursor-spotlight-target
            className={catCls('extensions')}
            onClick={() => setCategory('extensions')}
          >
            <Puzzle className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
            {t('extensions')}
          </button>
        ) : null}
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('agents')}
          onClick={() => setCategory('agents')}
        >
          <Bot className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('agents')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('subagents')}
          onClick={() => setCategory('subagents')}
        >
          <UsersRound className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('subagents')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('archives')}
          onClick={() => setCategory('archives')}
        >
          <Archive className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('archives')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('dataMigration')}
          onClick={() => setCategory('dataMigration')}
        >
          <PackageOpen className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('dataMigration')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('worktree')}
          onClick={() => setCategory('worktree')}
        >
          <GitBranch className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('worktree')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('memory')}
          onClick={() => setCategory('memory')}
        >
          <BrainCircuit className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('memory')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('shortcuts')}
          onClick={() => setCategory('shortcuts')}
        >
          <Keyboard className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('keyboardShortcuts')}
        </button>
        <button
          type="button"
          data-cursor-spotlight-target
          className={catCls('updates')}
          onClick={() => setCategory('updates')}
        >
          <RefreshCw className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('updates')}
        </button>
      </nav>
      <div className="ds-no-drag shrink-0 border-t border-ds-border p-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-cursor-spotlight-target
            onClick={goToChat}
            className="group flex min-h-[36px] w-full items-center gap-2.5 rounded-[10px] border border-transparent px-2 py-1 text-left transition duration-150 hover:border-black/[0.06] hover:bg-ds-hover"
            aria-label={`${accountDisplayName} · ${t('userHome')}`}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8470ed] to-[#5aa7dc] text-[11px] font-semibold text-white shadow-[0_2px_8px_rgba(111,93,221,0.3)]">
              {accountInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-ds-ink">
                {accountIsGuest ? t('guestAccount') : accountDisplayName}
              </div>
              <div className="truncate text-[10.5px] text-ds-faint">
                {accountIsGuest ? t('guestDescription') : t('userHome')}
              </div>
            </div>
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-ds-faint transition group-hover:translate-x-0.5 group-hover:text-ds-ink"
              strokeWidth={1.8}
            />
          </button>
          <SidebarIconButton
            title={t('claw')}
            ariaLabel={t('claw')}
            onClick={onOpenClaw}
            active={category === 'claw'}
            className="h-8 w-8 rounded-[9px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            <Smartphone className="h-4 w-4" strokeWidth={1.75} />
          </SidebarIconButton>
          <SidebarIconButton
            title={tCommon('toggleTheme')}
            ariaLabel={tCommon('toggleTheme')}
            onClick={onToggleTheme}
            className="h-8 w-8 rounded-[9px] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            {/* 与聊天侧栏一致:图标/文案随主题纯 CSS 切换,避免用 JS 跟踪 data-theme 触发整棵侧栏重绘。 */}
            <Moon className="h-4 w-4 dark:hidden" strokeWidth={1.75} />
            <Sun className="hidden h-4 w-4 dark:block" strokeWidth={1.75} />
            <span className="sr-only dark:hidden">{tCommon('switchToDark')}</span>
            <span className="sr-only hidden dark:inline">{tCommon('switchToLight')}</span>
          </SidebarIconButton>
        </div>
      </div>
    </aside>
  )
}
