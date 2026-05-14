/**
 * Thinking content type for Convos.
 *
 * Agent → conversation "I'm thinking about this message" status. Mirrors
 * the existing FocusModeControl / TypingIndicator pattern: silent, no
 * fallback, JSON payload, filtered from chat history. Receivers route it
 * into a side-channel UI affordance ("Agent is thinking…").
 *
 * Wire shape:
 *   {
 *     "state": "start" | "stop",
 *     "targetMessageId": "<message id this thinking anchors to>",
 *     "content": "<3–5 word human-readable label>",
 *     "resultMessageId": "<optional: agent's reply that closed the thought>"
 *   }
 *
 * The `state` field follows the FocusModeControl pattern — `start` opens
 * a thinking session, `stop` closes it. Senders are expected to always
 * pair a `start` with a matching `stop` (same `targetMessageId`).
 *
 * `targetMessageId` and `content` are both required even on `stop`, so
 * receivers can disambiguate concurrent thinking sessions and render a
 * final label if they want.
 *
 * `resultMessageId` is optional and only meaningful on `stop` — when present,
 * it identifies the agent's own reply message that resolved the thinking.
 * Receivers can use it to link "thought about X" to "replied with Y" in the
 * UI. Omitted when the thinking ended without a reply (interrupt, error,
 * agent had nothing to say).
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

// ─── Content Type ───

export const ContentTypeThinking: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "thinking",
  versionMajor: 1,
  versionMinor: 0,
};

// ─── Types ───

export type ThinkingState = "start" | "stop";

export interface Thinking {
  state: ThinkingState;
  targetMessageId: string;
  content: string;
  /** Optional — only meaningful on `stop`. The agent's reply that closed the thinking. */
  resultMessageId?: string;
}

// ─── Codec ───

function validate(value: unknown): asserts value is Thinking {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Thinking payload");
  }
  const t = value as Partial<Thinking>;
  if (t.state !== "start" && t.state !== "stop") {
    throw new Error("Invalid Thinking.state");
  }
  if (typeof t.targetMessageId !== "string" || t.targetMessageId.length === 0) {
    throw new Error("Missing Thinking.targetMessageId");
  }
  if (typeof t.content !== "string" || t.content.length === 0) {
    throw new Error("Missing Thinking.content");
  }
  if (t.resultMessageId !== undefined) {
    if (typeof t.resultMessageId !== "string" || t.resultMessageId.length === 0) {
      throw new Error("Invalid Thinking.resultMessageId");
    }
  }
}

export class ThinkingCodec implements ContentCodec<Thinking> {
  get contentType(): ContentTypeId {
    return ContentTypeThinking;
  }

  encode(content: Thinking): EncodedContent {
    validate(content);
    return {
      type: ContentTypeThinking,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(content)),
    } as EncodedContent;
  }

  decode(content: EncodedContent): Thinking {
    const json = new TextDecoder().decode(content.content);
    const parsed = JSON.parse(json) as unknown;
    validate(parsed);
    return parsed;
  }

  fallback(_content: Thinking): string | undefined {
    return undefined;
  }

  shouldPush(_content: Thinking): boolean {
    return false;
  }
}

// ─── Helpers ───

export function isThinkingMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeThinking.authorityId &&
    ct.typeId === ContentTypeThinking.typeId
  );
}

export function getThinkingContent(message: DecodedMessage): Thinking | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (
    "state" in content &&
    "targetMessageId" in content &&
    "content" in content &&
    ((content as any).state === "start" || (content as any).state === "stop") &&
    typeof (content as any).targetMessageId === "string" &&
    typeof (content as any).content === "string" &&
    // Tolerate either an absent resultMessageId or a string one; structural
    // pre-check stays in sync with the validator.
    ((content as any).resultMessageId === undefined ||
      typeof (content as any).resultMessageId === "string")
  ) {
    try {
      validate(content);
      return content as Thinking;
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
