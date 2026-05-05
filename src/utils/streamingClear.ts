/**
 * StreamingClear content type for Convos Assistant Builder Focus Mode.
 *
 * Matches the iOS StreamingClearCodec:
 * - Content type: convos.org/streaming_clear:1.0
 * - Payload: JSON {"sessionId","senderInboxId","revision"}
 * - shouldPush: false (silent)
 * - fallback: undefined (no text fallback)
 *
 * "I'm done with this thought, blank my bubble." Receivers delay the
 * visual clear by 600ms so the final phrase stays readable. Revisions
 * share the same monotonic counter as StreamingText per
 * (sessionId, senderInboxId).
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

// ─── Content Type ───

export const ContentTypeStreamingClear: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "streaming_clear",
  versionMajor: 1,
  versionMinor: 0,
};

/** Visual clear delay applied by receivers so the final phrase stays readable. */
export const STREAMING_CLEAR_DELAY_MS = 600;

// ─── Types ───

export interface StreamingClear {
  sessionId: string;
  senderInboxId: string;
  /** uint32 monotonic per (sessionId, senderInboxId), shared with StreamingText. */
  revision: number;
}

// ─── Codec ───

function isUint32(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 0xffff_ffff;
}

export class StreamingClearCodec implements ContentCodec<StreamingClear> {
  get contentType(): ContentTypeId {
    return ContentTypeStreamingClear;
  }

  encode(content: StreamingClear): EncodedContent {
    if (typeof content.sessionId !== "string" || content.sessionId.length === 0) {
      throw new Error("Missing StreamingClear.sessionId");
    }
    if (typeof content.senderInboxId !== "string" || content.senderInboxId.length === 0) {
      throw new Error("Missing StreamingClear.senderInboxId");
    }
    if (!isUint32(content.revision)) {
      throw new Error("Invalid StreamingClear.revision (uint32 required)");
    }
    return {
      type: ContentTypeStreamingClear,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(content)),
    } as EncodedContent;
  }

  decode(content: EncodedContent): StreamingClear {
    const parsed = JSON.parse(
      new TextDecoder().decode(content.content),
    ) as StreamingClear;
    if (
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.length === 0 ||
      typeof parsed.senderInboxId !== "string" ||
      parsed.senderInboxId.length === 0 ||
      !isUint32(parsed.revision)
    ) {
      throw new Error("Invalid StreamingClear payload");
    }
    return parsed;
  }

  fallback(_content: StreamingClear): string | undefined {
    return undefined;
  }

  shouldPush(_content: StreamingClear): boolean {
    return false;
  }
}

// ─── Helpers ───

export function isStreamingClearMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeStreamingClear.authorityId &&
    ct.typeId === ContentTypeStreamingClear.typeId
  );
}

export function getStreamingClearContent(
  message: DecodedMessage,
): StreamingClear | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (
    "sessionId" in content &&
    "senderInboxId" in content &&
    "revision" in content &&
    !("text" in content) &&
    typeof (content as any).sessionId === "string" &&
    typeof (content as any).senderInboxId === "string" &&
    isUint32((content as any).revision)
  ) {
    return content as StreamingClear;
  }

  if ("content" in content && (content as any).content instanceof Uint8Array) {
    try {
      const parsed = JSON.parse(
        new TextDecoder().decode((content as any).content),
      ) as StreamingClear;
      if (
        typeof parsed.sessionId === "string" &&
        typeof parsed.senderInboxId === "string" &&
        isUint32(parsed.revision)
      ) {
        return parsed;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}
