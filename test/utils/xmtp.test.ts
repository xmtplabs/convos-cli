import { describe, expect, it } from "vitest";
import {
  describeAppDataChange,
  getSenderProfile,
  type ProfileMap,
} from "../../src/utils/xmtp.js";
import {
  serializeAppData,
  type ConversationCustomMetadata,
} from "../../src/utils/metadata.js";

describe("describeAppDataChange", () => {
  const inboxA = "aa" + "00".repeat(31);
  const inboxB = "bb" + "00".repeat(31);
  const inboxC = "cc" + "00".repeat(31);

  const emptyMeta: ConversationCustomMetadata = { tag: "", profiles: [] };
  const emptyProfiles: ProfileMap = new Map();

  describe("profile changes", () => {
    it("detects a new profile with a name", () => {
      const oldMeta: ConversationCustomMetadata = { tag: "t", profiles: [] };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual(["Alice set their profile name"]);
    });

    it("detects a new profile with a photo", () => {
      const oldMeta: ConversationCustomMetadata = { tag: "t", profiles: [] };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, image: "https://example.com/a.jpg" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual(["Somebody set their profile photo"]);
    });

    it("detects a new profile with name and photo", () => {
      const oldMeta: ConversationCustomMetadata = { tag: "t", profiles: [] };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice", image: "https://example.com/a.jpg" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toContain("Alice set their profile name");
      expect(result).toContain("Alice set their profile photo");
    });

    it("detects a profile name change", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice Smith" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual(["Alice changed their name to Alice Smith"]);
    });

    it("detects a profile name being cleared", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual(["Alice cleared their profile name"]);
    });

    it("detects a profile photo update", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice", image: "https://example.com/old.jpg" }],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice", image: "https://example.com/new.jpg" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual(["Alice updated their profile photo"]);
    });

    it("detects a profile photo being removed", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice", image: "https://example.com/a.jpg" }],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual(["Alice removed their profile photo"]);
    });

    it("detects a profile being removed", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };
      const newMeta: ConversationCustomMetadata = { tag: "t", profiles: [] };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual(["Alice's profile was removed"]);
    });

    it("detects both name and photo change at once", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice", image: "https://example.com/old.jpg" }],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice Smith", image: "https://example.com/new.jpg" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toContain("Alice changed their name to Alice Smith");
      expect(result).toContain("Alice Smith updated their profile photo");
    });

    it("uses ProfileMap for name resolution when profile has no name", () => {
      const profiles: ProfileMap = new Map([[inboxA.toLowerCase(), "Alice"]]);
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, image: "https://example.com/old.jpg" }],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, image: "https://example.com/new.jpg" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", profiles);
      expect(result).toEqual(["Alice updated their profile photo"]);
    });

    it("returns empty when multiple profiles changed (too complex)", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [
          { inboxId: inboxA, name: "Alice" },
          { inboxId: inboxB, name: "Bob" },
        ],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [
          { inboxId: inboxA, name: "Alice Smith" },
          { inboxId: inboxB, name: "Bob Jones" },
        ],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual([]);
    });

    it("returns empty when one profile changed and another was added", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [
          { inboxId: inboxA, name: "Alice Smith" },
          { inboxId: inboxB, name: "Bob" },
        ],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual([]);
    });

    it("returns empty when one profile changed and another was removed", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [
          { inboxId: inboxA, name: "Alice" },
          { inboxId: inboxB, name: "Bob" },
        ],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice Smith" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual([]);
    });

    it("allows single profile change when other profiles are unchanged", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [
          { inboxId: inboxA, name: "Alice" },
          { inboxId: inboxB, name: "Bob" },
        ],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [
          { inboxId: inboxA, name: "Alice Smith" },
          { inboxId: inboxB, name: "Bob" },
        ],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Somebody", emptyProfiles);
      expect(result).toEqual(["Alice changed their name to Alice Smith"]);
    });

    it("detects no change when profiles are identical", () => {
      const meta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };

      const result = describeAppDataChange(meta, meta, "Somebody", emptyProfiles);
      expect(result).toEqual([]);
    });
  });

  describe("invite tag changes", () => {
    it("detects invite tag rotation", () => {
      const oldMeta: ConversationCustomMetadata = { tag: "oldTag", profiles: [] };
      const newMeta: ConversationCustomMetadata = { tag: "newTag", profiles: [] };

      const result = describeAppDataChange(oldMeta, newMeta, "Alice", emptyProfiles);
      expect(result).toEqual(["Alice rotated the invite tag"]);
    });

    it("detects invite tag being set for the first time", () => {
      const oldMeta: ConversationCustomMetadata = { tag: "", profiles: [] };
      const newMeta: ConversationCustomMetadata = { tag: "firstTag", profiles: [] };

      const result = describeAppDataChange(oldMeta, newMeta, "Alice", emptyProfiles);
      expect(result).toEqual(["Alice set the invite tag"]);
    });

    it("detects invite tag being cleared", () => {
      const oldMeta: ConversationCustomMetadata = { tag: "someTag", profiles: [] };
      const newMeta: ConversationCustomMetadata = { tag: "", profiles: [] };

      const result = describeAppDataChange(oldMeta, newMeta, "Alice", emptyProfiles);
      expect(result).toEqual(["Alice cleared the invite tag"]);
    });

    it("no description when tag is unchanged", () => {
      const oldMeta: ConversationCustomMetadata = { tag: "sameTag", profiles: [] };
      const newMeta: ConversationCustomMetadata = { tag: "sameTag", profiles: [] };

      const result = describeAppDataChange(oldMeta, newMeta, "Alice", emptyProfiles);
      expect(result).toEqual([]);
    });
  });

  describe("expiration changes", () => {
    it("detects expiration being set", () => {
      const oldMeta: ConversationCustomMetadata = { tag: "t", profiles: [] };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [],
        expiresAtUnix: 1700000000,
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Alice", emptyProfiles);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatch(/Alice set conversation expiration to/);
    });

    it("handles invalid expiration timestamp gracefully", () => {
      const oldMeta: ConversationCustomMetadata = { tag: "t", profiles: [] };
      const newMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [],
        expiresAtUnix: Number.MAX_SAFE_INTEGER,
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Alice", emptyProfiles);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatch(/Alice set conversation expiration to/);
      // Should fall back to raw number, not throw
      expect(result[0]).toContain(String(Number.MAX_SAFE_INTEGER));
    });

    it("detects expiration being cleared", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [],
        expiresAtUnix: 1700000000,
      };
      const newMeta: ConversationCustomMetadata = { tag: "t", profiles: [] };

      const result = describeAppDataChange(oldMeta, newMeta, "Alice", emptyProfiles);
      expect(result).toEqual(["Alice cleared conversation expiration"]);
    });
  });

  describe("combined changes", () => {
    it("handles profile change + tag rotation together", () => {
      const oldMeta: ConversationCustomMetadata = {
        tag: "oldTag",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };
      const newMeta: ConversationCustomMetadata = {
        tag: "newTag",
        profiles: [{ inboxId: inboxA, name: "Alice Smith" }],
      };

      const result = describeAppDataChange(oldMeta, newMeta, "Admin", emptyProfiles);
      expect(result).toContain("Alice changed their name to Alice Smith");
      expect(result).toContain("Admin rotated the invite tag");
    });

    it("returns empty array when nothing changed", () => {
      const meta: ConversationCustomMetadata = {
        tag: "t",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
      };

      const result = describeAppDataChange(meta, meta, "Alice", emptyProfiles);
      expect(result).toEqual([]);
    });

    it("handles empty old and new metadata", () => {
      const result = describeAppDataChange(emptyMeta, emptyMeta, "Alice", emptyProfiles);
      expect(result).toEqual([]);
    });
  });
});

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
