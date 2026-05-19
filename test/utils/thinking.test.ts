import { describe, expect, it } from "vitest";
import {
  ContentTypeThinking,
  ThinkingCodec,
  getThinkingContent,
  isThinkingMessage,
  type Thinking,
} from "../../src/utils/thinking.js";

const codec = new ThinkingCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

function make(overrides: Partial<Thinking> = {}): Thinking {
  return {
    state: "start",
    targetMessageId: "msg-123",
    content: "Designing your cycling guide",
    ...overrides,
  };
}

describe("ContentTypeThinking", () => {
  it("matches the documented authority/type/version", () => {
    expect(ContentTypeThinking).toEqual({
      authorityId: "convos.org",
      typeId: "thinking",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("ThinkingCodec", () => {
  it("round-trips a start state", () => {
    const original = make();
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("round-trips a stop state", () => {
    const original = make({ state: "stop" });
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("rejects invalid state on encode", () => {
    expect(() => codec.encode(make({ state: "pause" as any }))).toThrow(/state/);
  });

  it("rejects empty targetMessageId on encode", () => {
    expect(() => codec.encode(make({ targetMessageId: "" }))).toThrow(/targetMessageId/);
  });

  it("rejects empty content on encode", () => {
    expect(() => codec.encode(make({ content: "" }))).toThrow(/content/);
  });

  it("rejects missing fields on decode", () => {
    const bad = {
      type: ContentTypeThinking,
      parameters: {},
      content: new TextEncoder().encode(
        JSON.stringify({ state: "start", targetMessageId: "msg-1" }),
      ),
    } as any;
    expect(() => codec.decode(bad)).toThrow(/content/);
  });

  it("rejects unknown state on decode", () => {
    const bad = {
      type: ContentTypeThinking,
      parameters: {},
      content: new TextEncoder().encode(
        JSON.stringify({ state: "wat", targetMessageId: "x", content: "y" }),
      ),
    } as any;
    expect(() => codec.decode(bad)).toThrow(/state/);
  });

  it("is silent and has no fallback", () => {
    expect(codec.shouldPush(make())).toBe(false);
    expect(codec.fallback(make())).toBeUndefined();
  });

  it("round-trips a stop with resultMessageId", () => {
    const original = make({ state: "stop", resultMessageId: "reply-789" });
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("omits resultMessageId when not provided", () => {
    const decoded = codec.decode(codec.encode(make()));
    expect(decoded.resultMessageId).toBeUndefined();
  });

  it("rejects empty resultMessageId on encode", () => {
    expect(() => codec.encode(make({ resultMessageId: "" }))).toThrow(
      /resultMessageId/,
    );
  });

  it("rejects non-string resultMessageId on decode", () => {
    const bad = {
      type: ContentTypeThinking,
      parameters: {},
      content: new TextEncoder().encode(
        JSON.stringify({ ...make(), resultMessageId: 42 }),
      ),
    } as any;
    expect(() => codec.decode(bad)).toThrow(/resultMessageId/);
  });
});

describe("isThinkingMessage", () => {
  it("returns true for matching content type", () => {
    expect(isThinkingMessage(mockMessage(ContentTypeThinking))).toBe(true);
  });
  it("returns false for other types", () => {
    expect(
      isThinkingMessage(
        mockMessage({ authorityId: "xmtp.org", typeId: "text", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getThinkingContent", () => {
  it("returns decoded content directly", () => {
    const thinking = make();
    expect(
      getThinkingContent(mockMessage(ContentTypeThinking, thinking)),
    ).toEqual(thinking);
  });

  it("decodes raw EncodedContent fallback", () => {
    const raw = {
      content: new TextEncoder().encode(JSON.stringify(make())),
    };
    expect(
      getThinkingContent(mockMessage(ContentTypeThinking, raw)),
    ).toEqual(make());
  });

  it("returns undefined for invalid content", () => {
    expect(
      getThinkingContent(mockMessage(ContentTypeThinking, { foo: "bar" })),
    ).toBeUndefined();
    expect(
      getThinkingContent(mockMessage(ContentTypeThinking, null)),
    ).toBeUndefined();
  });

  it("returns undefined when raw bytes are malformed", () => {
    const raw = {
      content: new TextEncoder().encode("not json"),
    };
    expect(
      getThinkingContent(mockMessage(ContentTypeThinking, raw)),
    ).toBeUndefined();
  });
});
