/**
 * TypingIndicator content type for Convos.
 *
 * Matches the iOS TypingIndicatorCodec:
 * - Content type: convos.org/typing_indicator:1.0
 * - Payload: JSON {"isTyping": bool}
 * - shouldPush: false (silent)
 * - fallback: undefined (no text fallback)
 *
 * Typing indicators are ephemeral — they are not stored in the
 * conversation history and are filtered from message streams.
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

// ─── Content Type ───

export const ContentTypeTypingIndicator: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "typing_indicator",
  versionMajor: 1,
  versionMinor: 0,
};

// ─── Types ───

export interface TypingIndicatorContent {
  isTyping: boolean;
}

// ─── Codec ───

export class TypingIndicatorCodec implements ContentCodec<TypingIndicatorContent> {
  get contentType(): ContentTypeId {
    return ContentTypeTypingIndicator;
  }

  encode(content: TypingIndicatorContent): EncodedContent {
    const json = JSON.stringify(content);
    return {
      type: ContentTypeTypingIndicator,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): TypingIndicatorContent {
    const json = new TextDecoder().decode(content.content);
    const parsed = JSON.parse(json) as TypingIndicatorContent;
    if (typeof parsed.isTyping !== "boolean") {
      throw new Error("Missing or invalid isTyping in TypingIndicator");
    }
    return parsed;
  }

  fallback(_content: TypingIndicatorContent): string | undefined {
    return undefined;
  }

  shouldPush(_content: TypingIndicatorContent): boolean {
    return false;
  }
}

// ─── Helpers ───

/**
 * Check if a message is a TypingIndicator content type.
 */
export function isTypingIndicatorMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeTypingIndicator.authorityId &&
    ct.typeId === ContentTypeTypingIndicator.typeId
  );
}

/**
 * Extract a TypingIndicatorContent from a DecodedMessage.
 */
export function getTypingIndicatorContent(
  message: DecodedMessage,
): TypingIndicatorContent | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  // Codec registered: content is already decoded
  if ("isTyping" in content && typeof (content as any).isTyping === "boolean") {
    return content as TypingIndicatorContent;
  }

  // No codec: content is raw EncodedContent
  if ("content" in content && (content as any).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as any).content);
      const parsed = JSON.parse(json) as TypingIndicatorContent;
      if (typeof parsed.isTyping === "boolean") return parsed;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
