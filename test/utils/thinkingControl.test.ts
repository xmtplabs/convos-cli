import { describe, expect, it } from "vitest";
import {
  ContentTypeThinkingControl,
  ThinkingControlCodec,
  getThinkingControlContent,
  isThinkingControlMessage,
  type ThinkingControl,
} from "../../src/utils/thinkingControl.js";

const codec = new ThinkingControlCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

function make(overrides: Partial<ThinkingControl> = {}): ThinkingControl {
  return {
    action: "stop",
    targetMessageId: "msg-123",
    agentInboxId: "agent-inbox-456",
    ...overrides,
  };
}

describe("ContentTypeThinkingControl", () => {
  it("matches the documented authority/type/version", () => {
    expect(ContentTypeThinkingControl).toEqual({
      authorityId: "convos.org",
      typeId: "thinking-control",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("ThinkingControlCodec", () => {
  it("round-trips a stop action", () => {
    const original = make();
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("round-trips a resume action", () => {
    const original = make({ action: "resume" });
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("rejects invalid action on encode", () => {
    expect(() => codec.encode(make({ action: "pause" as any }))).toThrow(/action/);
  });

  it("rejects empty targetMessageId on encode", () => {
    expect(() => codec.encode(make({ targetMessageId: "" }))).toThrow(/targetMessageId/);
  });

  it("rejects empty agentInboxId on encode", () => {
    expect(() => codec.encode(make({ agentInboxId: "" }))).toThrow(/agentInboxId/);
  });

  it("rejects missing fields on decode", () => {
    const bad = {
      type: ContentTypeThinkingControl,
      parameters: {},
      content: new TextEncoder().encode(
        JSON.stringify({ action: "stop", targetMessageId: "msg-1" }),
      ),
    } as any;
    expect(() => codec.decode(bad)).toThrow(/agentInboxId/);
  });

  it("rejects unknown action on decode", () => {
    const bad = {
      type: ContentTypeThinkingControl,
      parameters: {},
      content: new TextEncoder().encode(
        JSON.stringify({ action: "wat", targetMessageId: "x", agentInboxId: "y" }),
      ),
    } as any;
    expect(() => codec.decode(bad)).toThrow(/action/);
  });

  it("is silent and has no fallback", () => {
    expect(codec.shouldPush(make())).toBe(false);
    expect(codec.fallback(make())).toBeUndefined();
  });
});

describe("isThinkingControlMessage", () => {
  it("returns true for matching content type", () => {
    expect(isThinkingControlMessage(mockMessage(ContentTypeThinkingControl))).toBe(true);
  });
  it("returns false for other types", () => {
    expect(
      isThinkingControlMessage(
        mockMessage({ authorityId: "convos.org", typeId: "thinking", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getThinkingControlContent", () => {
  it("returns decoded content directly", () => {
    const control = make();
    expect(
      getThinkingControlContent(mockMessage(ContentTypeThinkingControl, control)),
    ).toEqual(control);
  });

  it("decodes raw EncodedContent fallback", () => {
    const raw = {
      content: new TextEncoder().encode(JSON.stringify(make())),
    };
    expect(
      getThinkingControlContent(mockMessage(ContentTypeThinkingControl, raw)),
    ).toEqual(make());
  });

  it("returns undefined for invalid content", () => {
    expect(
      getThinkingControlContent(mockMessage(ContentTypeThinkingControl, { foo: "bar" })),
    ).toBeUndefined();
    expect(
      getThinkingControlContent(mockMessage(ContentTypeThinkingControl, null)),
    ).toBeUndefined();
  });

  it("returns undefined when raw bytes are malformed", () => {
    const raw = {
      content: new TextEncoder().encode("not json"),
    };
    expect(
      getThinkingControlContent(mockMessage(ContentTypeThinkingControl, raw)),
    ).toBeUndefined();
  });
});
