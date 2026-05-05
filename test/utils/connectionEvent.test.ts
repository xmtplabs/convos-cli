import { describe, it, expect } from "vitest";
import {
  ConnectionEventCodec,
  ContentTypeConnectionEvent,
  CONNECTION_EVENT_SUPPORTED_VERSION,
  getConnectionEventContent,
  isConnectionEventMessage,
  type ConnectionEvent,
} from "../../src/utils/connectionEvent.js";

const codec = new ConnectionEventCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

function makeEvent(overrides: Partial<ConnectionEvent> = {}): ConnectionEvent {
  return {
    version: CONNECTION_EVENT_SUPPORTED_VERSION,
    providerId: "device.health",
    action: "granted",
    ...overrides,
  };
}

describe("ContentTypeConnectionEvent", () => {
  it("matches the iOS wire content type", () => {
    expect(ContentTypeConnectionEvent).toEqual({
      authorityId: "convos.org",
      typeId: "connection_event",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("ConnectionEventCodec", () => {
  it("round-trips granted and revoked events", () => {
    expect(codec.decode(codec.encode(makeEvent()))).toEqual(makeEvent());
    expect(codec.decode(codec.encode(makeEvent({ action: "revoked" })))).toEqual(
      makeEvent({ action: "revoked" }),
    );
  });

  it("returns false from shouldPush", () => {
    expect(codec.shouldPush(makeEvent())).toBe(false);
  });

  it("returns no fallback", () => {
    expect(codec.fallback(makeEvent())).toBeUndefined();
  });

  it("rejects future schema versions on decode", () => {
    // Encode is gated by the same validator now, so we construct the raw
    // future-version bytes directly rather than going through codec.encode().
    const futureBytes = new TextEncoder().encode(
      JSON.stringify(makeEvent({ version: CONNECTION_EVENT_SUPPORTED_VERSION + 1 })),
    );
    expect(() =>
      codec.decode({
        type: ContentTypeConnectionEvent,
        parameters: {},
        content: futureBytes,
      } as any),
    ).toThrow(/Unsupported.*version/);
  });
});

describe("isConnectionEventMessage", () => {
  it("matches the connection_event content type", () => {
    expect(isConnectionEventMessage(mockMessage(ContentTypeConnectionEvent))).toBe(true);
  });
});

describe("getConnectionEventContent", () => {
  it("returns decoded content directly", () => {
    const event = makeEvent();
    expect(getConnectionEventContent(mockMessage(ContentTypeConnectionEvent, event))).toEqual(event);
  });

  it("decodes raw EncodedContent when codec wasn't registered", () => {
    const event = makeEvent();
    const encoded = codec.encode(event);
    expect(getConnectionEventContent(mockMessage(ContentTypeConnectionEvent, encoded))).toEqual(event);
  });
});
