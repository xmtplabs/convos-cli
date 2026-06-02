---
"@xmtp/convos-cli": patch
---

Declare `@xmtp/node-sdk` and `@xmtp/node-bindings` as peer dependencies so consumers install a single copy. Prevents native-binding segfaults from duplicate node-sdk trees.
