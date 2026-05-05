/**
 * FocusModeControl content type for Convos Assistant Builder.
 *
 * Matches the iOS FocusModeControlCodec:
 * - Content type: convos.org/focus_mode_control:1.0
 * - Payload: JSON {"state","focusedInboxId","sessionId"}
 * - shouldPush: false (silent)
 * - fallback: undefined (no text fallback)
 *
 * Receivers route these into a separate session-state store; they are
 * not stored in conversation history.
 */

import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { DecodedMessage } from "@xmtp/node-sdk";

// ─── Content Type ───

export const ContentTypeFocusModeControl: ContentTypeId = {
  authorityId: "convos.org",
  typeId: "focus_mode_control",
  versionMajor: 1,
  versionMinor: 0,
};

// ─── Types ───

export type FocusModeState = "start" | "stop";

export interface FocusModeControl {
  state: FocusModeState;
  focusedInboxId: string | null;
  sessionId: string;
}

// ─── Codec ───

export class FocusModeControlCodec implements ContentCodec<FocusModeControl> {
  get contentType(): ContentTypeId {
    return ContentTypeFocusModeControl;
  }

  encode(content: FocusModeControl): EncodedContent {
    if (content.state !== "start" && content.state !== "stop") {
      throw new Error("Invalid FocusModeControl.state");
    }
    if (typeof content.sessionId !== "string" || content.sessionId.length === 0) {
      throw new Error("Missing FocusModeControl.sessionId");
    }
    if (
      content.focusedInboxId !== null &&
      typeof content.focusedInboxId !== "string"
    ) {
      throw new Error("Invalid FocusModeControl.focusedInboxId");
    }
    const json = JSON.stringify(content);
    return {
      type: ContentTypeFocusModeControl,
      parameters: {},
      content: new TextEncoder().encode(json),
    } as EncodedContent;
  }

  decode(content: EncodedContent): FocusModeControl {
    const json = new TextDecoder().decode(content.content);
    const parsed = JSON.parse(json) as FocusModeControl;
    if (parsed.state !== "start" && parsed.state !== "stop") {
      throw new Error("Invalid FocusModeControl.state");
    }
    if (typeof parsed.sessionId !== "string" || parsed.sessionId.length === 0) {
      throw new Error("Missing FocusModeControl.sessionId");
    }
    if (
      parsed.focusedInboxId !== null &&
      typeof parsed.focusedInboxId !== "string"
    ) {
      throw new Error("Invalid FocusModeControl.focusedInboxId");
    }
    return parsed;
  }

  fallback(_content: FocusModeControl): string | undefined {
    return undefined;
  }

  shouldPush(_content: FocusModeControl): boolean {
    return false;
  }
}

// ─── Helpers ───

export function isFocusModeControlMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeFocusModeControl.authorityId &&
    ct.typeId === ContentTypeFocusModeControl.typeId
  );
}

export function getFocusModeControlContent(
  message: DecodedMessage,
): FocusModeControl | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  if (
    "state" in content &&
    "sessionId" in content &&
    "focusedInboxId" in content &&
    (content.state === "start" || content.state === "stop") &&
    typeof (content as any).sessionId === "string" &&
    ((content as any).focusedInboxId === null ||
      typeof (content as any).focusedInboxId === "string")
  ) {
    return content as FocusModeControl;
  }

  if ("content" in content && (content as any).content instanceof Uint8Array) {
    try {
      const json = new TextDecoder().decode((content as any).content);
      const parsed = JSON.parse(json) as FocusModeControl;
      if (
        (parsed.state === "start" || parsed.state === "stop") &&
        typeof parsed.sessionId === "string" &&
        (parsed.focusedInboxId === null ||
          typeof parsed.focusedInboxId === "string")
      ) {
        return parsed;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}
