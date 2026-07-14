---
"@xmtp/convos-cli": minor
---

Add the thinking-control content type (`convos.org/thinking-control:1.0`), the user-to-agent counterpart of the thinking content type. Where `convos.org/thinking:1.0` is an agent narrating its own thinking session, a thinking-control message is any conversation member asking the agent to stop that session or resume it. The JSON payload carries an `action` (`stop` or `resume`), the `targetMessageId` the session anchors to, and the `agentInboxId` of the agent being addressed, so the request stays unambiguous when several agents think about the same message. Like thinking, it is silent: no fallback text, `shouldPush` false, and never rendered as a chat row.

Controls are requests rather than state transitions - the agent acknowledges by emitting its own thinking events. `agent serve` now decodes inbound thinking-control messages into a `thinking_control` event (with `action`, `targetMessageId`, `agentInboxId`) and accepts a `thinking-control` stdin command for sending them. Exports: `ThinkingControlCodec`, `ContentTypeThinkingControl`, `isThinkingControlMessage`, `getThinkingControlContent`, and the `ThinkingControl` / `ThinkingControlAction` types, from both the package root and `@xmtp/convos-cli/utils/thinkingControl`.
