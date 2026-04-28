import { describe, it, expect } from "vitest";
import {
  ConnectionInvocationResultCodec,
  ContentTypeConnectionInvocationResult,
  CONNECTION_INVOCATION_RESULT_CURRENT_SCHEMA_VERSION,
  getConnectionInvocationResultContent,
  isConnectionInvocationResultMessage,
  type ConnectionInvocationResult,
} from "../../src/utils/connectionInvocationResult.js";
import {
  ALL_INVOCATION_STATUSES,
  dateToSwiftReference,
  type InvocationStatus,
} from "../../src/utils/connectionTypes.js";

const codec = new ConnectionInvocationResultCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

function makeResult(
  overrides: Partial<ConnectionInvocationResult> = {},
): ConnectionInvocationResult {
  return {
    id: "DDEEFF00-1122-3344-5566-778899AABBCC",
    schemaVersion: CONNECTION_INVOCATION_RESULT_CURRENT_SCHEMA_VERSION,
    invocationId: "agent-1-001",
    kind: "contacts",
    actionName: "create_contact",
    status: "success",
    result: { contactId: { type: "string", value: "ABC123" } },
    completedAt: dateToSwiftReference(new Date("2026-04-27T12:30:00Z")),
    ...overrides,
  };
}

describe("ContentTypeConnectionInvocationResult", () => {
  it("matches the iOS wire content type", () => {
    expect(ContentTypeConnectionInvocationResult).toEqual({
      authorityId: "convos.org",
      typeId: "connection_invocation_result",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

describe("ConnectionInvocationResultCodec", () => {
  it("round-trips a successful result", () => {
    const original = makeResult();
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
    expect(encoded.type).toEqual(ContentTypeConnectionInvocationResult);
  });

  it("round-trips for every documented status", () => {
    for (const status of ALL_INVOCATION_STATUSES) {
      const isSuccess = status === "success";
      const original = makeResult({
        status: status as InvocationStatus,
        result: isSuccess
          ? { eventId: { type: "string", value: "evt-abc" } }
          : {},
        errorMessage: isSuccess ? undefined : `failed: ${status}`,
      });
      expect(codec.decode(codec.encode(original))).toEqual(original);
    }
  });

  it('falls back to "<actionName>: <status>"', () => {
    expect(codec.fallback(makeResult())).toBe("create_contact: success");
    expect(
      codec.fallback(makeResult({ status: "execution_failed" })),
    ).toBe("create_contact: execution_failed");
  });

  it("returns false from shouldPush", () => {
    expect(codec.shouldPush(makeResult())).toBe(false);
  });

  it("rejects empty content during decode", () => {
    expect(() =>
      codec.decode({ type: ContentTypeConnectionInvocationResult, parameters: {}, content: new Uint8Array() } as any),
    ).toThrow(/empty/);
  });

  it("rejects malformed JSON", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeConnectionInvocationResult,
        parameters: {},
        content: new TextEncoder().encode("{not json"),
      } as any),
    ).toThrow(/Invalid JSON/);
  });

  it("rejects results missing the result map", () => {
    expect(() =>
      codec.decode({
        type: ContentTypeConnectionInvocationResult,
        parameters: {},
        content: new TextEncoder().encode(
          JSON.stringify({
            id: "x",
            schemaVersion: 1,
            invocationId: "y",
            kind: "contacts",
            actionName: "n",
            status: "success",
            completedAt: 0,
          }),
        ),
      } as any),
    ).toThrow();
  });
});

describe("isConnectionInvocationResultMessage", () => {
  it("matches the connection_invocation_result content type", () => {
    expect(
      isConnectionInvocationResultMessage(
        mockMessage(ContentTypeConnectionInvocationResult),
      ),
    ).toBe(true);
  });

  it("rejects other content types", () => {
    expect(
      isConnectionInvocationResultMessage(
        mockMessage({ authorityId: "xmtp.org", typeId: "text", versionMajor: 1, versionMinor: 0 }),
      ),
    ).toBe(false);
  });
});

describe("getConnectionInvocationResultContent", () => {
  it("returns content directly when codec already decoded it", () => {
    const result = makeResult();
    expect(
      getConnectionInvocationResultContent(
        mockMessage(ContentTypeConnectionInvocationResult, result),
      ),
    ).toEqual(result);
  });

  it("decodes raw EncodedContent when the codec wasn't registered", () => {
    const result = makeResult();
    const encoded = codec.encode(result);
    expect(
      getConnectionInvocationResultContent(
        mockMessage(ContentTypeConnectionInvocationResult, encoded),
      ),
    ).toEqual(result);
  });

  it("returns undefined for unrelated content", () => {
    expect(
      getConnectionInvocationResultContent(
        mockMessage(ContentTypeConnectionInvocationResult, "hello"),
      ),
    ).toBeUndefined();
  });
});
