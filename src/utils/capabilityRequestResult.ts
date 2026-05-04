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
import {
  capabilitySubjectDisplayName,
  isCapabilitySubject,
} from "./capabilityTypes.js";
import type { ConnectionCapability, ConnectionKind } from "./connectionTypes.js";
import { isConnectionCapability } from "./connectionTypes.js";

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

/** Cap on the availableActions array. Anything longer is truncated on encode and decode. */
export const CAPABILITY_REQUEST_RESULT_MAX_AVAILABLE_ACTIONS = 64;

// ─── Types ───

export type CapabilityRequestResultStatus = "approved" | "denied" | "cancelled";

export const ALL_CAPABILITY_REQUEST_RESULT_STATUSES: readonly CapabilityRequestResultStatus[] = [
  "approved",
  "denied",
  "cancelled",
] as const;

/**
 * Single I/O parameter on an `AvailableAction` schema. Keys mirror the
 * iOS `CapabilityRequestResult.Parameter` (note `isRequired`, not
 * `required`).
 */
export interface AvailableActionParameter {
  name: string;
  /**
   * Schema type as a free-form string. iOS encodes whatever string the
   * source `ActionSchema.parameter.type` produced (e.g. `"string"`,
   * `"int"`, `"date"`, `"array<string>"`). The CLI doesn't constrain
   * the value; consumers should treat it as a hint.
   */
  type: string;
  description: string;
  isRequired: boolean;
}

/**
 * Action schema entry returned alongside an approved capability so the
 * agent knows what verbs it can invoke without round-tripping a probe.
 *
 * Mirrors iOS `CapabilityRequestResult.AvailableAction`:
 *   { providerId, kind, actionName, summary, inputs, outputs }.
 */
export interface AvailableAction {
  /** Routes this action to a specific provider in the resolution. */
  providerId: ProviderID;
  /** Device kind that owns the action. Cloud providers reuse this for routing. */
  kind: ConnectionKind;
  actionName: string;
  summary: string;
  inputs: AvailableActionParameter[];
  outputs: AvailableActionParameter[];
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
   * Action schemas compatible with the approved capability, filtered to
   * the providers above. Empty for `denied` / `cancelled`. Truncated to
   * `CAPABILITY_REQUEST_RESULT_MAX_AVAILABLE_ACTIONS` on encode/decode.
   *
   * Always emitted as an array on the wire (iOS encodes empty arrays);
   * decoders also accept missing keys for forward-compat.
   */
  availableActions: AvailableAction[];
}

// ─── Codec ───

