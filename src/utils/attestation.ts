/**
 * Assistant attestation utilities.
 *
 * Implements the cryptographic verification scheme for Convos assistants
 * as described in the assistant-attestation design doc.
 *
 * Attestation scheme:
 *   message = sha256(inboxId || timestamp)
 *   signature = Ed25519.sign(message, privateKey)
 *
 * The signature, timestamp, and key ID are stored in ProfileUpdate metadata:
 *   attestation     = base64url(signature)
 *   attestation_ts  = ISO 8601 UTC timestamp
 *   attestation_kid = key ID from JWKS endpoint
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify, generateKeyPairSync } from "node:crypto";

// ─── Types ───

export interface Attestation {
  /** Base64url-encoded Ed25519 signature (64 bytes) */
  signature: string;
  /** ISO 8601 UTC timestamp used in the signed message */
  timestamp: string;
  /** Key ID from the JWKS endpoint */
  kid: string;
}

export interface JwksKey {
  /** Key ID */
  kid: string;
  /** Key type — must be "OKP" for Ed25519 */
  kty: string;
  /** Curve — must be "Ed25519" */
  crv: string;
  /** Base64url-encoded 32-byte public key */
  x: string;
  /** Key use — "sig" for signing */
  use?: string;
  /** Optional expiry — ISO 8601 */
  exp?: string;
}

export interface Jwks {
  keys: JwksKey[];
}

export interface Ed25519KeyPair {
  /** Base64url-encoded 32-byte public key */
  publicKey: string;
  /** Base64url-encoded 64-byte private key (seed + public) or PEM */
  privateKeyPem: string;
  /** Key ID */
  kid: string;
}

// ─── Helpers ───

function base64urlEncode(data: Buffer): string {
  return data.toString("base64url");
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

/**
 * Compute the attestation message: sha256(inboxId || timestamp)
 */
function computeMessage(inboxId: string, timestamp: string): Buffer {
  return createHash("sha256").update(`${inboxId}${timestamp}`).digest();
}

// ─── Signing ───

/**
 * Sign an attestation for an agent's inbox ID.
 *
 * @param inboxId - The agent's XMTP inbox ID (hex string)
 * @param privateKeyPem - Ed25519 private key in PEM format
 * @param kid - Key ID to include in the attestation
 * @param timestamp - Optional timestamp (defaults to now)
 */
export function signAttestation(
  inboxId: string,
  privateKeyPem: string,
  kid: string,
  timestamp?: string,
): Attestation {
  const ts = timestamp ?? new Date().toISOString();
  const message = computeMessage(inboxId, ts);

  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(null, message, privateKey);

  return {
    signature: base64urlEncode(signature),
    timestamp: ts,
    kid,
  };
}

// ─── Verification ───

/**
 * Verify an attestation against a public key.
 *
 * @param inboxId - The agent's XMTP inbox ID
 * @param attestation - The attestation to verify
 * @param publicKeyBase64url - Base64url-encoded 32-byte Ed25519 public key
 * @param maxAgeMs - Maximum age of the attestation in milliseconds (default: 24 hours)
 * @param referenceDate - Reference date for age check (default: now)
 */
export function verifyAttestation(
  inboxId: string,
  attestation: Attestation,
  publicKeyBase64url: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
  referenceDate?: Date,
): { valid: boolean; reason?: string } {
  // Check timestamp format
  const ts = new Date(attestation.timestamp);
  if (isNaN(ts.getTime())) {
    return { valid: false, reason: "Invalid timestamp format" };
  }

  // Check age
  const ref = referenceDate ?? new Date();
  const ageMs = ref.getTime() - ts.getTime();
  if (ageMs > maxAgeMs) {
    return { valid: false, reason: `Attestation too old (${Math.round(ageMs / 1000)}s > ${Math.round(maxAgeMs / 1000)}s)` };
  }
  if (ageMs < -60_000) {
    // Allow 1 minute of clock skew for future timestamps
    return { valid: false, reason: "Attestation timestamp is in the future" };
  }

  // Decode signature
  const signatureBytes = base64urlDecode(attestation.signature);
  if (signatureBytes.length !== 64) {
    return { valid: false, reason: `Invalid signature length: ${signatureBytes.length} (expected 64)` };
  }

  // Reconstruct message
  const message = computeMessage(inboxId, attestation.timestamp);

  // Build public key from raw bytes
  const publicKeyBytes = base64urlDecode(publicKeyBase64url);
  if (publicKeyBytes.length !== 32) {
    return { valid: false, reason: `Invalid public key length: ${publicKeyBytes.length} (expected 32)` };
  }

  const publicKey = createPublicKey({
    key: Buffer.concat([
      // Ed25519 DER prefix for a 32-byte public key
      Buffer.from("302a300506032b6570032100", "hex"),
      publicKeyBytes,
    ]),
    format: "der",
    type: "spki",
  });

  // Verify
  const valid = verify(null, message, publicKey, signatureBytes);
  if (!valid) {
    return { valid: false, reason: "Signature verification failed" };
  }

  return { valid: true };
}

/**
 * Verify an attestation against a JWKS keyset.
 *
 * Looks up the key by `kid`, checks expiry, then verifies the signature.
 */
export function verifyAttestationWithJwks(
  inboxId: string,
  attestation: Attestation,
  jwks: Jwks,
  maxAgeMs = 24 * 60 * 60 * 1000,
  referenceDate?: Date,
): { valid: boolean; reason?: string } {
  const key = jwks.keys.find((k) => k.kid === attestation.kid);
  if (!key) {
    return { valid: false, reason: `Key not found: ${attestation.kid}` };
  }

  if (key.kty !== "OKP" || key.crv !== "Ed25519") {
    return { valid: false, reason: `Unsupported key type: ${key.kty}/${key.crv}` };
  }

  // Check key expiry
  if (key.exp) {
    const expDate = new Date(key.exp);
    const ref = referenceDate ?? new Date();
    if (expDate < ref) {
      return { valid: false, reason: `Key expired: ${key.exp}` };
    }
  }

  return verifyAttestation(inboxId, attestation, key.x, maxAgeMs, referenceDate);
}

// ─── Key Generation (for testing) ───

/**
 * Generate an Ed25519 key pair for testing attestations.
 *
 * @param kid - Key ID to assign
 */
export function generateAttestationKeyPair(kid: string): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  // Ed25519 DER public key is 44 bytes: 12-byte header + 32-byte key
  const publicKeyRaw = publicKeyDer.subarray(12);

  return {
    publicKey: base64urlEncode(publicKeyRaw),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    kid,
  };
}

/**
 * Build a JWKS from key pairs (for testing).
 */
export function buildJwks(keys: Array<{ publicKey: string; kid: string; exp?: string }>): Jwks {
  return {
    keys: keys.map((k) => ({
      kid: k.kid,
      kty: "OKP",
      crv: "Ed25519",
      x: k.publicKey,
      use: "sig",
      ...(k.exp && { exp: k.exp }),
    })),
  };
}

/**
 * Fetch a JWKS from a URL.
 */
export async function fetchJwks(url: string): Promise<Jwks> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as Jwks;
}
