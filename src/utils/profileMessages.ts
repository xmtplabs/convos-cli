/**
 * Profile Messages — ProfileUpdate and ProfileSnapshot content types.
 *
 * Matches the convos-ios implementation (PR #552):
 * - ProfileUpdate (convos.org/profile_update:1.0) — sent by a member when
 *   they change their own profile. Self-authored, overwrites unconditionally.
 * - ProfileSnapshot (convos.org/profile_snapshot:1.0) — sent after adding
 *   members. Contains all current profiles so new joiners have data immediately.
 *
 * Both use protobuf encoding with shouldPush = false (silent).
 */

import protobuf from "protobufjs";
import type { ContentTypeId, EncodedContent } from "@xmtp/node-bindings";
import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { Group, DecodedMessage } from "@xmtp/node-sdk";
import { SortDirection } from "@xmtp/node-sdk";

// Protobuf schema mirrors profile_messages.proto in the convos-ios repo.
const root = new protobuf.Root();

const MemberKindEnum = new protobuf.Enum("MemberKind")
  .add("MEMBER_KIND_UNSPECIFIED", 0)
  .add("MEMBER_KIND_AGENT", 1);

// MetadataValue — a typed value supporting string, number (double), or bool.
// Uses a oneof, encoded as separate optional fields (protobuf oneof semantics).
const MetadataValueType = new protobuf.Type("MetadataValue")
  .add(new protobuf.OneOf("value", ["string_value", "number_value", "bool_value"]))
  .add(new protobuf.Field("string_value", 1, "string", "optional"))
  .add(new protobuf.Field("number_value", 2, "double", "optional"))
  .add(new protobuf.Field("bool_value", 3, "bool", "optional"));

// Map entry type for map<string, MetadataValue>
// Protobuf maps are encoded as repeated message { key, value } entries.
const MetadataEntryType = new protobuf.Type("MetadataEntry")
  .add(new protobuf.Field("key", 1, "string"))
  .add(new protobuf.Field("value", 2, "MetadataValue"));

const EncryptedProfileImageRefType = new protobuf.Type("EncryptedProfileImageRef")
  .add(new protobuf.Field("url", 1, "string"))
  .add(new protobuf.Field("salt", 2, "bytes"))
  .add(new protobuf.Field("nonce", 3, "bytes"));

const ProfileUpdateType = new protobuf.Type("ProfileUpdate")
  .add(new protobuf.Field("name", 1, "string", "optional"))
  .add(new protobuf.Field("encrypted_image", 2, "EncryptedProfileImageRef", "optional"))
  .add(new protobuf.Field("member_kind", 3, "MemberKind", "optional"))
  .add(new protobuf.MapField("metadata", 4, "string", "MetadataValue"))
  // v2. Field 2 stays declared rather than reserved: senders that have not
  // upgraded still populate it, and reserving it would make their avatars
  // decode as absent instead of failing loudly.
  .add(new protobuf.Field("avatar_url", 5, "string", "optional"))
  .add(new protobuf.Field("version", 6, "uint64", "optional"));

const MemberProfileType = new protobuf.Type("MemberProfile")
  .add(new protobuf.Field("inbox_id", 1, "bytes"))
  .add(new protobuf.Field("name", 2, "string", "optional"))
  .add(new protobuf.Field("encrypted_image", 3, "EncryptedProfileImageRef", "optional"))
  .add(new protobuf.Field("member_kind", 4, "MemberKind", "optional"))
  .add(new protobuf.MapField("metadata", 5, "string", "MetadataValue"));

const ProfileSnapshotType = new protobuf.Type("ProfileSnapshot")
  .add(new protobuf.Field("profiles", 1, "MemberProfile", "repeated"));

root.add(MemberKindEnum);
root.add(MetadataValueType);
root.add(MetadataEntryType);
root.add(EncryptedProfileImageRefType);
root.add(ProfileUpdateType);
root.add(MemberProfileType);
root.add(ProfileSnapshotType);

// ─── Content Type IDs ───

export const ContentTypeProfileUpdate = {
  authorityId: "convos.org",
  typeId: "profile_update",
  versionMajor: 1,
  versionMinor: 0,
};

