# create-Rcode-extension

Create an atomic, least-privilege Rcode extension project:

```sh
npm view create-Rcode-extension version
```

Only use the public-registry command below when that preflight returns a
version. `E404` means the configured registry does not publish the scaffolder;
use the repository examples until it is available.

```sh
npx create-Rcode-extension my-extension \
  --template react \
  --publisher acme \
  --name issue-assistant
```

Templates: `node`, `webview`, and `react`. Every generated project includes
build, test, `Rcode extension validate`, and `Rcode extension pack` scripts.
Those standalone projects install published `@Rcode/extension-api`, optional
`@Rcode/extension-react`, and `@Rcode/extension-test` packages by name. The `Rcode`
CLI comes from the Rcode installation; the unscoped npm package with that name is
unrelated.

Repository maintainers can exercise the scaffolder implementation without
claiming public-registry availability:

```sh
npm ci
node ./packages/create-Rcode-extension/src/cli.mjs my-extension \
  --template react \
  --publisher acme \
  --name issue-assistant
```

Installing dependencies in the generated directory still requires the SDK
packages to be published to the configured registry.
