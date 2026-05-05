/**
 * StreamingText content type for Convos Assistant Builder Focus Mode.
 *
 * Matches the iOS StreamingTextCodec:
 * - Content type: convos.org/streaming_text:1.0
 * - Payload: JSON {"sessionId","senderInboxId","revision","text"}
 * - shouldPush: false (silent)
 * - fallback: undefined (no text fallback)
 *
 * Each message carries a FULL SNAPSHOT of the bubble text — not a delta.
 * Receivers compare `revision` to drop stale arrivals; ordering is not
 * guaranteed by XMTP. Revisions are monotonic per (sessionId, senderInboxId)
 * and shared with the StreamingClear codec.
 *
 * Receivers route these into a separate session-state store; they are
 * not stored in conversation history.
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

// ─── Content Type ───

export const ContentTypeStreamingText: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "streaming_text",
  versionMajor: 1,
  versionMinor: 0,
};

// ─── Limits ───

/** Receiver-side reject ceiling. Senders should target much smaller values. */
export const STREAMING_TEXT_MAX_BYTES = 1024;

// ─── Types ───

export interface StreamingText {
  sessionId: string;
  senderInboxId: string;
  /** uint32 monotonic per (sessionId, senderInboxId). */
  revision: number;
  text: string;
}

// ─── Codec ───

function isUint32(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 0xffff_ffff;
}

export class StreamingTextCodec implements ContentCodec<StreamingText> {
  get contentType(): ContentTypeId {
    return ContentTypeStreamingText;
  }

  encode(content: StreamingText): EncodedContent {
    if (typeof content.sessionId !== "string" || content.sessionId.length === 0) {
      throw new Error("Missing StreamingText.sessionId");
    }
    if (typeof content.senderInboxId !== "string" || content.senderInboxId.length === 0) {
      throw new Error("Missing StreamingText.senderInboxId");
    }
    if (!isUint32(content.revision)) {
      throw new Error("Invalid StreamingText.revision (uint32 required)");
    }
    if (typeof content.text !== "string") {
      throw new Error("Invalid StreamingText.text");
    }
    return {
      type: ContentTypeStreamingText,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(content)),
    } as EncodedContent;
  }

  decode(content: EncodedContent): StreamingText {
    if (content.content.byteLength > STREAMING_TEXT_MAX_BYTES) {
      throw new Error(
        `StreamingText payload exceeds ${STREAMING_TEXT_MAX_BYTES} bytes`,
      );
    }
    const parsed = JSON.parse(
      new TextDecoder().decode(content.content),
    ) as StreamingText;
    if (
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.length === 0 ||
      typeof parsed.senderInboxId !== "string" ||
      parsed.senderInboxId.length === 0 ||
      !isUint32(parsed.revision) ||
      typeof parsed.text !== "string"
    ) {
      throw new Error("Invalid StreamingText payload");
    }
    return parsed;
  }

  fallback(_content: StreamingText): string | undefined {
    return undefined;
  }

  shouldPush(_content: StreamingText): boolean {
    return false;
  }
}

// ─── Helpers ───

export function isStreamingTextMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeStreamingText.authorityId &&
    ct.typeId === ContentTypeStreamingText.typeId
  );
}

export function getStreamingTextContent(
  message: DecodedMessage,
): StreamingText | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (
    "sessionId" in content &&
    "senderInboxId" in content &&
    "revision" in content &&
    "text" in content &&
    typeof (content as any).sessionId === "string" &&
    typeof (content as any).senderInboxId === "string" &&
    isUint32((content as any).revision) &&
    typeof (content as any).text === "string"
  ) {
    return content as StreamingText;
  }

  if ("content" in content && (content as any).content instanceof Uint8Array) {
    try {
      const bytes = (content as any).content as Uint8Array;
      if (bytes.byteLength > STREAMING_TEXT_MAX_BYTES) return undefined;
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as StreamingText;
      if (
        typeof parsed.sessionId === "string" &&
        typeof parsed.senderInboxId === "string" &&
        isUint32(parsed.revision) &&
        typeof parsed.text === "string"
      ) {
        return parsed;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}
