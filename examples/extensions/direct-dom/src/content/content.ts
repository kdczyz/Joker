import type { RcodeHostContentScriptApi } from '@Rcode/extension-api'

declare global {
  interface Window {
    readonly RcodeHost: RcodeHostContentScriptApi
  }
}

// Direct DOM is deliberately outside Extension API SemVer. Every selector below
// is an unsupported compatibility dependency and must fail without harming Rcode.
(() => {
  const context = window.RcodeHost.getContext()
  const extensionRootId = 'Rcode-example-direct-dom-warning'

  // Rcode never injects content scripts into protected windows. Keep a defensive
  // check as well so a future host regression cannot make this example render.
  if (document.documentElement.hasAttribute('data-Rcode-protected-surface')) return
  if (document.getElementById(extensionRootId)) return

  const target =
    document.querySelector<HTMLElement>('[data-Rcode-surface="workbench-topbar"]') ??
    document.querySelector<HTMLElement>('[role="banner"]')
  if (!target) {
    void window.RcodeHost.reportDiagnostic({
      code: 'SELECTOR_MISSING',
      message: 'The unsupported workbench top-bar selector was not found.',
      level: 'warning'
    })
    return
  }

  const badge = document.createElement('span')
  badge.id = extensionRootId
  badge.dataset.RcodeExtensionRoot = context.marker
  badge.setAttribute('role', 'status')
  badge.textContent = 'Direct DOM example (unsupported selector)'
  target.append(badge)

  const cleanup = (): void => {
    badge.remove()
    window.removeEventListener('Rcode-extension-deactivate', cleanup)
  }
  window.addEventListener('Rcode-extension-deactivate', cleanup, { once: true })
  window.addEventListener('pagehide', cleanup, { once: true })
})()
