/**
 * JoinRequest content type for Convos join requests.
 *
 * Replaces the plain-text invite slug DM with a structured content type
 * that includes the joiner's profile and optional metadata.
 *
 * Content type: convos.org/join_request:1.0
 * Encoding: JSON (matching iOS JoinRequestCodec)
 *
 * The CLI still sends a plain text slug as well for backward compat
 * with older iOS clients that don't understand the new content type.
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

// ─── Content Type ───

export const ContentTypeJoinRequest: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "join_request",
  versionMajor: 1,
  versionMinor: 0,
};

// ─── Types ───

export interface JoinRequestProfile {
  name?: string;
  imageURL?: string;
  memberKind?: string;
}

export interface JoinRequestContent {
  inviteSlug: string;
  profile?: JoinRequestProfile;
  metadata?: Record<string, string>;
}

// ─── Codec ───

export class JoinRequestCodec implements ContentCodec<JoinRequestContent> {
  get contentType(): ContentTypeId {
    return ContentTypeJoinRequest;
  }

  encode(content: JoinRequestContent): EncodedContent {
    const json = JSON.stringify(content);
    return {
      type: ContentTypeJoinRequest,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): JoinRequestContent {
    const json = new TextDecoder().decode(content.content);
    const parsed = JSON.parse(json) as JoinRequestContent;
    if (!parsed.inviteSlug) {
      throw new Error("Missing inviteSlug in JoinRequest");
    }
    return parsed;
  }

  fallback(content: JoinRequestContent): string | undefined {
    return content.inviteSlug;
  }

  shouldPush(_content: JoinRequestContent): boolean {
    return true;
  }
}

// ─── Helpers ───

/**
 * Check if a message is a JoinRequest content type.
 */
export function isJoinRequestMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeJoinRequest.authorityId &&
    ct.typeId === ContentTypeJoinRequest.typeId
  );
}

/**
 * Extract a JoinRequestContent from a DecodedMessage.
 *
 * When the JoinRequestCodec is registered, message.content is the decoded object.
 * Falls back to raw EncodedContent parsing if needed.
 */
export function getJoinRequestContent(
  message: DecodedMessage,
): JoinRequestContent | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  // Codec registered: content is already decoded
  if ("inviteSlug" in content && typeof (content as any).inviteSlug === "string") {
    return content as JoinRequestContent;
  }

  // No codec: content is raw EncodedContent
  if ("content" in content && (content as any).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as any).content);
      const parsed = JSON.parse(json) as JoinRequestContent;
      if (parsed.inviteSlug) return parsed;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
