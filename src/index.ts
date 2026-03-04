export { run } from "@oclif/core";

// Base command for plugin extension
export { ConvosBaseCommand } from "./baseCommand.js";

// Identity management
export {
  createIdentityStore,
  type Identity,
  type IdentityStore,
} from "./utils/identities.js";

// Client creation
export { createClientForIdentity } from "./utils/client.js";

// Config types
export type { ConvosConfig } from "./utils/config.js";

// Invite system
export {
  createInviteSlug,
  parseInvite,
  verifyInvite,
  verifyInviteSignature,
  recoverInvitePublicKey,
  inviteToSlug,
  encryptConversationToken,
  decryptConversationToken,
  type InviteOptions,
  type ParsedInvite,
} from "./utils/invite.js";

// Metadata / profiles
export {
  parseAppData,
  serializeAppData,
  upsertProfile,
  removeProfile,
  getProfile,
  type ConversationProfile,
  type ConversationCustomMetadata,
} from "./utils/metadata.js";

// Profile messages (primary profile source)
export {
  encodeProfileUpdate,
  decodeProfileUpdate,
  encodeProfileSnapshot,
  decodeProfileSnapshot,
  sendProfileUpdate,
  sendProfileSnapshot,
  buildProfileSnapshot,
  resolveProfilesFromMessages,
  isProfileMessage,
  isProfileUpdateMessage,
  isProfileSnapshotMessage,
  ContentTypeProfileUpdate,
  ContentTypeProfileSnapshot,
  MemberKind,
  type ProfileUpdateContent,
  type ProfileSnapshotContent,
  type MemberProfileEntry,
  type EncryptedProfileImageRef,
  type ResolvedProfile,
} from "./utils/profileMessages.js";

// Random utilities
export { randomAlphanumeric } from "./utils/random.js";

// Re-export XMTP utilities for downstream consumers
export {
  getAccountAddress,
  toHexBytes,
  isGroup,
  isDm,
  requireGroup,
  requireDm,
  formatSections,
  formatHuman,
  jsonStringify,
  buildProfileMap,
  buildProfileMapFromMessages,
  getSenderProfile,
  getSenderProfileFromResolved,
  isDisplayableMessage,
  normalizeMessageContent,
  type ProfileMap,
  type SenderProfile,
  isTTY,
  VALID_ENVS,
  type Section,
} from "./utils/xmtp.js";
