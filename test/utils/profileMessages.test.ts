import { describe, it, expect } from "vitest";
import {
  encodeProfileUpdate,
  decodeProfileUpdate,
  encodeProfileSnapshot,
  decodeProfileSnapshot,
  MemberKind,
  ContentTypeProfileUpdate,
  ContentTypeProfileSnapshot,
  isProfileUpdateMessage,
  isProfileSnapshotMessage,
  isProfileMessage,
  type ProfileUpdateContent,
  type ProfileSnapshotContent,
} from "../../src/utils/profileMessages.js";
import {
  isDisplayableMessage,
  getSenderProfileFromResolved,
} from "../../src/utils/xmtp.js";
import {
  parseAppData,
  serializeAppData,
  upsertProfile,
} from "../../src/utils/metadata.js";
import { randomAlphanumeric } from "../../src/utils/random.js";
import type { ResolvedProfile } from "../../src/utils/profileMessages.js";

// ─── Helper to create a mock DecodedMessage with a given content type ───

function mockMessage(contentType: { authorityId: string; typeId: string; versionMajor: number; versionMinor: number }, extra?: Record<string, unknown>) {
  return { contentType, ...extra } as any;
}

// ─── ProfileUpdate Codec Tests ───

describe("ProfileUpdate encode/decode", () => {
  it("round-trips a name-only update", () => {
    const update: ProfileUpdateContent = { name: "Alice" };
    const encoded = encodeProfileUpdate(update);

    expect(encoded.type).toEqual(ContentTypeProfileUpdate);
    expect(encoded.content).toBeInstanceOf(Uint8Array);
    expect(encoded.content.length).toBeGreaterThan(0);

    const decoded = decodeProfileUpdate(encoded);
    expect(decoded.name).toBe("Alice");
    expect(decoded.encryptedImage).toBeUndefined();
    expect(decoded.memberKind).toBeUndefined();
  });

  it("round-trips an update with encrypted image", () => {
    const update: ProfileUpdateContent = {
      name: "Bob",
      encryptedImage: {
        url: "https://example.com/avatar.enc",
        salt: new Uint8Array(32).fill(0xab),
        nonce: new Uint8Array(12).fill(0xcd),
      },
    };

    const encoded = encodeProfileUpdate(update);
    const decoded = decodeProfileUpdate(encoded);

    expect(decoded.name).toBe("Bob");
    expect(decoded.encryptedImage).toBeDefined();
    expect(decoded.encryptedImage!.url).toBe("https://example.com/avatar.enc");
    expect(decoded.encryptedImage!.salt).toHaveLength(32);
    expect(decoded.encryptedImage!.nonce).toHaveLength(12);
  });

  it("round-trips an update with agent memberKind", () => {
    const update: ProfileUpdateContent = {
      name: "Agent Bot",
      memberKind: MemberKind.Agent,
    };

    const encoded = encodeProfileUpdate(update);
    const decoded = decodeProfileUpdate(encoded);

    expect(decoded.name).toBe("Agent Bot");
    expect(decoded.memberKind).toBe(MemberKind.Agent);
  });

  it("round-trips an empty update (profile clear)", () => {
    const update: ProfileUpdateContent = {};
    const encoded = encodeProfileUpdate(update);
    const decoded = decodeProfileUpdate(encoded);

    expect(decoded.name).toBeUndefined();
    expect(decoded.encryptedImage).toBeUndefined();
    expect(decoded.memberKind).toBeUndefined();
  });

  it("omits memberKind when Unspecified", () => {
    const update: ProfileUpdateContent = {
      name: "Test",
      memberKind: MemberKind.Unspecified,
    };
    const encoded = encodeProfileUpdate(update);
    const decoded = decodeProfileUpdate(encoded);

    // Unspecified (0) is the protobuf default, so it won't be serialized
    expect(decoded.name).toBe("Test");
    expect(decoded.memberKind).toBeUndefined();
  });
});

// ─── ProfileSnapshot Codec Tests ───

