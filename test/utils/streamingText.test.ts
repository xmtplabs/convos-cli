import { describe, expect, it } from "vitest";
import {
  ContentTypeStreamingText,
  STREAMING_TEXT_MAX_BYTES,
  StreamingTextCodec,
  getStreamingTextContent,
  isStreamingTextMessage,
  type StreamingText,
} from "../../src/utils/streamingText.js";

const codec = new StreamingTextCodec();
const SESSION = "8d2c5a1e-f4a7-4b8e-9c0d-7a3b2e1f4d5c";
const SENDER = "0xagentinbox";

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

describe("ContentTypeStreamingText", () => {
  it("matches the documented authority/type/version", () => {
    expect(ContentTypeStreamingText).toEqual({
      authorityId: "convos.org",
      typeId: "streaming_text",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("StreamingTextCodec", () => {
  it("round-trips a typical snapshot", () => {
    const original: StreamingText = {
      sessionId: SESSION,
      senderInboxId: SENDER,
      revision: 3,
      text: "Tell me what you want this assistant to do.",
    };
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("round-trips empty text (backspace-to-nothing)", () => {
    const original: StreamingText = {
      sessionId: SESSION,
      senderInboxId: SENDER,
      revision: 7,
      text: "",
    };
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("rejects negative revision on encode", () => {
    expect(() =>
      codec.encode({ sessionId: SESSION, senderInboxId: SENDER, revision: -1, text: "x" }),
    ).toThrow(/revision/);
  });

  it("rejects fractional revision on encode", () => {
    expect(() =>
      codec.encode({ sessionId: SESSION, senderInboxId: SENDER, revision: 1.5, text: "x" }),
    ).toThrow(/revision/);
  });

  it("rejects revision above uint32 ceiling on encode", () => {
    expect(() =>
      codec.encode({
        sessionId: SESSION,
        senderInboxId: SENDER,
        revision: 0x1_0000_0000,
        text: "x",
      }),
    ).toThrow(/revision/);
  });

  it("rejects empty sessionId / senderInboxId on encode", () => {
    expect(() =>
      codec.encode({ sessionId: "", senderInboxId: SENDER, revision: 1, text: "x" }),
    ).toThrow(/sessionId/);
    expect(() =>
      codec.encode({ sessionId: SESSION, senderInboxId: "", revision: 1, text: "x" }),
    ).toThrow(/senderInboxId/);
  });

  it("rejects payloads larger than STREAMING_TEXT_MAX_BYTES on decode", () => {
    const huge = "x".repeat(STREAMING_TEXT_MAX_BYTES + 100);
    const oversize = {
      type: ContentTypeStreamingText,
      parameters: {},
      content: new TextEncoder().encode(
        JSON.stringify({ sessionId: SESSION, senderInboxId: SENDER, revision: 1, text: huge }),
      ),
    } as any;
    expect(() => codec.decode(oversize)).toThrow(/exceeds/);
  });

  it("rejects malformed payload on decode", () => {
    const bad = {
      type: ContentTypeStreamingText,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify({ sessionId: SESSION })),
    } as any;
    expect(() => codec.decode(bad)).toThrow(/Invalid/);
  });

  it("is silent and has no fallback", () => {
    expect(codec.shouldPush({} as any)).toBe(false);
    expect(codec.fallback({} as any)).toBeUndefined();
  });
});

describe("isStreamingTextMessage", () => {
  it("returns true only for matching content type", () => {
    expect(isStreamingTextMessage(mockMessage(ContentTypeStreamingText))).toBe(true);
    expect(
      isStreamingTextMessage(
        mockMessage({ authorityId: "convos.org", typeId: "streaming_clear", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getStreamingTextContent", () => {
  it("extracts decoded content", () => {
    const decoded = { sessionId: SESSION, senderInboxId: SENDER, revision: 1, text: "hi" };
    expect(getStreamingTextContent(mockMessage(ContentTypeStreamingText, decoded))).toEqual(
      decoded,
    );
  });
  it("decodes raw EncodedContent fallback", () => {
    const raw = {
      content: new TextEncoder().encode(
        JSON.stringify({ sessionId: SESSION, senderInboxId: SENDER, revision: 9, text: "yo" }),
      ),
    };
    expect(getStreamingTextContent(mockMessage(ContentTypeStreamingText, raw))).toMatchObject({
      sessionId: SESSION,
      revision: 9,
      text: "yo",
    });
  });
  it("returns undefined for invalid content", () => {
    expect(
      getStreamingTextContent(mockMessage(ContentTypeStreamingText, { foo: "bar" })),
    ).toBeUndefined();
  });
});
