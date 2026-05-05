import { describe, expect, it } from "vitest";
import {
  ContentTypeStreamingClear,
  STREAMING_CLEAR_DELAY_MS,
  StreamingClearCodec,
  getStreamingClearContent,
  isStreamingClearMessage,
  type StreamingClear,
} from "../../src/utils/streamingClear.js";

const codec = new StreamingClearCodec();
const SESSION = "8d2c5a1e-f4a7-4b8e-9c0d-7a3b2e1f4d5c";
const SENDER = "0xagentinbox";

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

describe("ContentTypeStreamingClear", () => {
  it("matches the documented authority/type/version", () => {
    expect(ContentTypeStreamingClear).toEqual({
      authorityId: "convos.org",
      typeId: "streaming_clear",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("STREAMING_CLEAR_DELAY_MS", () => {
  it("matches the iOS 600ms readability delay", () => {
    expect(STREAMING_CLEAR_DELAY_MS).toBe(600);
  });
});

describe("StreamingClearCodec", () => {
  it("round-trips a typical clear", () => {
    const original: StreamingClear = {
      sessionId: SESSION,
      senderInboxId: SENDER,
      revision: 4,
    };
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("rejects bad revision on encode", () => {
    expect(() =>
      codec.encode({ sessionId: SESSION, senderInboxId: SENDER, revision: -1 }),
    ).toThrow(/revision/);
  });

  it("rejects empty session/sender on encode", () => {
    expect(() => codec.encode({ sessionId: "", senderInboxId: SENDER, revision: 1 })).toThrow(
      /sessionId/,
    );
    expect(() => codec.encode({ sessionId: SESSION, senderInboxId: "", revision: 1 })).toThrow(
      /senderInboxId/,
    );
  });

  it("rejects malformed payload on decode", () => {
    const bad = {
      type: ContentTypeStreamingClear,
      parameters: {},
      content: new TextEncoder().encode(
        JSON.stringify({ sessionId: SESSION, senderInboxId: SENDER }),
      ),
    } as any;
    expect(() => codec.decode(bad)).toThrow(/Invalid/);
  });

  it("is silent and has no fallback", () => {
    expect(codec.shouldPush({} as any)).toBe(false);
    expect(codec.fallback({} as any)).toBeUndefined();
  });
});

describe("isStreamingClearMessage", () => {
  it("returns true only for matching content type", () => {
    expect(isStreamingClearMessage(mockMessage(ContentTypeStreamingClear))).toBe(true);
    expect(
      isStreamingClearMessage(
        mockMessage({ authorityId: "convos.org", typeId: "streaming_text", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getStreamingClearContent", () => {
  it("extracts decoded content", () => {
    const decoded = { sessionId: SESSION, senderInboxId: SENDER, revision: 6 };
    expect(getStreamingClearContent(mockMessage(ContentTypeStreamingClear, decoded))).toEqual(
      decoded,
    );
  });
  it("decodes raw EncodedContent fallback", () => {
    const raw = {
      content: new TextEncoder().encode(
        JSON.stringify({ sessionId: SESSION, senderInboxId: SENDER, revision: 11 }),
      ),
    };
    expect(getStreamingClearContent(mockMessage(ContentTypeStreamingClear, raw))).toMatchObject({
      revision: 11,
    });
  });
  it("returns undefined for invalid content", () => {
    expect(
      getStreamingClearContent(mockMessage(ContentTypeStreamingClear, { foo: 1 })),
    ).toBeUndefined();
  });
});