/**
 * What the iOS client sends once profiles live on the backend: a plain avatar
 * URL and a version instead of an encrypted image. Registered for reading,
 * because the XMTP codec registry keys on the full version string - without
 * this, a v2 message finds no codec and arrives as raw EncodedContent.
 *
 * The CLI keeps sending v1. The wire format is a superset, so v1 carries the
 * new fields fine, and a client that predates v2 would ignore a v2-typed
 * message entirely - which for an agent means its name silently stops
 * updating on every un-upgraded client, in exchange for nothing.
 */
export const ContentTypeProfileUpdateV2 = {
  authorityId: "convos.org",
  typeId: "profile_update",
  versionMajor: 2,
  versionMinor: 0,
};

export const ContentTypeProfileSnapshot = {
  authorityId: "convos.org",
  typeId: "profile_snapshot",
  versionMajor: 1,
  versionMinor: 0,
};

// ─── Types ───

export enum MemberKind {
  Unspecified = 0,
  Agent = 1,
}

export interface EncryptedProfileImageRef {
  url: string;
  salt: Uint8Array;
  nonce: Uint8Array;
}

/**
 * A typed metadata value supporting string, number (double), or boolean.
 * Matches the proto MetadataValue oneof.
 */
export type ProfileMetadataValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "bool"; value: boolean };

/**
 * Profile metadata — arbitrary typed key-value pairs.
 * Keys are strings, values are typed (string, number, or bool).
 */
export type ProfileMetadata = Record<string, ProfileMetadataValue>;

export interface ProfileUpdateContent {
  name?: string;
  /** Pre-v2 senders only. New senders carry `avatarUrl` instead. */
  encryptedImage?: EncryptedProfileImageRef;
  memberKind?: MemberKind;
  metadata?: ProfileMetadata;
  /** Plain CDN URL of the backend-hosted avatar. */
  avatarUrl?: string;
  /** The backend's monotonic profile version, so a reader can skip a fetch. */
  version?: number;
}

export interface MemberProfileEntry {
  inboxId: string; // hex string
  name?: string;
  encryptedImage?: EncryptedProfileImageRef;
  memberKind?: MemberKind;
  metadata?: ProfileMetadata;
}

export interface ProfileSnapshotContent {
  profiles: MemberProfileEntry[];
}

/** Resolved profile data for a member (from either messages or appData). */
export interface ResolvedProfile {
  inboxId: string;
  name?: string;
  image?: string;
  encryptedImage?: EncryptedProfileImageRef;
  memberKind?: MemberKind;
  metadata?: ProfileMetadata;
}

// ─── Hex <-> Bytes ───

// ─── Metadata Helpers ───

interface RawMetadataValue {
  string_value?: string;
  number_value?: number;
  bool_value?: boolean;
  /** protobufjs oneof discriminator — which field is set */
  value?: "string_value" | "number_value" | "bool_value";
}

/**
 * Convert ProfileMetadata to the protobuf map<string, MetadataValue> format.
 */
function metadataToProto(
  metadata: ProfileMetadata,
): Record<string, RawMetadataValue> {
  const result: Record<string, RawMetadataValue> = {};
  for (const [key, val] of Object.entries(metadata)) {
    switch (val.type) {
      case "string":
        result[key] = { string_value: val.value };
        break;
      case "number":
        result[key] = { number_value: val.value };
        break;
      case "bool":
        result[key] = { bool_value: val.value };
        break;
    }
  }
  return result;
}

/**
 * Convert the protobuf map<string, MetadataValue> format to ProfileMetadata.
 *
 * Uses the protobufjs oneof discriminator (`val.value`) to determine which
 * field is set, correctly handling default values like empty string "", 0,
 * and false (which are valid oneof selections in proto3).
 */
function metadataFromProto(
  raw: Record<string, RawMetadataValue> | undefined,
): ProfileMetadata | undefined {
  if (!raw || Object.keys(raw).length === 0) return undefined;
  const result: ProfileMetadata = {};
  for (const [key, val] of Object.entries(raw)) {
    // Use the oneof discriminator to determine which field is set
    switch (val.value) {
      case "string_value":
        result[key] = { type: "string", value: val.string_value ?? "" };
        break;
      case "number_value":
        result[key] = { type: "number", value: val.number_value ?? 0 };
        break;
      case "bool_value":
        result[key] = { type: "bool", value: val.bool_value ?? false };
        break;
      default:
        // No oneof discriminator — fall back to value inspection
        if (val.string_value !== undefined && val.string_value !== "") {
          result[key] = { type: "string", value: val.string_value };
        } else if (val.number_value !== undefined && val.number_value !== 0) {
          result[key] = { type: "number", value: val.number_value };
        } else if (val.bool_value !== undefined) {
          result[key] = { type: "bool", value: val.bool_value };
        }
        break;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ─── Hex <-> Bytes ───

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex");
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// ─── Content Type Matching ───

export function isProfileUpdateMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeProfileUpdate.authorityId &&
    ct.typeId === ContentTypeProfileUpdate.typeId
  );
}

export function isProfileSnapshotMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  return (
    ct.authorityId === ContentTypeProfileSnapshot.authorityId &&
    ct.typeId === ContentTypeProfileSnapshot.typeId
  );
}

