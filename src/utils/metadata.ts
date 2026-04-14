/**
 * ConversationCustomMetadata — protobuf schema matching convos-ios
 * Stored in XMTP group's appData field (max 8KB).
 *
 * Encoding: protobuf → optional DEFLATE compress → base64url
 */

import { deflateSync, inflateSync } from "node:zlib";
import protobuf from "protobufjs";

// ─── Protobuf Schema ───

const root = new protobuf.Root();

const EncryptedImageRefType = new protobuf.Type("EncryptedImageRef")
  .add(new protobuf.Field("url", 1, "string"))
  .add(new protobuf.Field("salt", 2, "bytes"))
  .add(new protobuf.Field("nonce", 3, "bytes"));

const ConversationProfileType = new protobuf.Type("ConversationProfile")
  .add(new protobuf.Field("inboxId", 1, "bytes"))
  .add(new protobuf.Field("name", 2, "string", "optional"))
  .add(new protobuf.Field("image", 3, "string", "optional"))
  .add(new protobuf.Field("encryptedImage", 4, "EncryptedImageRef", "optional"));

const ConversationCustomMetadataType = new protobuf.Type("ConversationCustomMetadata")
  .add(new protobuf.Field("tag", 1, "string"))
  .add(new protobuf.Field("profiles", 2, "ConversationProfile", "repeated"))
  .add(new protobuf.Field("expiresAtUnix", 3, "sfixed64", "optional"))
  .add(new protobuf.Field("imageEncryptionKey", 4, "bytes", "optional"))
  .add(new protobuf.Field("encryptedGroupImage", 5, "EncryptedImageRef", "optional"));

root.add(EncryptedImageRefType);
root.add(ConversationProfileType);
root.add(ConversationCustomMetadataType);

// ─── Types ───

export interface EncryptedImageRef {
  url: string;
  salt: Uint8Array;
  nonce: Uint8Array;
}

export interface ConversationProfile {
  inboxId: string; // hex string
  name?: string;
  image?: string; // plain URL (legacy/simple)
  encryptedImage?: EncryptedImageRef; // iOS encrypted avatar
}

export interface ConversationCustomMetadata {
  tag: string;
  profiles: ConversationProfile[];
  expiresAtUnix?: number;
  imageEncryptionKey?: Uint8Array; // iOS group image key
  encryptedGroupImage?: EncryptedImageRef; // iOS group avatar
}

// ─── Compression (matching iOS: DEFLATE if >100 bytes) ───

const COMPRESSION_MARKER = 0x1f;
const MAX_DECOMPRESSED_SIZE = 10 * 1024 * 1024; // 10MB

// Format must match iOS: [marker: 1 byte][original_size: 4 bytes big-endian][zlib data]

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
  if (data.length === 0) return data;
  if (data[0] === COMPRESSION_MARKER) {
    // iOS format: [marker][4-byte size BE][zlib data]
    const decompressed = Buffer.from(inflateSync(data.subarray(5)));
    if (decompressed.length > MAX_DECOMPRESSED_SIZE) {
      throw new Error("Decompressed metadata exceeds size limit");
    }
    return decompressed;
  }
  return data;
}

// ─── Hex <-> Bytes ───

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex");
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// ─── Base64URL ───

