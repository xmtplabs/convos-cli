---
"@xmtp/convos-cli": patch
---

Mark the `@xmtp/node-bindings` peer dependency as optional.

convos-cli only ever imports types from `@xmtp/node-bindings`; at runtime the
bindings arrive through `@xmtp/node-sdk`'s exact-pinned dependency. A required
peer makes pnpm's `autoInstallPeers` fetch a second, registry-latest bindings
build in workspaces that pin bindings only via `pnpm.overrides` — a native
addon compiled against a different node-sdk than the one in the tree. Optional
peers are never auto-installed and still resolve to the single in-graph
bindings, so type imports keep working and the sdk/bindings compile contract
stays intact.
