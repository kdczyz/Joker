/**
 * Runs inside an extension's isolated world. The source is deliberately static:
 * binding identity is read from the frozen `RcodeHost` bridge instead of being
 * interpolated into executable JavaScript.
 */
export const EXTENSION_CONTENT_SCRIPT_DEACTIVATION_SOURCE = `(() => {
  'use strict';
  const api = globalThis.RcodeHost;
  if (!api || typeof api.getContext !== 'function') return;
  const context = api.getContext();
  if (!context || typeof context !== 'object') return;
  const { extensionId, contributionId, marker } = context;
  if (typeof extensionId !== 'string' || typeof contributionId !== 'string' || typeof marker !== 'string') return;
  const detail = Object.freeze({ extensionId, contributionId });
  window.dispatchEvent(new CustomEvent('Rcode-extension-deactivate', { detail }));
  document.querySelectorAll('[data-Rcode-extension-style], [data-Rcode-extension-root]').forEach((node) => {
    if (node.getAttribute('data-Rcode-extension-style') === marker || node.getAttribute('data-Rcode-extension-root') === marker) node.remove();
  });
})();`
