import { describe, expect, it } from "vitest";
import {
  parseAppData,
  serializeAppData,
  upsertProfile,
  removeProfile,
  getProfile,
} from "../../src/utils/metadata.js";

describe("conversation metadata", () => {
  const inboxA = "aa" + "00".repeat(31);
  const inboxB = "bb" + "00".repeat(31);

  describe("parseAppData / serializeAppData", () => {
    it("returns empty metadata for empty string", () => {
      const meta = parseAppData("");
      expect(meta.tag).toBe("");
      expect(meta.profiles).toEqual([]);
    });

    it("returns empty metadata for null/undefined", () => {
      const meta = parseAppData(null as unknown as string);
      expect(meta.tag).toBe("");
      expect(meta.profiles).toEqual([]);
    });

    it("roundtrips metadata with tag only", () => {
      const original = { tag: "abc123", profiles: [] };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);
      expect(decoded.tag).toBe("abc123");
      expect(decoded.profiles).toEqual([]);
    });

    it("roundtrips metadata with profiles", () => {
      const original = {
        tag: "myTag",
        profiles: [
          { inboxId: inboxA, name: "Alice", image: "https://example.com/a.jpg" },
          { inboxId: inboxB, name: "Bob" },
        ],
      };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);

      expect(decoded.tag).toBe("myTag");
      expect(decoded.profiles).toHaveLength(2);
      expect(decoded.profiles[0].name).toBe("Alice");
      expect(decoded.profiles[0].image).toBe("https://example.com/a.jpg");
      expect(decoded.profiles[1].name).toBe("Bob");
      expect(decoded.profiles[1].image).toBeUndefined();
    });

    it("roundtrips metadata with expiration", () => {
      const original = {
        tag: "expTag",
        profiles: [],
        expiresAtUnix: 1700000000,
      };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);
      expect(decoded.expiresAtUnix).toBe(1700000000);
    });

    it("does not inject expiresAtUnix=0 on roundtrip when field is absent", () => {
      // Regression: protobuf sfixed64 defaults to 0, and re-serializing
      // that value caused iOS to interpret it as "expires at epoch 0"
      // (1970-01-01), hiding the conversation from the list.
      const original = { tag: "noExpiry", profiles: [] };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);
      expect(decoded.expiresAtUnix).toBeUndefined();

      // Simulate lock: read, rotate tag, write back
      decoded.tag = "rotatedTag";
      const reEncoded = serializeAppData(decoded);
      const reParsed = parseAppData(reEncoded);
      expect(reParsed.expiresAtUnix).toBeUndefined();
      expect(reParsed.tag).toBe("rotatedTag");
    });

    it("does not inject expiresAtUnix=0 on roundtrip with profiles", () => {
      const original = {
        tag: "withProfiles",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);
      expect(decoded.expiresAtUnix).toBeUndefined();
      expect(decoded.profiles).toHaveLength(1);
    });

    it("preserves real expiresAtUnix through roundtrip", () => {
      const ts = 1739200000;
      const original = { tag: "exp", profiles: [], expiresAtUnix: ts };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);
      expect(decoded.expiresAtUnix).toBe(ts);
    });

    it("parses legacy JSON appData", () => {
      const legacy = JSON.stringify({ tag: "oldTag" });
      const decoded = parseAppData(legacy);
      expect(decoded.tag).toBe("oldTag");
      expect(decoded.profiles).toEqual([]);
    });

    it("stays under 8KB for many profiles", () => {
      const profiles = Array.from({ length: 50 }, (_, i) => ({
        inboxId: i.toString(16).padStart(64, "0"),
        name: `User ${i}`,
        image: `https://example.com/avatar-${i}.jpg`,
      }));
      const meta = { tag: "bigGroup", profiles };
      const encoded = serializeAppData(meta);
      expect(Buffer.byteLength(encoded, "utf-8")).toBeLessThan(8 * 1024);
    });
  });

  describe("upsertProfile", () => {
    it("adds a new profile", () => {
      const meta = { tag: "t", profiles: [] };
      const updated = upsertProfile(meta, {
        inboxId: inboxA,
        name: "Alice",
      });
      expect(updated.profiles).toHaveLength(1);
      expect(updated.profiles[0].name).toBe("Alice");
    });

    it("updates an existing profile", () => {
      const meta = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };
      const updated = upsertProfile(meta, {
        inboxId: inboxA,
        name: "Alice Smith",
        image: "https://example.com/new.jpg",
      });
      expect(updated.profiles).toHaveLength(1);
      expect(updated.profiles[0].name).toBe("Alice Smith");
      expect(updated.profiles[0].image).toBe("https://example.com/new.jpg");
    });

    it("is case-insensitive on inboxId", () => {
      const meta = {
        tag: "t",
        profiles: [{ inboxId: inboxA.toLowerCase(), name: "Alice" }],
      };
      const updated = upsertProfile(meta, {
        inboxId: inboxA.toUpperCase(),
        name: "Updated",
      });
      expect(updated.profiles).toHaveLength(1);
      expect(updated.profiles[0].name).toBe("Updated");
    });

    it("does not mutate the original", () => {
      const meta = { tag: "t", profiles: [] };
      const updated = upsertProfile(meta, { inboxId: inboxA, name: "A" });
      expect(meta.profiles).toHaveLength(0);
      expect(updated.profiles).toHaveLength(1);
    });
  });

  describe("removeProfile", () => {
    it("removes a profile by inboxId", () => {
      const meta = {
        tag: "t",
        profiles: [
          { inboxId: inboxA, name: "Alice" },
          { inboxId: inboxB, name: "Bob" },
        ],
      };
      const updated = removeProfile(meta, inboxA);
      expect(updated.profiles).toHaveLength(1);
      expect(updated.profiles[0].inboxId).toBe(inboxB);
    });

    it("is a no-op if inboxId not found", () => {
      const meta = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };
      const updated = removeProfile(meta, inboxB);
      expect(updated.profiles).toHaveLength(1);
    });
  });

  describe("getProfile", () => {
    it("finds a profile by inboxId", () => {
      const meta = {
        tag: "t",
        profiles: [
          { inboxId: inboxA, name: "Alice" },
          { inboxId: inboxB, name: "Bob" },
        ],
      };
      const profile = getProfile(meta, inboxA);
      expect(profile?.name).toBe("Alice");
    });

    it("returns undefined if not found", () => {
      const meta = { tag: "t", profiles: [] };
      expect(getProfile(meta, inboxA)).toBeUndefined();
    });
  });
});
