import { describe, it, expect } from "vitest";
import {
  ConnectionInvocationCodec,
  ContentTypeConnectionInvocation,
  CONNECTION_INVOCATION_CURRENT_SCHEMA_VERSION,
  getConnectionInvocationContent,
  isConnectionInvocationMessage,
  type ConnectionInvocation,
} from "../../src/utils/connectionInvocation.js";
import { dateToSwiftReference } from "../../src/utils/connectionTypes.js";

const codec = new ConnectionInvocationCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

function makeInvocation(
  overrides: Partial<ConnectionInvocation> = {},
): ConnectionInvocation {
  return {
    id: "AABBCCDD-EEFF-1122-3344-556677889900",
    schemaVersion: CONNECTION_INVOCATION_CURRENT_SCHEMA_VERSION,
    invocationId: "agent-1-001",
    kind: "calendar",
    action: {
      name: "create_event",
      arguments: {
        title: { type: "string", value: "Team sync" },
        startDate: { type: "iso8601", value: "2026-05-01T15:00:00-07:00" },
        endDate: { type: "iso8601", value: "2026-05-01T16:00:00-07:00" },
        timeZone: { type: "string", value: "America/Los_Angeles" },
        isAllDay: { type: "bool", value: false },
      },
    },
    issuedAt: dateToSwiftReference(new Date("2026-04-27T12:00:00Z")),
    ...overrides,
  };
}

describe("ContentTypeConnectionInvocation", () => {
  it("matches the iOS wire content type", () => {
    expect(ContentTypeConnectionInvocation).toEqual({
      authorityId: "convos.org",
      typeId: "connection_invocation",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("ConnectionInvocationCodec", () => {
  it("round-trips a calendar create_event invocation", () => {
    const original = makeInvocation();
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
    expect(encoded.type).toEqual(ContentTypeConnectionInvocation);
  });

  it("supports all ArgumentValue tags", () => {
    const original = makeInvocation({
      action: {
        name: "everything",
        arguments: {
          s: { type: "string", value: "hello" },
          b: { type: "bool", value: true },
          i: { type: "int", value: 42 },
          d: { type: "double", value: 3.14 },
          dt: { type: "date", value: 721_692_800 },
          iso: { type: "iso8601", value: "2026-05-01T15:00:00Z" },
          en: { type: "enum", value: "futureEvents" },
          arr: {
            type: "array",
            value: [
              { type: "string", value: "a" },
              { type: "int", value: 1 },
              { type: "null", value: null },
            ],
          },
          n: { type: "null", value: null },
        },
      },
    });
    expect(codec.decode(codec.encode(original))).toEqual(original);
  });

  it('falls back to "Action requested: <name>"', () => {
    expect(codec.fallback(makeInvocation())).toBe("Action requested: create_event");
  });

  it("returns false from shouldPush", () => {
    expect(codec.shouldPush(makeInvocation())).toBe(false);
  });

  it("rejects empty content during decode", () => {
    expect(() =>
      codec.decode({ type: ContentTypeConnectionInvocation, parameters: {}, content: new Uint8Array() } as any),
    ).toThrow(/empty/);
  });

  it("rejects malformed JSON", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeConnectionInvocation,
        parameters: {},
        content: new TextEncoder().encode("{not json"),
      } as any),
    ).toThrow(/Invalid JSON/);
  });

  it("rejects invocations missing action.arguments", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeConnectionInvocation,
        parameters: {},
        content: new TextEncoder().encode(
          JSON.stringify({
            id: "x",
            schemaVersion: 1,
            invocationId: "y",
            kind: "calendar",
            issuedAt: 0,
            action: { name: "n" },
          }),
        ),
      } as any),
    ).toThrow(/action\.arguments/);
  });

  it("rejects invocations carrying malformed argument values", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeConnectionInvocation,
        parameters: {},
        content: new TextEncoder().encode(
          JSON.stringify({
            id: "x",
            schemaVersion: 1,
            invocationId: "y",
            kind: "calendar",
            issuedAt: 0,
            action: { name: "n", arguments: { bad: { type: "uint64", value: 1 } } },
          }),
        ),
      } as any),
    ).toThrow();
  });
});

describe("isConnectionInvocationMessage", () => {
  it("matches the connection_invocation content type", () => {
    expect(
      isConnectionInvocationMessage(mockMessage(ContentTypeConnectionInvocation)),
    ).toBe(true);
  });

  it("rejects other content types", () => {
    expect(
      isConnectionInvocationMessage(
        mockMessage({ authorityId: "xmtp.org", typeId: "text", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getConnectionInvocationContent", () => {
  it("returns content directly when codec already decoded it", () => {
    const inv = makeInvocation();
    expect(getConnectionInvocationContent(mockMessage(ContentTypeConnectionInvocation, inv))).toEqual(
      inv,
    );
  });

  it("decodes raw EncodedContent when the codec wasn't registered", () => {
    const inv = makeInvocation();
    const encoded = codec.encode(inv);
    expect(
      getConnectionInvocationContent(mockMessage(ContentTypeConnectionInvocation, encoded)),
    ).toEqual(inv);
  });

  it("returns undefined for unrelated content", () => {
    expect(
      getConnectionInvocationContent(mockMessage(ContentTypeConnectionInvocation, "hello")),
    ).toBeUndefined();
  });
});