describe("ProfileSnapshot encode/decode", () => {
  it("round-trips a snapshot with multiple profiles", () => {
    const snapshot: ProfileSnapshotContent = {
      profiles: [
        { inboxId: "aabb".repeat(16), name: "Alice" },
        {
          inboxId: "ccdd".repeat(16),
          name: "Bob",
          encryptedImage: {
            url: "https://example.com/bob.enc",
            salt: new Uint8Array(32).fill(1),
            nonce: new Uint8Array(12).fill(2),
          },
        },
        {
          inboxId: "eeff".repeat(16),
          name: "Agent",
          memberKind: MemberKind.Agent,
        },
      ],
    };

    const encoded = encodeProfileSnapshot(snapshot);

    expect(encoded.type).toEqual(ContentTypeProfileSnapshot);
    expect(encoded.content).toBeInstanceOf(Uint8Array);

    const decoded = decodeProfileSnapshot(encoded);
    expect(decoded.profiles).toHaveLength(3);

    expect(decoded.profiles[0].inboxId).toBe("aabb".repeat(16));
    expect(decoded.profiles[0].name).toBe("Alice");

    expect(decoded.profiles[1].inboxId).toBe("ccdd".repeat(16));
    expect(decoded.profiles[1].name).toBe("Bob");
    expect(decoded.profiles[1].encryptedImage!.url).toBe("https://example.com/bob.enc");

    expect(decoded.profiles[2].inboxId).toBe("eeff".repeat(16));
    expect(decoded.profiles[2].name).toBe("Agent");
    expect(decoded.profiles[2].memberKind).toBe(MemberKind.Agent);
  });

  it("round-trips an empty snapshot", () => {
    const snapshot: ProfileSnapshotContent = { profiles: [] };
    const encoded = encodeProfileSnapshot(snapshot);
    const decoded = decodeProfileSnapshot(encoded);

    expect(decoded.profiles).toHaveLength(0);
  });

  it("handles profiles without names", () => {
    const snapshot: ProfileSnapshotContent = {
      profiles: [
        { inboxId: "1122".repeat(16) },
      ],
    };

    const encoded = encodeProfileSnapshot(snapshot);
    const decoded = decodeProfileSnapshot(encoded);

    expect(decoded.profiles).toHaveLength(1);
    expect(decoded.profiles[0].inboxId).toBe("1122".repeat(16));
    expect(decoded.profiles[0].name).toBeUndefined();
  });
});

// ─── Content Type Matching ───

describe("isProfileMessage", () => {
  it("detects ProfileUpdate messages", () => {
    const msg = mockMessage(ContentTypeProfileUpdate);
    expect(isProfileUpdateMessage(msg)).toBe(true);
    expect(isProfileSnapshotMessage(msg)).toBe(false);
    expect(isProfileMessage(msg)).toBe(true);
  });

  it("detects ProfileSnapshot messages", () => {
    const msg = mockMessage(ContentTypeProfileSnapshot);
    expect(isProfileUpdateMessage(msg)).toBe(false);
    expect(isProfileSnapshotMessage(msg)).toBe(true);
    expect(isProfileMessage(msg)).toBe(true);
  });

  it("does not match regular text messages", () => {
    const msg = mockMessage({
      authorityId: "xmtp.org",
      typeId: "text",
      versionMajor: 1,
      versionMinor: 0,
    });
    expect(isProfileMessage(msg)).toBe(false);
  });

  it("does not match other convos.org content types", () => {
    const msg = mockMessage({
      authorityId: "convos.org",
      typeId: "explode_settings",
      versionMajor: 1,
      versionMinor: 0,
    });
    expect(isProfileMessage(msg)).toBe(false);
  });
});

// ─── isDisplayableMessage filters profile messages ───

describe("isDisplayableMessage with profile messages", () => {
  it("filters out ProfileUpdate messages", () => {
    const msg = mockMessage(ContentTypeProfileUpdate);
    expect(isDisplayableMessage(msg)).toBe(false);
  });

  it("filters out ProfileSnapshot messages", () => {
    const msg = mockMessage(ContentTypeProfileSnapshot);
    expect(isDisplayableMessage(msg)).toBe(false);
  });

  it("still allows regular text messages", () => {
    const msg = mockMessage(
      { authorityId: "xmtp.org", typeId: "text", versionMajor: 1, versionMinor: 0 },
      { content: "hello" },
    );
    expect(isDisplayableMessage(msg)).toBe(true);
  });

  it("still allows group_updated messages", () => {
    const msg = mockMessage(
      { authorityId: "xmtp.org", typeId: "group_updated", versionMajor: 1, versionMinor: 0 },
      { content: {} },
    );
    expect(isDisplayableMessage(msg)).toBe(true);
  });
});

// ─── getSenderProfileFromResolved ───

