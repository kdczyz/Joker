# @joker-code/extension-test

Deterministic, credential-free test utilities for Joker extensions. The harness
provides a fake Host transport plus workspace, Agent, tool, provider, account,
storage, network, permission, clock, Webview, protected media, durable job, and
generated-artifact services. Media and job fakes use a controllable clock and
explicit lifecycle methods, so tests never require FFmpeg or wall-clock waits.

Repository development uses the root npm workspace. A standalone project must
first verify that the public artifact exists, then install it by package name:

```sh
npm view @joker-code/extension-test@1.2.0 version
npm install --save-dev @joker-code/extension-test@^1.2.0
```

An `E404` is a registry-publication failure, not a reason to add a
repository-relative `file:` dependency to a portable extension.
