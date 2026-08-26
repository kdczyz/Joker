# @joker-code/extension-react

Optional React bindings for sandboxed Joker extension Webviews. The package layers
on `@joker-code/extension-api` and never exposes Electron or `window.JokerGui`.

In this repository, use `npm ci` at the root and build the
`@joker-code/extension-react` workspace. In a standalone project, verify both published
packages before installing by name:

```sh
npm view @joker-code/extension-api@1.2.0 version
npm view @joker-code/extension-react@1.2.0 version
npm install @joker-code/extension-api@^1.2.0 @joker-code/extension-react@^1.2.0
```

Do not continue after `E404`; use the repository workflow until the configured
registry contains the required artifacts.

Use `ExtensionViewProvider` at the Webview root, then consume `useTheme`,
`useLocale`, `useViewState`, `useHostMessage`, `useAgentRun`, `useAccounts`, and
`useProviderStatus`. Use `useCommand` for schema-validated command invocation
with result, loading, and error state, and `useConfiguration` for declared,
host-persisted global or workspace settings.