export class CapabilityRequestResultCodec
  implements ContentCodec<CapabilityRequestResult>
{
  get contentType(): ContentTypeId {
    return ContentTypeCapabilityRequestResult;
  }

  encode(content: CapabilityRequestResult): EncodedContent {
    validateCapabilityRequestResult(content);
    const sanitized = sanitizeCapabilityRequestResult(content);
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
    const normalized = normalizeForDecode(parsed);
    validateCapabilityRequestResult(normalized);
    if (normalized.version > CAPABILITY_REQUEST_RESULT_SUPPORTED_VERSION) {
      throw new Error(
        `Unsupported CapabilityRequestResult version ${normalized.version}`,
      );
    }
    return sanitizeCapabilityRequestResult(normalized);
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

/**
 * Default missing array fields to `[]` so a sender that omits empty
 * arrays still validates. Validation runs on the normalized object.
 */
function normalizeForDecode(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (obj.providers === undefined || obj.providers === null) {
    obj.providers = [];
  }
  if (obj.availableActions === undefined || obj.availableActions === null) {
    obj.availableActions = [];
  }
  return obj;
}

function validateCapabilityRequestResult(
  value: unknown,
): asserts value is CapabilityRequestResult {
  if (!value || typeof value !== "object") {
    throw new Error("CapabilityRequestResult: not an object");
  }
  const r = value as Partial<CapabilityRequestResult>;
  if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) {
    throw new Error(`CapabilityRequestResult: invalid version ${JSON.stringify(r.version)}`);
  }
  if (typeof r.requestId !== "string") throw new Error("CapabilityRequestResult: missing requestId");
  if (
    r.status !== "approved" &&
    r.status !== "denied" &&
    r.status !== "cancelled"
  ) {
    throw new Error(`CapabilityRequestResult: invalid status ${JSON.stringify(r.status)}`);
  }
  if (!isCapabilitySubject(r.subject)) {
    throw new Error(`CapabilityRequestResult: invalid subject ${JSON.stringify(r.subject)}`);
  }
  if (!isConnectionCapability(r.capability)) {
    throw new Error(`CapabilityRequestResult: invalid capability ${JSON.stringify(r.capability)}`);
  }
  if (!Array.isArray(r.providers)) {
    throw new Error("CapabilityRequestResult: providers must be an array");
  }
  for (const id of r.providers) {
    if (typeof id !== "string") {
      throw new Error("CapabilityRequestResult: providers entries must be strings");
    }
  }
  if (!Array.isArray(r.availableActions)) {
    throw new Error("CapabilityRequestResult: availableActions must be an array");
  }
  for (const action of r.availableActions) {
    validateAvailableAction(action);
  }
}

function validateAvailableAction(value: unknown): asserts value is AvailableAction {
  if (!value || typeof value !== "object") {
    throw new Error("CapabilityRequestResult: availableAction must be an object");
  }
  const action = value as Partial<AvailableAction>;
  if (typeof action.providerId !== "string") {
    throw new Error("CapabilityRequestResult: availableAction missing providerId");
  }
  if (typeof action.kind !== "string") {
    throw new Error("CapabilityRequestResult: availableAction missing kind");
  }
  if (typeof action.actionName !== "string") {
    throw new Error("CapabilityRequestResult: availableAction missing actionName");
  }
  if (typeof action.summary !== "string") {
    throw new Error("CapabilityRequestResult: availableAction missing summary");
  }
  if (!Array.isArray(action.inputs)) {
    throw new Error("CapabilityRequestResult: availableAction inputs must be an array");
  }
  if (!Array.isArray(action.outputs)) {
    throw new Error("CapabilityRequestResult: availableAction outputs must be an array");
  }
  for (const input of action.inputs) validateAvailableActionParameter(input);
  for (const output of action.outputs) validateAvailableActionParameter(output);
}

function validateAvailableActionParameter(
  value: unknown,
): asserts value is AvailableActionParameter {
  if (!value || typeof value !== "object") {
    throw new Error("CapabilityRequestResult: availableAction parameter must be an object");
  }
  const parameter = value as Partial<AvailableActionParameter>;
  if (typeof parameter.name !== "string") {
    throw new Error("CapabilityRequestResult: availableAction parameter missing name");
  }
  if (typeof parameter.type !== "string") {
    throw new Error("CapabilityRequestResult: availableAction parameter missing type");
  }
  if (typeof parameter.description !== "string") {
    throw new Error("CapabilityRequestResult: availableAction parameter missing description");
  }
  if (typeof parameter.isRequired !== "boolean") {
    throw new Error("CapabilityRequestResult: availableAction parameter missing isRequired");
  }
}

function sanitizeCapabilityRequestResult(
  value: CapabilityRequestResult,
): CapabilityRequestResult {
  const providers =
    value.providers.length > CAPABILITY_REQUEST_RESULT_MAX_PROVIDERS
      ? value.providers.slice(0, CAPABILITY_REQUEST_RESULT_MAX_PROVIDERS)
      : value.providers;
  const availableActions =
    value.availableActions.length > CAPABILITY_REQUEST_RESULT_MAX_AVAILABLE_ACTIONS
      ? value.availableActions.slice(
          0,
          CAPABILITY_REQUEST_RESULT_MAX_AVAILABLE_ACTIONS,
        )
      : value.availableActions;
  return { ...value, providers, availableActions };
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
      const normalized = normalizeForDecode(parsed);
      if (!looksLikeCapabilityRequestResult(normalized)) return undefined;
      // Run the same per-entry validation and array-cap sanitization that
      // `codec.decode()` performs — `looksLike*` only checks top-level
      // shape, so without these calls a payload with malformed
      // `availableActions` entries or an over-cap array could leak into
      // downstream consumers.
      validateCapabilityRequestResult(normalized);
      return sanitizeCapabilityRequestResult(normalized);
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
    (r.status === "approved" || r.status === "denied" || r.status === "cancelled") &&
    isCapabilitySubject(r.subject) &&
    isConnectionCapability(r.capability) &&
    Array.isArray(r.providers) &&
    Array.isArray(r.availableActions)
  );
}
