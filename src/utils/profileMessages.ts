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

// ─── Protobuf Schema (matches profile_messages.proto) ───

const root = new protobuf.Root();

const MemberKindEnum = new protobuf.Enum("MemberKind")
  .add("MEMBER_KIND_UNSPECIFIED", 0)
  .add("MEMBER_KIND_AGENT", 1);

const EncryptedProfileImageRefType = new protobuf.Type("EncryptedProfileImageRef")
  .add(new protobuf.Field("url", 1, "string"))
  .add(new protobuf.Field("salt", 2, "bytes"))
  .add(new protobuf.Field("nonce", 3, "bytes"));

const ProfileUpdateType = new protobuf.Type("ProfileUpdate")
  .add(new protobuf.Field("name", 1, "string", "optional"))
  .add(new protobuf.Field("encrypted_image", 2, "EncryptedProfileImageRef", "optional"))
  .add(new protobuf.Field("member_kind", 3, "MemberKind", "optional"));

const MemberProfileType = new protobuf.Type("MemberProfile")
  .add(new protobuf.Field("inbox_id", 1, "bytes"))
  .add(new protobuf.Field("name", 2, "string", "optional"))
  .add(new protobuf.Field("encrypted_image", 3, "EncryptedProfileImageRef", "optional"))
  .add(new protobuf.Field("member_kind", 4, "MemberKind", "optional"));

const ProfileSnapshotType = new protobuf.Type("ProfileSnapshot")
  .add(new protobuf.Field("profiles", 1, "MemberProfile", "repeated"));

root.add(MemberKindEnum);
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

export interface ProfileUpdateContent {
  name?: string;
  encryptedImage?: EncryptedProfileImageRef;
  memberKind?: MemberKind;
}

export interface MemberProfileEntry {
  inboxId: string; // hex string
  name?: string;
  encryptedImage?: EncryptedProfileImageRef;
  memberKind?: MemberKind;
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

  if (msg.encrypted_image && msg.encrypted_image.url) {
    result.encryptedImage = {
      url: msg.encrypted_image.url,
      salt: msg.encrypted_image.salt,
      nonce: msg.encrypted_image.nonce,
    };
  }

  if (msg.member_kind) {
    result.memberKind = msg.member_kind as MemberKind;
  }

  return result;
}

interface RawMemberProfileMsg {
  inbox_id: Uint8Array;
  name?: string;
  encrypted_image?: { url: string; salt: Uint8Array; nonce: Uint8Array } | null;
  member_kind?: number;
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

      if (p.encrypted_image && p.encrypted_image.url) {
        entry.encryptedImage = {
          url: p.encrypted_image.url,
          salt: p.encrypted_image.salt,
          nonce: p.encrypted_image.nonce,
        };
      }

      if (p.member_kind) {
        entry.memberKind = p.member_kind as MemberKind;
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
function getProfileUpdateContent(message: DecodedMessage): ProfileUpdateContent | undefined {
  const content = message.content;
  if (!content || typeof content !== "object") return undefined;

  // Codec registered: content is already decoded ProfileUpdateContent
  if ("name" in content || "encryptedImage" in content || "memberKind" in content) {
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
