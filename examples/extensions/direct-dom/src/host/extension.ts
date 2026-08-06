import type { ExtensionContext } from '@Rcode/extension-api'

export async function activate(context: ExtensionContext): Promise<void> {
  // Content-script resources are declared statically in the Manifest. The Node
  // host cannot dynamically inject additional scripts, styles, or surfaces.
  void context
}

export async function deactivate(): Promise<void> {
  // Rcode removes Host-managed content-script resources during deactivation.
}