describe("getSenderProfileFromResolved", () => {
  const inboxA = "aa" + "00".repeat(31);
  const inboxB = "bb" + "00".repeat(31);

  it("returns message-sourced profile when available", () => {
    const resolved = new Map<string, ResolvedProfile>([
      [inboxA.toLowerCase(), { inboxId: inboxA, name: "Alice (message)" }],
    ]);
    const appData = serializeAppData({
      tag: "t",
      profiles: [{ inboxId: inboxA, name: "Alice (appData)" }],
    });

    const profile = getSenderProfileFromResolved(resolved, appData, inboxA);
    expect(profile).toEqual({ name: "Alice (message)" });
  });

  it("falls back to appData when no message-sourced profile", () => {
    const resolved = new Map<string, ResolvedProfile>();
    const appData = serializeAppData({
      tag: "t",
      profiles: [{ inboxId: inboxA, name: "Alice (appData)" }],
    });

    const profile = getSenderProfileFromResolved(resolved, appData, inboxA);
    expect(profile).toEqual({ name: "Alice (appData)" });
  });

  it("returns undefined when neither source has a profile", () => {
    const resolved = new Map<string, ResolvedProfile>();
    const appData = serializeAppData({ tag: "t", profiles: [] });

    const profile = getSenderProfileFromResolved(resolved, appData, inboxA);
    expect(profile).toBeUndefined();
  });

  it("includes encrypted image URL from message-sourced profile", () => {
    const resolved = new Map<string, ResolvedProfile>([
      [inboxA.toLowerCase(), {
        inboxId: inboxA,
        name: "Alice",
        encryptedImage: {
          url: "https://cdn.example.com/avatar.enc",
          salt: new Uint8Array(32),
          nonce: new Uint8Array(12),
        },
      }],
    ]);

    const profile = getSenderProfileFromResolved(resolved, "", inboxA);
    expect(profile).toEqual({
      name: "Alice",
      image: "https://cdn.example.com/avatar.enc",
    });
  });

  it("skips message-sourced profile with no name or image", () => {
    const resolved = new Map<string, ResolvedProfile>([
      [inboxA.toLowerCase(), { inboxId: inboxA }],
    ]);
    const appData = serializeAppData({
      tag: "t",
      profiles: [{ inboxId: inboxA, name: "Alice (appData)" }],
    });

    // Message profile has no name/image, so should fall through to appData
    const profile = getSenderProfileFromResolved(resolved, appData, inboxA);
    expect(profile).toEqual({ name: "Alice (appData)" });
  });

  it("is case-insensitive on inbox ID", () => {
    const resolved = new Map<string, ResolvedProfile>([
      [inboxA.toLowerCase(), { inboxId: inboxA, name: "Alice" }],
    ]);

    const profile = getSenderProfileFromResolved(resolved, "", inboxA.toUpperCase());
    expect(profile).toEqual({ name: "Alice" });
  });
});

// ─── appData corruption scenario ───

describe("appData corruption prevention", () => {
  it("demonstrates the old bug: parseAppData failure leads to data loss", () => {
    // This test documents the corruption bug that was fixed.
    // The old flow was: read appData → parseAppData → upsertProfile → serializeAppData → write
    // If parseAppData failed, it returned { tag: "", profiles: [] }
    // Writing that back erased the invite tag and all profiles.

    // Original metadata has a tag and profiles
    const original = {
      tag: "important-tag",
      profiles: [
        { inboxId: "aa".repeat(32), name: "Alice" },
        { inboxId: "bb".repeat(32), name: "Bob" },
      ],
    };
    const originalAppData = serializeAppData(original);

    // Verify original is intact
    const parsed = parseAppData(originalAppData);
    expect(parsed.tag).toBe("important-tag");
    expect(parsed.profiles).toHaveLength(2);

    // Simulate: appData is corrupted or unparseable (returns empty default)
    const corruptedResult = parseAppData("totally-invalid-data");
    expect(corruptedResult.tag).toBe("");
    expect(corruptedResult.profiles).toHaveLength(0);

    // Old bug: agent would upsert its own profile into the empty metadata
    const agentInboxId = "cc".repeat(32);
    const afterUpsert = upsertProfile(corruptedResult, {
      inboxId: agentInboxId,
      name: "Agent",
    });

    // And write it back — this would erase everything
    const corruptedAppData = serializeAppData(afterUpsert);
    const reRead = parseAppData(corruptedAppData);

    // The tag is gone! Alice and Bob's profiles are gone!
    expect(reRead.tag).toBe("");
    expect(reRead.profiles).toHaveLength(1); // Only the agent
    expect(reRead.profiles[0].name).toBe("Agent");

    // This is why the CLI now sends ProfileUpdate messages instead of
    // doing read-modify-write on appData for profile changes.
  });

  it("lock/unlock preserves existing profiles in appData", () => {
    // Commands that still write appData (lock, unlock, explode) do a
    // read-modify-write but only change tag/expiresAtUnix, preserving profiles.
    const original = {
      tag: "old-tag",
      profiles: [
        { inboxId: "aa".repeat(32), name: "Alice" },
        { inboxId: "bb".repeat(32), name: "Bob" },
      ],
    };
    const appData = serializeAppData(original);

    // Simulate lock: parse → change tag → serialize
    const metadata = parseAppData(appData);
    metadata.tag = randomAlphanumeric(10);
    const newAppData = serializeAppData(metadata);

    // Profiles should be preserved
    const result = parseAppData(newAppData);
    expect(result.tag).not.toBe("old-tag");
    expect(result.tag).toHaveLength(10);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles[0].name).toBe("Alice");
    expect(result.profiles[1].name).toBe("Bob");
  });
});

