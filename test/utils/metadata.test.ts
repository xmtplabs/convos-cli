import { deflateRawSync, deflateSync, inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import {
  parseAppData,
  parseAppDataForWrite,
  serializeAppData,
  upsertProfile,
  removeProfile,
  getProfile,
} from "../../src/utils/metadata.js";

describe("conversation metadata", () => {
  const inboxA = "aa" + "00".repeat(31);
  const inboxB = "bb" + "00".repeat(31);

  function encodeVarint(value: number): Buffer {
    const bytes: number[] = [];
    let remaining = value;
    do {
      let byte = remaining % 128;
      remaining = Math.floor(remaining / 128);
      if (remaining > 0) byte |= 0x80;
      bytes.push(byte);
    } while (remaining > 0);
    return Buffer.from(bytes);
  }

  function encodeStringField(fieldNumber: number, value: string): Buffer {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([
      encodeVarint(fieldNumber * 8 + 2),
      encodeVarint(bytes.length),
      bytes,
    ]);
  }

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

    it("roundtrips an uncompressed spaceUrl", () => {
      const spaceUrl = "https://spaces.example/test";
      const encoded = serializeAppData({
        tag: "space",
        profiles: [],
        spaceUrl,
      });

      expect(Buffer.from(encoded, "base64url")[0]).not.toBe(0x1f);
      expect(parseAppData(encoded).spaceUrl).toBe(spaceUrl);
    });

    it("encodes spaceUrl at protobuf field number 9", () => {
      const spaceUrl = "https://s.example";
      const encoded = serializeAppData({
        tag: "",
        profiles: [],
        spaceUrl,
      });

      expect(Buffer.from(encoded, "base64url")).toEqual(
        Buffer.concat([
          encodeStringField(1, ""),
          encodeStringField(9, spaceUrl),
        ]),
      );
    });

    it("replaces an existing spaceUrl with last-write-wins semantics", () => {
      const encoded = serializeAppData({
        tag: "invite-tag",
        profiles: [],
        spaceUrl: "https://old.example",
      });
      const metadata = parseAppDataForWrite(encoded);
      metadata.spaceUrl = "https://new.example";

      const replaced = serializeAppData(metadata);
      const decoded = parseAppData(replaced);
      expect(decoded.spaceUrl).toBe("https://new.example");
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

    it("parseAppDataForWrite allows empty appData for first write", () => {
      const decoded = parseAppDataForWrite("");
      expect(decoded.tag).toBe("");
      expect(decoded.profiles).toEqual([]);
    });

    it("parseAppDataForWrite preserves valid existing tag", () => {
      const encoded = serializeAppData({ tag: "keep-me", profiles: [] });
      const decoded = parseAppDataForWrite(encoded);
      expect(decoded.tag).toBe("keep-me");
    });

    it("parseAppDataForWrite throws on invalid non-empty appData", () => {
      expect(() => parseAppDataForWrite("totally-invalid-data")).toThrow(
        "Could not parse existing appData safely for write",
      );
    });

    it("roundtrips iOS imageEncryptionKey and encryptedGroupImage", () => {
      const encKey = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
      const original = {
        tag: "iosGroup",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
        imageEncryptionKey: encKey,
        encryptedGroupImage: {
          url: "https://example.com/group.enc",
          salt: Buffer.from("aabbccdd", "hex"),
          nonce: Buffer.from("11223344", "hex"),
        },
      };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);

      expect(decoded.profiles).toHaveLength(1);
      expect(decoded.profiles[0].name).toBe("Alice");
      expect(Buffer.from(decoded.imageEncryptionKey!)).toEqual(encKey);
      expect(decoded.encryptedGroupImage!.url).toBe("https://example.com/group.enc");
      expect(Buffer.from(decoded.encryptedGroupImage!.salt)).toEqual(Buffer.from("aabbccdd", "hex"));
      expect(Buffer.from(decoded.encryptedGroupImage!.nonce)).toEqual(Buffer.from("11223344", "hex"));
    });

    it("roundtrips profile encryptedImage", () => {
      const original = {
        tag: "iosProfile",
        profiles: [
          {
            inboxId: inboxA,
            name: "Alice",
            encryptedImage: {
              url: "https://example.com/alice.enc",
              salt: Buffer.from("aabb", "hex"),
              nonce: Buffer.from("ccdd", "hex"),
            },
          },
          { inboxId: inboxB, name: "Bob" },
        ],
      };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);

      expect(decoded.profiles).toHaveLength(2);
      expect(decoded.profiles[0].encryptedImage!.url).toBe("https://example.com/alice.enc");
      expect(Buffer.from(decoded.profiles[0].encryptedImage!.salt)).toEqual(Buffer.from("aabb", "hex"));
      expect(decoded.profiles[1].encryptedImage).toBeUndefined();
    });

    it("ignores the deprecated profile connections field without crashing", () => {
      const profile = Buffer.concat([
        Buffer.from([0x0a, 0x01, 0xaa]),
        encodeStringField(5, "{\"calendar\":true}"),
      ]);
      const wire = Buffer.concat([
        encodeStringField(1, "connections-wire"),
        Buffer.from([0x12]),
        encodeVarint(profile.length),
        profile,
        encodeStringField(9, "https://space.example"),
      ]).toString("base64url");

      const decoded = parseAppData(wire);
      expect(decoded.profiles).toEqual([{ inboxId: "aa" }]);
      expect(decoded.spaceUrl).toBe("https://space.example");
      expect(() => serializeAppData(decoded)).not.toThrow();
    });

    it("preserves iOS fields through CLI read-modify-write cycle", () => {
      // Simulates: iOS creates group with encryption → CLI agent joins → profiles survive
      const iosCreated = {
        tag: "invite-abc",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
        imageEncryptionKey: Buffer.from("deadbeef".repeat(4), "hex"),
        encryptedGroupImage: {
          url: "https://example.com/group.enc",
          salt: Buffer.from("salt1234", "hex"),
          nonce: Buffer.from("nonce567", "hex"),
        },
      };
      const encoded = serializeAppData(iosCreated);

      // CLI agent reads, adds its profile, writes back
      const parsed = parseAppData(encoded);
      const withAgent = {
        ...parsed,
        profiles: [...parsed.profiles, { inboxId: inboxB, name: "Agent" }],
      };
      const reEncoded = serializeAppData(withAgent);
      const final = parseAppData(reEncoded);

      expect(final.profiles).toHaveLength(2);
      expect(final.profiles[0].name).toBe("Alice");
      expect(final.profiles[1].name).toBe("Agent");
      expect(Buffer.from(final.imageEncryptionKey!)).toEqual(
        Buffer.from("deadbeef".repeat(4), "hex"),
      );
      expect(final.encryptedGroupImage!.url).toBe("https://example.com/group.enc");
    });

    it("roundtrips emoji field", () => {
      const original = { tag: "emojiTag", profiles: [], emoji: "🦊" };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);
      expect(decoded.emoji).toBe("🦊");
    });

    it("preserves emoji through read-modify-write cycle", () => {
      const original = {
        tag: "emojiPreserve",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
        emoji: "🐙",
      };
      const encoded = serializeAppData(original);
      const parsed = parseAppData(encoded);
      // Simulate lock: change tag, preserve emoji
      parsed.tag = "newTag";
      const reEncoded = serializeAppData(parsed);
      const final = parseAppData(reEncoded);
      expect(final.emoji).toBe("🐙");
      expect(final.tag).toBe("newTag");
      expect(final.profiles).toHaveLength(1);
    });

    it("treats missing emoji as undefined", () => {
      const original = { tag: "noEmoji", profiles: [] };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);
      expect(decoded.emoji).toBeUndefined();
    });

    it("backward compat: old appData without emoji field decodes cleanly", () => {
      // Simulate appData written by an older CLI/iOS that didn't have the emoji field.
      // Serialize without emoji, then verify parsing doesn't break and emoji is undefined.
      const oldStyleMetadata = { tag: "oldClient", profiles: [{ inboxId: inboxA, name: "Alice" }] };
      const encoded = serializeAppData(oldStyleMetadata);

      const decoded = parseAppData(encoded);
      expect(decoded.tag).toBe("oldClient");
      expect(decoded.profiles).toHaveLength(1);
      expect(decoded.profiles[0].name).toBe("Alice");
      expect(decoded.emoji).toBeUndefined();
    });

    it("backward compat: legacy JSON appData without emoji decodes cleanly", () => {
      const legacy = JSON.stringify({ tag: "legacyTag" });
      const decoded = parseAppData(legacy);
      expect(decoded.tag).toBe("legacyTag");
      expect(decoded.emoji).toBeUndefined();
    });

    it("backward compat: new appData with emoji is safe to read by old parser logic", () => {
      // An older CLI that doesn't know about emoji would still parse tag/profiles correctly.
      // We verify the encoded data roundtrips and that adding emoji doesn't corrupt other fields.
      const withEmoji = {
        tag: "newClient",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
        emoji: "\uD83E\uDD8A",
        imageEncryptionKey: Buffer.from("deadbeef".repeat(4), "hex"),
      };
      const encoded = serializeAppData(withEmoji);
      const decoded = parseAppData(encoded);
      expect(decoded.tag).toBe("newClient");
      expect(decoded.profiles).toHaveLength(1);
      expect(decoded.profiles[0].name).toBe("Alice");
      expect(decoded.emoji).toBe("\uD83E\uDD8A");
      expect(Buffer.from(decoded.imageEncryptionKey!)).toEqual(Buffer.from("deadbeef".repeat(4), "hex"));
    });

    it("roundtrips agentDm originConversationId", () => {
      const originId = "cc" + "11".repeat(31);
      const original = {
        tag: "agentDmTag",
        profiles: [],
        agentDm: { originConversationId: originId },
      };
      const encoded = serializeAppData(original);
      const decoded = parseAppData(encoded);
      expect(decoded.agentDm?.originConversationId).toBe(originId);
    });

    it("preserves agentDm through parseAppDataForWrite (RMW survival)", () => {
      const originId = "dd" + "22".repeat(31);
      const encoded = serializeAppData({
        tag: "rmwTag",
        profiles: [{ inboxId: inboxA, name: "Alice" }],
        agentDm: { originConversationId: originId },
      });

      // Write-guarded read: marker must survive so a later RMW can't strip it.
      const forWrite = parseAppDataForWrite(encoded);
      expect(forWrite.agentDm?.originConversationId).toBe(originId);

      // Simulate lock: rotate tag, write back, marker persists.
      forWrite.tag = "rotated";
      const reEncoded = serializeAppData(forWrite);
      const reParsed = parseAppData(reEncoded);
      expect(reParsed.agentDm?.originConversationId).toBe(originId);
      expect(reParsed.tag).toBe("rotated");
    });

    it("omits agentDm field when absent", () => {
      const encoded = serializeAppData({ tag: "noAgentDm", profiles: [] });
      const decoded = parseAppData(encoded);
      expect(decoded.agentDm).toBeUndefined();
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

    it("parses an appData vector written by the iOS serializer", () => {
      const decoded = parseAppData(
        "Cg5zd2lmdC1zcGFjZS12MUoRaHR0cHM6Ly9zLmV4YW1wbGU",
      );
      expect(decoded.tag).toBe("swift-space-v1");
      expect(decoded.spaceUrl).toBe("https://s.example");
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

  describe("raw-DEFLATE (iOS) compressed appData", () => {
    // iOS compresses with Apple's COMPRESSION_ZLIB, which emits raw DEFLATE
    // (no zlib header). Frame: [0x1f][4-byte size BE][raw deflate body].
    function iosCompress(payload: Buffer): string {
      const compressed = deflateRawSync(payload);
      const sizeBytes = Buffer.alloc(4);
      sizeBytes.writeUInt32BE(payload.length);
      return Buffer.concat([
        Buffer.from([0x1f]),
        sizeBytes,
        compressed,
      ]).toString("base64url");
    }

    it("parses an iOS-compressed blob identically to its uncompressed form", () => {
      // A <100-byte payload is below the writer's compression threshold, so
      // serializeAppData returns the raw protobuf bytes base64url-encoded —
      // no un-framing needed and no coupling to the writer's compression
      // heuristics. Frame those bytes the way iOS does and parse.
      const uncompressed = serializeAppData({ tag: "inviteTag123", profiles: [] });
      const protobufBytes = Buffer.from(uncompressed, "base64url");

      const iosBlob = iosCompress(protobufBytes);
      const parsed = parseAppData(iosBlob);

      expect(parsed).toEqual(parseAppData(uncompressed));
      expect(parsed.tag).toBe("inviteTag123");
    });

    it("still rejects garbage compressed bodies", () => {
      const garbage = Buffer.concat([
        Buffer.from([0x1f, 0x00, 0x00, 0x00, 0x10]),
        Buffer.from("definitely-not-deflate"),
      ]).toString("base64url");
      expect(parseAppData(garbage)).toEqual({ tag: "", profiles: [] });
    });
  });

  describe("raw-DEFLATE writer (phase 2 of format convergence)", () => {
    // Enough content to cross the 100-byte compression threshold.
    const largeMetadata = {
      tag: "phaseTwoTag",
      profiles: [
        { inboxId: inboxA, name: "Alice", image: "https://example.com/alice-avatar.png" },
        { inboxId: inboxB, name: "Bob", image: "https://example.com/bob-avatar.png" },
      ],
    };

    it("emits raw DEFLATE so iOS/Android raw-only readers can decode it", () => {
      const encoded = serializeAppData(largeMetadata);
      const rawBytes = Buffer.from(encoded, "base64url");
      expect(rawBytes[0]).toBe(0x1f); // compressed
      const declaredSize = rawBytes.readUInt32BE(1);
      // Raw inflate must succeed DIRECTLY — no zlib header to skip. This is
      // exactly what Apple's COMPRESSION_ZLIB and Inflater(nowrap=true) do.
      const inflated = inflateRawSync(rawBytes.subarray(5));
      expect(inflated.length).toBe(declaredSize);
      expect(parseAppData(encoded)).toEqual(parseAppData(encoded));
      expect(parseAppData(encoded).tag).toBe("phaseTwoTag");
    });

    it("still reads historic zlib-wrapped blobs written before the flip", () => {
      // Mirror of the pre-phase-2 writer: zlib-wrapped deflate in the frame.
      const protobufBytes = Buffer.from(
        serializeAppData({ tag: "legacyZlib", profiles: [] }),
        "base64url",
      );
      const compressed = deflateSync(protobufBytes);
      const sizeBytes = Buffer.alloc(4);
      sizeBytes.writeUInt32BE(protobufBytes.length);
      const legacyBlob = Buffer.concat([
        Buffer.from([0x1f]),
        sizeBytes,
        compressed,
      ]).toString("base64url");

      expect(parseAppData(legacyBlob).tag).toBe("legacyZlib");
    });
  });

  describe("parseAppDataForWrite cause threading", () => {
    it("attaches the decode error as cause when appData is undecodable", () => {
      const garbage = Buffer.concat([
        Buffer.from([0x1f, 0x00, 0x00, 0x00, 0x10]),
        Buffer.from("definitely-not-deflate"),
      ]).toString("base64url");
      let thrown: unknown;
      try {
        parseAppDataForWrite(garbage);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(
        "Could not parse existing appData safely for write",
      );
      expect((thrown as Error).cause).toBeInstanceOf(Error);
    });

    it("attaches a cause for garbage that is not even base64url", () => {
      // "!!!!": Buffer.from(.., "base64url") silently drops every char and
      // yields an empty buffer, which protobuf reads as an empty message —
      // without an explicit alphabet check this would misclassify as
      // decoded-but-tagless (no cause).
      let thrown: unknown;
      try {
        parseAppDataForWrite("!!!!");
      } catch (err) {
        thrown = err;
      }
      expect((thrown as Error).cause).toBeInstanceOf(Error);
      // Lenient path is unchanged: still empty metadata, no throw.
      expect(parseAppData("!!!!")).toEqual({ tag: "", profiles: [] });
    });

    it("throws WITHOUT cause when appData decodes but has an empty tag", () => {
      const tagless = serializeAppData({
        tag: "",
        profiles: [{ inboxId: inboxA, name: "Agent" }],
      });
      let thrown: unknown;
      try {
        parseAppDataForWrite(tagless);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).cause).toBeUndefined();
    });
  });
});
