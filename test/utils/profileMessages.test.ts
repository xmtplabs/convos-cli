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

// ─── Helper to create a mock DecodedMessage with a given content type ───

function mockMessage(contentType: { authorityId: string; typeId: string; versionMajor: number; versionMinor: number }) {
  return { contentType } as any;
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
