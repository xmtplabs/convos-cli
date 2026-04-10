import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import protobuf from "protobufjs";
import { hexToBytes as viemHexToBytes, recoverPublicKey } from "viem";
import { sign as viemSign, privateKeyToAccount } from "viem/accounts";

// ─── Protobuf Schemas (matching convos-ios invite.proto) ───

const root = new protobuf.Root();

root.add(
  new protobuf.Type("InvitePayload")
    .add(new protobuf.Field("conversationToken", 1, "bytes"))
    .add(new protobuf.Field("creatorInboxId", 2, "bytes"))
    .add(new protobuf.Field("tag", 3, "string"))
    .add(new protobuf.Field("name", 4, "string", "optional"))
    .add(new protobuf.Field("description_p", 5, "string", "optional"))
    .add(new protobuf.Field("imageURL", 6, "string", "optional"))
    .add(new protobuf.Field("conversationExpiresAtUnix", 7, "sfixed64", "optional"))
    .add(new protobuf.Field("expiresAtUnix", 8, "sfixed64", "optional"))
    .add(new protobuf.Field("expiresAfterUse", 9, "bool"))
    .add(new protobuf.Field("emoji", 10, "string", "optional")),
);

root.add(
  new protobuf.Type("SignedInvite")
    .add(new protobuf.Field("payload", 1, "bytes"))
    .add(new protobuf.Field("signature", 2, "bytes")),
);

const InvitePayload = root.lookupType("InvitePayload");
const SignedInviteType = root.lookupType("SignedInvite");

// ─── HKDF-SHA256 ───

function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  let t = Buffer.alloc(0);
  let okm = Buffer.alloc(0);
  for (let i = 1; okm.length < length; i++) {
    t = createHmac("sha256", prk)
      .update(Buffer.concat([t, info, Buffer.from([i])]))
      .digest();
    okm = Buffer.concat([okm, t]);
  }
  return okm.subarray(0, length);
}

// ─── ChaCha20-Poly1305 Conversation Token (matching InviteConversationToken.swift) ───

const FORMAT_VERSION = 1;
const HKDF_SALT = Buffer.from("ConvosInviteV1", "utf-8");

function deriveTokenKey(privateKeyBytes: Uint8Array, inboxId: string): Buffer {
  const info = Buffer.from(`inbox:${inboxId}`, "utf-8");
  return hkdfSha256(privateKeyBytes, HKDF_SALT, info, 32);
}

function packConversationId(conversationId: string): Buffer {
  const uuidMatch = conversationId.match(
    /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i,
  );
  if (uuidMatch) {
    const hex = uuidMatch.slice(1).join("");
    return Buffer.concat([Buffer.from([0x01]), Buffer.from(hex, "hex")]);
  }
  const strBytes = Buffer.from(conversationId, "utf-8");
  if (strBytes.length <= 255) {
    return Buffer.concat([Buffer.from([0x02, strBytes.length]), strBytes]);
  }
  return Buffer.concat([
    Buffer.from([0x02, 0x00, (strBytes.length >> 8) & 0xff, strBytes.length & 0xff]),
    strBytes,
  ]);
}

function unpackConversationId(data: Buffer): string {
  const tag = data[0];
  if (tag === 0x01) {
    const hex = data.subarray(1, 17).toString("hex");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  }
  if (tag === 0x02) {
    let offset = 1;
    let length = data[offset];
    offset++;
    if (length === 0) {
      length = (data[offset] << 8) | data[offset + 1];
      offset += 2;
    }
    return data.subarray(offset, offset + length).toString("utf-8");
  }
  throw new Error(`Unknown conversation ID tag: ${tag}`);
}

export function encryptConversationToken(
  conversationId: string,
  creatorInboxId: string,
  privateKeyBytes: Uint8Array,
): Buffer {
  const key = deriveTokenKey(privateKeyBytes, creatorInboxId);
  const plaintext = packConversationId(conversationId);
  const nonce = randomBytes(12);
  const aad = Buffer.from(creatorInboxId, "utf-8");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cipher = createCipheriv("chacha20-poly1305" as any, key, nonce, { authTagLength: 16 } as any) as any;
  cipher.setAAD(aad);
  const ciphertext = cipher.update(plaintext) as Buffer;
  cipher.final();
  const authTag = cipher.getAuthTag() as Buffer;

  return Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, ciphertext, authTag]);
}