export function isProfileMessage(message: DecodedMessage): boolean {
  return isProfileUpdateMessage(message) || isProfileSnapshotMessage(message);
}

// ─── Encode ───

/**
 * Encode a ProfileUpdate into an EncodedContent for sending via XMTP.
 */
export function encodeProfileUpdate(update: ProfileUpdateContent): EncodedContent {
  const obj: Record<string, unknown> = {};

  if (update.name !== undefined) {
    obj.name = update.name;
  }

  if (update.encryptedImage) {
    obj.encrypted_image = {
      url: update.encryptedImage.url,
      salt: update.encryptedImage.salt,
      nonce: update.encryptedImage.nonce,
    };
  }

  if (update.memberKind !== undefined && update.memberKind !== MemberKind.Unspecified) {
    obj.member_kind = update.memberKind;
  }

  if (update.metadata && Object.keys(update.metadata).length > 0) {
    obj.metadata = metadataToProto(update.metadata);
  }

  if (update.avatarUrl !== undefined) {
    obj.avatar_url = update.avatarUrl;
  }

  if (update.version !== undefined) {
    obj.version = update.version;
  }

  const errMsg = ProfileUpdateType.verify(obj);
  if (errMsg) throw new Error(`Invalid ProfileUpdate: ${errMsg}`);

  const content = Buffer.from(
    ProfileUpdateType.encode(ProfileUpdateType.create(obj)).finish(),
  );

  return {
    type: ContentTypeProfileUpdate,
    parameters: {},
    fallback: undefined,
    content,
  };
}

/**
 * Encode a ProfileSnapshot into an EncodedContent for sending via XMTP.
 */
export function encodeProfileSnapshot(snapshot: ProfileSnapshotContent): EncodedContent {
  const profiles = snapshot.profiles.map((p) => {
    const entry: Record<string, unknown> = {
      inbox_id: hexToBytes(p.inboxId),
    };

    if (p.name !== undefined) {
      entry.name = p.name;
    }

    if (p.encryptedImage) {
      entry.encrypted_image = {
        url: p.encryptedImage.url,
        salt: p.encryptedImage.salt,
        nonce: p.encryptedImage.nonce,
      };
    }

    if (p.memberKind !== undefined && p.memberKind !== MemberKind.Unspecified) {
      entry.member_kind = p.memberKind;
    }

    if (p.metadata && Object.keys(p.metadata).length > 0) {
      entry.metadata = metadataToProto(p.metadata);
    }

    return entry;
  });

  const obj = { profiles };
  const errMsg = ProfileSnapshotType.verify(obj);
  if (errMsg) throw new Error(`Invalid ProfileSnapshot: ${errMsg}`);

  const content = Buffer.from(
    ProfileSnapshotType.encode(ProfileSnapshotType.create(obj)).finish(),
  );

  return {
    type: ContentTypeProfileSnapshot,
    parameters: {},
    fallback: undefined,
    content,
  };
}

// ─── Decode ───

interface RawProfileUpdateMsg {
  name?: string;
  encrypted_image?: { url: string; salt: Uint8Array; nonce: Uint8Array } | null;
  member_kind?: number;
  metadata?: Record<string, RawMetadataValue>;
  avatar_url?: string;
  version?: number | { toNumber(): number };
}

/**
 * Decode a ProfileUpdate from an EncodedContent.
 */
