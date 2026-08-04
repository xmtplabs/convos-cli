---
"@xmtp/convos-cli": patch
---

Add the `agentDm` marker (field 8) to the `ConversationCustomMetadata` codec (`AgentDmInfo.originConversationId`), matching the iOS proto so agent-DM markers round-trip byte-compatibly. Enables server-side (Herald) stamping of the marker for CON-761 agent-owned DM creation; `parseAppDataForWrite` preserves it across read-modify-write.