export function decryptConversationToken(
  tokenBytes: Buffer,
  creatorInboxId: string,
  privateKeyBytes: Uint8Array,
): string {
  if (tokenBytes[0] !== FORMAT_VERSION) {
    throw new Error(`Unsupported token version: ${tokenBytes[0]}`);
  }
  const nonce = tokenBytes.subarray(1, 13);
  const authTag = tokenBytes.subarray(tokenBytes.length - 16);
  const ciphertext = tokenBytes.subarray(13, tokenBytes.length - 16);
  const key = deriveTokenKey(privateKeyBytes, creatorInboxId);
  const aad = Buffer.from(creatorInboxId, "utf-8");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decipher = createDecipheriv("chacha20-poly1305" as any, key, nonce, { authTagLength: 16 } as any) as any;
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext) as Buffer, decipher.final() as Buffer]);
  return unpackConversationId(plaintext);
}

// ─── secp256k1 ECDSA with recovery (using viem) ───

function sha256(data: Uint8Array): Buffer {
  return createHash("sha256").update(data).digest();
}

/**
 * Sign a message hash with secp256k1 and produce a 65-byte recoverable signature
 * (64 bytes compact + 1 byte recovery ID), matching the iOS implementation.
 *
 * Uses viem's sign() which wraps @noble/curves and returns {r, s, yParity}.
 */
async function signWithRecovery(messageHash: Buffer, privateKeyHex: string): Promise<Buffer> {
  const hashHex = `0x${messageHash.toString("hex")}` as `0x${string}`;
  const keyHex = privateKeyHex.startsWith("0x") ? privateKeyHex : `0x${privateKeyHex}`;

  const sig = await viemSign({
    hash: hashHex,
    privateKey: keyHex as `0x${string}`,
  });

  // Convert r, s (hex strings) to 32-byte buffers
  const rBytes = Buffer.from(viemHexToBytes(sig.r as `0x${string}`));
  const sBytes = Buffer.from(viemHexToBytes(sig.s as `0x${string}`));

  // Recovery ID is yParity (0 or 1)
  const recoveryId = sig.yParity;

  const result = Buffer.alloc(65);
  rBytes.copy(result, 32 - rBytes.length); // pad r to 32 bytes
  sBytes.copy(result, 64 - sBytes.length); // pad s to 32 bytes
  result[64] = recoveryId ?? 0;
  return result;
}

// ─── Base64URL ───

