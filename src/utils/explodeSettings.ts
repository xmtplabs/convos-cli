import type { EncodedContent } from "@xmtp/node-bindings";

/**
 * Encode an ExplodeSettings message matching the iOS content type.
 *
 * Content type: convos.org/explode_settings:1.0
 * Payload: JSON-encoded { expiresAt: ISO8601 string }
 * Fallback: "Conversation expires at {date}"
 */
export function encodeExplodeSettings(expiresAt: Date): EncodedContent {
  const payload = JSON.stringify({
    expiresAt: expiresAt.toISOString(),
  });

  return {
    type: {
      authorityId: "convos.org",
      typeId: "explode_settings",
      versionMajor: 1,
      versionMinor: 0,
    },
    parameters: {},
    fallback: `Conversation expires at ${expiresAt.toISOString()}`,
    content: new TextEncoder().encode(payload),
  };
}
