---
"@xmtp/convos-cli": patch
---

Write appData compressed bodies as raw DEFLATE (matching iOS/Android), completing the compression-format convergence. Historic zlib-wrapped blobs remain readable via the dual-format reader.
