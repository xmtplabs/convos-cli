/**
 * ConnectionEvent content type — device/user → agent notification that a
 * provider grant changed for this conversation.
 *
 * Mirrors the iOS `ConnectionEventCodec` (PR #771):
 * - Content type: convos.org/connection_event:1.0
 * - Payload: JSON-encoded `ConnectionEvent`
 * - Fallback: none
 * - shouldPush: false
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

export const ContentTypeConnectionEvent: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "connection_event",
  versionMajor: 1,
  versionMinor: 0,
};

export const CONNECTION_EVENT_SUPPORTED_VERSION = 1;

export type ConnectionEventAction = "granted" | "revoked";

export interface ConnectionEvent {
  version: number;
  providerId: string;
  action: ConnectionEventAction;
}

export class ConnectionEventCodec implements ContentCodec<ConnectionEvent> {
  get contentType(): ContentTypeId {
    return ContentTypeConnectionEvent;
  }

  encode(content: ConnectionEvent): EncodedContent {
    validateConnectionEvent(content);
    const json = JSON.stringify(content);
    return {
      type: ContentTypeConnectionEvent,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): ConnectionEvent {
    if (!content.content || content.content.length === 0) {
      throw new Error("ConnectionEvent content is empty");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(content.content));
    } catch {
      throw new Error("Invalid JSON format for ConnectionEvent");
    }
    validateConnectionEvent(parsed);
    if (parsed.version > CONNECTION_EVENT_SUPPORTED_VERSION) {
      throw new Error(`Unsupported ConnectionEvent version ${parsed.version}`);
    }
    return parsed;
  }

  fallback(_content: ConnectionEvent): string | undefined {
    return undefined;
  }

  shouldPush(_content: ConnectionEvent): boolean {
    return false;
  }
}

function validateConnectionEvent(value: unknown): asserts value is ConnectionEvent {
  if (!value || typeof value !== "object") {
    throw new Error("ConnectionEvent: not an object");
  }
  const event = value as Partial<ConnectionEvent>;
  if (typeof event.version !== "number" || !Number.isInteger(event.version) || event.version < 1) {
    throw new Error(`ConnectionEvent: invalid version ${JSON.stringify(event.version)}`);
  }
  if (typeof event.providerId !== "string") throw new Error("ConnectionEvent: missing providerId");
  if (event.action !== "granted" && event.action !== "revoked") {
    throw new Error("ConnectionEvent: invalid action");
  }
}

export function isConnectionEventMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeConnectionEvent.authorityId &&
    ct.typeId === ContentTypeConnectionEvent.typeId
  );
}

export function getConnectionEventContent(
  message: DecodedMessage,
): ConnectionEvent | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (looksLikeConnectionEvent(content)) {
    return content as ConnectionEvent;
  }

  if ("content" in content && (content as { content: unknown }).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as { content: Uint8Array }).content);
      const parsed = JSON.parse(json) as unknown;
      if (looksLikeConnectionEvent(parsed)) {
        return parsed as ConnectionEvent;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function looksLikeConnectionEvent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<ConnectionEvent>;
  return (
    typeof event.version === "number" &&
    typeof event.providerId === "string" &&
    (event.action === "granted" || event.action === "revoked")
  );
}