export function decodeProfileUpdate(encoded: EncodedContent): ProfileUpdateContent {
  const msg = ProfileUpdateType.decode(
    Buffer.from(encoded.content),
  ) as protobuf.Message & RawProfileUpdateMsg;

  const result: ProfileUpdateContent = {};

  if (msg.name) {
    result.name = msg.name;
  }

  if (
    msg.encrypted_image &&
    msg.encrypted_image.url &&
    msg.encrypted_image.salt?.length === 32 &&
    msg.encrypted_image.nonce?.length === 12
  ) {
    result.encryptedImage = {
      url: msg.encrypted_image.url,
      salt: msg.encrypted_image.salt,
      nonce: msg.encrypted_image.nonce,
    };
  }

  if (msg.member_kind) {
    result.memberKind = msg.member_kind as MemberKind;
  }

  if (msg.avatar_url) {
    result.avatarUrl = msg.avatar_url;
  }

  if (msg.version !== undefined && msg.version !== null) {
    // protobufjs hands back a Long for uint64 unless configured otherwise, and
    // decodes an unset field as 0 rather than leaving it out. Backend versions
    // start at 1, so 0 means the sender did not set one.
    const version =
      typeof msg.version === "number" ? msg.version : msg.version.toNumber();
    if (version > 0) {
      result.version = version;
    }
  }

  const meta = metadataFromProto(msg.metadata);
  if (meta) {
    result.metadata = meta;
  }

  return result;
}

interface RawMemberProfileMsg {
  inbox_id: Uint8Array;
  name?: string;
  encrypted_image?: { url: string; salt: Uint8Array; nonce: Uint8Array } | null;
  member_kind?: number;
  metadata?: Record<string, RawMetadataValue>;
}

interface RawProfileSnapshotMsg {
  profiles: RawMemberProfileMsg[];
}

/**
 * Decode a ProfileSnapshot from an EncodedContent.
 */
export function decodeProfileSnapshot(encoded: EncodedContent): ProfileSnapshotContent {
  const msg = ProfileSnapshotType.decode(
    Buffer.from(encoded.content),
  ) as protobuf.Message & RawProfileSnapshotMsg;

  return {
    profiles: (msg.profiles || []).map((p) => {
      const entry: MemberProfileEntry = {
        inboxId: bytesToHex(p.inbox_id),
      };

      if (p.name) {
        entry.name = p.name;
      }

      if (
        p.encrypted_image &&
        p.encrypted_image.url &&
        p.encrypted_image.salt?.length === 32 &&
        p.encrypted_image.nonce?.length === 12
      ) {
        entry.encryptedImage = {
          url: p.encrypted_image.url,
          salt: p.encrypted_image.salt,
          nonce: p.encrypted_image.nonce,
        };
      }

      if (p.member_kind) {
        entry.memberKind = p.member_kind as MemberKind;
      }

      const meta = metadataFromProto(p.metadata);
      if (meta) {
        entry.metadata = meta;
      }

      return entry;
    }),
  };
}

// ─── XMTP Content Codecs ───

/**
 * XMTP ContentCodec for ProfileUpdate messages.
 * Register this with the XMTP client so it can decode profile messages.
 */
export class ProfileUpdateCodec implements ContentCodec<ProfileUpdateContent> {
  get contentType(): ContentTypeId {
    return ContentTypeProfileUpdate;
  }

  encode(content: ProfileUpdateContent): EncodedContent {
    return encodeProfileUpdate(content);
  }

  decode(content: EncodedContent): ProfileUpdateContent {
    return decodeProfileUpdate(content);
  }

  fallback(_content: ProfileUpdateContent): string | undefined {
    return undefined;
  }

  shouldPush(_content: ProfileUpdateContent): boolean {
    return false;
  }
}

/**
 * Reads v2 profile updates. Decoding is identical - the proto is a superset
 * and only the content type differs, which is what the registry keys on.
 */
export class ProfileUpdateV2Codec extends ProfileUpdateCodec {
  get contentType(): ContentTypeId {
    return ContentTypeProfileUpdateV2;
  }
}

/**
 * XMTP ContentCodec for ProfileSnapshot messages.
 * Register this with the XMTP client so it can decode profile messages.
 */
export class ProfileSnapshotCodec implements ContentCodec<ProfileSnapshotContent> {
  get contentType(): ContentTypeId {
    return ContentTypeProfileSnapshot;
  }

  encode(content: ProfileSnapshotContent): EncodedContent {
    return encodeProfileSnapshot(content);
  }

  decode(content: EncodedContent): ProfileSnapshotContent {
    return decodeProfileSnapshot(content);
  }

  fallback(_content: ProfileSnapshotContent): string | undefined {
    return undefined;
  }

