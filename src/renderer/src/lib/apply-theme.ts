import {
  documentLanguageForAppLocale,
  normalizeChatContentMaxWidth,
  normalizeUiFontScale,
  writeFontStackFor,
  type ChatContentMaxWidthPx,
  type UiFontScale,
  type WriteTypographySettingsV1
} from '@shared/app-settings'
import type { AppLocale } from '@shared/app-locales'

export type ThemePreference = 'system' | 'light' | 'dark'
export type { ChatContentMaxWidthPx, UiFontScale }

let removeSystemListener: (() => void) | null = null
let themeSwitchFrame: number | null = null

function resolvedMode(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 主题切换期间冻结全站过渡(见 base-shell.css 的 `[data-theme-switch]`)。
 *
 * 深浅切换会让页面上成百上千个元素同时开始颜色插值 —— 侧边栏几乎每一行都带
 * `transition duration-150`,文本从 #18181b 到 #ffffff、行背景从 black/4% 到
 * white/6% 都要走一遍中间值,混合出来的就是一片灰;而且这么多并行过渡会把合成
 * 线程压垮,表现为「左侧栏发灰 + 卡一下」。切换瞬间掐掉过渡让颜色瞬时到位,
 * 两帧后再恢复,hover 等交互过渡完全不受影响。
 */
function freezeTransitionsDuringSwitch(root: HTMLElement): void {
  root.setAttribute('data-theme-switch', '')
  if (themeSwitchFrame !== null) {
    cancelAnimationFrame(themeSwitchFrame)
    themeSwitchFrame = null
  }
  const raf = globalThis.requestAnimationFrame
  if (typeof raf !== 'function') {
    root.removeAttribute('data-theme-switch')
    return
  }
  // 两帧:第一帧保证浏览器已经在「无过渡」状态下完成新值的样式计算与绘制,
  // 第二帧再恢复过渡能力 —— 只等一帧的话浏览器可能把新值当成过渡起点补一段动画。
  themeSwitchFrame = raf(() => {
    themeSwitchFrame = raf(() => {
      themeSwitchFrame = null
      root.removeAttribute('data-theme-switch')
    })
  })
}

/**
 * Applies `data-theme` on `<html>` for Tailwind `dark:` variants and CSS variables.
 */
export function applyTheme(pref: ThemePreference): void {
  removeSystemListener?.()
  removeSystemListener = null

  const root = document.documentElement
  const apply = (): void => {
    const mode = resolvedMode(pref)
    if (root.getAttribute('data-theme') === mode) return
    freezeTransitionsDuringSwitch(root)
    root.setAttribute('data-theme', mode)
  }

  if (pref === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      apply()
    }
    mq.addEventListener('change', onChange)
    removeSystemListener = (): void => {
      mq.removeEventListener('change', onChange)
    }
  }

  apply()
}

export function applyUiFontScale(scale: UiFontScale): void {
  const root = document.documentElement
  root.style.setProperty('--ds-ui-scale', String(normalizeUiFontScale(scale)))
}

export function applyChatContentMaxWidth(widthPx: ChatContentMaxWidthPx): void {
  const root = document.documentElement
  root.style.setProperty('--ds-chat-content-max-width', `${normalizeChatContentMaxWidth(widthPx)}px`)
}

/**
 * Pushes the Write editor typography onto CSS variables consumed by the rich
 * editor, the CodeMirror live appearance, and the markdown preview. Setting the
 * variables on `<html>` keeps chat surfaces untouched (only `.write-*` and the
 * editor theme read them) and live-updates open editors without a rebuild.
 */
export function applyWriteTypography(typography: WriteTypographySettingsV1): void {
  const root = document.documentElement.style
  root.setProperty('--write-editor-font-family', writeFontStackFor(typography.fontPreset, typography.customFontFamily))
  root.setProperty('--write-editor-font-size', `${typography.fontSizePx}px`)
  root.setProperty('--write-editor-line-height', String(typography.lineHeight))
}

/**
 * Mirrors the active i18n locale onto `<html lang>` so screen readers,
 * browser spellcheck, and CSS `:lang()` selectors match the visible UI.
 */
export function applyDocumentLocale(locale: AppLocale): void {
  const lang = documentLanguageForAppLocale(locale)
  if (document.documentElement.getAttribute('lang') !== lang) {
    document.documentElement.setAttribute('lang', lang)
  }
}
