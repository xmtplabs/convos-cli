import { describe, it, expect } from "vitest";
import {
  ALL_CAPABILITY_REQUEST_RESULT_STATUSES,
  CapabilityRequestResultCodec,
  ContentTypeCapabilityRequestResult,
  CAPABILITY_REQUEST_RESULT_SUPPORTED_VERSION,
  CAPABILITY_REQUEST_RESULT_MAX_PROVIDERS,
  getCapabilityRequestResultContent,
  isCapabilityRequestResultMessage,
  type CapabilityRequestResult,
  type CapabilityRequestResultStatus,
} from "../../src/utils/capabilityRequestResult.js";

const codec = new CapabilityRequestResultCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

function makeResult(
  overrides: Partial<CapabilityRequestResult> = {},
): CapabilityRequestResult {
  return {
    version: CAPABILITY_REQUEST_RESULT_SUPPORTED_VERSION,
    requestId: "req-1",
    status: "approved",
    subject: "calendar",
    capability: "read",
    providers: ["device.calendar"],
    ...overrides,
  };
}

describe("ContentTypeCapabilityRequestResult", () => {
  it("matches the iOS wire content type", () => {
    expect(ContentTypeCapabilityRequestResult).toEqual({
      authorityId: "convos.org",
      typeId: "capability_request_result",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("CapabilityRequestResultCodec", () => {
  it("round-trips an approved single-provider result", () => {
    const original = makeResult();
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("round-trips an approved federated fitness read with multiple providers", () => {
    const original = makeResult({
      subject: "fitness",
      providers: ["composio.strava", "composio.fitbit"],
    });
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it("round-trips for every documented status", () => {
    for (const status of ALL_CAPABILITY_REQUEST_RESULT_STATUSES) {
      const isApproved = status === "approved";
      const original = makeResult({
        status: status as CapabilityRequestResultStatus,
        providers: isApproved ? ["device.calendar"] : [],
      });
      expect(codec.decode(codec.encode(original))).toEqual(original);
    }
  });

  it("falls back with the right verb per status", () => {
    expect(codec.fallback(makeResult({ status: "approved" }))).toBe(
      "Approved calendar access",
    );
    expect(codec.fallback(makeResult({ status: "denied" }))).toBe(
      "Declined calendar access",
    );
    expect(codec.fallback(makeResult({ status: "cancelled" }))).toBe(
      "Cancelled calendar access request",
    );
    expect(
      codec.fallback(makeResult({ status: "approved", subject: "screen_time" })),
    ).toBe("Approved screen time access");
  });

  it("returns false from shouldPush", () => {
    expect(codec.shouldPush(makeResult())).toBe(false);
  });

  it("truncates the providers array at the documented cap", () => {
    const bloated = Array.from(
      { length: CAPABILITY_REQUEST_RESULT_MAX_PROVIDERS + 5 },
      (_, i) => `composio.x${i}`,
    );
    const decoded = codec.decode(
      codec.encode(makeResult({ subject: "fitness", providers: bloated })),
    );
    expect(decoded.providers).toHaveLength(CAPABILITY_REQUEST_RESULT_MAX_PROVIDERS);
  });

  it("rejects future schema versions on decode", () => {
    const future = makeResult({
      version: CAPABILITY_REQUEST_RESULT_SUPPORTED_VERSION + 1,
    });
    const encoded = codec.encode(future);
    expect(() => codec.decode(encoded)).toThrow(/Unsupported.*version/);
  });

  it("rejects empty content during decode", () => {
    expect(() =>
      codec.decode({ type: ContentTypeCapabilityRequestResult, parameters: {}, content: new Uint8Array() } as any),
    ).toThrow(/empty/);
  });

  it("rejects malformed JSON", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeCapabilityRequestResult,
        parameters: {},
        content: new TextEncoder().encode("{not json"),
      } as any),
    ).toThrow(/Invalid JSON/);
  });

  it("rejects results missing the providers array", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeCapabilityRequestResult,
        parameters: {},
        content: new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            requestId: "x",
            status: "approved",
            subject: "calendar",
            capability: "read",
          }),
        ),
      } as any),
    ).toThrow(/providers/);
  });
});

describe("isCapabilityRequestResultMessage", () => {
  it("matches the capability_request_result content type", () => {
    expect(
      isCapabilityRequestResultMessage(mockMessage(ContentTypeCapabilityRequestResult)),
    ).toBe(true);
  });

  it("rejects other content types", () => {
    expect(
      isCapabilityRequestResultMessage(
        mockMessage({ authorityId: "xmtp.org", typeId: "text", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getCapabilityRequestResultContent", () => {
  it("returns content directly when codec already decoded it", () => {
    const r = makeResult();
    expect(
      getCapabilityRequestResultContent(mockMessage(ContentTypeCapabilityRequestResult, r)),
    ).toEqual(r);
  });

  it("decodes raw EncodedContent when the codec wasn't registered", () => {
    const r = makeResult();
    const encoded = codec.encode(r);
    expect(
      getCapabilityRequestResultContent(mockMessage(ContentTypeCapabilityRequestResult, encoded)),
    ).toEqual(r);
  });

  it("returns undefined for unrelated content", () => {
    expect(
      getCapabilityRequestResultContent(mockMessage(ContentTypeCapabilityRequestResult, "hello")),
    ).toBeUndefined();
  });
});