  shouldPush(_content: ProfileSnapshotContent): boolean {
    return false;
  }
}

// ─── Profile Resolution from Messages ───

/**
 * Extract a ProfileUpdateContent from a DecodedMessage.
 *
 * When the ProfileUpdateCodec is registered with the XMTP client,
 * `message.content` is the already-decoded ProfileUpdateContent.
 * When no codec is registered, `message.content` is the raw
 * EncodedContent and we decode it ourselves.
 */
export function getProfileUpdateContent(message: DecodedMessage): ProfileUpdateContent | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  // Codec registered: content is already decoded ProfileUpdateContent
  if ("name" in content || "encryptedImage" in content || "memberKind" in content || "metadata" in content) {
    return content as ProfileUpdateContent;
  }

  // No codec: content is raw EncodedContent with protobuf bytes
  if ("content" in content && (content as any).content instanceof Uint8Array) {
    try {
      return decodeProfileUpdate(content as EncodedContent);
    } catch {
      return undefined;
    }
  }

  // Empty ProfileUpdate (clear profile) — decoded object with no fields set
  // still matches if it's a plain object from the codec
  return content as ProfileUpdateContent;
}

/**
 * Extract a ProfileSnapshotContent from a DecodedMessage.
 *
 * When the ProfileSnapshotCodec is registered with the XMTP client,
 * `message.content` is the already-decoded ProfileSnapshotContent.
 * When no codec is registered, `message.content` is the raw
 * EncodedContent and we decode it ourselves.
 */
