import { describe, it, expect } from "vitest";
import {
  ALL_CAPABILITY_REQUEST_RESULT_STATUSES,
  CapabilityRequestResultCodec,
  ContentTypeCapabilityRequestResult,
  CAPABILITY_REQUEST_RESULT_SUPPORTED_VERSION,
  CAPABILITY_REQUEST_RESULT_MAX_PROVIDERS,
  CAPABILITY_REQUEST_RESULT_MAX_AVAILABLE_ACTIONS,
  getCapabilityRequestResultContent,
  isCapabilityRequestResultMessage,
  type AvailableAction,
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
    availableActions: [],
    ...overrides,
  };
}

function makeAction(overrides: Partial<AvailableAction> = {}): AvailableAction {
  return {
    providerId: "device.calendar",
    kind: "calendar",
    actionName: "create_event",
    summary: "Create a calendar event",
    inputs: [
      { name: "title", type: "string", description: "Event title", isRequired: true },
    ],
    outputs: [
      { name: "eventId", type: "string", description: "Calendar event ID", isRequired: true },
    ],
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

  it("round-trips availableActions with full provider/kind/actionName/parameter shape", () => {
    const original = makeResult({
      availableActions: [
        makeAction({
          actionName: "fetch_summary_last_24h",
          summary: "Fetch health summary",
          providerId: "device.health",
          kind: "health",
          inputs: [],
          outputs: [
            { name: "summary", type: "string", description: "Human-readable summary", isRequired: true },
          ],
        }),
      ],
    });
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

  it("truncates availableActions at the documented cap", () => {
    const bloated = Array.from(
      { length: CAPABILITY_REQUEST_RESULT_MAX_AVAILABLE_ACTIONS + 5 },
      (_, i) => makeAction({ actionName: `action_${i}` }),
    );
    const decoded = codec.decode(codec.encode(makeResult({ availableActions: bloated })));
    expect(decoded.availableActions).toHaveLength(
      CAPABILITY_REQUEST_RESULT_MAX_AVAILABLE_ACTIONS,
    );
  });

  it("rejects future schema versions on decode", () => {
    const futureBytes = new TextEncoder().encode(
      JSON.stringify(
        makeResult({ version: CAPABILITY_REQUEST_RESULT_SUPPORTED_VERSION + 1 }),
      ),
    );
    expect(() =>
      codec.decode({
        type: ContentTypeCapabilityRequestResult,
        parameters: {},
        content: futureBytes,
      } as any),
    ).toThrow(/Unsupported.*version/);
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

  it("rejects results where providers is not an array", () => {
    // iOS encodes `providers` as a JSON array; a string here is malformed.
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
            providers: "device.calendar",
            availableActions: [],
          }),
        ),
      } as any),
    ).toThrow(/providers/);
  });

  it("treats missing providers and availableActions as empty (forward-compat with iOS decodeIfPresent)", () => {
    const decoded = codec.decode({
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
    } as any);
    expect(decoded.providers).toEqual([]);
    expect(decoded.availableActions).toEqual([]);
  });

  it("rejects malformed availableAction parameters", () => {
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
            providers: ["device.calendar"],
            availableActions: [
              {
                providerId: "device.calendar",
                kind: "calendar",
                actionName: "create_event",
                summary: "x",
                inputs: "bad",
                outputs: [],
              },
            ],
          }),
        ),
      } as any),
    ).toThrow(/availableAction|inputs/);
  });

  it("rejects availableAction parameters using the legacy `required` key", () => {
    // iOS PR #771 renamed `required` → `isRequired`. Senders still using the
    // old key must fail loudly so we don't silently mistype the parameter.
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
            providers: ["device.calendar"],
            availableActions: [
              {
                providerId: "device.calendar",
                kind: "calendar",
                actionName: "create_event",
                summary: "x",
                inputs: [
                  { name: "title", type: "string", description: "x", required: true },
                ],
                outputs: [],
              },
            ],
          }),
        ),
      } as any),
    ).toThrow(/isRequired/);
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
