/**
 * CapabilityRequest content type for ConvosConnections capability
 * resolution (agent → device "may I have this capability?").
 *
 * Mirrors the iOS `CapabilityRequestCodec` (PR #771):
 * - Content type: convos.org/capability_request:1.0
 * - Payload: JSON-encoded `CapabilityRequest`
 * - Fallback: `"The assistant is requesting access to your <subject>"`
 * - shouldPush: false (silent — surfaces via the picker UI)
 *
 * The device routes the request into `CapabilityResolver`, which
 * shows a picker / confirmation card. The user's choice arrives back
 * as a `CapabilityRequestResult` keyed on the same `requestId`.
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";
import type {
  CapabilitySubject,
  ProviderID,
} from "./capabilityTypes.js";
import {
  capabilitySubjectDisplayName,
  isCapabilitySubject,
} from "./capabilityTypes.js";
import type { ConnectionCapability } from "./connectionTypes.js";
import { isConnectionCapability } from "./connectionTypes.js";

// ─── Content Type ───

export const ContentTypeCapabilityRequest: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "capability_request",
  versionMajor: 1,
  versionMinor: 0,
};

/** Highest schema version this codec understands. */
export const CAPABILITY_REQUEST_SUPPORTED_VERSION = 1;

/** Cap on the rationale string. Anything longer is truncated on encode and decode. */
export const CAPABILITY_REQUEST_MAX_RATIONALE_LENGTH = 500;

/** Cap on preferredProviders entries. Anything longer is truncated on encode and decode. */
export const CAPABILITY_REQUEST_MAX_PREFERRED_PROVIDERS = 16;

// ─── Types ───

export interface CapabilityRequest {
  /** Schema version. Must equal `CAPABILITY_REQUEST_SUPPORTED_VERSION` (1) for now. */
  version: number;
  /** Caller-supplied correlation ID echoed back on the result. */
  requestId: string;
  subject: CapabilitySubject;
  capability: ConnectionCapability;
  /** Free-form human-readable reason; rendered verbatim on the picker card. */
  rationale: string;
  /**
   * Optional agent hint — provider IDs the agent has previously seen
   * in `profile.metadata["capabilities"]` and would prefer the
   * resolver default to. The resolver may override.
   */
  preferredProviders?: ProviderID[];
}

// ─── Codec ───

export class CapabilityRequestCodec implements ContentCodec<CapabilityRequest> {
  get contentType(): ContentTypeId {
    return ContentTypeCapabilityRequest;
  }

  encode(content: CapabilityRequest): EncodedContent {
    validateCapabilityRequest(content);
    const sanitized = sanitizeCapabilityRequest(content);
    const json = JSON.stringify(sanitized);
    return {
      type: ContentTypeCapabilityRequest,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): CapabilityRequest {
    if (!content.content || content.content.length === 0) {
      throw new Error("CapabilityRequest content is empty");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(content.content));
    } catch {
      throw new Error("Invalid JSON format for CapabilityRequest");
    }
    validateCapabilityRequest(parsed);
    return sanitizeCapabilityRequest(parsed);
  }

  fallback(content: CapabilityRequest): string | undefined {
    return `The assistant is requesting access to your ${capabilitySubjectDisplayName(
      content.subject,
    ).toLowerCase()}`;
  }

  shouldPush(_content: CapabilityRequest): boolean {
    return false;
  }
}

// ─── Helpers ───

function validateCapabilityRequest(
  value: unknown,
): asserts value is CapabilityRequest {
  if (!value || typeof value !== "object") {
    throw new Error("CapabilityRequest: not an object");
  }
  const r = value as Partial<CapabilityRequest>;
  if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) {
    throw new Error(`CapabilityRequest: invalid version ${JSON.stringify(r.version)}`);
  }
  if (r.version > CAPABILITY_REQUEST_SUPPORTED_VERSION) {
    throw new Error(`Unsupported CapabilityRequest version ${r.version}`);
  }
  if (typeof r.requestId !== "string") throw new Error("CapabilityRequest: missing requestId");
  if (!isCapabilitySubject(r.subject)) {
    throw new Error(`CapabilityRequest: invalid subject ${JSON.stringify(r.subject)}`);
  }
  if (!isConnectionCapability(r.capability)) {
    throw new Error(`CapabilityRequest: invalid capability ${JSON.stringify(r.capability)}`);
  }
  if (typeof r.rationale !== "string") throw new Error("CapabilityRequest: missing rationale");
  if (r.preferredProviders !== undefined && r.preferredProviders !== null) {
    if (!Array.isArray(r.preferredProviders)) {
      throw new Error("CapabilityRequest: preferredProviders must be an array");
    }
    for (const id of r.preferredProviders) {
      if (typeof id !== "string") {
        throw new Error("CapabilityRequest: preferredProviders entries must be strings");
      }
    }
  }
}

/**
 * Truncate `rationale` and `preferredProviders` to the same caps the
 * iOS decoder enforces — agents that exceed them on encode get the
 * truncated version back on decode, so do the truncation up-front so
 * round-trips compare equal.
 */
function sanitizeCapabilityRequest(value: CapabilityRequest): CapabilityRequest {
  const rationale =
    value.rationale.length > CAPABILITY_REQUEST_MAX_RATIONALE_LENGTH
      ? value.rationale.slice(0, CAPABILITY_REQUEST_MAX_RATIONALE_LENGTH)
      : value.rationale;
  const preferredProviders =
    value.preferredProviders &&
    value.preferredProviders.length > CAPABILITY_REQUEST_MAX_PREFERRED_PROVIDERS
      ? value.preferredProviders.slice(0, CAPABILITY_REQUEST_MAX_PREFERRED_PROVIDERS)
      : value.preferredProviders;
  return {
    ...value,
    rationale,
    ...(preferredProviders !== undefined && { preferredProviders }),
  };
}

export function isCapabilityRequestMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeCapabilityRequest.authorityId &&
    ct.typeId === ContentTypeCapabilityRequest.typeId
  );
}

export function getCapabilityRequestContent(
  message: DecodedMessage,
): CapabilityRequest | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  // Both branches run the same validate + sanitize that `codec.decode()`
  // performs — `looksLike*` only checks top-level shape, so without
  // these calls a payload with malformed nested fields or an over-cap
  // rationale could leak into downstream consumers.
  if (looksLikeCapabilityRequest(content)) {
    try {
      validateCapabilityRequest(content);
      return sanitizeCapabilityRequest(content as CapabilityRequest);
    } catch {
      return undefined;
    }
  }

  if ("content" in content && (content as { content: unknown }).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as { content: Uint8Array }).content);
      const parsed = JSON.parse(json) as unknown;
      if (!looksLikeCapabilityRequest(parsed)) return undefined;
      validateCapabilityRequest(parsed);
      return sanitizeCapabilityRequest(parsed);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function looksLikeCapabilityRequest(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<CapabilityRequest>;
  return (
    typeof r.version === "number" &&
    typeof r.requestId === "string" &&
    isCapabilitySubject(r.subject) &&
    isConnectionCapability(r.capability) &&
    typeof r.rationale === "string"
  );
}
