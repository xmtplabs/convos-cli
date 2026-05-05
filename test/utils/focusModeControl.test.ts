import { describe, expect, it } from "vitest";
import {
  ContentTypeFocusModeControl,
  FocusModeControlCodec,
  getFocusModeControlContent,
  isFocusModeControlMessage,
  type FocusModeControl,
} from "../../src/utils/focusModeControl.js";

const codec = new FocusModeControlCodec();
const SESSION = "8d2c5a1e-f4a7-4b8e-9c0d-7a3b2e1f4d5c";

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

describe("ContentTypeFocusModeControl", () => {
  it("matches the documented authority/type/version", () => {
    expect(ContentTypeFocusModeControl).toEqual({
      authorityId: "convos.org",
      typeId: "focus_mode_control",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("FocusModeControlCodec", () => {
  it("round-trips a pending start (focusedInboxId null)", () => {
    const original: FocusModeControl = {
      state: "start",
      focusedInboxId: null,
      sessionId: SESSION,
    };
    const decoded = codec.decode(codec.encode(original));
    expect(decoded).toEqual(original);
  });

  it("round-trips a focused start", () => {
    const original: FocusModeControl = {
      state: "start",
      focusedInboxId: "0xagent",
      sessionId: SESSION,
    };
    const decoded = codec.decode(codec.encode(original));
    expect(decoded).toEqual(original);
  });

  it("round-trips a stop", () => {
    const original: FocusModeControl = {
      state: "stop",
      focusedInboxId: null,
      sessionId: SESSION,
    };
    const decoded = codec.decode(codec.encode(original));
    expect(decoded).toEqual(original);
  });

  it("rejects invalid state on encode", () => {
    expect(() =>
      codec.encode({ state: "pause" as any, focusedInboxId: null, sessionId: SESSION }),
    ).toThrow(/state/);
  });

  it("rejects empty sessionId on encode", () => {
    expect(() =>
      codec.encode({ state: "start", focusedInboxId: null, sessionId: "" }),
    ).toThrow(/sessionId/);
  });

  it("rejects non-string focusedInboxId on encode", () => {
    expect(() =>
      codec.encode({ state: "start", focusedInboxId: 42 as any, sessionId: SESSION }),
    ).toThrow(/focusedInboxId/);
  });

  it("rejects malformed JSON on decode", () => {
    const bad = {
      type: ContentTypeFocusModeControl,
      parameters: {},
      content: new TextEncoder().encode("not json"),
    } as any;
    expect(() => codec.decode(bad)).toThrow();
  });

  it("rejects unknown state on decode", () => {
    const bad = {
      type: ContentTypeFocusModeControl,
      parameters: {},
      content: new TextEncoder().encode(
        JSON.stringify({ state: "wat", focusedInboxId: null, sessionId: SESSION }),
      ),
    } as any;
    expect(() => codec.decode(bad)).toThrow(/state/);
  });

  it("is silent (shouldPush=false) and has no fallback", () => {
    expect(codec.shouldPush({} as any)).toBe(false);
    expect(codec.fallback({} as any)).toBeUndefined();
  });
});

describe("isFocusModeControlMessage", () => {
  it("returns true for matching content type", () => {
    expect(isFocusModeControlMessage(mockMessage(ContentTypeFocusModeControl))).toBe(
      true,
    );
  });
  it("returns false for other types", () => {
    expect(
      isFocusModeControlMessage(
        mockMessage({ authorityId: "xmtp.org", typeId: "text", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getFocusModeControlContent", () => {
  it("extracts decoded content", () => {
    const decoded = { state: "start", focusedInboxId: null, sessionId: SESSION };
    expect(
      getFocusModeControlContent(mockMessage(ContentTypeFocusModeControl, decoded)),
    ).toEqual(decoded);
  });
  it("decodes raw EncodedContent fallback", () => {
    const raw = {
      content: new TextEncoder().encode(
        JSON.stringify({ state: "stop", focusedInboxId: null, sessionId: SESSION }),
      ),
    };
    expect(
      getFocusModeControlContent(mockMessage(ContentTypeFocusModeControl, raw)),
    ).toMatchObject({ state: "stop", sessionId: SESSION });
  });
  it("returns undefined for invalid content", () => {
    expect(
      getFocusModeControlContent(mockMessage(ContentTypeFocusModeControl, { foo: "bar" })),
    ).toBeUndefined();
    expect(
      getFocusModeControlContent(mockMessage(ContentTypeFocusModeControl, null)),
    ).toBeUndefined();
  });
});
