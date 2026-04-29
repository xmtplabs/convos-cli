/**
 * CapabilityRequestResult content type — device → agent reply to a
 * CapabilityRequest. Always emitted, even on cancel/deny, so the
 * agent can correlate by `requestId` and stop waiting.
 *
 * Mirrors the iOS `CapabilityRequestResultCodec` (PR #771):
 * - Content type: convos.org/capability_request_result:1.0
 * - Payload: JSON-encoded `CapabilityRequestResult`
 * - Fallback: status-aware ("Approved …", "Declined …", "Cancelled …")
 * - shouldPush: false
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";
import type {
  CapabilitySubject,
  ProviderID,
} from "./capabilityTypes.js";
import { capabilitySubjectDisplayName } from "./capabilityTypes.js";
import type { ConnectionCapability } from "./connectionTypes.js";

// ─── Content Type ───

export const ContentTypeCapabilityRequestResult: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "capability_request_result",
  versionMajor: 1,
  versionMinor: 0,
};

/** Highest schema version this codec understands. */
export const CAPABILITY_REQUEST_RESULT_SUPPORTED_VERSION = 1;

/** Cap on the providers array. Anything longer is truncated on encode and decode. */
export const CAPABILITY_REQUEST_RESULT_MAX_PROVIDERS = 16;

// ─── Types ───

export type CapabilityRequestResultStatus = "approved" | "denied" | "cancelled";

export const ALL_CAPABILITY_REQUEST_RESULT_STATUSES: readonly CapabilityRequestResultStatus[] = [
  "approved",
  "denied",
  "cancelled",
] as const;

export interface CapabilityRequestResultActionSchemaParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  enumValues?: string[];
  itemType?: string;
  itemEnumValues?: string[];
}

export interface CapabilityRequestResultActionSchema {
  name: string;
  summary: string;
  inputs: CapabilityRequestResultActionSchemaParameter[];
  outputs: CapabilityRequestResultActionSchemaParameter[];
}

export interface CapabilityRequestResult {
  /** Schema version. Must equal `CAPABILITY_REQUEST_RESULT_SUPPORTED_VERSION` (1) for now. */
  version: number;
  /** Echoes the request's `requestId` for correlation. */
  requestId: string;
  status: CapabilityRequestResultStatus;
  subject: CapabilitySubject;
  capability: ConnectionCapability;
  /**
   * Empty for `denied` / `cancelled`. For `approved`, size is 1 for
   * non-federating subjects and write verbs, ≥ 1 for federating-subject
   * reads. Reflects what the resolver actually persisted — agents that
   * supplied a `preferredProviders` hint should compare against this
   * to confirm whether their hint was honored.
   */
  providers: ProviderID[];
  /**
   * Optional action schemas surfaced by iOS when a capability approval
   * resolves to a provider that can advertise invocable actions.
   */
  actions?: CapabilityRequestResultActionSchema[];
}

// ─── Codec ───

export class CapabilityRequestResultCodec
  implements ContentCodec<CapabilityRequestResult>
{
  get contentType(): ContentTypeId {
    return ContentTypeCapabilityRequestResult;
  }

  encode(content: CapabilityRequestResult): EncodedContent {
    const sanitized = sanitizeCapabilityRequestResult(content);
    validateCapabilityRequestResult(sanitized);
    const json = JSON.stringify(sanitized);
    return {
      type: ContentTypeCapabilityRequestResult,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): CapabilityRequestResult {
    if (!content.content || content.content.length === 0) {
      throw new Error("CapabilityRequestResult content is empty");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(content.content));
    } catch {
      throw new Error("Invalid JSON format for CapabilityRequestResult");
    }
    validateCapabilityRequestResult(parsed);
    if (parsed.version > CAPABILITY_REQUEST_RESULT_SUPPORTED_VERSION) {
      throw new Error(
        `Unsupported CapabilityRequestResult version ${parsed.version}`,
      );
    }
    return sanitizeCapabilityRequestResult(parsed);
  }

  fallback(content: CapabilityRequestResult): string | undefined {
    const subject = capabilitySubjectDisplayName(content.subject).toLowerCase();
    switch (content.status) {
      case "approved":
        return `Approved ${subject} access`;
      case "denied":
        return `Declined ${subject} access`;
      case "cancelled":
        return `Cancelled ${subject} access request`;
    }
  }

  shouldPush(_content: CapabilityRequestResult): boolean {
    return false;
  }
}

// ─── Helpers ───

