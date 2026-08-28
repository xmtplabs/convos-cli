export { run } from "@oclif/core";

// Base command for plugin extension
export { ConvosBaseCommand } from "./baseCommand.js";

// Identity management
export {
  createIdentityStore,
  type Identity,
  type IdentityStore,
} from "./utils/identities.js";

// Client creation (single-inbox — one client per CONVOS_HOME)
export { getClient, getIdentityAndClient } from "./utils/client.js";

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
  type AgentDmInfo,
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
  ProfileUpdateCodec,
  ProfileSnapshotCodec,
  ContentTypeProfileUpdate,
  ContentTypeProfileSnapshot,
  MemberKind,
  type ProfileUpdateContent,
  type ProfileSnapshotContent,
  type MemberProfileEntry,
  type EncryptedProfileImageRef,
  type ResolvedProfile,
  type ProfileMetadataValue,
  type ProfileMetadata,
} from "./utils/profileMessages.js";

// Join request content type
export {
  JoinRequestCodec,
  ContentTypeJoinRequest,
  isJoinRequestMessage,
  getJoinRequestContent,
  type JoinRequestContent,
  type JoinRequestProfile,
} from "./utils/joinRequest.js";

// Typing indicator content type
export {
  TypingIndicatorCodec,
  ContentTypeTypingIndicator,
  isTypingIndicatorMessage,
  getTypingIndicatorContent,
  type TypingIndicatorContent,
} from "./utils/typingIndicator.js";

// Thinking content type
export {
  ThinkingCodec,
  ContentTypeThinking,
  isThinkingMessage,
  getThinkingContent,
  type Thinking,
  type ThinkingState,
} from "./utils/thinking.js";

// Thinking-control content type
export {
  ThinkingControlCodec,
  ContentTypeThinkingControl,
  isThinkingControlMessage,
  getThinkingControlContent,
  type ThinkingControl,
  type ThinkingControlAction,
} from "./utils/thinkingControl.js";

// Explode settings content type
export {
  ExplodeSettingsCodec,
  ContentTypeExplodeSettings,
  encodeExplodeSettings,
  isExplodeSettingsMessage,
  getExplodeSettingsContent,
  type ExplodeSettingsContent,
} from "./utils/explodeSettings.js";

// Assistant attestation
export {
  signAttestation,
  verifyAttestation,
  verifyAttestationWithJwks,
  generateAttestationKeyPair,
  buildJwks,
  fetchJwks,
  type Attestation,
  type Jwks,
  type JwksKey,
  type Ed25519KeyPair,
} from "./utils/attestation.js";

// Image encryption
export {
  encryptImage,
  decryptImage,
  fetchImageData,
  generateGroupKey,
  type EncryptedPayload,
} from "./utils/imageEncryption.js";

// Remote attachment JSON-safe extractors
export {
  extractRemoteAttachment,
  extractMultiRemoteAttachment,
  type RemoteAttachmentJson,
  type RemoteAttachmentInfoJson,
  type MultiRemoteAttachmentJson,
} from "./utils/remoteAttachment.js";

// Emoji utilities
export { emojiForIdentifier, EMOJIS } from "./utils/emoji.js";

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