function base64urlEncode(data: Buffer): string {
  return data.toString("base64url");
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

// ─── Public API ───

const APP_DATA_LIMIT = 8 * 1024; // 8KB

/**
 * Parse appData string into ConversationCustomMetadata.
 * Returns empty metadata if appData is empty or invalid.
 */
export function parseAppData(appData: string): ConversationCustomMetadata {
  if (!appData || appData.length === 0) {
    return { tag: "", profiles: [] };
  }

  // Try legacy JSON format first (from early invite tag storage)
  if (appData.startsWith("{")) {
    try {
      const parsed = JSON.parse(appData);
      return {
        tag: parsed.tag || "",
        profiles: [],
        expiresAtUnix: parsed.expiresAtUnix,
      };
    } catch {
      // Not valid JSON, try protobuf
    }
  }

  // Try base64url → decompress → protobuf
  try {
    const rawBytes = base64urlDecode(appData);
    const decompressed = decompressIfNeeded(rawBytes);
    const msg = ConversationCustomMetadataType.decode(decompressed) as protobuf.Message & {
      tag: string;
      profiles: Array<{
        inboxId: Uint8Array;
        name?: string;
        image?: string;
        encryptedImage?: { url: string; salt: Uint8Array; nonce: Uint8Array } | null;
      }>;
      expiresAtUnix?: number | { toNumber(): number };
      imageEncryptionKey?: Uint8Array | null;
      encryptedGroupImage?: { url: string; salt: Uint8Array; nonce: Uint8Array } | null;
    };

    const toNum = (v: number | { toNumber(): number } | undefined): number | undefined => {
      if (v == null) return undefined;
      const n = typeof v === "number" ? v : v.toNumber();
      // Treat 0 as unset — protobuf sfixed64 defaults to 0 when the field
      // is absent, and epoch 0 (1970-01-01) is never a valid expiration.
      // Without this, re-serializing would write expiresAtUnix=0 which iOS
      // interprets as "expired in 1970" and hides the conversation.
      return n === 0 ? undefined : n;
    };

    const parseEncryptedImageRef = (
      ref: { url: string; salt: Uint8Array; nonce: Uint8Array } | null | undefined,
    ): EncryptedImageRef | undefined => {
      if (!ref || !ref.url) return undefined;
      return { url: ref.url, salt: ref.salt, nonce: ref.nonce };
    };

    return {
      tag: msg.tag || "",
      profiles: (msg.profiles || []).map((p) => ({
        inboxId: bytesToHex(p.inboxId),
        name: p.name || undefined,
        image: p.image || undefined,
        encryptedImage: parseEncryptedImageRef(p.encryptedImage),
      })),
      expiresAtUnix: toNum(msg.expiresAtUnix),
      imageEncryptionKey:
        msg.imageEncryptionKey && msg.imageEncryptionKey.length > 0
          ? msg.imageEncryptionKey
          : undefined,
      encryptedGroupImage: parseEncryptedImageRef(msg.encryptedGroupImage),
    };
  } catch {
    return { tag: "", profiles: [] };
  }
}

/**
 * Parse appData for read-modify-write operations that must preserve the invite
 * tag. Empty appData is allowed, but invalid/non-empty appData throws so callers
 * don't accidentally write back metadata with an empty tag.
 */
export function parseAppDataForWrite(appData: string): ConversationCustomMetadata {
  if (!appData || appData.length === 0) {
    return { tag: "", profiles: [] };
  }

  const parsed = parseAppData(appData);
  if (!parsed.tag) {
    throw new Error("Could not parse existing appData safely for write");
  }

  return parsed;
}

/**
 * Serialize ConversationCustomMetadata to an appData string.
 * Throws if result exceeds 8KB.
 */
export function serializeAppData(metadata: ConversationCustomMetadata): string {
  const obj = {
    tag: metadata.tag,
    profiles: metadata.profiles.map((p) => ({
      inboxId: hexToBytes(p.inboxId),
      name: p.name,
      image: p.image,
      encryptedImage: p.encryptedImage,
    })),
    expiresAtUnix: metadata.expiresAtUnix,
    imageEncryptionKey: metadata.imageEncryptionKey,
    encryptedGroupImage: metadata.encryptedGroupImage,
  };

  const errMsg = ConversationCustomMetadataType.verify(obj);
  if (errMsg) throw new Error(`Invalid metadata: ${errMsg}`);

  const bytes = Buffer.from(
    ConversationCustomMetadataType.encode(
      ConversationCustomMetadataType.create(obj),
    ).finish(),
  );

  const compressed = compressIfSmaller(bytes);
  const encoded = base64urlEncode(compressed);

  if (Buffer.byteLength(encoded, "utf-8") > APP_DATA_LIMIT) {
    throw new Error(
      `Metadata exceeds ${APP_DATA_LIMIT} byte limit (${Buffer.byteLength(encoded, "utf-8")} bytes)`,
    );
  }

  return encoded;
}

/**
 * Upsert a profile in the metadata. If a profile with the same inboxId exists,
 * it is updated. Otherwise, a new profile is added.
 */
export function upsertProfile(
  metadata: ConversationCustomMetadata,
  profile: ConversationProfile,
): ConversationCustomMetadata {
  const existing = metadata.profiles.findIndex(
    (p) => p.inboxId.toLowerCase() === profile.inboxId.toLowerCase(),
  );

  const profiles = [...metadata.profiles];
  if (existing >= 0) {
    profiles[existing] = { ...profiles[existing], ...profile };
  } else {
    profiles.push(profile);
  }

  return { ...metadata, profiles };
}

/**
 * Remove a profile from the metadata by inbox ID.
 */
export function removeProfile(
  metadata: ConversationCustomMetadata,
  inboxId: string,
): ConversationCustomMetadata {
  return {
    ...metadata,
    profiles: metadata.profiles.filter(
      (p) => p.inboxId.toLowerCase() !== inboxId.toLowerCase(),
    ),
  };
}

/**
 * Get a profile by inbox ID.
 */
export function getProfile(
  metadata: ConversationCustomMetadata,
  inboxId: string,
): ConversationProfile | undefined {
  return metadata.profiles.find(
    (p) => p.inboxId.toLowerCase() === inboxId.toLowerCase(),
  );
}