function validateCapabilityRequestResult(
  value: unknown,
): asserts value is CapabilityRequestResult {
  if (!value || typeof value !== "object") {
    throw new Error("CapabilityRequestResult: not an object");
  }
  const r = value as Partial<CapabilityRequestResult>;
  if (typeof r.version !== "number") throw new Error("CapabilityRequestResult: missing version");
  if (typeof r.requestId !== "string") throw new Error("CapabilityRequestResult: missing requestId");
  if (typeof r.status !== "string") throw new Error("CapabilityRequestResult: missing status");
  if (typeof r.subject !== "string") throw new Error("CapabilityRequestResult: missing subject");
  if (typeof r.capability !== "string") throw new Error("CapabilityRequestResult: missing capability");
  if (!Array.isArray(r.providers)) {
    throw new Error("CapabilityRequestResult: providers must be an array");
  }
  for (const id of r.providers) {
    if (typeof id !== "string") {
      throw new Error("CapabilityRequestResult: providers entries must be strings");
    }
  }
  if (r.actions !== undefined) {
    if (!Array.isArray(r.actions)) {
      throw new Error("CapabilityRequestResult: actions must be an array when present");
    }
    for (const action of r.actions) {
      validateActionSchema(action);
    }
  }
}

function validateActionSchema(value: unknown): void {
  if (!value || typeof value !== "object") {
    throw new Error("CapabilityRequestResult: action schema must be an object");
  }
  const action = value as Partial<CapabilityRequestResultActionSchema>;
  if (typeof action.name !== "string") {
    throw new Error("CapabilityRequestResult: action schema missing name");
  }
  if (typeof action.summary !== "string") {
    throw new Error("CapabilityRequestResult: action schema missing summary");
  }
  if (!Array.isArray(action.inputs)) {
    throw new Error("CapabilityRequestResult: action schema inputs must be an array");
  }
  if (!Array.isArray(action.outputs)) {
    throw new Error("CapabilityRequestResult: action schema outputs must be an array");
  }
  for (const input of action.inputs) validateActionParameter(input);
  for (const output of action.outputs) validateActionParameter(output);
}

function validateActionParameter(value: unknown): void {
  if (!value || typeof value !== "object") {
    throw new Error("CapabilityRequestResult: action parameter must be an object");
  }
  const parameter = value as Partial<CapabilityRequestResultActionSchemaParameter>;
  if (typeof parameter.name !== "string") {
    throw new Error("CapabilityRequestResult: action parameter missing name");
  }
  if (typeof parameter.type !== "string") {
    throw new Error("CapabilityRequestResult: action parameter missing type");
  }
  if (typeof parameter.description !== "string") {
    throw new Error("CapabilityRequestResult: action parameter missing description");
  }
  if (typeof parameter.required !== "boolean") {
    throw new Error("CapabilityRequestResult: action parameter missing required");
  }
  if (parameter.enumValues !== undefined) {
    if (!Array.isArray(parameter.enumValues) || parameter.enumValues.some((v) => typeof v !== "string")) {
      throw new Error("CapabilityRequestResult: action parameter enumValues must be a string array");
    }
  }
  if (parameter.itemType !== undefined && typeof parameter.itemType !== "string") {
    throw new Error("CapabilityRequestResult: action parameter itemType must be a string");
  }
  if (parameter.itemEnumValues !== undefined) {
    if (!Array.isArray(parameter.itemEnumValues) || parameter.itemEnumValues.some((v) => typeof v !== "string")) {
      throw new Error("CapabilityRequestResult: action parameter itemEnumValues must be a string array");
    }
  }
}

function sanitizeCapabilityRequestResult(
  value: CapabilityRequestResult,
): CapabilityRequestResult {
  const providers =
    value.providers.length > CAPABILITY_REQUEST_RESULT_MAX_PROVIDERS
      ? value.providers.slice(0, CAPABILITY_REQUEST_RESULT_MAX_PROVIDERS)
      : value.providers;
  return { ...value, providers };
}

export function isCapabilityRequestResultMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeCapabilityRequestResult.authorityId &&
    ct.typeId === ContentTypeCapabilityRequestResult.typeId
  );
}

export function getCapabilityRequestResultContent(
  message: DecodedMessage,
): CapabilityRequestResult | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (looksLikeCapabilityRequestResult(content)) {
    return content as CapabilityRequestResult;
  }

  if ("content" in content && (content as { content: unknown }).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as { content: Uint8Array }).content);
      const parsed = JSON.parse(json) as unknown;
      if (looksLikeCapabilityRequestResult(parsed)) {
        return parsed as CapabilityRequestResult;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function looksLikeCapabilityRequestResult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<CapabilityRequestResult>;
  return (
    typeof r.version === "number" &&
    typeof r.requestId === "string" &&
    typeof r.status === "string" &&
    typeof r.subject === "string" &&
    typeof r.capability === "string" &&
    Array.isArray(r.providers) &&
    (r.actions === undefined || Array.isArray(r.actions))
  );
}
