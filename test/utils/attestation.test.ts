import { describe, expect, it } from "vitest";
import {
  signAttestation,
  verifyAttestation,
  verifyAttestationWithJwks,
  generateAttestationKeyPair,
  buildJwks,
} from "../../src/utils/attestation.js";

describe("attestation", () => {
  const kp = generateAttestationKeyPair("test-key-1");
  const inboxId = "ab12cd34ef56789012345678901234567890abcdef";

  describe("signAttestation + verifyAttestation", () => {
    it("signs and verifies a valid attestation", () => {
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);

      const result = verifyAttestation(inboxId, attestation, kp.publicKey);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("includes the correct kid", () => {
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      expect(attestation.kid).toBe("test-key-1");
    });

    it("uses provided timestamp", () => {
      const ts = "2026-03-11T20:00:00Z";
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid, ts);
      expect(attestation.timestamp).toBe(ts);
    });

    it("rejects wrong inbox ID", () => {
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestation("wrong-inbox-id", attestation, kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Signature verification failed");
    });

    it("rejects wrong public key", () => {
      const otherKp = generateAttestationKeyPair("other-key");
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestation(inboxId, attestation, otherKp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Signature verification failed");
    });

    it("rejects expired attestation", () => {
      const oldTs = "2020-01-01T00:00:00Z";
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid, oldTs);
      const result = verifyAttestation(inboxId, attestation, kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/too old/);
    });

    it("accepts attestation within max age", () => {
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestation(inboxId, attestation, kp.publicKey, 60_000);
      expect(result.valid).toBe(true);
    });

    it("rejects future timestamp beyond skew tolerance", () => {
      const futureTs = new Date(Date.now() + 120_000).toISOString();
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid, futureTs);
      const result = verifyAttestation(inboxId, attestation, kp.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/future/);
    });

    it("rejects tampered signature", () => {
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      // Flip a byte in the signature
      const sigBytes = Buffer.from(attestation.signature, "base64url");
      sigBytes[0] ^= 0xff;
      const tampered = { ...attestation, signature: sigBytes.toString("base64url") };
      const result = verifyAttestation(inboxId, tampered, kp.publicKey);
      expect(result.valid).toBe(false);
    });

    it("rejects invalid signature length", () => {
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestation(
        inboxId,
        { ...attestation, signature: Buffer.alloc(32).toString("base64url") },
        kp.publicKey,
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/signature length/);
    });
  });

  describe("verifyAttestationWithJwks", () => {
    it("verifies against JWKS keyset", () => {
      const jwks = buildJwks([{ publicKey: kp.publicKey, kid: kp.kid }]);
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestationWithJwks(inboxId, attestation, jwks);
      expect(result.valid).toBe(true);
    });

    it("rejects JWKS with missing keys array", () => {
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestationWithJwks(inboxId, attestation, {} as any);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/missing keys/);
    });

    it("rejects unknown kid", () => {
      const jwks = buildJwks([{ publicKey: kp.publicKey, kid: "other-kid" }]);
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestationWithJwks(inboxId, attestation, jwks);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Key not found/);
    });

    it("rejects expired key", () => {
      const jwks = buildJwks([{
        publicKey: kp.publicKey,
        kid: kp.kid,
        exp: "2020-01-01T00:00:00Z",
      }]);
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestationWithJwks(inboxId, attestation, jwks);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/expired/);
    });

    it("rejects malformed key expiry date", () => {
      const jwks = buildJwks([{
        publicKey: kp.publicKey,
        kid: kp.kid,
        exp: "not-a-date",
      }]);
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestationWithJwks(inboxId, attestation, jwks);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Invalid key expiry date/);
    });

    it("accepts non-expired key", () => {
      const jwks = buildJwks([{
        publicKey: kp.publicKey,
        kid: kp.kid,
        exp: "2099-01-01T00:00:00Z",
      }]);
      const attestation = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const result = verifyAttestationWithJwks(inboxId, attestation, jwks);
      expect(result.valid).toBe(true);
    });

    it("works with multiple keys in keyset", () => {
      const kp2 = generateAttestationKeyPair("key-2");
      const jwks = buildJwks([
        { publicKey: kp.publicKey, kid: kp.kid },
        { publicKey: kp2.publicKey, kid: kp2.kid },
      ]);

      const att1 = signAttestation(inboxId, kp.privateKeyPem, kp.kid);
      const att2 = signAttestation(inboxId, kp2.privateKeyPem, kp2.kid);

      expect(verifyAttestationWithJwks(inboxId, att1, jwks).valid).toBe(true);
      expect(verifyAttestationWithJwks(inboxId, att2, jwks).valid).toBe(true);
    });
  });

  describe("generateAttestationKeyPair", () => {
    it("generates a valid key pair", () => {
      const pair = generateAttestationKeyPair("my-key");
      expect(pair.kid).toBe("my-key");
      expect(pair.publicKey).toBeDefined();
      expect(pair.privateKeyPem).toContain("BEGIN PRIVATE KEY");

      // Round-trip: sign and verify
      const attestation = signAttestation("test-inbox", pair.privateKeyPem, pair.kid);
      const result = verifyAttestation("test-inbox", attestation, pair.publicKey);
      expect(result.valid).toBe(true);
    });

    it("generates unique keys each time", () => {
      const pair1 = generateAttestationKeyPair("k1");
      const pair2 = generateAttestationKeyPair("k2");
      expect(pair1.publicKey).not.toBe(pair2.publicKey);
    });
  });
});
