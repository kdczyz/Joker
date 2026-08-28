import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode
} from 'react'
import { ChevronRight, Command, PanelLeft, Search, X } from 'lucide-react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type SidebarFrameProps = {
  title: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}

type SidebarTitlebarToggleButtonProps = {
  title: string
  ariaLabel?: string
  onClick: () => void
  className?: string
  children?: ReactNode
}

export function SidebarTitlebarToggleButton({
  title,
  ariaLabel,
  onClick,
  className,
  children
}: SidebarTitlebarToggleButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={cx('ds-titlebar-sidebar-toggle ds-no-drag', className)}
    >
      {children ?? <PanelLeft className="h-4 w-4" strokeWidth={1.75} />}
    </button>
  )
}

export function SidebarFrame({
  title,
  children,
  footer,
  className
}: SidebarFrameProps): ReactElement {
  return (
    <aside
      className={cx(
        'ds-drag ds-sidebar-shell relative flex h-full w-full shrink-0 flex-col overflow-hidden px-2.5 pb-2.5',
        className
      )}
    >
      <div className="ds-sidebar-titlebar-spacer shrink-0 pb-1 pt-1.5">
        {/* 收起/展开按钮由 Workbench 固定锚定在红绿灯右侧,这里仅保留安全区占位 */}
        <div className="ds-sidebar-titlebar-row flex min-h-[30px] items-start">
          <div aria-hidden className="ds-titlebar-safe-block min-w-[80px]" />
        </div>
      </div>

      {children}

      {footer ? (
        <div className="ds-sidebar-footer ds-no-drag mt-auto border-t border-[var(--ds-sidebar-divider)]/70 px-1 pt-2">
          {footer}
        </div>
      ) : null}
    </aside>
  )
}

type SidebarCommandRowProps = {
  icon: ReactElement
  label: string
  onClick?: () => void
  disabled?: boolean
  disabledHint?: string
  shortcut?: string
  variant?: 'flat' | 'accent' | 'hero' | 'subtle' | 'footer'
  trailing?: ReactNode
  active?: boolean
  showChevron?: boolean
  className?: string
}

