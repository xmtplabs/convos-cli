/**
 * CloudConnectionGrantRequest content type — agent → device "please link
 * <service>" prompt for a cloud (OAuth) provider. The receiving device
 * surfaces a card / sheet, the user completes the OAuth flow, and the
 * resulting grant is published via `profile.metadata` (no on-wire reply
 * codec — the manifest is the persisted source of truth).
 *
 * Mirrors the iOS `CloudConnectionGrantRequestCodec`:
 * - Content type: convos.org/connection_grant_request:1.0
 * - Payload: JSON-encoded `CloudConnectionGrantRequest`
 * - Fallback: `"The assistant asked to connect <service>"`
 * - shouldPush: false (silent — the device renders a card on receipt)
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

// ─── Content Type ───

export const ContentTypeCloudConnectionGrantRequest: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "connection_grant_request",
  versionMajor: 1,
  versionMinor: 0,
};

/** Highest schema version this codec understands. */
export const CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION = 1;

/** Cap on the `reason` field. iOS truncates symmetrically on encode and decode. */
export const CLOUD_CONNECTION_GRANT_REQUEST_MAX_REASON_LENGTH = 500;

// ─── Types ───

export interface CloudConnectionGrantRequest {
  /** Schema version. Must equal `CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION` (1). */
  version: number;
  /**
   * Cloud service identifier (e.g. `"strava"`, `"google_calendar"`). Used
   * by the device to render a service-specific link card and to resolve
   * the OAuth provider implementation.
   */
  service: string;
  /** Inbox ID of the agent (or other party) requesting the grant. */
  requestedByInboxId: string;
  /** Inbox ID of the user expected to complete the OAuth flow. */
  targetInboxId: string;
  /**
   * Free-form human-readable reason rendered on the picker card.
   * Truncated to `CLOUD_CONNECTION_GRANT_REQUEST_MAX_REASON_LENGTH` on
   * encode and decode (matches iOS).
   */
  reason: string;
}

// ─── Codec ───

export class CloudConnectionGrantRequestCodec
  implements ContentCodec<CloudConnectionGrantRequest>
{
  get contentType(): ContentTypeId {
    return ContentTypeCloudConnectionGrantRequest;
  }

  encode(content: CloudConnectionGrantRequest): EncodedContent {
    validateCloudConnectionGrantRequest(content);
    const sanitized = sanitizeCloudConnectionGrantRequest(content);
    const json = JSON.stringify(sanitized);
    return {
      type: ContentTypeCloudConnectionGrantRequest,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): CloudConnectionGrantRequest {
    if (!content.content || content.content.length === 0) {
      throw new Error("CloudConnectionGrantRequest content is empty");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(content.content));
    } catch {
      throw new Error("Invalid JSON format for CloudConnectionGrantRequest");
    }
    validateCloudConnectionGrantRequest(parsed);
    if (parsed.version > CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION) {
      throw new Error(
        `Unsupported CloudConnectionGrantRequest version ${parsed.version}`,
      );
    }
    return sanitizeCloudConnectionGrantRequest(parsed);
  }

  fallback(content: CloudConnectionGrantRequest): string | undefined {
    return `The assistant asked to connect ${content.service}`;
  }

  shouldPush(_content: CloudConnectionGrantRequest): boolean {
    return false;
  }
}

// ─── Helpers ───

function validateCloudConnectionGrantRequest(
  value: unknown,
): asserts value is CloudConnectionGrantRequest {
  if (!value || typeof value !== "object") {
    throw new Error("CloudConnectionGrantRequest: not an object");
  }
  const r = value as Partial<CloudConnectionGrantRequest>;
  if (typeof r.version !== "number") {
    throw new Error("CloudConnectionGrantRequest: missing version");
  }
  if (typeof r.service !== "string") {
    throw new Error("CloudConnectionGrantRequest: missing service");
  }
  if (typeof r.requestedByInboxId !== "string") {
    throw new Error("CloudConnectionGrantRequest: missing requestedByInboxId");
  }
  if (typeof r.targetInboxId !== "string") {
    throw new Error("CloudConnectionGrantRequest: missing targetInboxId");
  }
  if (typeof r.reason !== "string") {
    throw new Error("CloudConnectionGrantRequest: missing reason");
  }
}

function sanitizeCloudConnectionGrantRequest(
  value: CloudConnectionGrantRequest,
): CloudConnectionGrantRequest {
  const reason =
    value.reason.length > CLOUD_CONNECTION_GRANT_REQUEST_MAX_REASON_LENGTH
      ? value.reason.slice(0, CLOUD_CONNECTION_GRANT_REQUEST_MAX_REASON_LENGTH)
      : value.reason;
  return { ...value, reason };
}

export function isCloudConnectionGrantRequestMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeCloudConnectionGrantRequest.authorityId &&
    ct.typeId === ContentTypeCloudConnectionGrantRequest.typeId
  );
}

export function getCloudConnectionGrantRequestContent(
  message: DecodedMessage,
): CloudConnectionGrantRequest | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (looksLikeCloudConnectionGrantRequest(content)) {
    return content as CloudConnectionGrantRequest;
  }

  if ("content" in content && (content as { content: unknown }).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as { content: Uint8Array }).content);
      const parsed = JSON.parse(json) as unknown;
      if (looksLikeCloudConnectionGrantRequest(parsed)) {
        return parsed as CloudConnectionGrantRequest;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function looksLikeCloudConnectionGrantRequest(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<CloudConnectionGrantRequest>;
  return (
    typeof r.version === "number" &&
    typeof r.service === "string" &&
    typeof r.requestedByInboxId === "string" &&
    typeof r.targetInboxId === "string" &&
    typeof r.reason === "string"
  );
}
