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
  normalizeMessageContent,
  type ProfileMap,
  isTTY,
  VALID_ENVS,
  type Section,
} from "./utils/xmtp.js";