export function SidebarCommandRow({
  icon,
  label,
  onClick,
  disabled,
  disabledHint,
  shortcut,
  variant = 'flat',
  trailing,
  active = false,
  showChevron = false,
  className
}: SidebarCommandRowProps): ReactElement {
  const isHero = variant === 'hero'
  const isAccent = variant === 'accent'
  const isSubtle = variant === 'subtle'
  const isFooter = variant === 'footer'

  return (
    <button
      type="button"
      data-cursor-spotlight-target
      data-active={active ? 'true' : 'false'}
      data-variant={variant}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={onClick}
      className={cx(
        'ds-sidebar-command-row group relative flex min-h-[34px] w-full items-center gap-2.5 rounded-[9px] px-3 py-1.5 text-[13px] font-normal transition duration-150',
        disabled
          ? 'cursor-not-allowed text-[#a8a8a8] opacity-55'
          : isHero
            ? 'border border-black/[0.08] bg-white font-medium text-[#18181b] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#fafafa] hover:shadow-[0_2px_6px_rgba(0,0,0,0.08)] active:translate-y-[0.5px] dark:border-white/[0.12] dark:bg-white/[0.09] dark:text-white dark:shadow-[0_2px_6px_rgba(0,0,0,0.3)] dark:hover:bg-white/[0.13]'
            : active
              ? 'bg-[var(--ds-sidebar-row-active)] font-medium text-[#1f1f1f] shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] dark:text-white'
              : isSubtle
                ? 'text-[#606066] hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#18181b] dark:text-[#9e9ea6] dark:hover:text-white'
                : isFooter
                  ? 'text-[#4f4f4f] hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:text-white/70 dark:hover:text-white'
                  : isAccent
                    ? 'text-[#18181b] hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#000] dark:text-[#eaeaea] dark:hover:text-white'
                    : 'text-[#38383e] hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#18181b] dark:text-[#b4b4bc] dark:hover:text-white',
        className
      )}
    >
      <span
        className={cx(
          'flex h-5 w-5 shrink-0 items-center justify-center transition group-hover:scale-105',
          isHero ? 'text-[#18181b] dark:text-white' : isAccent ? 'text-[#1f1f1f] dark:text-white' : isFooter ? 'text-[#888888]' : 'text-[#52525b] dark:text-[#9e9ea6] group-hover:text-[#18181b] dark:group-hover:text-white'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {shortcut ? (
        <kbd className="ds-kbd hidden items-center gap-0.5 rounded-[5px] border border-black/5 bg-black/[0.03] px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ds-faint transition group-hover:border-black/10 sm:inline-flex dark:border-white/10 dark:bg-white/5">
          <Command className="h-2.5 w-2.5" strokeWidth={2} />
          {shortcut.replace('⌘', '')}
        </kbd>
      ) : null}
      {trailing ?? null}
      {showChevron ? <ChevronRight className="h-3.5 w-3.5 text-ds-faint transition group-hover:translate-x-0.5" strokeWidth={1.8} /> : null}
    </button>
  )
}

type SidebarSectionHeaderProps = {
  label: string
  title?: string
  actions?: ReactNode
}

export function SidebarSectionHeader({
  label,
  title,
  actions
}: SidebarSectionHeaderProps): ReactElement {
  return (
    <div className="ds-sidebar-section-header flex items-center justify-between px-2.5 pb-2 pt-5">
      <span
        className="min-w-0 truncate text-[12px] font-normal text-[#9aa5b5] dark:text-white/35"
        title={title}
      >
        {label}
      </span>
      {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  )
}

type SidebarIconButtonProps = {
  title: string
  children: ReactNode
  onClick?: () => void
  ariaLabel?: string
  disabled?: boolean
  active?: boolean
  tone?: 'default' | 'accent' | 'danger'
  className?: string
  stopPropagation?: boolean
}

export function SidebarIconButton({
  title,
  children,
  onClick,
  ariaLabel,
  disabled,
  active,
  tone = 'default',
  className,
  stopPropagation = false
}: SidebarIconButtonProps): ReactElement {
  const toneClass =
    tone === 'danger'
      ? 'hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300'
      : tone === 'accent'
        ? 'hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:hover:text-white'
        : 'hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:hover:text-white'

  return (
    <button
      type="button"
      data-cursor-spotlight-target
      disabled={disabled}
      onPointerDown={(event) => {
        if (stopPropagation) event.stopPropagation()
      }}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation()
        onClick?.()
      }}
      className={cx(
        'ds-sidebar-icon-button ds-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[#9a9a9a] transition disabled:cursor-not-allowed disabled:opacity-40 dark:text-white/45',
        active ? 'bg-[color-mix(in_srgb,var(--ds-sidebar-row-active)_72%,var(--ds-accent)_28%)] text-[#1f1f1f] shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] dark:text-white' : toneClass,
        className
      )}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

type SidebarSearchFieldProps = {
  value: string
  placeholder: string
  clearLabel: string
  onChange: (value: string) => void
}

export function SidebarSearchField({
  value,
  placeholder,
  clearLabel,
  onChange
}: SidebarSearchFieldProps): ReactElement {
  return (
    <label
      data-cursor-spotlight-target
      className="ds-sidebar-search-field relative flex min-w-0 flex-1 items-center rounded-[8px]"
    >
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
        strokeWidth={1.8}
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-7.5 w-full rounded-[8px] border border-black/[0.06] bg-[var(--ds-sidebar-field-bg)] pl-8 pr-7 text-[12.5px] text-[#1f1f1f] outline-none transition placeholder:text-[#9aa5b5] focus:border-black/20 focus:bg-[var(--ds-sidebar-field-focus)] focus:shadow-[0_0_0_2px_rgba(0,0,0,0.04)] dark:border-white/[0.08] dark:text-white dark:focus:border-white/20 dark:focus:shadow-[0_0_0_2px_rgba(255,255,255,0.05)]"
      />
      {value.trim() ? (
        <button
          type="button"
          data-cursor-spotlight-target
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 flex h-5.5 w-5.5 -translate-y-1/2 items-center justify-center rounded-md text-[#9a9a9a] transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f1f1f] dark:hover:text-white"
          title={clearLabel}
          aria-label={clearLabel}
        >
          <X className="h-3 w-3" strokeWidth={1.9} />
        </button>
      ) : null}
    </label>
  )
}

type SidebarTreeRowProps = {
  children: ReactNode
  onClick?: () => void
  title?: string
  ariaLabel?: string
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void
  onDoubleClick?: () => void
  onMouseEnter?: (event: ReactMouseEvent<HTMLDivElement>) => void
  onMouseMove?: (event: ReactMouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (event: ReactMouseEvent<HTMLDivElement>) => void
  draggable?: boolean
  onDragStart?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragLeave?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void
  disabled?: boolean
  active?: boolean
  activeVariant?: 'rail' | 'outline'
  trailing?: ReactNode
  actions?: ReactNode
  actionsVisibility?: 'hidden' | 'subtle' | 'visible'
  actionsLayout?: 'inline' | 'overlay'
  className?: string
  buttonClassName?: string
  buttonStyle?: CSSProperties
}

export function SidebarTreeRow({
  children,
  onClick,
  title,
  ariaLabel,
  onContextMenu,
  onDoubleClick,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  disabled,
  active = false,
  activeVariant = 'rail',
  trailing,
  actions,
  actionsVisibility = 'subtle',
  actionsLayout = 'inline',
  className,
  buttonClassName,
  buttonStyle
}: SidebarTreeRowProps): ReactElement {
  const outlined = active && activeVariant === 'outline'
  const rail = activeVariant === 'rail'
  const actionsClass =
    actionsVisibility === 'hidden'
      ? 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100'
      : actionsVisibility === 'visible'
        ? 'opacity-100'
        : 'opacity-60 group-hover:opacity-100 focus-within:opacity-100'
  const actionsWrapClass =
    actionsLayout === 'overlay'
      ? 'absolute inset-y-0 right-1 flex items-center gap-0.5'
      : 'mr-1 flex shrink-0 items-center gap-0.5'
  const trailingWrapClass =
    actionsLayout === 'overlay'
      ? 'mr-1 flex shrink-0 items-center gap-0.5 transition group-hover:opacity-0 group-focus-within:opacity-0'
      : 'flex shrink-0 items-center gap-0.5'

  return (
    <div
      data-cursor-spotlight-target
      data-active={active ? 'true' : 'false'}
      data-active-variant={activeVariant}
      className={cx(
        'ds-sidebar-tree-row group relative flex w-full items-center overflow-hidden rounded-[8px] text-[13px] font-normal transition duration-150',
        outlined
          ? 'bg-[var(--ds-sidebar-row-active)] text-[#18181b] shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] dark:text-white'
          : active
            ? 'bg-black/[0.06] font-medium text-[#18181b] shadow-[0_1px_2px_rgba(0,0,0,0.03),inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:bg-white/[0.08] dark:text-white dark:shadow-[0_1px_2px_rgba(0,0,0,0.2),inset_0_0_0_1px_rgba(255,255,255,0.08)]'
            : 'text-[#38383e] hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#18181b] dark:text-[#b4b4bc] dark:hover:text-white',
        className
      )}
      title={title}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {rail && active ? (
        <span
          aria-hidden
          className="absolute bottom-1.5 left-0.5 top-1.5 w-[3px] rounded-full bg-[#18181b] transition dark:bg-white"
        />
      ) : null}
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cx(
          'flex min-w-0 flex-1 text-left disabled:cursor-not-allowed',
          buttonClassName ?? 'items-center gap-2 px-2.5 py-1.5'
        )}
        style={buttonStyle}
      >
        {children}
      </button>      {trailing ? <div className={trailingWrapClass}>{trailing}</div> : null}
      {actions ? (
        <div className={actionsWrapClass}>
          <div className={cx('flex shrink-0 items-center gap-0.5 transition', actionsClass)}>
            {actions}
          </div>
        </div>
      ) : null}
    </div>
  )
}
