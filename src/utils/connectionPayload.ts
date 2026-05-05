/**
 * ConnectionPayload content type for ConvosConnections (device → agent
 * sensor events).
 *
 * Mirrors the iOS `ConnectionPayloadCodec` (PR #767):
 * - Content type: convos.org/connection_payload:1.0
 * - Payload: JSON-encoded `ConnectionPayload`
 * - Fallback: `payload.summary`
 * - shouldPush: false (silent — agent consumes via dedicated handler)
 *
 * The CLI does not model each per-source payload body type. The body is
 * carried as `{ type, data: unknown }` so we round-trip every known
 * source unchanged plus any future types iOS may ship before the CLI
 * gains explicit support.
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";
import type { ConnectionKind } from "./connectionTypes.js";

// ─── Content Type ───

export const ContentTypeConnectionPayload: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "connection_payload",
  versionMajor: 1,
  versionMinor: 0,
};

export const CONNECTION_PAYLOAD_CURRENT_SCHEMA_VERSION = 1;

// ─── Types ───

/**
 * Source-specific payload body. `type` is one of the known
 * `ConnectionKind` raw values OR any other string for forward
 * compatibility with newer iOS builds.
 */
export interface ConnectionPayloadBody {
  type: ConnectionKind | (string & {});
  data: unknown;
}

export interface ConnectionPayload {
  /** Uppercase UUID (Swift's default UUID encoding). */
  id: string;
  schemaVersion: number;
  source: ConnectionKind;
  /** Swift `Date` wire value: seconds since 2001-01-01 reference date. */
  capturedAt: number;
  body: ConnectionPayloadBody;
}

// ─── Codec ───

export class ConnectionPayloadCodec implements ContentCodec<ConnectionPayload> {
  get contentType(): ContentTypeId {
    return ContentTypeConnectionPayload;
  }

  encode(content: ConnectionPayload): EncodedContent {
    validateConnectionPayload(content);
    const json = JSON.stringify(content);
    return {
      type: ContentTypeConnectionPayload,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): ConnectionPayload {
    if (!content.content || content.content.length === 0) {
      throw new Error("ConnectionPayload content is empty");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(content.content));
    } catch {
      throw new Error("Invalid JSON format for ConnectionPayload");
    }
    validateConnectionPayload(parsed);
    return parsed;
  }

  fallback(content: ConnectionPayload): string | undefined {
    return summarizeConnectionPayload(content);
  }

  shouldPush(_content: ConnectionPayload): boolean {
    return false;
  }
}

// ─── Helpers ───

function validateConnectionPayload(value: unknown): asserts value is ConnectionPayload {
  if (!value || typeof value !== "object") {
    throw new Error("ConnectionPayload: not an object");
  }
  const p = value as Partial<ConnectionPayload>;
  if (typeof p.id !== "string") throw new Error("ConnectionPayload: missing id");
  if (typeof p.schemaVersion !== "number") throw new Error("ConnectionPayload: missing schemaVersion");
  if (typeof p.source !== "string") throw new Error("ConnectionPayload: missing source");
  if (typeof p.capturedAt !== "number") throw new Error("ConnectionPayload: missing capturedAt");
  if (!p.body || typeof p.body !== "object" || typeof (p.body as ConnectionPayloadBody).type !== "string") {
    throw new Error("ConnectionPayload: missing body.type");
  }
}

/**
 * Best-effort human-readable summary, mirroring the per-body `summary`
 * accessor on iOS. Falls back to the body's discriminator when the
 * payload doesn't carry an explicit summary string.
 */
export function summarizeConnectionPayload(payload: ConnectionPayload): string {
  const data = payload.body.data;
  if (data && typeof data === "object" && "summary" in data) {
    const summary = (data as { summary?: unknown }).summary;
    if (typeof summary === "string") return summary;
  }
  return `Unknown payload (${payload.body.type})`;
}

export function isConnectionPayloadMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeConnectionPayload.authorityId &&
    ct.typeId === ContentTypeConnectionPayload.typeId
  );
}

/**
 * Extract a `ConnectionPayload` from a DecodedMessage whether the codec
 * was registered at client creation or not.
 */
export function getConnectionPayloadContent(
  message: DecodedMessage,
): ConnectionPayload | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  // Both branches run the same body validation `codec.decode()` performs.
  if (looksLikeConnectionPayload(content)) {
    try {
      validateConnectionPayload(content);
      return content as ConnectionPayload;
    } catch {
      return undefined;
    }
  }

  if ("content" in content && (content as { content: unknown }).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as { content: Uint8Array }).content);
      const parsed = JSON.parse(json) as unknown;
      if (!looksLikeConnectionPayload(parsed)) return undefined;
      validateConnectionPayload(parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function looksLikeConnectionPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ConnectionPayload>;
  return (
    typeof p.id === "string" &&
    typeof p.schemaVersion === "number" &&
    typeof p.source === "string" &&
    typeof p.capturedAt === "number" &&
    !!p.body &&
    typeof p.body === "object" &&
    typeof (p.body as ConnectionPayloadBody).type === "string"
  );
}
