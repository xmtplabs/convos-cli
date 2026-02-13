import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  createInviteSlug,
  parseInvite,
  verifyInvite,
  verifyInviteSignature,
  recoverInvitePublicKey,
  inviteToSlug,
  encryptConversationToken,
  decryptConversationToken,
} from "../../src/utils/invite.js";

describe("invite crypto", () => {
  const testPrivateKey =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const testPrivateKeyBytes = Buffer.from(
    "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    "hex",
  );
  const testInboxId =
    "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const testConversationId = "550e8400-e29b-41d4-a716-446655440000";

  describe("conversation token encryption", () => {
    it("encrypts and decrypts a UUID conversation ID", () => {
      const token = encryptConversationToken(
        testConversationId,
        testInboxId,
        testPrivateKeyBytes,
      );

      expect(token).toBeInstanceOf(Buffer);
      expect(token[0]).toBe(1); // format version

      const decrypted = decryptConversationToken(
        token,
        testInboxId,
        testPrivateKeyBytes,
      );
      expect(decrypted).toBe(testConversationId);
    });

    it("encrypts and decrypts a non-UUID conversation ID", () => {
      const nonUuid = "some-arbitrary-conversation-id-string";
      const token = encryptConversationToken(
        nonUuid,
        testInboxId,
        testPrivateKeyBytes,
      );

      const decrypted = decryptConversationToken(
        token,
        testInboxId,
        testPrivateKeyBytes,
      );
      expect(decrypted).toBe(nonUuid);
    });

    it("fails to decrypt with wrong inbox ID", () => {
      const token = encryptConversationToken(
        testConversationId,
        testInboxId,
        testPrivateKeyBytes,
      );

      const wrongInboxId =
        "0000000000000000000000000000000000000000000000000000000000000000";
      expect(() =>
        decryptConversationToken(token, wrongInboxId, testPrivateKeyBytes),
      ).toThrow();
    });

    it("fails to decrypt with wrong private key", () => {
      const token = encryptConversationToken(
        testConversationId,
        testInboxId,
        testPrivateKeyBytes,
      );

      const wrongKey = Buffer.alloc(32, 0xff);
      expect(() =>
        decryptConversationToken(token, testInboxId, wrongKey),
      ).toThrow();
    });

    it("produces different ciphertexts each time (random nonce)", () => {
      const t1 = encryptConversationToken(
        testConversationId,
        testInboxId,
        testPrivateKeyBytes,
      );
      const t2 = encryptConversationToken(
        testConversationId,
        testInboxId,
        testPrivateKeyBytes,
      );
      expect(t1.equals(t2)).toBe(false);
    });
  });

  describe("invite slug creation and parsing", () => {
    it("creates and parses a basic invite", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "testTag123",
        testPrivateKey,
      );

      expect(typeof slug).toBe("string");
      expect(slug.length).toBeGreaterThan(0);

      const parsed = parseInvite(slug);
      expect(parsed.tag).toBe("testTag123");
      expect(parsed.creatorInboxId).toBe(testInboxId);
      expect(parsed.expiresAfterUse).toBe(false);
      expect(await verifyInvite(parsed)).toBe(true);

      // Decrypt the conversation token
      const decrypted = decryptConversationToken(
        parsed.conversationToken,
        testInboxId,
        testPrivateKeyBytes,
      );
      expect(decrypted).toBe(testConversationId);
    });

    it("includes optional metadata", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "tagWithMeta",
        testPrivateKey,
        {
          name: "Test Group",
          description: "A test group",
          expiresAfterUse: true,
        },
      );

      const parsed = parseInvite(slug);
      expect(parsed.name).toBe("Test Group");
      expect(parsed.description).toBe("A test group");
      expect(parsed.expiresAfterUse).toBe(true);
    });

    it("includes expiration time", async () => {
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "tagExpiry",
        testPrivateKey,
        { expiresAt },
      );

      const parsed = parseInvite(slug);
      expect(parsed.expiresAt).toBeDefined();
      // Allow 1 second tolerance
      expect(
        Math.abs(parsed.expiresAt!.getTime() - expiresAt.getTime()),
      ).toBeLessThan(1000);
    });

    it("re-encodes to the same slug", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "roundtrip",
        testPrivateKey,
        { name: "Roundtrip Test" },
      );

      const parsed = parseInvite(slug);
      const reencoded = inviteToSlug(parsed);
      expect(reencoded).toBe(slug);
    });

    it("parses invite from a URL", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "urlTest",
        testPrivateKey,
      );

      const url = `https://dev.popup.convos.org/v2?i=${encodeURIComponent(slug)}`;
      const parsed = parseInvite(url);
      expect(parsed.tag).toBe("urlTest");
    });

    it("handles iMessage separators", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "sepTest",
        testPrivateKey,
      );

      // Simulate iMessage separator insertion
      const withSeparators = slug.replace(/(.{50})/g, "$1*");
      const parsed = parseInvite(withSeparators);
      expect(parsed.tag).toBe("sepTest");
    });
  });

  describe("invite verification", () => {
    it("accepts a validly signed invite", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "validSig",
        testPrivateKey,
      );
      const parsed = parseInvite(slug);
      expect(await verifyInvite(parsed)).toBe(true);
    });

    it("rejects invite with empty tag", async () => {
      const bad = {
        tag: "",
        creatorInboxId: testInboxId,
        conversationToken: Buffer.from([1, 2, 3]),
        expiresAfterUse: false,
        payloadBytes: new Uint8Array([1]),
        signature: new Uint8Array(65),
      };
      expect(await verifyInvite(bad)).toBe(false);
    });

    it("rejects invite with wrong signature length", async () => {
      const bad = {
        tag: "test",
        creatorInboxId: testInboxId,
        conversationToken: Buffer.from([1, 2, 3]),
        expiresAfterUse: false,
        payloadBytes: new Uint8Array([1]),
        signature: new Uint8Array(32), // wrong: should be 65
      };
      expect(await verifyInvite(bad)).toBe(false);
    });

    it("rejects corrupted signature against the original signing key", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "corruptSig",
        testPrivateKey,
      );
      const parsed = parseInvite(slug);

      // Corrupt the signature — ECDSA recovery may still produce a public key,
      // but it won't match the original signing key
      const badSig = new Uint8Array(parsed.signature);
      badSig[0] ^= 0xff;
      badSig[1] ^= 0xff;
      const corrupted = { ...parsed, signature: badSig };

      expect(await verifyInviteSignature(corrupted, testPrivateKey)).toBe(false);
    });

    it("rejects invite with tampered payload", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "tampered",
        testPrivateKey,
      );
      const parsed = parseInvite(slug);

      // Tamper with the payload bytes (signature won't match)
      const badPayload = new Uint8Array(parsed.payloadBytes);
      badPayload[0] ^= 0xff;
      const tampered = { ...parsed, payloadBytes: badPayload };

      // The signature will still be 65 bytes and structurally valid,
      // but recovery will produce a different public key or fail
      // Either way, verifyInviteSignature should reject it
      expect(await verifyInviteSignature(tampered, testPrivateKey)).toBe(false);
    });
  });

  describe("signature verification against known key", () => {
    it("verifies signature matches the signing key", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "sigMatch",
        testPrivateKey,
      );
      const parsed = parseInvite(slug);

      expect(await verifyInviteSignature(parsed, testPrivateKey)).toBe(true);
    });

    it("rejects signature from a different key", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "sigMismatch",
        testPrivateKey,
      );
      const parsed = parseInvite(slug);

      const differentKey = "0x" + randomBytes(32).toString("hex");
      expect(await verifyInviteSignature(parsed, differentKey)).toBe(false);
    });

    it("rejects corrupted signature against correct key", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "corruptedAgainstKey",
        testPrivateKey,
      );
      const parsed = parseInvite(slug);

      const badSig = new Uint8Array(parsed.signature);
      badSig[10] ^= 0xff;
      const corrupted = { ...parsed, signature: badSig };

      expect(await verifyInviteSignature(corrupted, testPrivateKey)).toBe(false);
    });
  });

  describe("public key recovery", () => {
    it("recovers a consistent public key from a valid invite", async () => {
      const slug = await createInviteSlug(
        testConversationId,
        testInboxId,
        "recoveryTest",
        testPrivateKey,
      );
      const parsed = parseInvite(slug);

      const pubKey = await recoverInvitePublicKey(parsed);
      expect(pubKey).toMatch(/^0x04/); // uncompressed public key prefix
      expect(pubKey.length).toBe(132); // 0x + 130 hex chars = 65 bytes
    });

    it("recovers the same public key for invites signed by the same key", async () => {
      const slug1 = await createInviteSlug(
        testConversationId,
        testInboxId,
        "recover1",
        testPrivateKey,
      );
      const slug2 = await createInviteSlug(
        testConversationId,
        testInboxId,
        "recover2",
        testPrivateKey,
      );

      const pubKey1 = await recoverInvitePublicKey(parseInvite(slug1));
      const pubKey2 = await recoverInvitePublicKey(parseInvite(slug2));

      expect(pubKey1).toBe(pubKey2);
    });

    it("recovers a different public key for a different signing key", async () => {
      const slug1 = await createInviteSlug(
        testConversationId,
        testInboxId,
        "diffKey1",
        testPrivateKey,
      );
      const differentKey = "0x" + randomBytes(32).toString("hex");
      const slug2 = await createInviteSlug(
        testConversationId,
        testInboxId,
        "diffKey2",
        differentKey,
      );

      const pubKey1 = await recoverInvitePublicKey(parseInvite(slug1));
      const pubKey2 = await recoverInvitePublicKey(parseInvite(slug2));

      expect(pubKey1).not.toBe(pubKey2);
    });
  });
});
