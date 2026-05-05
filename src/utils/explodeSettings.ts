/**
 * ExplodeSettings content type for Convos.
 *
 * Matches the iOS ExplodeSettingsCodec:
 * - Content type: convos.org/explode_settings:1.0
 * - Payload: JSON-encoded { expiresAt: ISO8601 string }
 * - fallback: "Conversation expires at {date}"
 * - shouldPush: true (so receiving clients can trigger their cleanup flow)
 *
 * Sent by the creator immediately before `removeMembers(all others)` +
 * `leaveGroup()` (per ADR 004 C9 amendment / ADR 011 §5). Receiving
 * clients drop the conversation locally on whichever arrives first: the
 * ExplodeSettings message or the MLS remove commit.
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

export const ContentTypeExplodeSettings: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "explode_settings",
  versionMajor: 1,
  versionMinor: 0,
};

export interface ExplodeSettingsContent {
  /** ISO 8601 timestamp when the conversation expires. */
  expiresAt: string;
}

export class ExplodeSettingsCodec
  implements ContentCodec<ExplodeSettingsContent>
{
  get contentType(): ContentTypeId {
    return ContentTypeExplodeSettings;
  }

  encode(content: ExplodeSettingsContent): EncodedContent {
    const json = JSON.stringify({ expiresAt: content.expiresAt });
    return {
      type: ContentTypeExplodeSettings,
      parameters: {},
      content: new TextEncoder().encode(json),
      fallback: `Conversation expires at ${content.expiresAt}`,
    } as EncodedContent;
  }

  decode(content: EncodedContent): ExplodeSettingsContent {
    const json = new TextDecoder().decode(content.content);
    const parsed = JSON.parse(json) as ExplodeSettingsContent;
    if (typeof parsed.expiresAt !== "string") {
      throw new Error("Missing or invalid expiresAt in ExplodeSettings");
    }
    return parsed;
  }

  fallback(content: ExplodeSettingsContent): string | undefined {
    return `Conversation expires at ${content.expiresAt}`;
  }

  shouldPush(_content: ExplodeSettingsContent): boolean {
    return true;
  }
}

/**
 * Encode an ExplodeSettings message directly as EncodedContent. Used by
 * senders that construct the wire payload without instantiating the codec.
 */
export function encodeExplodeSettings(expiresAt: Date): EncodedContent {
  return new ExplodeSettingsCodec().encode({
    expiresAt: expiresAt.toISOString(),
  });
}

export function isExplodeSettingsMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeExplodeSettings.authorityId &&
    ct.typeId === ContentTypeExplodeSettings.typeId
  );
}

/**
 * Extract ExplodeSettings content from a DecodedMessage. When the codec is
 * registered on the client (the default), the SDK has already decoded the
 * payload and the first branch returns the typed object directly. The
 * EncodedContent fallback handles callers that hand the helper a raw
 * `{ content: Uint8Array }` object (test mocks, in-process forwarding, or
 * any future code path that bypasses the codec registry); without this
 * branch those callers would silently get `undefined`.
 *
 * Note: when an unregistered codec runs through the SDK proper the SDK
 * sets `content = undefined`, so the early-exit kicks in and the fallback
 * is unreachable. The fallback is load-bearing only for callers that
 * supply EncodedContent directly.
 */
export function getExplodeSettingsContent(
  message: DecodedMessage,
): ExplodeSettingsContent | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (
    "expiresAt" in content &&
    typeof (content as { expiresAt: unknown }).expiresAt === "string"
  ) {
    return content as ExplodeSettingsContent;
  }

  if (
    "content" in content &&
    (content as { content: unknown }).content instanceof Uint8Array
  ) {
    try {
      const json = new TextDecoder().decode(
        (content as { content: Uint8Array }).content,
      );
      const parsed = JSON.parse(json) as ExplodeSettingsContent;
      if (typeof parsed.expiresAt === "string") return parsed;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
