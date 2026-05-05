import { describe, it, expect } from "vitest";
import {
  ConnectionPayloadCodec,
  ContentTypeConnectionPayload,
  CONNECTION_PAYLOAD_CURRENT_SCHEMA_VERSION,
  getConnectionPayloadContent,
  isConnectionPayloadMessage,
  summarizeConnectionPayload,
  type ConnectionPayload,
} from "../../src/utils/connectionPayload.js";
import { dateToSwiftReference } from "../../src/utils/connectionTypes.js";

const codec = new ConnectionPayloadCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

function makePayload(overrides: Partial<ConnectionPayload> = {}): ConnectionPayload {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    schemaVersion: CONNECTION_PAYLOAD_CURRENT_SCHEMA_VERSION,
    source: "calendar",
    capturedAt: dateToSwiftReference(new Date("2026-04-27T15:00:00Z")),
    body: {
      type: "calendar",
      data: {
        summary: "2 events today",
        events: [],
        rangeStart: dateToSwiftReference(new Date("2026-04-27T00:00:00Z")),
        rangeEnd: dateToSwiftReference(new Date("2026-04-28T00:00:00Z")),
      },
    },
    ...overrides,
  };
}

describe("ContentTypeConnectionPayload", () => {
  it("matches the iOS wire content type", () => {
    expect(ContentTypeConnectionPayload).toEqual({
      authorityId: "convos.org",
      typeId: "connection_payload",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("ConnectionPayloadCodec", () => {
  it("round-trips a calendar payload", () => {
    const original = makePayload();
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
    expect(encoded.type).toEqual(ContentTypeConnectionPayload);
  });

  it("preserves unknown body types for forward compatibility", () => {
    const original = makePayload({
      source: "health",
      body: {
        type: "future_source_we_havent_shipped_yet",
        data: { schemaVersion: 2, summary: "later", samples: [42, 43, 44] },
      },
    });
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded.body.type).toBe("future_source_we_havent_shipped_yet");
    expect(decoded.body.data).toEqual({
      schemaVersion: 2,
      summary: "later",
      samples: [42, 43, 44],
    });
  });

  it("falls back to body.summary on the decoded payload", () => {
    const payload = makePayload();
    expect(codec.fallback(payload)).toBe("2 events today");
  });

  it("falls back to a placeholder for unknown bodies without a summary", () => {
    const payload = makePayload({
      body: { type: "future_source", data: { schemaVersion: 2 } },
    });
    expect(codec.fallback(payload)).toBe("Unknown payload (future_source)");
  });

  it("returns false from shouldPush", () => {
    expect(codec.shouldPush(makePayload())).toBe(false);
  });

  it("rejects empty content during decode", () => {
    expect(() =>
      codec.decode({ type: ContentTypeConnectionPayload, parameters: {}, content: new Uint8Array() } as any),
    ).toThrow(/empty/);
  });

  it("rejects malformed JSON", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeConnectionPayload,
        parameters: {},
        content: new TextEncoder().encode("{not json"),
      } as any),
    ).toThrow(/Invalid JSON/);
  });

  it("rejects payloads missing required fields", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeConnectionPayload,
        parameters: {},
        content: new TextEncoder().encode(JSON.stringify({ id: "x" })),
      } as any),
    ).toThrow();
  });
});

describe("isConnectionPayloadMessage", () => {
  it("matches the connection_payload content type", () => {
    expect(
      isConnectionPayloadMessage(mockMessage(ContentTypeConnectionPayload)),
    ).toBe(true);
  });

  it("rejects other content types", () => {
    expect(
      isConnectionPayloadMessage(
        mockMessage({ authorityId: "xmtp.org", typeId: "text", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getConnectionPayloadContent", () => {
  it("returns content directly when codec already decoded it", () => {
    const payload = makePayload();
    expect(getConnectionPayloadContent(mockMessage(ContentTypeConnectionPayload, payload))).toEqual(
      payload,
    );
  });

  it("decodes raw EncodedContent when the codec wasn't registered", () => {
    const payload = makePayload();
    const encoded = codec.encode(payload);
    expect(
      getConnectionPayloadContent(mockMessage(ContentTypeConnectionPayload, encoded)),
    ).toEqual(payload);
  });

  it("returns undefined for unrelated content", () => {
    expect(
      getConnectionPayloadContent(mockMessage(ContentTypeConnectionPayload, "hello")),
    ).toBeUndefined();
  });
});

describe("summarizeConnectionPayload", () => {
  it("uses body.data.summary when present", () => {
    expect(summarizeConnectionPayload(makePayload())).toBe("2 events today");
  });

  it("falls back to a placeholder when summary is missing", () => {
    expect(
      summarizeConnectionPayload(
        makePayload({ body: { type: "screen_time", data: {} } }),
      ),
    ).toBe("Unknown payload (screen_time)");
  });
});
