---
"@xmtp/convos-cli": patch
---

Preserve `ConversationCustomMetadata.participationMode` (field 9) through appData read-modify-write. The field was missing from the CLI schema, so any agent-side appData rewrite silently dropped a conversation's participation mode.
