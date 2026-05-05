/**
 * ConnectionInvocationResult content type for ConvosConnections (device →
 * agent write outcomes).
 *
 * Mirrors the iOS `ConnectionInvocationResultCodec` (PR #767):
 * - Content type: convos.org/connection_invocation_result:1.0
 * - Payload: JSON-encoded `ConnectionInvocationResult`
 * - Fallback: `"<actionName>: <status>"`
 * - shouldPush: false
 *
 * Always emitted by the device, even on failure. `invocationId` echoes
 * the request so the agent can correlate.
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";
import type {
  ArgumentValue,
  ConnectionKind,
  InvocationStatus,
} from "./connectionTypes.js";
import { assertArgumentValue } from "./connectionTypes.js";

// ─── Content Type ───

export const ContentTypeConnectionInvocationResult: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "connection_invocation_result",
  versionMajor: 1,
  versionMinor: 0,
};

export const CONNECTION_INVOCATION_RESULT_CURRENT_SCHEMA_VERSION = 1;

// ─── Types ───

export interface ConnectionInvocationResult {
  /** Uppercase UUID (Swift's default UUID encoding). */
  id: string;
  schemaVersion: number;
  /** Echoes the request's `invocationId` for correlation. */
  invocationId: string;
  kind: ConnectionKind;
  actionName: string;
  status: InvocationStatus;
  /** Populated only on `status == "success"`. Keys match `ActionSchema.outputs`. */
  result: Record<string, ArgumentValue>;
  /** Human-readable failure description, when surfaced by the framework. */
  errorMessage?: string;
  /** Swift `Date` wire value: seconds since 2001-01-01 reference date. */
  completedAt: number;
}

// ─── Codec ───

export class ConnectionInvocationResultCodec
  implements ContentCodec<ConnectionInvocationResult>
{
  get contentType(): ContentTypeId {
    return ContentTypeConnectionInvocationResult;
  }

  encode(content: ConnectionInvocationResult): EncodedContent {
    validateConnectionInvocationResult(content);
    const json = JSON.stringify(content);
    return {
      type: ContentTypeConnectionInvocationResult,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): ConnectionInvocationResult {
    if (!content.content || content.content.length === 0) {
      throw new Error("ConnectionInvocationResult content is empty");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(content.content));
    } catch {
      throw new Error("Invalid JSON format for ConnectionInvocationResult");
    }
    validateConnectionInvocationResult(parsed);
    return parsed;
  }

  fallback(content: ConnectionInvocationResult): string | undefined {
    return `${content.actionName}: ${content.status}`;
  }

  shouldPush(_content: ConnectionInvocationResult): boolean {
    return false;
  }
}

// ─── Helpers ───

function validateConnectionInvocationResult(
  value: unknown,
): asserts value is ConnectionInvocationResult {
  if (!value || typeof value !== "object") {
    throw new Error("ConnectionInvocationResult: not an object");
  }
  const r = value as Partial<ConnectionInvocationResult>;
  if (typeof r.id !== "string") throw new Error("ConnectionInvocationResult: missing id");
  if (typeof r.schemaVersion !== "number") throw new Error("ConnectionInvocationResult: missing schemaVersion");
  if (typeof r.invocationId !== "string") throw new Error("ConnectionInvocationResult: missing invocationId");
  if (typeof r.kind !== "string") throw new Error("ConnectionInvocationResult: missing kind");
  if (typeof r.actionName !== "string") throw new Error("ConnectionInvocationResult: missing actionName");
  if (typeof r.status !== "string") throw new Error("ConnectionInvocationResult: missing status");
  if (typeof r.completedAt !== "number") throw new Error("ConnectionInvocationResult: missing completedAt");
  if (!r.result || typeof r.result !== "object" || Array.isArray(r.result)) {
    throw new Error("ConnectionInvocationResult: missing result");
  }
  for (const [key, arg] of Object.entries(r.result)) {
    assertArgumentValue(arg, `result[${key}]`);
  }
  if (r.errorMessage !== undefined && r.errorMessage !== null && typeof r.errorMessage !== "string") {
    throw new Error("ConnectionInvocationResult: errorMessage must be a string when present");
  }
}

export function isConnectionInvocationResultMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeConnectionInvocationResult.authorityId &&
    ct.typeId === ContentTypeConnectionInvocationResult.typeId
  );
}

export function getConnectionInvocationResultContent(
  message: DecodedMessage,
): ConnectionInvocationResult | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  // Both branches run the per-result validation that `codec.decode()`
  // performs — `looksLike*` only checks top-level shape, so without
  // these calls a payload with malformed `result` ArgumentValue tags
  // could leak into downstream consumers.
  if (looksLikeConnectionInvocationResult(content)) {
    try {
      validateConnectionInvocationResult(content);
      return content as ConnectionInvocationResult;
    } catch {
      return undefined;
    }
  }

  if ("content" in content && (content as { content: unknown }).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as { content: Uint8Array }).content);
      const parsed = JSON.parse(json) as unknown;
      if (!looksLikeConnectionInvocationResult(parsed)) return undefined;
      validateConnectionInvocationResult(parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function looksLikeConnectionInvocationResult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<ConnectionInvocationResult>;
  return (
    typeof r.id === "string" &&
    typeof r.schemaVersion === "number" &&
    typeof r.invocationId === "string" &&
    typeof r.kind === "string" &&
    typeof r.actionName === "string" &&
    typeof r.status === "string" &&
    typeof r.completedAt === "number" &&
    !!r.result &&
    typeof r.result === "object" &&
    !Array.isArray(r.result)
  );
}
