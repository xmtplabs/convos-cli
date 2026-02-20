import { describe, expect, it } from "vitest";
import { getSenderProfile } from "../../src/utils/xmtp.js";
import { serializeAppData } from "../../src/utils/metadata.js";

describe("getSenderProfile", () => {
  const inboxA = "aa" + "00".repeat(31);
  const inboxB = "bb" + "00".repeat(31);

  it("returns profile with name and image", () => {
    const appData = serializeAppData({
      tag: "t",
      profiles: [
        { inboxId: inboxA, name: "Alice", image: "https://example.com/a.jpg" },
      ],
    });

    const profile = getSenderProfile(appData, inboxA);
    expect(profile).toEqual({ name: "Alice", image: "https://example.com/a.jpg" });
  });

  it("returns profile with name only", () => {
    const appData = serializeAppData({
      tag: "t",
      profiles: [{ inboxId: inboxA, name: "Alice" }],
    });

    const profile = getSenderProfile(appData, inboxA);
    expect(profile).toEqual({ name: "Alice" });
  });

  it("returns profile with image only", () => {
    const appData = serializeAppData({
      tag: "t",
      profiles: [{ inboxId: inboxA, image: "https://example.com/a.jpg" }],
    });

    const profile = getSenderProfile(appData, inboxA);
    expect(profile).toEqual({ image: "https://example.com/a.jpg" });
  });

  it("returns undefined for unknown inbox ID", () => {
    const appData = serializeAppData({
      tag: "t",
      profiles: [{ inboxId: inboxA, name: "Alice" }],
    });

    const profile = getSenderProfile(appData, inboxB);
    expect(profile).toBeUndefined();
  });

  it("returns undefined for empty appData", () => {
    const profile = getSenderProfile("", inboxA);
    expect(profile).toBeUndefined();
  });

  it("returns undefined for profile with no name or image", () => {
    const appData = serializeAppData({
      tag: "t",
      profiles: [{ inboxId: inboxA }],
    });

    const profile = getSenderProfile(appData, inboxA);
    expect(profile).toBeUndefined();
  });

  it("is case-insensitive on inbox ID", () => {
    const appData = serializeAppData({
      tag: "t",
      profiles: [{ inboxId: inboxA.toLowerCase(), name: "Alice" }],
    });

    const profile = getSenderProfile(appData, inboxA.toUpperCase());
    expect(profile).toEqual({ name: "Alice" });
  });

  it("finds the correct profile among multiple", () => {
    const appData = serializeAppData({
      tag: "t",
      profiles: [
        { inboxId: inboxA, name: "Alice" },
        { inboxId: inboxB, name: "Bob", image: "https://example.com/b.jpg" },
      ],
    });

    const profile = getSenderProfile(appData, inboxB);
    expect(profile).toEqual({ name: "Bob", image: "https://example.com/b.jpg" });
  });
});
