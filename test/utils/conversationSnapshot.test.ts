import { describe, expect, it } from "vitest";
import {
  ContentTypeConversationSnapshot,
  ConversationSnapshotCodec,
  buildConversationSnapshot,
  getConversationSnapshotContent,
  isConversationSnapshotMessage,
  type ConversationSnapshot,
} from "../../src/utils/conversationSnapshot.js";

const codec = new ConversationSnapshotCodec();
const SESSION = "8d2c5a1e-f4a7-4b8e-9c0d-7a3b2e1f4d5c";

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

describe("ContentTypeConversationSnapshot", () => {
  it("matches the documented authority/type/version", () => {
    expect(ContentTypeConversationSnapshot).toEqual({
      authorityId: "convos.org",
      typeId: "conversation_snapshot",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("ConversationSnapshotCodec", () => {
  it("round-trips an empty snapshot", () => {
    const original: ConversationSnapshot = {};
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("round-trips a snapshot with an active focus session", () => {
    const original: ConversationSnapshot = {
      focusSession: {
        sessionId: SESSION,
        state: "start",
        focusedInboxId: "0xagent",
      },
    };
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("round-trips a snapshot with a stopped focus session", () => {
    const original: ConversationSnapshot = {
      focusSession: { sessionId: SESSION, state: "stop", focusedInboxId: null },
    };
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("round-trips an explicit null focusSession (no active session)", () => {
    const original: ConversationSnapshot = { focusSession: null };
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("ignores unknown top-level keys on decode (strict-additive)", () => {
    const future = {
      type: ContentTypeConversationSnapshot,
      parameters: {},
      content: new TextEncoder().encode(
        JSON.stringify({
          focusSession: { sessionId: SESSION, state: "start", focusedInboxId: null },
          locks: { addMember: "denied" },
          capabilityState: { foo: "bar" },
        }),
      ),
    } as any;
    const decoded = codec.decode(future);
    expect(decoded.focusSession).toEqual({
      sessionId: SESSION,
      state: "start",
      focusedInboxId: null,
    });
    expect((decoded as any).locks).toEqual({ addMember: "denied" });
    expect((decoded as any).capabilityState).toEqual({ foo: "bar" });
  });

  it("rejects malformed focusSession block on encode", () => {
    expect(() =>
      codec.encode({
        focusSession: { sessionId: "", state: "start", focusedInboxId: null } as any,
      }),
    ).toThrow(/focusSession/);
  });

  it("rejects unknown focusSession.state", () => {
    expect(() =>
      codec.encode({
        focusSession: { sessionId: SESSION, state: "pause" as any, focusedInboxId: null },
      }),
    ).toThrow(/focusSession/);
  });

  it("rejects non-object payloads", () => {
    const bad = {
      type: ContentTypeConversationSnapshot,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(["array"])),
    } as any;
    expect(() => codec.decode(bad)).toThrow(/Invalid/);
  });

  it("is silent and has no fallback", () => {
    expect(codec.shouldPush({} as any)).toBe(false);
    expect(codec.fallback({} as any)).toBeUndefined();
  });
});

describe("isConversationSnapshotMessage", () => {
  it("returns true only for matching content type", () => {
    expect(
      isConversationSnapshotMessage(mockMessage(ContentTypeConversationSnapshot)),
    ).toBe(true);
    expect(
      isConversationSnapshotMessage(
        mockMessage({ authorityId: "convos.org", typeId: "focus_mode_control", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getConversationSnapshotContent", () => {
  it("extracts decoded content with focusSession", () => {
    const decoded: ConversationSnapshot = {
      focusSession: { sessionId: SESSION, state: "start", focusedInboxId: null },
    };
    expect(
      getConversationSnapshotContent(mockMessage(ContentTypeConversationSnapshot, decoded)),
    ).toEqual(decoded);
  });
  it("decodes raw EncodedContent fallback", () => {
    const raw = {
      content: new TextEncoder().encode(JSON.stringify({})),
    };
    expect(
      getConversationSnapshotContent(mockMessage(ContentTypeConversationSnapshot, raw)),
    ).toEqual({});
  });
  it("returns undefined for malformed focusSession", () => {
    expect(
      getConversationSnapshotContent(
        mockMessage(ContentTypeConversationSnapshot, {
          focusSession: { sessionId: 5, state: "start", focusedInboxId: null },
        }),
      ),
    ).toBeUndefined();
  });
});

describe("buildConversationSnapshot", () => {
  it("returns an empty snapshot when no focusSession is provided", () => {
    expect(buildConversationSnapshot({})).toEqual({});
  });
  it("includes a focusSession block when provided", () => {
    const snap = buildConversationSnapshot({
      focusSession: { sessionId: SESSION, state: "start", focusedInboxId: "0x" },
    });
    expect(snap.focusSession).toEqual({
      sessionId: SESSION,
      state: "start",
      focusedInboxId: "0x",
    });
  });
  it("preserves explicit null focusSession (no active session)", () => {
    const snap = buildConversationSnapshot({ focusSession: null });
    expect(snap.focusSession).toBeNull();
  });
});
