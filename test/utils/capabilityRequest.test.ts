import { describe, it, expect } from "vitest";
import {
  CapabilityRequestCodec,
  ContentTypeCapabilityRequest,
  CAPABILITY_REQUEST_SUPPORTED_VERSION,
  CAPABILITY_REQUEST_MAX_RATIONALE_LENGTH,
  CAPABILITY_REQUEST_MAX_PREFERRED_PROVIDERS,
  getCapabilityRequestContent,
  isCapabilityRequestMessage,
  type CapabilityRequest,
} from "../../src/utils/capabilityRequest.js";

const codec = new CapabilityRequestCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

function makeRequest(
  overrides: Partial<CapabilityRequest> = {},
): CapabilityRequest {
  return {
    version: CAPABILITY_REQUEST_SUPPORTED_VERSION,
    requestId: "req-1",
    askerInboxId: "agent-inbox-1",
    subject: "calendar",
    capability: "read",
    rationale: "To summarize your week",
    preferredProviders: ["device.calendar"],
    ...overrides,
  };
}

describe("ContentTypeCapabilityRequest", () => {
  it("matches the iOS wire content type", () => {
    expect(ContentTypeCapabilityRequest).toEqual({
      authorityId: "convos.org",
      typeId: "capability_request",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("CapabilityRequestCodec", () => {
  it("round-trips a calendar read request", () => {
    const original = makeRequest();
    const decoded = codec.decode(codec.encode(original));
    expect(decoded).toEqual(original);
  });

  it("round-trips a fitness read request with multiple preferred providers", () => {
    const original = makeRequest({
      subject: "fitness",
      capability: "read",
      preferredProviders: ["composio.strava", "composio.fitbit"],
    });
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("round-trips a request with no preferredProviders hint", () => {
    const original = makeRequest({ preferredProviders: undefined });
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded.preferredProviders).toBeUndefined();
  });

  it("truncates the rationale at the documented cap on encode", () => {
    const bloated = "x".repeat(CAPABILITY_REQUEST_MAX_RATIONALE_LENGTH + 100);
    const decoded = codec.decode(codec.encode(makeRequest({ rationale: bloated })));
    expect(decoded.rationale.length).toBe(CAPABILITY_REQUEST_MAX_RATIONALE_LENGTH);
  });

  it("truncates preferredProviders at the documented cap", () => {
    const bloated = Array.from(
      { length: CAPABILITY_REQUEST_MAX_PREFERRED_PROVIDERS + 5 },
      (_, i) => `composio.x${i}`,
    );
    const decoded = codec.decode(
      codec.encode(makeRequest({ preferredProviders: bloated })),
    );
    expect(decoded.preferredProviders).toHaveLength(
      CAPABILITY_REQUEST_MAX_PREFERRED_PROVIDERS,
    );
  });

  it("rejects future schema versions on decode", () => {
    // Encode is gated by the same validator now, so we construct the raw
    // future-version bytes directly rather than going through codec.encode().
    const futureBytes = new TextEncoder().encode(
      JSON.stringify(makeRequest({ version: CAPABILITY_REQUEST_SUPPORTED_VERSION + 1 })),
    );
    expect(() =>
      codec.decode({
        type: ContentTypeCapabilityRequest,
        parameters: {},
        content: futureBytes,
      } as any),
    ).toThrow(/Unsupported.*version/);
  });

  it("falls back to a subject-aware string", () => {
    expect(codec.fallback(makeRequest())).toBe(
      "The assistant is requesting access to your calendar",
    );
    expect(codec.fallback(makeRequest({ subject: "screen_time" }))).toBe(
      "The assistant is requesting access to your screen time",
    );
  });

  it("returns false from shouldPush", () => {
    expect(codec.shouldPush(makeRequest())).toBe(false);
  });

  it("rejects empty content during decode", () => {
    expect(() =>
      codec.decode({ type: ContentTypeCapabilityRequest, parameters: {}, content: new Uint8Array() } as any),
    ).toThrow(/empty/);
  });

  it("rejects malformed JSON", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeCapabilityRequest,
        parameters: {},
        content: new TextEncoder().encode("{not json"),
      } as any),
    ).toThrow(/Invalid JSON/);
  });

  it("rejects requests missing required fields", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeCapabilityRequest,
        parameters: {},
        content: new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            askerInboxId: "agent",
            subject: "calendar",
            capability: "read",
          }),
        ),
      } as any),
    ).toThrow(/missing/);
  });

  it("rejects requests missing askerInboxId (mirrors convos-ios#812)", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        requestId: "req-1",
        subject: "calendar",
        capability: "read",
        rationale: "x",
      }),
    );
    expect(() =>
      codec.decode({
        type: ContentTypeCapabilityRequest,
        parameters: {},
        content: bytes,
      } as any),
    ).toThrow(/askerInboxId/);
  });

  it("rejects empty askerInboxId on encode", () => {
    expect(() => codec.encode(makeRequest({ askerInboxId: "" }))).toThrow(
      /askerInboxId/,
    );
  });

  it("round-trips askerInboxId verbatim", () => {
    const original = makeRequest({ askerInboxId: "0xagent-inbox-hex" });
    expect(codec.decode(codec.encode(original)).askerInboxId).toBe(
      "0xagent-inbox-hex",
    );
  });
});

describe("isCapabilityRequestMessage", () => {
  it("matches the capability_request content type", () => {
    expect(
      isCapabilityRequestMessage(mockMessage(ContentTypeCapabilityRequest)),
    ).toBe(true);
  });

  it("rejects other content types", () => {
    expect(
      isCapabilityRequestMessage(
        mockMessage({ authorityId: "xmtp.org", typeId: "text", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getCapabilityRequestContent", () => {
  it("returns content directly when codec already decoded it", () => {
    const req = makeRequest();
    expect(
      getCapabilityRequestContent(mockMessage(ContentTypeCapabilityRequest, req)),
    ).toEqual(req);
  });

  it("decodes raw EncodedContent when the codec wasn't registered", () => {
    const req = makeRequest();
    const encoded = codec.encode(req);
    expect(
      getCapabilityRequestContent(mockMessage(ContentTypeCapabilityRequest, encoded)),
    ).toEqual(req);
  });

  it("returns undefined for unrelated content", () => {
    expect(
      getCapabilityRequestContent(mockMessage(ContentTypeCapabilityRequest, "hello")),
    ).toBeUndefined();
  });
});
