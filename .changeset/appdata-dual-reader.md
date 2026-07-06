---
"@xmtp/convos-cli": patch
---

Accept raw-DEFLATE (iOS-compressed) appData in parseAppData/parseAppDataForWrite, and attach the original decode error as `cause` on the write-guard throw.