function getProfileSnapshotContent(message: DecodedMessage): ProfileSnapshotContent | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  // Codec registered: content is already decoded ProfileSnapshotContent
  if ("profiles" in content && Array.isArray((content as any).profiles)) {
    return content as ProfileSnapshotContent;
  }

  // No codec: content is raw EncodedContent with protobuf bytes
  if ("content" in content && (content as any).content instanceof Uint8Array) {
    try {
      return decodeProfileSnapshot(content as EncodedContent);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Scan group messages to resolve member profiles.
 *
 * Resolution precedence (matching iOS ProfileSnapshotBuilder):
 * 1. Latest ProfileUpdate from that member (highest priority)
 * 2. Most recent ProfileSnapshot containing that member (fallback)
 *
 * Messages are fetched in descending order, so the first ProfileUpdate
 * found for each member is the latest one.
 *
 * @param group - XMTP group to scan
 * @param memberInboxIds - optional list of member inbox IDs to resolve
 * @returns Map of inboxId (lowercase) → ResolvedProfile
 */
export async function resolveProfilesFromMessages(
  group: Group,
  memberInboxIds?: string[],
): Promise<Map<string, ResolvedProfile>> {
  const profilesByInboxId = new Map<string, ResolvedProfile>();
  let latestSnapshotProfiles: Map<string, MemberProfileEntry> | undefined;

  try {
    const messages = await group.messages({
      limit: 500,
      direction: SortDirection.Descending,
    });

    for (const message of messages) {
      const ct = message.contentType;

      if (
        ct.authorityId === ContentTypeProfileUpdate.authorityId &&
        ct.typeId === ContentTypeProfileUpdate.typeId
      ) {
        // ProfileUpdate — only process if we haven't seen this sender yet
        const senderInboxId = message.senderInboxId.toLowerCase();
        if (!profilesByInboxId.has(senderInboxId)) {
          try {
            const update = getProfileUpdateContent(message);
            if (update) {
              profilesByInboxId.set(senderInboxId, {
                inboxId: message.senderInboxId,
                name: update.name,
                encryptedImage: update.encryptedImage,
                memberKind: update.memberKind,
                metadata: update.metadata,
              });
            }
          } catch {
            // Skip malformed messages
          }
        }
      } else if (
        ct.authorityId === ContentTypeProfileSnapshot.authorityId &&
        ct.typeId === ContentTypeProfileSnapshot.typeId &&
        !latestSnapshotProfiles
      ) {
        // ProfileSnapshot — only process the most recent one (first found in descending order)
        try {
          const snapshot = getProfileSnapshotContent(message);
          if (snapshot) {
            latestSnapshotProfiles = new Map();
            for (const p of snapshot.profiles) {
              if (p.inboxId) {
                latestSnapshotProfiles.set(p.inboxId.toLowerCase(), p);
              }
            }
          }
        } catch {
          // Skip malformed messages
        }
      }

      // Check if all members are resolved
      if (memberInboxIds) {
        const allResolved = memberInboxIds.every(
          (id) => profilesByInboxId.has(id.toLowerCase()),
        );
        if (allResolved) break;
      }
    }
  } catch {
    // If message scanning fails, return whatever we have
  }

  // Fill gaps from snapshot
  if (latestSnapshotProfiles) {
    for (const [inboxId, entry] of latestSnapshotProfiles) {
      if (!profilesByInboxId.has(inboxId)) {
        profilesByInboxId.set(inboxId, {
          inboxId: entry.inboxId,
          name: entry.name,
          encryptedImage: entry.encryptedImage,
          memberKind: entry.memberKind,
          metadata: entry.metadata,
        });
      }
    }
  }

  return profilesByInboxId;
}

// ─── Snapshot Builder & Sender ───

/**
 * Build a ProfileSnapshot from current group state by scanning messages.
 * Follows the same precedence as iOS ProfileSnapshotBuilder.
 */
export async function buildProfileSnapshot(
  group: Group,
  memberInboxIds: string[],
): Promise<ProfileSnapshotContent> {
  const resolved = await resolveProfilesFromMessages(group, memberInboxIds);

  const profiles: MemberProfileEntry[] = [];
  for (const inboxId of memberInboxIds) {
    const profile = resolved.get(inboxId.toLowerCase());
    if (profile) {
      profiles.push({
        inboxId: profile.inboxId,
        name: profile.name,
        encryptedImage: profile.encryptedImage,
        memberKind: profile.memberKind,
        metadata: profile.metadata,
      });
    }
  }

  return { profiles };
}

/**
 * Build and send a ProfileSnapshot to the group.
 * Called after adding members so new joiners have profile data immediately.
 */
export async function sendProfileSnapshot(
  group: Group,
  memberInboxIds: string[],
): Promise<void> {
  await group.sync();
  const snapshot = await buildProfileSnapshot(group, memberInboxIds);
  if (snapshot.profiles.length === 0) return;

  const encoded = encodeProfileSnapshot(snapshot);
  await group.send(encoded);
}

/**
 * Send a ProfileUpdate message to the group.
 */
export async function sendProfileUpdate(
  group: Group,
  update: ProfileUpdateContent,
): Promise<void> {
  const encoded = encodeProfileUpdate(update);
  await group.send(encoded);
}

/**
 * Parse repeatable `--metadata key=value` CLI flags.
 *
 * Returns both shapes used downstream:
 *   - `parsedMetadata`: typed `ProfileMetadata` for ProfileUpdate messages.
 *     Auto-typed: "true"/"false" → bool, numeric → number, else string.
 *     Whitespace-only or whitespace-padded values stay strings — `Number(" ")`
 *     coerces to `0`, so we require the value to equal its trimmed form
 *     before treating it as numeric.
 *   - `joinMetadata`: flat `Record<string, string>` for JoinRequest payloads.
 *
 * `onError` should terminate execution (e.g. oclif's `this.error`). It's
 * typed `(msg: string) => never` so TypeScript treats invalid input as a
 * non-returning code path.
 */
export function parseMetadataFlags(
  entries: readonly string[] | undefined,
  onError: (msg: string) => never,
): { parsedMetadata: ProfileMetadata; joinMetadata: Record<string, string> } | undefined {
  if (!entries || entries.length === 0) return undefined;

  const parsedMetadata: ProfileMetadata = {};
  const joinMetadata: Record<string, string> = {};

  for (const entry of entries) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) {
      onError(`Invalid metadata format: "${entry}". Expected key=value`);
    }
    const key = entry.slice(0, eqIdx);
    const rawValue = entry.slice(eqIdx + 1);

    if (!key) {
      onError(`Empty metadata key in "${entry}"`);
    }

    joinMetadata[key] = rawValue;

    if (rawValue === "true" || rawValue === "false") {
      parsedMetadata[key] = { type: "bool", value: rawValue === "true" };
    } else if (
      rawValue !== "" &&
      rawValue.trim() === rawValue &&
      !isNaN(Number(rawValue))
    ) {
      parsedMetadata[key] = { type: "number", value: Number(rawValue) };
    } else {
      parsedMetadata[key] = { type: "string", value: rawValue };
    }
  }

  return { parsedMetadata, joinMetadata };
}
