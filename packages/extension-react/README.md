# @Rcode/extension-react

Optional React bindings for sandboxed Rcode extension Webviews. The package layers
on `@Rcode/extension-api` and never exposes Electron or `window.RcodeGui`.

In this repository, use `npm ci` at the root and build the
`@Rcode/extension-react` workspace. In a standalone project, verify both published
packages before installing by name:

```sh
npm view @Rcode/extension-api@1.2.0 version
npm view @Rcode/extension-react@1.2.0 version
npm install @Rcode/extension-api@^1.2.0 @Rcode/extension-react@^1.2.0
```

Do not continue after `E404`; use the repository workflow until the configured
registry contains the required artifacts.

Use `ExtensionViewProvider` at the Webview root, then consume `useTheme`,
`useLocale`, `useViewState`, `useHostMessage`, `useAgentRun`, `useAccounts`, and
`useProviderStatus`. Use `useCommand` for schema-validated command invocation
with result, loading, and error state, and `useConfiguration` for declared,
host-persisted global or workspace settings.