// ─── Encoded Content Type ───

describe("encoded content type", () => {
  it("ProfileUpdate has correct content type", () => {
    const encoded = encodeProfileUpdate({ name: "Test" });
    expect(encoded.type).toEqual({
      authorityId: "convos.org",
      typeId: "profile_update",
      versionMajor: 1,
      versionMinor: 0,
    });
  });

  it("ProfileSnapshot has correct content type", () => {
    const encoded = encodeProfileSnapshot({ profiles: [] });
    expect(encoded.type).toEqual({
      authorityId: "convos.org",
      typeId: "profile_snapshot",
      versionMajor: 1,
      versionMinor: 0,
    });
  });

  it("ProfileUpdate has shouldPush-compatible settings", () => {
    const encoded = encodeProfileUpdate({ name: "Test" });
    // No fallback means silent (shouldPush = false behavior)
    expect(encoded.fallback).toBeUndefined();
  });
});

// ─── Snapshot Size ───

describe("snapshot size", () => {
  it("stays well under XMTP limits for large groups", () => {
    // Simulate 150 members (Convos max group size)
    const profiles = Array.from({ length: 150 }, (_, i) => ({
      inboxId: Buffer.from(new Uint8Array(32).fill(i)).toString("hex"),
      name: `Member ${i}`,
    }));

    const encoded = encodeProfileSnapshot({ profiles });
    // Should be well under 100KB even at max group size
    expect(encoded.content.length).toBeLessThan(100 * 1024);
    // Sanity check: per-member overhead is reasonable (~50-100 bytes per member)
    expect(encoded.content.length / 150).toBeLessThan(200);
  });
});

// ─── Cross-compatibility ───

describe("protobuf compatibility", () => {
  it("inbox IDs are stored as bytes and round-trip correctly", () => {
    // Test with a realistic 32-byte inbox ID (64-char hex string)
    const inboxId = "abcdef0123456789".repeat(4); // 64 chars = 32 bytes
    const snapshot: ProfileSnapshotContent = {
      profiles: [{ inboxId, name: "Test" }],
    };

    const encoded = encodeProfileSnapshot(snapshot);
    const decoded = decodeProfileSnapshot(encoded);

    expect(decoded.profiles[0].inboxId).toBe(inboxId);
  });

  it("handles encrypted image ref with exact salt and nonce sizes", () => {
    const salt = new Uint8Array(32); // 32-byte HKDF salt
    const nonce = new Uint8Array(12); // 12-byte AES-GCM nonce
    // Fill with recognizable patterns
    salt.fill(0x42);
    nonce.fill(0x99);

    const update: ProfileUpdateContent = {
      name: "Test",
      encryptedImage: {
        url: "https://cdn.example.com/avatar.enc",
        salt,
        nonce,
      },
    };

    const encoded = encodeProfileUpdate(update);
    const decoded = decodeProfileUpdate(encoded);

    expect(Buffer.from(decoded.encryptedImage!.salt)).toEqual(Buffer.from(salt));
    expect(Buffer.from(decoded.encryptedImage!.nonce)).toEqual(Buffer.from(nonce));
  });
});
