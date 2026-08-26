import type { JokerHostContentScriptApi } from '@joker-code/extension-api'

declare global {
  interface Window {
    readonly JokerHost: JokerHostContentScriptApi
  }
}

// Direct DOM is deliberately outside Extension API SemVer. Every selector below
// is an unsupported compatibility dependency and must fail without harming Joker.
(() => {
  const context = window.JokerHost.getContext()
  const extensionRootId = 'Joker-example-direct-dom-warning'

  // Joker never injects content scripts into protected windows. Keep a defensive
  // check as well so a future host regression cannot make this example render.
  if (document.documentElement.hasAttribute('data-Joker-protected-surface')) return
  if (document.getElementById(extensionRootId)) return

  const target =
    document.querySelector<HTMLElement>('[data-Joker-surface="workbench-topbar"]') ??
    document.querySelector<HTMLElement>('[role="banner"]')
  if (!target) {
    void window.JokerHost.reportDiagnostic({
      code: 'SELECTOR_MISSING',
      message: 'The unsupported workbench top-bar selector was not found.',
      level: 'warning'
    })
    return
  }

  const badge = document.createElement('span')
  badge.id = extensionRootId
  badge.dataset.JokerExtensionRoot = context.marker
  badge.setAttribute('role', 'status')
  badge.textContent = 'Direct DOM example (unsupported selector)'
  target.append(badge)

  const cleanup = (): void => {
    badge.remove()
    window.removeEventListener('Joker-extension-deactivate', cleanup)
  }
  window.addEventListener('Joker-extension-deactivate', cleanup, { once: true })
  window.addEventListener('pagehide', cleanup, { once: true })
})()
