import { describe, it, expect } from "vitest";
import {
  ALL_CONNECTION_KINDS,
  ALL_INVOCATION_STATUSES,
  SWIFT_REFERENCE_EPOCH_OFFSET_SECONDS,
  assertArgumentValue,
  dateToSwiftReference,
  swiftReferenceToDate,
  type ArgumentValue,
} from "../../src/utils/connectionTypes.js";

describe("Swift reference date conversion", () => {
  it("rounds-trips a known timestamp", () => {
    const original = new Date("2026-04-27T15:00:00.000Z");
    const swift = dateToSwiftReference(original);
    const back = swiftReferenceToDate(swift);
    expect(back.toISOString()).toBe(original.toISOString());
  });

  it("places the Swift reference epoch (2001-01-01) at 0", () => {
    const reference = new Date("2001-01-01T00:00:00.000Z");
    expect(dateToSwiftReference(reference)).toBe(0);
  });

  it("offsets the Unix epoch by the documented constant", () => {
    expect(dateToSwiftReference(new Date(0))).toBe(
      -SWIFT_REFERENCE_EPOCH_OFFSET_SECONDS,
    );
  });
});

describe("ConnectionKind / InvocationStatus enumerations", () => {
  it("lists the nine known connection kinds with snake_case raws", () => {
    expect(ALL_CONNECTION_KINDS).toEqual([
      "health",
      "calendar",
      "contacts",
      "location",
      "photos",
      "music",
      "home_kit",
      "screen_time",
      "motion",
    ]);
  });

  it("lists the seven invocation statuses with snake_case raws", () => {
    expect(ALL_INVOCATION_STATUSES).toEqual([
      "success",
      "capability_not_enabled",
      "capability_revoked",
      "requires_confirmation",
      "authorization_denied",
      "execution_failed",
      "unknown_action",
    ]);
  });
});

describe("assertArgumentValue", () => {
  it.each<ArgumentValue>([
    { type: "string", value: "hello" },
    { type: "bool", value: true },
    { type: "int", value: 42 },
    { type: "double", value: 3.14 },
    { type: "date", value: 721_692_800 },
    { type: "iso8601", value: "2026-05-01T15:00:00Z" },
    { type: "enum", value: "futureEvents" },
    { type: "null", value: null },
  ])("accepts a well-formed %s value", (value) => {
    expect(() => assertArgumentValue(value)).not.toThrow();
  });

  it("recursively validates array values", () => {
    const value: ArgumentValue = {
      type: "array",
      value: [
        { type: "string", value: "a" },
        { type: "int", value: 1 },
        { type: "null", value: null },
        { type: "array", value: [{ type: "bool", value: false }] },
      ],
    };
    expect(() => assertArgumentValue(value)).not.toThrow();
  });

  it("rejects unknown tags", () => {
    expect(() => assertArgumentValue({ type: "uint64", value: 1 } as never)).toThrow(
      /unknown type tag/,
    );
  });

  it("rejects mismatched value types", () => {
    expect(() => assertArgumentValue({ type: "int", value: "1" } as never)).toThrow(
      /expected number value/,
    );
    expect(() => assertArgumentValue({ type: "null", value: 0 } as never)).toThrow(
      /null variant must carry null/,
    );
  });

  it("rejects non-tagged objects", () => {
    expect(() => assertArgumentValue("hello" as never)).toThrow();
    expect(() => assertArgumentValue([] as never)).toThrow();
    expect(() => assertArgumentValue(null as never)).toThrow();
  });
});
