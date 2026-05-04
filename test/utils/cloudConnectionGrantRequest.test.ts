import { describe, it, expect } from "vitest";
import {
  CloudConnectionGrantRequestCodec,
  ContentTypeCloudConnectionGrantRequest,
  CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION,
  CLOUD_CONNECTION_GRANT_REQUEST_MAX_REASON_LENGTH,
  getCloudConnectionGrantRequestContent,
  isCloudConnectionGrantRequestMessage,
  type CloudConnectionGrantRequest,
} from "../../src/utils/cloudConnectionGrantRequest.js";

const codec = new CloudConnectionGrantRequestCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

function makeRequest(
  overrides: Partial<CloudConnectionGrantRequest> = {},
): CloudConnectionGrantRequest {
  return {
    version: CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION,
    service: "strava",
    requestedByInboxId: "inbox-agent-1",
    targetInboxId: "inbox-user-1",
    reason: "To summarize this week's training",
    ...overrides,
  };
}

describe("ContentTypeCloudConnectionGrantRequest", () => {
  it("matches the iOS wire content type", () => {
    expect(ContentTypeCloudConnectionGrantRequest).toEqual({
      authorityId: "convos.org",
      typeId: "connection_grant_request",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("CloudConnectionGrantRequestCodec", () => {
  it("round-trips a typical request", () => {
    const original = makeRequest();
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("returns false from shouldPush (silent codec)", () => {
    expect(codec.shouldPush(makeRequest())).toBe(false);
  });

  it("falls back to a service-named human string", () => {
    expect(codec.fallback(makeRequest({ service: "strava" }))).toBe(
      "The assistant asked to connect strava",
    );
    expect(
      codec.fallback(makeRequest({ service: "google_calendar" })),
    ).toBe("The assistant asked to connect google_calendar");
  });

  it("truncates an over-long reason symmetrically on encode and decode", () => {
    const bloated = "x".repeat(CLOUD_CONNECTION_GRANT_REQUEST_MAX_REASON_LENGTH + 25);
    const decoded = codec.decode(codec.encode(makeRequest({ reason: bloated })));
    expect(decoded.reason).toHaveLength(CLOUD_CONNECTION_GRANT_REQUEST_MAX_REASON_LENGTH);
  });

  it("rejects future schema versions on decode", () => {
    const future = makeRequest({
      version: CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION + 1,
    });
    const encoded = codec.encode(future);
    expect(() => codec.decode(encoded)).toThrow(/Unsupported.*version/);
  });

  it("rejects empty content during decode", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeCloudConnectionGrantRequest,
        parameters: {},
        content: new Uint8Array(),
      } as any),
    ).toThrow(/empty/);
  });

  it("rejects malformed JSON", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeCloudConnectionGrantRequest,
        parameters: {},
        content: new TextEncoder().encode("{not json"),
      } as any),
    ).toThrow(/Invalid JSON/);
  });

  it("rejects requests missing required fields", () => {
    for (const field of [
      "service",
      "requestedByInboxId",
      "targetInboxId",
      "reason",
    ] as const) {
      const incomplete = { ...makeRequest() } as Record<string, unknown>;
      delete incomplete[field];
      expect(() =>
        codec.decode({
          type: ContentTypeCloudConnectionGrantRequest,
          parameters: {},
          content: new TextEncoder().encode(JSON.stringify(incomplete)),
        } as any),
      ).toThrow(new RegExp(field));
    }
  });
});

describe("isCloudConnectionGrantRequestMessage", () => {
  it("matches the connection_grant_request content type", () => {
    expect(
      isCloudConnectionGrantRequestMessage(
        mockMessage(ContentTypeCloudConnectionGrantRequest),
      ),
    ).toBe(true);
  });

  it("rejects other content types", () => {
    expect(
      isCloudConnectionGrantRequestMessage(
        mockMessage({
          authorityId: "xmtp.org",
          typeId: "text",
          versionMajor: 1,
          versionMinor: 0,
        }),
      ),
    ).toBe(false);
  });
});

describe("getCloudConnectionGrantRequestContent", () => {
  it("returns decoded content directly when codec was registered", () => {
    const r = makeRequest();
    expect(
      getCloudConnectionGrantRequestContent(
        mockMessage(ContentTypeCloudConnectionGrantRequest, r),
      ),
    ).toEqual(r);
  });

  it("decodes raw EncodedContent when codec wasn't registered", () => {
    const r = makeRequest();
    const encoded = codec.encode(r);
    expect(
      getCloudConnectionGrantRequestContent(
        mockMessage(ContentTypeCloudConnectionGrantRequest, encoded),
      ),
    ).toEqual(r);
  });

  it("returns undefined for unrelated content", () => {
    expect(
      getCloudConnectionGrantRequestContent(
        mockMessage(ContentTypeCloudConnectionGrantRequest, "hello"),
      ),
    ).toBeUndefined();
  });
});
