/**
 * Thinking-control content type for Convos.
 *
 * User → conversation "stop (or resume) that agent's thinking session"
 * request. The counterpart to the Thinking content type: where
 * `convos.org/thinking:1.0` is the agent narrating its own session, this
 * type is any conversation member asking the agent to halt or pick the
 * session back up. Silent, no fallback, JSON payload, filtered from chat
 * history.
 *
 * Wire shape:
 *   {
 *     "action": "stop" | "resume",
 *     "targetMessageId": "<message id the thinking session anchors to>",
 *     "agentInboxId": "<inbox id of the agent whose session is targeted>"
 *   }
 *
 * A thinking session is keyed by `(agentInboxId, targetMessageId)` — the
 * same key the Thinking events use (there the agent is the sender, so the
 * agent inbox id is implicit). `agentInboxId` keeps the request unambiguous
 * when two agents think about the same message.
 *
 * These are requests, not state transitions: the agent acknowledges by
 * emitting its own Thinking events (a `stop` control is answered with a
 * thinking `stop`, a `resume` with a fresh thinking `start`). A control
 * for an anchor with no active session is a quiet no-op.
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

// ─── Content Type ───

export const ContentTypeThinkingControl: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "thinking-control",
  versionMajor: 1,
  versionMinor: 0,
};

// ─── Types ───

export type ThinkingControlAction = "stop" | "resume";

export interface ThinkingControl {
  action: ThinkingControlAction;
  targetMessageId: string;
  agentInboxId: string;
}

// ─── Codec ───

function validate(value: unknown): asserts value is ThinkingControl {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid ThinkingControl payload");
  }
  const t = value as Partial<ThinkingControl>;
  if (t.action !== "stop" && t.action !== "resume") {
    throw new Error("Invalid ThinkingControl.action");
  }
  if (typeof t.targetMessageId !== "string" || t.targetMessageId.length === 0) {
    throw new Error("Missing ThinkingControl.targetMessageId");
  }
  if (typeof t.agentInboxId !== "string" || t.agentInboxId.length === 0) {
    throw new Error("Missing ThinkingControl.agentInboxId");
  }
}

export class ThinkingControlCodec implements ContentCodec<ThinkingControl> {
  get contentType(): ContentTypeId {
    return ContentTypeThinkingControl;
  }

  encode(content: ThinkingControl): EncodedContent {
    validate(content);
    return {
      type: ContentTypeThinkingControl,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(content)),
    } as EncodedContent;
  }

  decode(content: EncodedContent): ThinkingControl {
    const json = new TextDecoder().decode(content.content);
    const parsed = JSON.parse(json) as unknown;
    validate(parsed);
    return parsed;
  }

  fallback(_content: ThinkingControl): string | undefined {
    return undefined;
  }

  shouldPush(_content: ThinkingControl): boolean {
    return false;
  }
}

// ─── Helpers ───

export function isThinkingControlMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeThinkingControl.authorityId &&
    ct.typeId === ContentTypeThinkingControl.typeId
  );
}

export function getThinkingControlContent(
  message: DecodedMessage,
): ThinkingControl | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (
    "action" in content &&
    "targetMessageId" in content &&
    "agentInboxId" in content
  ) {
    try {
      validate(content);
      return content as ThinkingControl;
    } catch {
      return undefined;
    }
  }

  if ("content" in content && (content as any).content instanceof Uint8Array) {
    try {
      const parsed = JSON.parse(
        new TextDecoder().decode((content as any).content),
      ) as unknown;
      validate(parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
