/**
 * ConversationSnapshot content type for Convos.
 *
 * Matches the iOS ConversationSnapshotCodec:
 * - Content type: convos.org/conversation_snapshot:1.0
 * - Payload: JSON
 * - shouldPush: false (silent)
 * - fallback: undefined (no text fallback)
 *
 * Sent by an existing member to a newly-joined member to restore
 * conversation-level state that the joiner missed (e.g. an in-progress
 * focus session). Receivers route blocks into the same writers that
 * handle the corresponding live-state codecs.
 *
 * Following the FocusModeControl/StreamingText/StreamingClear style: the
 * wire version is on the content type itself (`versionMajor`/`versionMinor`),
 * not embedded in the payload. The decoder is **strict-additive**: it
 * ignores unknown top-level keys so v1 readers survive future v1.x
 * snapshot extensions (locks, capability state, …).
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";
import type { FocusModeState } from "./focusModeControl.js";

// ─── Content Type ───

export const ContentTypeConversationSnapshot: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "conversation_snapshot",
  versionMajor: 1,
  versionMinor: 0,
};

// ─── Types ───

export interface ConversationSnapshotFocusSession {
  sessionId: string;
  state: FocusModeState;
  focusedInboxId: string | null;
}

export interface ConversationSnapshot {
  /**
   * Latest focus session state, if any.
   * - Absent or null → no live focus session at snapshot time (no-op for receivers).
   * - Present → mirrors FocusModeControl exactly, so receivers can treat it
   *   as a virtual FocusModeControl event.
   */
  focusSession?: ConversationSnapshotFocusSession | null;
  /** Forward-compat: unknown top-level fields are preserved on decode. */
  [extension: string]: unknown;
}

// ─── Codec ───

function isFocusSession(value: unknown): value is ConversationSnapshotFocusSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sessionId === "string" &&
    v.sessionId.length > 0 &&
    (v.state === "start" || v.state === "stop") &&
    (v.focusedInboxId === null || typeof v.focusedInboxId === "string")
  );
}

function validate(payload: unknown): asserts payload is ConversationSnapshot {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid ConversationSnapshot payload");
  }
  const p = payload as Record<string, unknown>;
  if (
    p.focusSession !== undefined &&
    p.focusSession !== null &&
    !isFocusSession(p.focusSession)
  ) {
    throw new Error("Invalid ConversationSnapshot.focusSession");
  }
  // Strict-additive: any other top-level keys are tolerated as forward-compat
  // extensions. We don't enumerate them here.
}

export class ConversationSnapshotCodec implements ContentCodec<ConversationSnapshot> {
  get contentType(): ContentTypeId {
    return ContentTypeConversationSnapshot;
  }

  encode(content: ConversationSnapshot): EncodedContent {
    validate(content);
    const json = JSON.stringify(content);
    return {
      type: ContentTypeConversationSnapshot,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): ConversationSnapshot {
    const json = new TextDecoder().decode(content.content);
    const parsed = JSON.parse(json) as unknown;
    validate(parsed);
    return parsed;
  }

  fallback(_content: ConversationSnapshot): string | undefined {
    return undefined;
  }

  shouldPush(_content: ConversationSnapshot): boolean {
    return false;
  }
}

// ─── Helpers ───

export function isConversationSnapshotMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeConversationSnapshot.authorityId &&
    ct.typeId === ContentTypeConversationSnapshot.typeId
  );
}

export function getConversationSnapshotContent(
  message: DecodedMessage,
): ConversationSnapshot | undefined {
  const content = message.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return undefined;
  }

  // Codec registered: content is already decoded. Validate the focusSession
  // shape if present; tolerate unknown top-level keys.
  if (
    !("content" in content) ||
    !((content as any).content instanceof Uint8Array)
  ) {
    try {
      validate(content);
      return content as ConversationSnapshot;
    } catch {
      return undefined;
    }
  }

  // Raw EncodedContent fallback.
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode((content as any).content),
    ) as unknown;
    validate(parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

/** Convenience for senders that may have one or more blocks to ship. */
export function buildConversationSnapshot(opts: {
  focusSession?: ConversationSnapshotFocusSession | null;
}): ConversationSnapshot {
  return {
    ...(opts.focusSession !== undefined && { focusSession: opts.focusSession }),
  };
}
