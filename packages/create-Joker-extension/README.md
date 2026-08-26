# create-Joker-extension

Create an atomic, least-privilege Joker extension project:

```sh
npm view create-Joker-extension version
```

Only use the public-registry command below when that preflight returns a
version. `E404` means the configured registry does not publish the scaffolder;
use the repository examples until it is available.

```sh
npx create-Joker-extension my-extension \
  --template react \
  --publisher acme \
  --name issue-assistant
```

Templates: `node`, `webview`, and `react`. Every generated project includes
build, test, `Joker extension validate`, and `Joker extension pack` scripts.
Those standalone projects install published `@joker-code/extension-api`, optional
`@joker-code/extension-react`, and `@joker-code/extension-test` packages by name. The `Joker`
CLI comes from the Joker installation; the unscoped npm package with that name is
unrelated.

Repository maintainers can exercise the scaffolder implementation without
claiming public-registry availability:

```sh
npm ci
node ./packages/create-Joker-extension/src/cli.mjs my-extension \
  --template react \
  --publisher acme \
  --name issue-assistant
```

Installing dependencies in the generated directory still requires the SDK
packages to be published to the configured registry.
