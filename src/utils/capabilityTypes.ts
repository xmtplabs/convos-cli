/**
 * Shared types for the upcoming capability-resolution surface
 * (convos.org/capability_request and capability_request_result).
 *
 * Mirrors the iOS `ConvosCore.CapabilityResolution` package
 * introduced in convos-ios#771 — `CapabilitySubject`, `ProviderID`,
 * and the federation-flag policy.
 */

// ─── CapabilitySubject ───

/**
 * What an agent is asking for. User-facing, provider-independent —
 * deliberately separate from `ConnectionKind` (which describes
 * device-side providers only).
 *
 * Note the user-facing rename versus `ConnectionKind`: device
 * `kind === "health"` corresponds to `subject === "fitness"`, and
 * device `kind === "home_kit"` corresponds to `subject === "home"`.
 * `motion` has no subject (device-only telemetry); `tasks` and `mail`
 * are subjects with no device counterpart yet.
 */
export type CapabilitySubject =
  | "calendar"
  | "contacts"
  | "tasks"
  | "mail"
  | "photos"
  | "fitness"
  | "music"
  | "location"
  | "home"
  | "screen_time";

export const ALL_CAPABILITY_SUBJECTS: readonly CapabilitySubject[] = [
  "calendar",
  "contacts",
  "tasks",
  "mail",
  "photos",
  "fitness",
  "music",
  "location",
  "home",
  "screen_time",
] as const;

/**
 * Whether `read` invocations on this subject can resolve to multiple
 * providers simultaneously. Writes never federate, regardless of
 * subject.
 *
 * Defaults to `false`; flipping a subject to `true` later is a
 * non-breaking expansion. Only `fitness` opts in for v1.
 */
export function allowsReadFederation(subject: CapabilitySubject): boolean {
  return subject === "fitness";
}

/** Runtime guard for decoded payloads — raw values from the wire aren't typed. */
export function isCapabilitySubject(value: unknown): value is CapabilitySubject {
  return typeof value === "string"
    && (ALL_CAPABILITY_SUBJECTS as readonly string[]).includes(value);
}

/** User-visible name for picker headers, settings rows, etc. */
export function capabilitySubjectDisplayName(subject: CapabilitySubject): string {
  switch (subject) {
    case "calendar":
      return "Calendar";
    case "contacts":
      return "Contacts";
    case "tasks":
      return "Tasks";
    case "mail":
      return "Mail";
    case "photos":
      return "Photos";
    case "fitness":
      return "Fitness";
    case "music":
      return "Music";
    case "location":
      return "Location";
    case "home":
      return "Home";
    case "screen_time":
      return "Screen Time";
  }
}

// ─── ProviderID ───

/**
 * Stable identifier for a `CapabilityProvider`. Encoded as a dotted
 * string on the wire (e.g. `"device.calendar"`, `"composio.strava"`,
 * `"composio.googlecalendar"`). For `composio.*` providers the second
 * segment is the Composio toolkit slug — the same slug iOS, the CLI,
 * the agent runtime, the backend, and Composio itself use end-to-end.
 *
 * Treat as opaque — the registry routes by lookup, not by parsing the
 * raw value. Aliased to `string` rather than wrapped in a nominal
 * type so JSON round-tripping requires no custom Codable.
 */
export type ProviderID = string;
