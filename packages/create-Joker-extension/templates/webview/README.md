# {{DISPLAY_NAME}}

Generated framework-neutral Joker Webview extension for Extension API 1.x. The
Webview uses only the sandbox Host transport and a CSP with `connect-src 'none'`.
Vite bundles the public API client and rewrites browser assets to confined,
relative URLs; do not replace the Webview build with plain `tsc` output because
browsers cannot resolve npm package specifiers such as `@joker-code/extension-api`.

```sh
npm install
npm test
npm run validate
npm run pack
```

Developer documentation: https://Joker.dev/extensions/1/
