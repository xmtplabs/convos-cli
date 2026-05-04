/**
 * ConnectionInvocation content type for ConvosConnections (agent →
 * device write requests).
 *
 * Mirrors the iOS `ConnectionInvocationCodec` (PR #767):
 * - Content type: convos.org/connection_invocation:1.0
 * - Payload: JSON-encoded `ConnectionInvocation`
 * - Fallback: `"Action requested: <name>"`
 * - shouldPush: false
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";
import type { ArgumentValue, ConnectionKind } from "./connectionTypes.js";
import { assertArgumentValue } from "./connectionTypes.js";

// ─── Content Type ───

export const ContentTypeConnectionInvocation: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "connection_invocation",
  versionMajor: 1,
  versionMinor: 0,
};

export const CONNECTION_INVOCATION_CURRENT_SCHEMA_VERSION = 1;

// ─── Types ───

export interface ConnectionAction {
  name: string;
  arguments: Record<string, ArgumentValue>;
}

export interface ConnectionInvocation {
  /** Uppercase UUID (Swift's default UUID encoding). */
  id: string;
  schemaVersion: number;
  /** Caller-supplied correlation ID echoed back in the result. */
  invocationId: string;
  kind: ConnectionKind;
  action: ConnectionAction;
  /** Swift `Date` wire value: seconds since 2001-01-01 reference date. */
  issuedAt: number;
}

// ─── Codec ───

export class ConnectionInvocationCodec
  implements ContentCodec<ConnectionInvocation>
{
  get contentType(): ContentTypeId {
    return ContentTypeConnectionInvocation;
  }

  encode(content: ConnectionInvocation): EncodedContent {
    validateConnectionInvocation(content);
    const json = JSON.stringify(content);
    return {
      type: ContentTypeConnectionInvocation,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): ConnectionInvocation {
    if (!content.content || content.content.length === 0) {
      throw new Error("ConnectionInvocation content is empty");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(content.content));
    } catch {
      throw new Error("Invalid JSON format for ConnectionInvocation");
    }
    validateConnectionInvocation(parsed);
    return parsed;
  }

  fallback(content: ConnectionInvocation): string | undefined {
    return `Action requested: ${content.action.name}`;
  }

  shouldPush(_content: ConnectionInvocation): boolean {
    return false;
  }
}

// ─── Helpers ───

function validateConnectionInvocation(
  value: unknown,
): asserts value is ConnectionInvocation {
  if (!value || typeof value !== "object") {
    throw new Error("ConnectionInvocation: not an object");
  }
  const inv = value as Partial<ConnectionInvocation>;
  if (typeof inv.id !== "string") throw new Error("ConnectionInvocation: missing id");
  if (typeof inv.schemaVersion !== "number") throw new Error("ConnectionInvocation: missing schemaVersion");
  if (typeof inv.invocationId !== "string") throw new Error("ConnectionInvocation: missing invocationId");
  if (typeof inv.kind !== "string") throw new Error("ConnectionInvocation: missing kind");
  if (typeof inv.issuedAt !== "number") throw new Error("ConnectionInvocation: missing issuedAt");
  if (!inv.action || typeof inv.action !== "object") {
    throw new Error("ConnectionInvocation: missing action");
  }
  const action = inv.action as Partial<ConnectionAction>;
  if (typeof action.name !== "string") {
    throw new Error("ConnectionInvocation: missing action.name");
  }
  if (!action.arguments || typeof action.arguments !== "object" || Array.isArray(action.arguments)) {
    throw new Error("ConnectionInvocation: missing action.arguments");
  }
  for (const [key, arg] of Object.entries(action.arguments)) {
    assertArgumentValue(arg, `action.arguments[${key}]`);
  }
}

export function isConnectionInvocationMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeConnectionInvocation.authorityId &&
    ct.typeId === ContentTypeConnectionInvocation.typeId
  );
}

export function getConnectionInvocationContent(
  message: DecodedMessage,
): ConnectionInvocation | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (looksLikeConnectionInvocation(content)) {
    return content as ConnectionInvocation;
  }

  if ("content" in content && (content as { content: unknown }).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as { content: Uint8Array }).content);
      const parsed = JSON.parse(json) as unknown;
      if (looksLikeConnectionInvocation(parsed)) return parsed as ConnectionInvocation;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function looksLikeConnectionInvocation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const inv = value as Partial<ConnectionInvocation>;
  if (!inv.action || typeof inv.action !== "object" || Array.isArray(inv.action)) {
    return false;
  }
  const action = inv.action as Partial<ConnectionAction>;
  if (
    !action.arguments ||
    typeof action.arguments !== "object" ||
    Array.isArray(action.arguments)
  ) {
    return false;
  }
  return (
    typeof inv.id === "string" &&
    typeof inv.schemaVersion === "number" &&
    typeof inv.invocationId === "string" &&
    typeof inv.kind === "string" &&
    typeof inv.issuedAt === "number" &&
    typeof action.name === "string"
  );
}
