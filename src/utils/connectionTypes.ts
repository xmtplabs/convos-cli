/**
 * Shared types for the ConvosConnections content codecs.
 *
 * Mirrors the iOS `ConvosConnections` package (PR #767) so that
 * payloads, invocations, and results round-trip between platforms.
 *
 * Wire format notes (must match Swift's default JSONEncoder/JSONDecoder):
 * - `Date` is encoded as a `Double` representing seconds since the Swift
 *   reference date (2001-01-01 00:00:00 UTC), not the Unix epoch. Use
 *   `dateToSwiftReference()` / `swiftReferenceToDate()` to convert.
 * - `UUID` is encoded as an uppercase hex string with dashes.
 * - Enum raw values are lowercase or snake_case (e.g. `home_kit`,
 *   `screen_time`, `capability_not_enabled`).
 */

/** Seconds between Unix epoch (1970-01-01) and Swift reference date (2001-01-01). */
export const SWIFT_REFERENCE_EPOCH_OFFSET_SECONDS = 978307200;

/** Convert a JS Date to a Swift `Date` wire value (seconds since 2001-01-01). */
export function dateToSwiftReference(date: Date): number {
  return date.getTime() / 1000 - SWIFT_REFERENCE_EPOCH_OFFSET_SECONDS;
}

/** Convert a Swift `Date` wire value (seconds since 2001-01-01) back to a JS Date. */
export function swiftReferenceToDate(seconds: number): Date {
  return new Date((seconds + SWIFT_REFERENCE_EPOCH_OFFSET_SECONDS) * 1000);
}

// ─── ConnectionKind ───

/**
 * Identifies a native iOS data source. Raw values are the discriminator
 * used in `ConnectionPayloadBody` and `ConnectionInvocation.kind`.
 */
export type ConnectionKind =
  | "health"
  | "calendar"
  | "contacts"
  | "location"
  | "photos"
  | "music"
  | "home_kit"
  | "screen_time"
  | "motion";

export const ALL_CONNECTION_KINDS: readonly ConnectionKind[] = [
  "health",
  "calendar",
  "contacts",
  "location",
  "photos",
  "music",
  "home_kit",
  "screen_time",
  "motion",
] as const;

// ─── ArgumentValue ───

/**
 * Tagged-union value carried by `ConnectionAction.arguments` and the
 * `success` branch of `ConnectionInvocationResult.result`. Wire form is
 * `{"type": <tag>, "value": ...}`.
 *
 * The `date` variant carries a Swift reference-date Double; `iso8601`
 * carries a pre-formatted ISO 8601 string. Producers usually pick one
 * based on how the consuming action schema declares the parameter type.
 */
export type ArgumentValue =
  | { type: "string"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "int"; value: number }
  | { type: "double"; value: number }
  | { type: "date"; value: number }
  | { type: "iso8601"; value: string }
  | { type: "enum"; value: string }
  | { type: "array"; value: ArgumentValue[] }
  | { type: "null"; value: null };

const ARGUMENT_VALUE_TAGS: readonly ArgumentValue["type"][] = [
  "string",
  "bool",
  "int",
  "double",
  "date",
  "iso8601",
  "enum",
  "array",
  "null",
] as const;

/**
 * Validate that an arbitrary JSON value is a well-formed `ArgumentValue`.
 * Throws on the first invalid node.
 */
export function assertArgumentValue(
  value: unknown,
  path = "argument",
): asserts value is ArgumentValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: expected tagged object`);
  }
  const obj = value as { type?: unknown; value?: unknown };
  if (typeof obj.type !== "string" || !ARGUMENT_VALUE_TAGS.includes(obj.type as ArgumentValue["type"])) {
    throw new Error(`${path}: unknown type tag "${String(obj.type)}"`);
  }
  switch (obj.type as ArgumentValue["type"]) {
    case "string":
    case "iso8601":
    case "enum":
      if (typeof obj.value !== "string") throw new Error(`${path}: expected string value`);
      return;
    case "bool":
      if (typeof obj.value !== "boolean") throw new Error(`${path}: expected bool value`);
      return;
    case "int":
    case "double":
    case "date":
      if (typeof obj.value !== "number") throw new Error(`${path}: expected number value`);
      return;
    case "array":
      if (!Array.isArray(obj.value)) throw new Error(`${path}: expected array value`);
      obj.value.forEach((el, i) => assertArgumentValue(el, `${path}[${i}]`));
      return;
    case "null":
      if (obj.value !== null) throw new Error(`${path}: null variant must carry null`);
      return;
  }
}

// ─── ConnectionCapability ───

/**
 * Verbs an action can require, orthogonal to its `ConnectionKind`. A user
 * grants capabilities per `(kind, conversation)` independently — a
 * read-only Strava cloud provider declares `[read]`; a calendar device
 * sink declares all four. Used as the discriminator for capability
 * resolution and as the wire-level field on `CapabilityRequest`.
 *
 * Raw values match `ConnectionCapability` on iOS — `read` plus three
 * snake_case write verbs.
 */
export type ConnectionCapability =
  | "read"
  | "write_create"
  | "write_update"
  | "write_delete";

export const ALL_CONNECTION_CAPABILITIES: readonly ConnectionCapability[] = [
  "read",
  "write_create",
  "write_update",
  "write_delete",
] as const;

/** True for every capability except `read`. */
export function isWriteCapability(capability: ConnectionCapability): boolean {
  return capability !== "read";
}

/** Runtime guard for decoded payloads — raw values from the wire aren't typed. */
export function isConnectionCapability(value: unknown): value is ConnectionCapability {
  return typeof value === "string"
    && (ALL_CONNECTION_CAPABILITIES as readonly string[]).includes(value);
}

// ─── InvocationStatus ───

/**
 * Result status emitted by the device after attempting an invocation.
 * Raw values match `ConnectionInvocationResult.Status` on iOS.
 */
export type InvocationStatus =
  | "success"
  | "capability_not_enabled"
  | "capability_revoked"
  | "requires_confirmation"
  | "authorization_denied"
  | "execution_failed"
  | "unknown_action";

export const ALL_INVOCATION_STATUSES: readonly InvocationStatus[] = [
  "success",
  "capability_not_enabled",
  "capability_revoked",
  "requires_confirmation",
  "authorization_denied",
  "execution_failed",
  "unknown_action",
] as const;