function base64urlEncode(data: Buffer): string {
  return data.toString("base64url");
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

// ─── Compression ───
// Format must match iOS: [marker: 1 byte][original_size: 4 bytes big-endian][zlib data]

const COMPRESSION_MARKER = 0x1f;

function compressIfSmaller(data: Buffer): Buffer {
  if (data.length <= 100) return data;
  const compressed = deflateSync(data);
  // 1 byte marker + 4 bytes size + compressed data
  if (compressed.length + 5 < data.length) {
    const sizeBytes = Buffer.alloc(4);
    sizeBytes.writeUInt32BE(data.length);
    return Buffer.concat([Buffer.from([COMPRESSION_MARKER]), sizeBytes, compressed]);
  }
  return data;
}

function decompressIfNeeded(data: Buffer): Buffer {
  if (data[0] === COMPRESSION_MARKER) {
    // iOS format: [marker][4-byte size BE][zlib data]
    return Buffer.from(inflateSync(data.subarray(5)));
  }
  return data;
}

// ─── iMessage compatibility ───

function insertSeparators(str: string, sep: string, every: number): string {
  if (str.length <= every) return str;
  const parts = [];
  for (let i = 0; i < str.length; i += every) {
    parts.push(str.slice(i, i + every));
  }
  return parts.join(sep);
}

function removeSeparators(str: string): string {
  return str.replace(/\*/g, "");
}

// ─── Hex helpers ───

function hexToBytes(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex");
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// ─── Public API ───

export interface InviteOptions {
  name?: string;
  description?: string;
  imageUrl?: string;
  emoji?: string;
  expiresAt?: Date;
  expiresAfterUse?: boolean;
}

/**
 * Generate an invite slug for a conversation (ADR 001).
 *
 * 1. Encrypt conversation ID with ChaCha20-Poly1305
 * 2. Build InvitePayload protobuf
 * 3. Sign with secp256k1 ECDSA (recoverable)
 * 4. Wrap in SignedInvite, compress, base64url encode
 */
export async function createInviteSlug(
  conversationId: string,
  creatorInboxId: string,
  inviteTag: string,
  walletPrivateKey: string,
  options?: InviteOptions,
): Promise<string> {
  const privateKeyBytes = hexToBytes(walletPrivateKey);

  const conversationToken = encryptConversationToken(conversationId, creatorInboxId, privateKeyBytes);
  const creatorInboxIdBytes = hexToBytes(creatorInboxId);

  const payloadObj: Record<string, unknown> = {
    conversationToken,
    creatorInboxId: creatorInboxIdBytes,
    tag: inviteTag,
    expiresAfterUse: options?.expiresAfterUse ?? false,
  };
  if (options?.name) payloadObj.name = options.name;
  if (options?.description) payloadObj.description_p = options.description;
  if (options?.imageUrl) payloadObj.imageURL = options.imageUrl;
  if (options?.emoji) payloadObj.emoji = options.emoji;
  if (options?.expiresAt) {
    payloadObj.expiresAtUnix = Math.floor(options.expiresAt.getTime() / 1000);
  }

  const errMsg = InvitePayload.verify(payloadObj);
  if (errMsg) throw new Error(`Invalid payload: ${errMsg}`);

  const payloadBytes = Buffer.from(InvitePayload.encode(InvitePayload.create(payloadObj)).finish());

  // Sign: SHA256(payloadBytes) → secp256k1 ECDSA recoverable
  const messageHash = sha256(payloadBytes);
  const signature = await signWithRecovery(messageHash, walletPrivateKey);

  const signedInviteBytes = Buffer.from(
    SignedInviteType.encode(
      SignedInviteType.create({ payload: payloadBytes, signature }),
    ).finish(),
  );

  const compressed = compressIfSmaller(signedInviteBytes);
  return insertSeparators(base64urlEncode(compressed), "*", 300);
}

export interface ParsedInvite {
  tag: string;
  creatorInboxId: string;
  conversationToken: Buffer;
  name?: string;
  description?: string;
  imageUrl?: string;
  emoji?: string;
  expiresAt?: Date;
  conversationExpiresAt?: Date;
  expiresAfterUse: boolean;
  /** Raw serialized payload bytes (for re-encoding) */
  payloadBytes: Uint8Array;
  /** 65-byte recoverable signature */
  signature: Uint8Array;
}

/**
 * Parse an invite from a slug or URL.
 */
export function parseInvite(inviteInput: string): ParsedInvite {
  let slug = inviteInput.trim();

  // Extract from URL if it looks like one
  try {
    const url = new URL(slug);
    const iParam = url.searchParams.get("i");
    if (iParam) slug = iParam;
  } catch {
    // Not a URL
  }

  slug = removeSeparators(slug);

  const data = base64urlDecode(slug);
  const decompressed = decompressIfNeeded(data);

  const signedInvite = SignedInviteType.decode(decompressed) as protobuf.Message & {
    payload: Uint8Array;
    signature: Uint8Array;
  };

  const payload = InvitePayload.decode(signedInvite.payload) as protobuf.Message & {
    conversationToken: Uint8Array;
    creatorInboxId: Uint8Array;
    tag: string;
    name?: string;
    description_p?: string;
    imageURL?: string;
    emoji?: string;
    expiresAtUnix?: number | { toNumber(): number };
    conversationExpiresAtUnix?: number | { toNumber(): number };
    expiresAfterUse: boolean;
  };

  const toNum = (v: number | { toNumber(): number } | undefined): number | undefined => {
    if (v == null) return undefined;
    return typeof v === "number" ? v : v.toNumber();
  };

  const expiresAtUnix = toNum(payload.expiresAtUnix);
  const convExpiresAtUnix = toNum(payload.conversationExpiresAtUnix);

  return {
    tag: payload.tag,
    creatorInboxId: bytesToHex(payload.creatorInboxId),
    conversationToken: Buffer.from(payload.conversationToken),
    name: payload.name || undefined,
    description: payload.description_p || undefined,
    imageUrl: payload.imageURL || undefined,
    emoji: payload.emoji || undefined,
    expiresAt: expiresAtUnix ? new Date(expiresAtUnix * 1000) : undefined,
    conversationExpiresAt: convExpiresAtUnix ? new Date(convExpiresAtUnix * 1000) : undefined,
    expiresAfterUse: payload.expiresAfterUse ?? false,
    payloadBytes: signedInvite.payload,
    signature: signedInvite.signature,
  };
}

/**
 * Verify the invite has a valid structure and a recoverable ECDSA signature.
 *
 * This performs:
 * 1. Structural validation (all required fields present)
 * 2. Cryptographic signature verification (can recover a public key from the
 *    secp256k1 ECDSA signature over SHA256(payloadBytes))
 *
 * Note: this does not verify the recovered public key matches a specific
 * creator — that requires additional context. Use `verifyInviteSignature()`
 * on the creator side to match against a known wallet key.
 */
export async function verifyInvite(invite: ParsedInvite): Promise<boolean> {
  try {
    // Structural validation
    if (!invite.tag || invite.tag.length === 0) return false;
    if (!invite.creatorInboxId || invite.creatorInboxId.length === 0) return false;
    if (!invite.conversationToken || invite.conversationToken.length === 0) return false;
    if (!invite.signature || invite.signature.length !== 65) return false;
    if (!invite.payloadBytes || invite.payloadBytes.length === 0) return false;

    // Cryptographic verification: recover public key from signature
    await recoverInvitePublicKey(invite);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recover the signer's public key from an invite's signature.
 *
 * Uses secp256k1 ECDSA recovery on SHA256(payloadBytes).
 * Returns the uncompressed public key (0x04... prefix, 65 bytes).
 */
export async function recoverInvitePublicKey(invite: ParsedInvite): Promise<`0x${string}`> {
  const messageHash = `0x${sha256(Buffer.from(invite.payloadBytes)).toString("hex")}` as `0x${string}`;

  // Reconstruct signature as 65-byte hex: r (32) + s (32) + v (1)
  const r = Buffer.from(invite.signature.slice(0, 32)).toString("hex");
  const s = Buffer.from(invite.signature.slice(32, 64)).toString("hex");
  const v = invite.signature[64]; // recovery ID (0 or 1)
  const signatureHex = `0x${r}${s}${v === 1 ? "01" : "00"}` as `0x${string}`;

  return recoverPublicKey({ hash: messageHash, signature: signatureHex });
}

/**
 * Verify that an invite was signed by a specific wallet private key.
 *
 * Used on the creator side (process-join-requests) to confirm the invite
 * was genuinely created by this identity's wallet. Recovers the signer's
 * public key from the signature and compares it to the public key derived
 * from the given private key.
 */
export async function verifyInviteSignature(
  invite: ParsedInvite,
  walletPrivateKey: string,
): Promise<boolean> {
  try {
    const keyHex = (walletPrivateKey.startsWith("0x") ? walletPrivateKey : `0x${walletPrivateKey}`) as `0x${string}`;
    const account = privateKeyToAccount(keyHex);
    const recoveredPubKey = await recoverInvitePublicKey(invite);
    return recoveredPubKey.toLowerCase() === account.publicKey.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Re-encode a parsed invite back to a slug (for sending as DM join request).
 */
export function inviteToSlug(invite: ParsedInvite): string {
  const signedInviteBytes = Buffer.from(
    SignedInviteType.encode(
      SignedInviteType.create({
        payload: Buffer.from(invite.payloadBytes),
        signature: Buffer.from(invite.signature),
      }),
    ).finish(),
  );
  const compressed = compressIfSmaller(signedInviteBytes);
  return insertSeparators(base64urlEncode(compressed), "*", 300);
}
