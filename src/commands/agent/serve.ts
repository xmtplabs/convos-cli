import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { Args, Flags } from "@oclif/core";
import {
  ConsentState,
  ConversationType,
  GroupPermissionsOptions,
  PermissionPolicy,
  PermissionUpdateType,
  ReactionAction,
  ReactionSchema,
  SortDirection,
  encryptAttachment,
  type AsyncStreamProxy,
  type Client,
  type CreateGroupOptions,
  type DecodedMessage,
  type Dm,
  type Group,
  type Reaction,
} from "@xmtp/node-sdk";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getIdentityAndClient } from "../../utils/client.js";
import {
  attestationToProfileMetadata,
  resolveAttestationFromFlags,
} from "../../utils/attestation.js";
import {
  encodeExplodeSettings,
  getExplodeSettingsContent,
  isExplodeSettingsMessage,
} from "../../utils/explodeSettings.js";
import type { Identity } from "../../utils/identities.js";
import {
  createInviteSlug,
  decryptConversationToken,
  parseInvite,
  verifyInvite,
  verifyInviteSignature,
} from "../../utils/invite.js";
import { getMimeType } from "../../utils/mime.js";
import { parseAppData, parseAppDataForWrite, serializeAppData } from "../../utils/metadata.js";
import { emojiForIdentifier } from "../../utils/emoji.js";
import {
  getProfileUpdateContent,
  isProfileUpdateMessage,
  sendProfileSnapshot,
  sendProfileUpdate,
  resolveProfilesFromMessages,
  MemberKind,
  type ResolvedProfile,
  type EncryptedProfileImageRef,
  type ProfileMetadata,
} from "../../utils/profileMessages.js";
import { encryptAndUploadProfileImage } from "../../utils/imageEncryption.js";
import { randomAlphanumeric } from "../../utils/random.js";
import {
  getUploadProvider,
  INLINE_ATTACHMENT_MAX_BYTES,
} from "../../utils/upload.js";
import {
  isJoinRequestMessage,
  getJoinRequestContent,
} from "../../utils/joinRequest.js";
import {
  buildProfileMap,
  getAccountAddress,
  getSenderProfileFromResolved,
  isDisplayableMessage,
  jsonStringify,
  normalizeMessageContent,
  requireGroup,
} from "../../utils/xmtp.js";
import {
  extractMultiRemoteAttachment,
  extractRemoteAttachment,
} from "../../utils/remoteAttachment.js";
import {
  isTypingIndicatorMessage,
  getTypingIndicatorContent,
  TypingIndicatorCodec,
  type TypingIndicatorContent,
} from "../../utils/typingIndicator.js";
import { randomUUID } from "node:crypto";
import {
  ConnectionInvocationCodec,
  CONNECTION_INVOCATION_CURRENT_SCHEMA_VERSION,
  type ConnectionInvocation,
} from "../../utils/connectionInvocation.js";
import {
  ALL_CONNECTION_CAPABILITIES,
  ALL_CONNECTION_KINDS,
  assertArgumentValue,
  dateToSwiftReference,
  type ArgumentValue,
  type ConnectionCapability,
  type ConnectionKind,
} from "../../utils/connectionTypes.js";
import {
  CapabilityRequestCodec,
  CAPABILITY_REQUEST_SUPPORTED_VERSION,
  getCapabilityRequestContent,
  isCapabilityRequestMessage,
  type CapabilityRequest,
} from "../../utils/capabilityRequest.js";
import {
  getCapabilityRequestResultContent,
  isCapabilityRequestResultMessage,
} from "../../utils/capabilityRequestResult.js";
import {
  getConnectionPayloadContent,
  isConnectionPayloadMessage,
} from "../../utils/connectionPayload.js";
import {
  getConnectionInvocationContent,
  isConnectionInvocationMessage,
} from "../../utils/connectionInvocation.js";
import {
  getConnectionInvocationResultContent,
  isConnectionInvocationResultMessage,
} from "../../utils/connectionInvocationResult.js";
import {
  getConnectionEventContent,
  isConnectionEventMessage,
} from "../../utils/connectionEvent.js";
import {
  CloudConnectionGrantRequestCodec,
  CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION,
  getCloudConnectionGrantRequestContent,
  isCloudConnectionGrantRequestMessage,
  type CloudConnectionGrantRequest,
} from "../../utils/cloudConnectionGrantRequest.js";
import {
  ALL_CAPABILITY_SUBJECTS,
  type CapabilitySubject,
} from "../../utils/capabilityTypes.js";

interface SendCommand { type: "send"; text: string; replyTo?: string; }
interface ReactCommand { type: "react"; messageId: string; emoji: string; action?: "add" | "remove"; }
interface AttachCommand { type: "attach"; file: string; mimeType?: string; replyTo?: string; }
interface RemoteAttachCommand {
  type: "remote-attach";
  url: string;
  contentDigest: string;
  secret: string;
  salt: string;
  nonce: string;
  contentLength: number;
  filename?: string;
  scheme?: string;
}
interface RenameCommand { type: "rename"; name: string; }
interface LockCommand { type: "lock"; }
interface UnlockCommand { type: "unlock"; }
interface ExplodeCommand { type: "explode"; scheduled?: string; }
interface UpdateProfileCommand {
  type: "update-profile";
  name?: string;
  image?: string;
  metadata?: Record<string, string | number | boolean>;
}
interface ReadReceiptCommand { type: "read-receipt"; }
interface TypingCommand { type: "typing"; isTyping?: boolean; }
interface ConnectionInvokeCommand {
  type: "connection-invoke";
  kind: string;
  action: string;
  arguments?: Record<string, unknown>;
  invocationId?: string;
  issuedAt?: string;
}
interface CapabilityRequestCommand {
  type: "capability-request";
  subject: string;
  capability: string;
  rationale: string;
  requestId?: string;
  preferredProviders?: string[];
}
interface CloudConnectionGrantRequestCommand {
  type: "cloud-connection-grant-request";
  service: string;
  targetInboxId: string;
  reason: string;
  /** Defaults to the agent's own inbox ID when omitted. */
  requestedByInboxId?: string;
}
interface StopCommand { type: "stop"; }

export type AgentCommand =
  | SendCommand
  | ReactCommand
  | AttachCommand
  | RemoteAttachCommand
  | RenameCommand
  | UpdateProfileCommand
  | LockCommand
  | UnlockCommand
  | ExplodeCommand
  | ReadReceiptCommand
  | TypingCommand
  | ConnectionInvokeCommand
  | CapabilityRequestCommand
  | CloudConnectionGrantRequestCommand
  | StopCommand;

export default class AgentServe extends ConvosBaseCommand {
  static description = `Run an agent server for a conversation.

Starts a long-running process bound to one conversation, combining
message streaming, join-request processing, and stdin command handling
into a single session — ideal for AI agents and bots.

Uses this install's singleton identity (per ADR 011) for every
conversation. To run multiple agents independently, point each at a
different CONVOS_HOME.

If no conversation ID is provided, creates a new conversation.
Displays the QR code invite on stderr so agents can share it.

Uses an ndjson (newline-delimited JSON) protocol:

STDIN commands (one JSON object per line):
  {"type":"send","text":"Hello"}                        Send a text message
  {"type":"send","text":"Re","replyTo":"<id>"}          Reply to a message
  {"type":"react","messageId":"<id>","emoji":"👍"}       React to a message
  {"type":"react","messageId":"<id>","emoji":"👍","action":"remove"}
  {"type":"attach","file":"./photo.jpg"}                Send a file attachment
  {"type":"attach","file":"./img.jpg","replyTo":"<id>"} Reply with attachment
  {"type":"remote-attach","url":"https://...","contentDigest":"...","secret":"...","salt":"...","nonce":"...","contentLength":123}
  {"type":"rename","name":"New Name"}                   Rename the conversation
  {"type":"update-profile","name":"New Name"}           Update your profile name
  {"type":"update-profile","image":"https://..."}       Update your profile image
  {"type":"update-profile","name":"X","image":"https://..."} Update both
  {"type":"update-profile","metadata":{"credits":75,"verified":true}} Update metadata
  {"type":"lock"}                                       Lock (prevent new joins)
  {"type":"unlock"}                                     Unlock (allow new joins)
  {"type":"explode"}                                    Explode immediately
  {"type":"explode","scheduled":"2025-03-01T00:00:00Z"} Schedule explosion
  {"type":"stop"}                                       Graceful shutdown

STDOUT events (one JSON object per line):
  {"event":"ready",...}         Session started, includes invite URL
  {"event":"message",...}       New message received
  {"event":"member_joined",...} A member joined via invite
  {"event":"sent",...}          Message sent confirmation
  {"event":"heartbeat",...}     Periodic health check
  {"event":"error",...}         Error occurred

STDERR: QR code, diagnostic logs (does not interfere with protocol)`;

  static examples = [
    {
      command: '<%= config.bin %> <%= command.id %> --name "My Bot"',
      description: "Create a new conversation and start serving",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "Attach to an existing conversation",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> --name "Agent" --profile-name "Assistant" --permissions admin-only',
      description: "Create an admin-only conversation with a profile name",
    },
  ];

  static args = {
    id: Args.string({
      description: "Existing conversation ID to attach to (omit to create new)",
      required: false,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    name: Flags.string({
      description: "Conversation name (when creating new)",
      helpValue: "<name>",
    }),
    description: Flags.string({
      description: "Conversation description (when creating new)",
      helpValue: "<description>",
    }),
    permissions: Flags.option({
      options: ["all-members", "admin-only"] as const,
      description: "Permission preset (when creating new)",
      default: "all-members" as const,
    })(),
    "profile-name": Flags.string({
      description: "Profile display name to use in this conversation",
      helpValue: "<name>",
    }),
    "no-invite": Flags.boolean({
      description: "Skip generating an invite (attach mode only)",
      default: false,
    }),
    heartbeat: Flags.integer({
      description: "Emit heartbeat events every N seconds (0 to disable)",
      helpValue: "<seconds>",
      default: 0,
    }),
    attestation: Flags.string({
      description: "Base64url-encoded Ed25519 attestation signature",
      helpValue: "<signature>",
      env: "CONVOS_ATTESTATION",
    }),
    "attestation-ts": Flags.string({
      description: "ISO 8601 timestamp used in the attestation",
      helpValue: "<iso8601>",
      env: "CONVOS_ATTESTATION_TS",
    }),
    "attestation-kid": Flags.string({
      description: "Key ID for the attestation",
      helpValue: "<kid>",
      env: "CONVOS_ATTESTATION_KID",
    }),
    "attestation-private-key": Flags.string({
      description:
        "Path to an Ed25519 private key (PEM). When set with --attestation-kid, " +
        "the CLI signs the attestation at startup against the resolved XMTP inbox " +
        "id, so the same command works whether the inbox already exists locally or " +
        "needs to be materialized first. Mutually exclusive with --attestation / --attestation-ts.",
      helpValue: "<path>",
      env: "CONVOS_ATTESTATION_PRIVATE_KEY",
    }),
  };

  private streams: AsyncStreamProxy<DecodedMessage>[] = [];
  private shutdownResolve?: () => void;
  private heartbeatInterval?: NodeJS.Timeout;
  private lastMessageTimestampNs: bigint = 0n;
  private lastDmTimestampNs: bigint = 0n;
  private recentMessageIds: Set<string> = new Set();
  private isCatchingUpMessages = false;
  private isMessagesCatchupPending = false;
  private isCatchingUpDms = false;
  private isDmsCatchupPending = false;
  private commandQueue: Promise<void> = Promise.resolve();
  private resolvedProfiles: Map<string, ResolvedProfile> = new Map();
  private lastProfileRefreshMs = 0;

  private static readonly MAX_RECENT_IDS = 1000;

  private emit(event: Record<string, unknown>): void {
    process.stdout.write(jsonStringify(event) + "\n");
  }

  private emitError(message: string, details?: Record<string, unknown>): void {
    this.emit({ event: "error", message, ...details });
  }

  /**
   * Route a message carrying a `convos.org` content type that the chat
   * stream filters out (`shouldPush=false`) into a structured stdout
   * event. Returns true if the message was a known Convos content type
   * (handled or attempted-and-malformed); the caller should not fall
   * through to the generic `message` path.
   *
   * Shared between the live stream and the catchup path so reconnects
   * don't drop connection/capability traffic on the floor. Dedupes
   * across the two paths via `trackMessageId` and advances
   * `lastMessageTimestampNs` so a subsequent catchup query won't
   * re-fetch the same message.
   */
  private routeConvosContentType(
    message: DecodedMessage,
    conversation: Group,
    catchup: boolean,
  ): boolean {
    if (isTypingIndicatorMessage(message)) {
      // Typing indicators are ephemeral — only emit on the live stream.
      // Replaying them on catchup would surface stale "is typing" state.
      // Also skip dedupe / watermark so the recent-ids cache isn't
      // churned by high-volume typing traffic.
      if (!catchup) {
        const typingContent = getTypingIndicatorContent(message);
        if (typingContent) {
          this.emit({
            event: "typing",
            senderInboxId: message.senderInboxId,
            isTyping: typingContent.isTyping,
            conversationId: conversation.id,
            timestamp: message.sentAt.toISOString(),
          });
        }
      }
      return true;
    }

    // Read receipts are high-frequency ephemeral signals — like typing,
    // only the latest matters. Skip on catchup so reconnects don't replay
    // every receipt that fired while we were offline; agents that want
    // historical read state can query `last-read-times`.
    if (
      message.contentType.authorityId === "xmtp.org" &&
      message.contentType.typeId === "read_receipt"
    ) {
      if (!catchup) {
        this.emit({
          event: "read_receipt",
          id: message.id,
          senderInboxId: message.senderInboxId,
          conversationId: conversation.id,
          sentAt: message.sentAt.toISOString(),
        });
      }
      return true;
    }

    // For non-ephemeral types: dedupe across live ↔ catchup, then
    // advance the watermark so subsequent catchup queries skip this id.
    const handled = (() => {
      if (isExplodeSettingsMessage(message)) return "explode" as const;
      if (isProfileUpdateMessage(message)) return "profile_update" as const;
      if (isConnectionPayloadMessage(message)) return "connection_payload" as const;
      if (isConnectionInvocationMessage(message)) return "connection_invocation" as const;
      if (isConnectionInvocationResultMessage(message)) return "connection_result" as const;
      if (isConnectionEventMessage(message)) return "connection_event" as const;
      if (isCloudConnectionGrantRequestMessage(message)) return "cloud_connection_grant_request" as const;
      if (isCapabilityRequestMessage(message)) return "capability_request" as const;
      if (isCapabilityRequestResultMessage(message)) return "capability_result" as const;
      return undefined;
    })();
    if (!handled) return false;

    if (!this.trackMessageId(message.id)) return true;
    const sentAtNs = message.sentAtNs;
    if (sentAtNs > this.lastMessageTimestampNs) {
      this.lastMessageTimestampNs = sentAtNs;
    }

    if (handled === "explode") {
      const explode = getExplodeSettingsContent(message);
      if (explode) {
        this.emit({
          event: "explode_notice",
          conversationId: conversation.id,
          senderInboxId: message.senderInboxId,
          expiresAt: explode.expiresAt,
          sentAt: message.sentAt.toISOString(),
          ...(catchup && { catchup: true }),
        });
      }
      return true;
    }

    if (handled === "profile_update") {
      const update = getProfileUpdateContent(message);
      if (update) {
        this.emit({
          event: "profile_update",
          id: message.id,
          senderInboxId: message.senderInboxId,
          conversationId: conversation.id,
          ...(update.name !== undefined && { name: update.name }),
          ...(update.encryptedImage && { encryptedImage: update.encryptedImage }),
          ...(update.memberKind !== undefined && { memberKind: update.memberKind }),
          ...(update.metadata && Object.keys(update.metadata).length > 0 && { metadata: update.metadata }),
          sentAt: message.sentAt.toISOString(),
          ...(catchup && { catchup: true }),
        });
      }
      return true;
    }

    if (handled === "connection_payload") {
      const payload = getConnectionPayloadContent(message);
      if (payload) {
        this.emit({
          event: "connection_payload",
          id: message.id,
          envelopeId: payload.id,
          senderInboxId: message.senderInboxId,
          conversationId: conversation.id,
          source: payload.source,
          schemaVersion: payload.schemaVersion,
          capturedAt: payload.capturedAt,
          body: payload.body,
          sentAt: message.sentAt.toISOString(),
          ...(catchup && { catchup: true }),
        });
      }
      return true;
    }

    if (handled === "connection_invocation") {
      const invocation = getConnectionInvocationContent(message);
      if (invocation) {
        this.emit({
          event: "connection_invocation",
          id: message.id,
          envelopeId: invocation.id,
          senderInboxId: message.senderInboxId,
          conversationId: conversation.id,
          invocationId: invocation.invocationId,
          kind: invocation.kind,
          schemaVersion: invocation.schemaVersion,
          action: invocation.action,
          issuedAt: invocation.issuedAt,
          sentAt: message.sentAt.toISOString(),
          ...(catchup && { catchup: true }),
        });
      }
      return true;
    }

    if (handled === "connection_result") {
      const result = getConnectionInvocationResultContent(message);
      if (result) {
        this.emit({
          event: "connection_result",
          id: message.id,
          envelopeId: result.id,
          senderInboxId: message.senderInboxId,
          conversationId: conversation.id,
          invocationId: result.invocationId,
          kind: result.kind,
          actionName: result.actionName,
          status: result.status,
          schemaVersion: result.schemaVersion,
          result: result.result,
          ...(result.errorMessage && { errorMessage: result.errorMessage }),
          completedAt: result.completedAt,
          sentAt: message.sentAt.toISOString(),
          ...(catchup && { catchup: true }),
        });
      }
      return true;
    }

    if (handled === "connection_event") {
      const event = getConnectionEventContent(message);
      if (event) {
        this.emit({
          event: "connection_event",
          id: message.id,
          senderInboxId: message.senderInboxId,
          conversationId: conversation.id,
          version: event.version,
          providerId: event.providerId,
          action: event.action,
          ...(event.grantedToInboxId !== undefined && {
            grantedToInboxId: event.grantedToInboxId,
          }),
          sentAt: message.sentAt.toISOString(),
          ...(catchup && { catchup: true }),
        });
      }
      return true;
    }

    if (handled === "cloud_connection_grant_request") {
      const request = getCloudConnectionGrantRequestContent(message);
      if (request) {
        this.emit({
          event: "cloud_connection_grant_request",
          id: message.id,
          senderInboxId: message.senderInboxId,
          conversationId: conversation.id,
          version: request.version,
          service: request.service,
          requestedByInboxId: request.requestedByInboxId,
          targetInboxId: request.targetInboxId,
          reason: request.reason,
          sentAt: message.sentAt.toISOString(),
          ...(catchup && { catchup: true }),
        });
      }
      return true;
    }

    if (handled === "capability_request") {
      const request = getCapabilityRequestContent(message);
      if (request) {
        this.emit({
          event: "capability_request",
          id: message.id,
          senderInboxId: message.senderInboxId,
          conversationId: conversation.id,
          version: request.version,
          requestId: request.requestId,
          askerInboxId: request.askerInboxId,
          subject: request.subject,
          capability: request.capability,
          rationale: request.rationale,
          ...(request.preferredProviders && { preferredProviders: request.preferredProviders }),
          sentAt: message.sentAt.toISOString(),
          ...(catchup && { catchup: true }),
        });
      }
      return true;
    }

    if (handled === "capability_result") {
      const result = getCapabilityRequestResultContent(message);
      if (result) {
        this.emit({
          event: "capability_result",
          id: message.id,
          senderInboxId: message.senderInboxId,
          conversationId: conversation.id,
          version: result.version,
          requestId: result.requestId,
          status: result.status,
          subject: result.subject,
          capability: result.capability,
          providers: result.providers,
          availableActions: result.availableActions,
          sentAt: message.sentAt.toISOString(),
          ...(catchup && { catchup: true }),
        });
      }
      return true;
    }

    return false;
  }

  private trackMessageId(id: string): boolean {
    if (this.recentMessageIds.has(id)) return false;
    this.recentMessageIds.add(id);
    if (this.recentMessageIds.size > AgentServe.MAX_RECENT_IDS) {
      const first = this.recentMessageIds.values().next().value!;
      this.recentMessageIds.delete(first);
    }
    return true;
  }

  /**
   * Process a single DM message as a potential join request for the
   * conversation this agent is bound to.
   */
  private async processJoinMessage(
    message: DecodedMessage,
    client: Client,
    identity: Identity,
    boundConversationId: string,
  ): Promise<{ conversationId: string; joinerInboxId: string } | undefined> {
    if (message.senderInboxId === client.inboxId) return;

    let slug: string | undefined;

    if (isJoinRequestMessage(message)) {
      const joinRequest = getJoinRequestContent(message);
      if (joinRequest) {
        slug = joinRequest.inviteSlug;
      }
    }

    if (!slug) {
      const text = typeof message.content === "string" ? message.content : null;
      if (!text) return;
      slug = text;
    }

    let invite;
    try {
      invite = parseInvite(slug);
    } catch {
      return;
    }

    const dmConversation = (await client.conversations.getConversationById(
      message.conversationId,
    )) as Dm | undefined;

    if (!(await verifyInvite(invite))) {
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    if (!(await verifyInviteSignature(invite, identity.walletKey))) {
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    if (invite.creatorInboxId !== client.inboxId) {
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) return;

    let conversationId: string;
    try {
      conversationId = decryptConversationToken(
        invite.conversationToken,
        client.inboxId,
        Buffer.from(identity.walletKey.replace("0x", ""), "hex"),
      );
    } catch {
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    // Only honor join requests for the conversation this agent is bound to.
    if (conversationId !== boundConversationId) return;

    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) return;

    const group = requireGroup(conversation);

    try {
      const appData = group.appData ?? "";
      const metadata = parseAppData(appData);
      if (metadata.tag && invite.tag !== metadata.tag) return;
    } catch {
      // skip tag check
    }

    await group.addMembers([message.senderInboxId]);

    // Send ProfileSnapshot so the new joiner has all profiles
    try {
      const allMembers = await group.members();
      const allMemberInboxIds = allMembers.map((m) => m.inboxId);
      await sendProfileSnapshot(group, allMemberInboxIds);
    } catch {
      // Non-fatal: new joiner can still receive profiles via individual updates
    }

    if (dmConversation) dmConversation.updateConsentState(ConsentState.Allowed);

    return { conversationId, joinerInboxId: message.senderInboxId };
  }

  private async processPendingJoinRequests(
    client: Client,
    identity: Identity,
    boundConversationId: string,
  ): Promise<void> {
    try {
      await client.conversations.sync();
      const dms = await client.conversations.list({
        conversationType: ConversationType.Dm,
        consentStates: [ConsentState.Unknown],
      });

      for (const dm of dms) {
        try {
          await dm.sync();
          const messages = await dm.messages({ limit: 10 });
          for (const message of messages) {
            try {
              const result = await this.processJoinMessage(
                message,
                client,
                identity,
                boundConversationId,
              );
              if (result) {
                this.emit({
                  event: "member_joined",
                  inboxId: result.joinerInboxId,
                  conversationId: result.conversationId,
                  timestamp: new Date().toISOString(),
                });
                break;
              }
            } catch {
              // skip individual message errors
            }
          }
        } catch {
          // skip individual DM errors
        }
      }
    } catch (error) {
      this.emitError(
        `Failed to process pending join requests: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /**
   * Schedule a DM catchup run. Coalesces concurrent restarts: a call during
   * an in-flight catchup sets a pending flag so one more pass runs after the
   * current one completes, picking up anything that arrived in between.
   */
  private scheduleDmJoinRequestsCatchup(
    client: Client,
    identity: Identity,
    boundConversationId: string,
  ): void {
    if (this.isCatchingUpDms) {
      this.isDmsCatchupPending = true;
      return;
    }
    this.isCatchingUpDms = true;
    void (async () => {
      try {
        do {
          this.isDmsCatchupPending = false;
          await this.catchUpDmJoinRequests(
            client,
            identity,
            boundConversationId,
            this.lastDmTimestampNs,
          );
        } while (this.isDmsCatchupPending);
      } finally {
        this.isCatchingUpDms = false;
      }
    })();
  }

  private async catchUpDmJoinRequests(
    client: Client,
    identity: Identity,
    boundConversationId: string,
    sinceNs: bigint,
  ): Promise<void> {
    if (sinceNs === 0n) return;

    try {
      await client.conversations.sync();
      const dms = await client.conversations.list({
        conversationType: ConversationType.Dm,
        consentStates: [ConsentState.Unknown],
      });

      for (const dm of dms) {
        try {
          await dm.sync();
          const messages = await dm.messages({
            sentAfterNs: sinceNs,
            direction: SortDirection.Ascending,
            limit: 10,
          });

          for (const message of messages) {
            try {
              const sentAtNs = message.sentAtNs;
              const result = await this.processJoinMessage(
                message,
                client,
                identity,
                boundConversationId,
              );
              if (result) {
                if (sentAtNs > this.lastDmTimestampNs) {
                  this.lastDmTimestampNs = sentAtNs;
                }
                this.emit({
                  event: "member_joined",
                  inboxId: result.joinerInboxId,
                  conversationId: result.conversationId,
                  timestamp: new Date().toISOString(),
                  catchup: true,
                });
                break;
              }
            } catch {
              // skip individual message errors
            }
          }
        } catch {
          // skip individual DM errors
        }
      }
    } catch (error) {
      this.emitError(
        `Failed to catch up DM join requests: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  private async startJoinRequestStream(
    client: Client,
    identity: Identity,
    boundConversationId: string,
  ): Promise<void> {
    try {
      const stream = await client.conversations.streamAllDmMessages({
        onRestart: () => {
          this.scheduleDmJoinRequestsCatchup(client, identity, boundConversationId);
        },
      });
      this.streams.push(stream);

      (async () => {
        try {
          for await (const message of stream) {
            try {
              const sentAtNs = message.sentAtNs;
              if (sentAtNs > this.lastDmTimestampNs) {
                this.lastDmTimestampNs = sentAtNs;
              }

              const result = await this.processJoinMessage(
                message,
                client,
                identity,
                boundConversationId,
              );
              if (result) {
                this.emit({
                  event: "member_joined",
                  inboxId: result.joinerInboxId,
                  conversationId: result.conversationId,
                  timestamp: new Date().toISOString(),
                });
              }
            } catch (error) {
              this.emitError(
                `Failed to handle DM message: ${error instanceof Error ? error.message : "unknown"}`,
                { messageId: message.id },
              );
            }
          }
        } catch (error) {
          this.emitError(
            `DM stream ended: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      })();
    } catch (error) {
      this.emitError(
        `Failed to start join request stream: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /**
   * Schedule a message catchup run. Coalesces concurrent restarts: a call
   * during an in-flight catchup sets a pending flag so one more pass runs
   * after the current one completes, picking up anything that arrived in
   * between.
   */
  private scheduleMessagesCatchup(
    conversation: Group,
    client: Client,
  ): void {
    if (this.isCatchingUpMessages) {
      this.isMessagesCatchupPending = true;
      return;
    }
    this.isCatchingUpMessages = true;
    void (async () => {
      try {
        do {
          this.isMessagesCatchupPending = false;
          await this.catchUpMessages(
            conversation,
            client,
            this.lastMessageTimestampNs,
          );
        } while (this.isMessagesCatchupPending);
      } finally {
        this.isCatchingUpMessages = false;
      }
    })();
  }

  private async catchUpMessages(
    conversation: Group,
    client: Client,
    sinceNs: bigint,
  ): Promise<void> {
    if (sinceNs === 0n) return;

    try {
      await conversation.sync();
      const missed = await conversation.messages({
        sentAfterNs: sinceNs,
        direction: SortDirection.Ascending,
      });

      try {
        this.resolvedProfiles = await resolveProfilesFromMessages(conversation);
      } catch {
        // Use existing cache
      }

      for (const message of missed) {
        if (message.senderInboxId === client.inboxId) continue;
        if (this.routeConvosContentType(message, conversation, true)) continue;
        if (!isDisplayableMessage(message)) continue;
        if (!this.trackMessageId(message.id)) continue;

        const sentAtNs = message.sentAtNs;
        if (sentAtNs > this.lastMessageTimestampNs) {
          this.lastMessageTimestampNs = sentAtNs;
        }

        const appData = conversation.appData ?? "";
        const profiles = buildProfileMap(appData);
        for (const [inboxId, profile] of this.resolvedProfiles) {
          if (profile.name) profiles.set(inboxId, profile.name);
        }
        const content = normalizeMessageContent(message, profiles);
        if (!content) continue;
        const senderProfile = getSenderProfileFromResolved(
          this.resolvedProfiles,
          appData,
          message.senderInboxId,
        );
        const remoteAttachment = extractRemoteAttachment(message);
        const multiRemoteAttachment = extractMultiRemoteAttachment(message);
        this.emit({
          event: "message",
          id: message.id,
          senderInboxId: message.senderInboxId,
          ...(senderProfile && { senderProfile }),
          contentType: message.contentType,
          content,
          ...(remoteAttachment && { remoteAttachment }),
          ...(multiRemoteAttachment && { multiRemoteAttachment }),
          sentAt: message.sentAt.toISOString(),
          deliveryStatus: message.deliveryStatus,
          catchup: true,
        });
      }
    } catch (error) {
      this.emitError(
        `Failed to catch up messages: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  private async startMessageStream(
    conversation: Group,
    client: Client,
  ): Promise<void> {
    try {
      const stream = await conversation.stream({
        onRestart: () => {
          this.scheduleMessagesCatchup(conversation, client);
        },
      });
      this.streams.push(stream);

      (async () => {
        try {
          for await (const message of stream) {
            if (message.senderInboxId === client.inboxId) continue;

            if (this.routeConvosContentType(message, conversation, false)) continue;

            if (!isDisplayableMessage(message)) continue;
            if (!this.trackMessageId(message.id)) continue;

            const sentAtNs = message.sentAtNs;
            if (sentAtNs > this.lastMessageTimestampNs) {
              this.lastMessageTimestampNs = sentAtNs;
            }

            const appData = conversation.appData ?? "";
            const profiles = buildProfileMap(appData);
            const now = Date.now();
            if (now - this.lastProfileRefreshMs > 30_000) {
              try {
                this.resolvedProfiles = await resolveProfilesFromMessages(conversation);
                this.lastProfileRefreshMs = now;
              } catch {
                // Use existing cache
              }
            }
            for (const [inboxId, profile] of this.resolvedProfiles) {
              if (profile.name) profiles.set(inboxId, profile.name);
            }
            const content = normalizeMessageContent(message, profiles);
            if (!content) continue;
            const senderProfile = getSenderProfileFromResolved(
              this.resolvedProfiles,
              appData,
              message.senderInboxId,
            );
            const remoteAttachment = extractRemoteAttachment(message);
            const multiRemoteAttachment = extractMultiRemoteAttachment(message);

            this.emit({
              event: "message",
              id: message.id,
              senderInboxId: message.senderInboxId,
              ...(senderProfile && { senderProfile }),
              contentType: message.contentType,
              content,
              ...(remoteAttachment && { remoteAttachment }),
              ...(multiRemoteAttachment && { multiRemoteAttachment }),
              sentAt: message.sentAt.toISOString(),
              deliveryStatus: message.deliveryStatus,
            });
          }
        } catch (error) {
          this.emitError(
            `Message stream ended: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      })();
    } catch (error) {
      this.emitError(
        `Failed to start message stream: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  private async startStdinReader(
    conversation: Group,
    client: Client,
    identity: Identity,
  ): Promise<void> {
    if (process.stdin.isTTY) return;

    const rl = createInterface({
      input: process.stdin,
      terminal: false,
    });

    rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let cmd: AgentCommand;
      try {
        cmd = JSON.parse(trimmed) as AgentCommand;
      } catch {
        this.emitError("Invalid JSON on stdin", { input: trimmed });
        return;
      }

      this.commandQueue = this.commandQueue.then(() =>
        this.handleCommand(cmd, conversation, client, identity),
      );
    });

    rl.on("close", () => {
      this.shutdown();
    });
  }

  private async handleCommand(
    cmd: AgentCommand,
    conversation: Group,
    client: Client,
    identity: Identity,
  ): Promise<void> {
    try {
      switch (cmd.type) {
        case "send": {
          if (!cmd.text) {
            this.emitError("send command requires 'text' field");
            return;
          }

          let messageId: string;
          if (cmd.replyTo) {
            const { encodeText } = await import("@xmtp/node-sdk");
            messageId = await conversation.sendReply({
              reference: cmd.replyTo,
              content: encodeText(cmd.text),
            });
          } else {
            messageId = await conversation.sendText(cmd.text);
          }

          this.emit({
            event: "sent",
            id: messageId,
            text: cmd.text,
            ...(cmd.replyTo && { replyTo: cmd.replyTo }),
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "react": {
          if (!cmd.messageId || !cmd.emoji) {
            this.emitError("react command requires 'messageId' and 'emoji' fields");
            return;
          }

          const action = cmd.action === "remove" ? ReactionAction.Removed : ReactionAction.Added;
          const reaction: Reaction = {
            reference: cmd.messageId,
            referenceInboxId: "",
            action,
            content: cmd.emoji,
            schema: ReactionSchema.Unicode,
          };
          const reactionMessageId = await conversation.sendReaction(reaction);

          this.emit({
            event: "sent",
            id: reactionMessageId,
            type: "reaction",
            messageId: cmd.messageId,
            emoji: cmd.emoji,
            action: cmd.action ?? "add",
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "attach": {
          if (!cmd.file) {
            this.emitError("attach command requires 'file' field");
            return;
          }

          const content = await readFile(cmd.file);
          const filename = basename(cmd.file);
          const mimeType = cmd.mimeType ?? getMimeType(cmd.file);
          const attachment = { mimeType, content, filename };

          const needsRemote = content.length > INLINE_ATTACHMENT_MAX_BYTES;

          let messageId: string;
          let sendType: string;
          let url: string | undefined;

          if (needsRemote) {
            const config = this.getConvosConfig();
            const provider = getUploadProvider(config);
            if (!provider) {
              this.emitError(
                `File is ${content.length} bytes (>${INLINE_ATTACHMENT_MAX_BYTES}). ` +
                  `Configure an upload provider (CONVOS_UPLOAD_PROVIDER) to send large files.`,
              );
              return;
            }

            const encrypted = encryptAttachment(attachment);
            url = await provider.upload(encrypted.payload, filename, mimeType);

            if (cmd.replyTo) {
              const { encodeRemoteAttachment } = await import("@xmtp/node-sdk");
              messageId = await conversation.sendReply({
                reference: cmd.replyTo,
                content: encodeRemoteAttachment({
                  url,
                  contentDigest: encrypted.contentDigest,
                  secret: encrypted.secret,
                  salt: encrypted.salt,
                  nonce: encrypted.nonce,
                  scheme: "https",
                  contentLength: encrypted.payload.length,
                  filename,
                }),
              });
            } else {
              messageId = await conversation.sendRemoteAttachment(
                {
                  url,
                  contentDigest: encrypted.contentDigest,
                  secret: encrypted.secret,
                  salt: encrypted.salt,
                  nonce: encrypted.nonce,
                  scheme: "https",
                  contentLength: encrypted.payload.length,
                  filename,
                },
                false,
              );
            }
            sendType = "remote";
          } else {
            if (cmd.replyTo) {
              const { encodeAttachment } = await import("@xmtp/node-sdk");
              messageId = await conversation.sendReply({
                reference: cmd.replyTo,
                content: encodeAttachment(attachment),
              });
            } else {
              messageId = await conversation.sendAttachment(attachment, false);
            }
            sendType = "inline";
          }

          this.emit({
            event: "sent",
            id: messageId,
            type: "attachment",
            filename,
            mimeType,
            size: content.length,
            sendType,
            ...(url && { url }),
            ...(cmd.replyTo && { replyTo: cmd.replyTo }),
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "remote-attach": {
          if (!cmd.url || !cmd.contentDigest || !cmd.secret || !cmd.salt || !cmd.nonce || !cmd.contentLength) {
            this.emitError(
              "remote-attach command requires 'url', 'contentDigest', 'secret', 'salt', 'nonce', and 'contentLength' fields",
            );
            return;
          }

          const remoteAttachment = {
            url: cmd.url,
            contentDigest: cmd.contentDigest,
            secret: new Uint8Array(Buffer.from(cmd.secret, "base64")),
            salt: new Uint8Array(Buffer.from(cmd.salt, "base64")),
            nonce: new Uint8Array(Buffer.from(cmd.nonce, "base64")),
            scheme: cmd.scheme ?? "https",
            contentLength: cmd.contentLength,
            filename: cmd.filename,
          };

          const remoteMessageId = await conversation.sendRemoteAttachment(
            remoteAttachment,
            false,
          );

          this.emit({
            event: "sent",
            id: remoteMessageId,
            type: "remote-attachment",
            url: cmd.url,
            filename: cmd.filename,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "rename": {
          if (!cmd.name) {
            this.emitError("rename command requires 'name' field");
            return;
          }

          await conversation.updateName(cmd.name);

          this.emit({
            event: "sent",
            type: "rename",
            name: cmd.name,
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "update-profile": {
          if (cmd.name == null && cmd.image == null && cmd.metadata == null) {
            this.emitError("update-profile requires 'name', 'image', and/or 'metadata'");
            return;
          }

          const profiles = this.resolvedProfiles.size > 0
            ? this.resolvedProfiles
            : await resolveProfilesFromMessages(conversation);
          const existing = profiles.get(client.inboxId.toLowerCase());

          const profileName = cmd.name !== undefined
            ? (cmd.name || undefined)
            : existing?.name;
          const memberKind = existing?.memberKind ?? MemberKind.Agent;

          let encryptedImage: EncryptedProfileImageRef | undefined;
          if (cmd.image !== undefined) {
            if (cmd.image === "") {
              encryptedImage = undefined;
            } else {
              const uploadProvider = getUploadProvider(this.getConvosConfig());
              if (!uploadProvider) {
                this.emitError(
                  "Image upload requires an upload provider. Set CONVOS_API_KEY=<key> or CONVOS_UPLOAD_PROVIDER=convos-api with CONVOS_API_KEY.",
                );
                return;
              }

              encryptedImage = await encryptAndUploadProfileImage(
                cmd.image,
                conversation,
                (data, filename, mimeType) => uploadProvider.upload(data, filename, mimeType),
                { verboseLog: (m) => this.verboseLog(m) },
              );
            }
          } else {
            encryptedImage = existing?.encryptedImage;
          }

          let parsedMetadata: ProfileMetadata | undefined;
          if (cmd.metadata != null) {
            parsedMetadata = {};
            for (const [key, val] of Object.entries(cmd.metadata)) {
              if (typeof val === "boolean") {
                parsedMetadata[key] = { type: "bool", value: val };
              } else if (typeof val === "number") {
                parsedMetadata[key] = { type: "number", value: val };
              } else {
                parsedMetadata[key] = { type: "string", value: String(val) };
              }
            }
          }

          const mergedMetadata: ProfileMetadata | undefined = parsedMetadata
            ? { ...(existing?.metadata ?? {}), ...parsedMetadata }
            : existing?.metadata;

          await sendProfileUpdate(conversation, {
            name: profileName,
            memberKind,
            ...(encryptedImage && { encryptedImage }),
            ...(mergedMetadata && Object.keys(mergedMetadata).length > 0 && { metadata: mergedMetadata }),
          });

          this.resolvedProfiles.set(client.inboxId.toLowerCase(), {
            inboxId: client.inboxId,
            name: profileName,
            memberKind,
            ...(encryptedImage && { encryptedImage }),
            ...(mergedMetadata && Object.keys(mergedMetadata).length > 0 && { metadata: mergedMetadata }),
          });

          this.emit({
            event: "sent",
            type: "update-profile",
            ...(cmd.name !== undefined && { name: cmd.name }),
            ...(cmd.image !== undefined && { image: cmd.image }),
            ...(cmd.metadata != null && { metadata: cmd.metadata }),
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "lock": {
          let appData = "";
          try {
            appData = conversation.appData ?? "";
          } catch {
            // no appData
          }
          const lockMetadata = parseAppData(appData);
          lockMetadata.tag = randomAlphanumeric(10);
          await conversation.updateAppData(serializeAppData(lockMetadata));

          await conversation.updatePermission(
            PermissionUpdateType.AddMember,
            PermissionPolicy.Deny,
          );

          this.emit({
            event: "sent",
            type: "lock",
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "unlock": {
          let appData = "";
          try {
            appData = conversation.appData ?? "";
          } catch {
            // no appData
          }
          const unlockMetadata = parseAppData(appData);
          unlockMetadata.tag = randomAlphanumeric(10);
          await conversation.updateAppData(serializeAppData(unlockMetadata));

          await conversation.updatePermission(
            PermissionUpdateType.AddMember,
            PermissionPolicy.Allow,
          );

          this.emit({
            event: "sent",
            type: "unlock",
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "explode": {
          let expiresAt: Date;
          const isImmediate = !cmd.scheduled;
          if (cmd.scheduled) {
            expiresAt = new Date(cmd.scheduled);
            if (isNaN(expiresAt.getTime())) {
              this.emitError(`Invalid scheduled date: ${cmd.scheduled}`);
              return;
            }
            if (expiresAt <= new Date()) {
              this.emitError("Scheduled date must be in the future");
              return;
            }
          } else {
            expiresAt = new Date();
          }

          const encodedContent = encodeExplodeSettings(expiresAt);
          await conversation.send(encodedContent, { shouldPush: true });

          try {
            let appData = "";
            try {
              appData = conversation.appData ?? "";
            } catch {
              this.verboseWarn("Could not read conversation appData in agent serve explode; treating as empty");
            }
            if (!appData) {
              this.verboseLog("Conversation appData is empty in agent serve during explode metadata update");
            }
            const explodeMetadata = parseAppDataForWrite(appData);
            explodeMetadata.expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
            await conversation.updateAppData(serializeAppData(explodeMetadata));
          } catch {
            // Non-fatal
          }

          if (isImmediate) {
            const members = await conversation.members();
            const others = members.filter((m) => m.inboxId !== client.inboxId);
            if (others.length > 0) {
              await conversation.removeMembers(others.map((m) => m.inboxId));
            }

            this.emit({
              event: "sent",
              type: "explode",
              conversationId: conversation.id,
              membersRemoved: others.length,
              expiresAt: expiresAt.toISOString(),
              timestamp: new Date().toISOString(),
            });

            // Exploded conversation is gone — shut down the agent process
            this.shutdown();
          } else {
            this.emit({
              event: "sent",
              type: "explode",
              scheduled: true,
              conversationId: conversation.id,
              expiresAt: expiresAt.toISOString(),
              timestamp: new Date().toISOString(),
            });
          }
          break;
        }

        case "read-receipt": {
          const receiptMessageId = await conversation.sendReadReceipt();

          this.emit({
            event: "sent",
            id: receiptMessageId,
            type: "read-receipt",
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "typing": {
          const isTyping = cmd.isTyping !== false;
          const content: TypingIndicatorContent = { isTyping };
          const codec = new TypingIndicatorCodec();
          const encoded = codec.encode(content);
          const typingMessageId = await conversation.send(encoded);

          this.emit({
            event: "sent",
            id: typingMessageId,
            type: "typing",
            isTyping,
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "connection-invoke": {
          if (!cmd.kind) {
            this.emitError("connection-invoke command requires 'kind' field");
            return;
          }
          if (!ALL_CONNECTION_KINDS.includes(cmd.kind as ConnectionKind)) {
            this.emitError(
              `connection-invoke 'kind' must be one of: ${ALL_CONNECTION_KINDS.join(", ")}`,
              { kind: cmd.kind },
            );
            return;
          }
          if (!cmd.action) {
            this.emitError("connection-invoke command requires 'action' field");
            return;
          }

          const argumentsTyped: Record<string, ArgumentValue> = {};
          const rawArgs = cmd.arguments ?? {};
          if (typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
            this.emitError(
              "connection-invoke 'arguments' must be a JSON object mapping names to ArgumentValue tagged objects",
            );
            return;
          }
          for (const [key, value] of Object.entries(rawArgs)) {
            try {
              assertArgumentValue(value, `arguments.${key}`);
            } catch (error) {
              this.emitError(
                error instanceof Error ? error.message : `arguments.${key}: invalid`,
              );
              return;
            }
            argumentsTyped[key] = value as ArgumentValue;
          }

          let issuedAtDate: Date;
          if (cmd.issuedAt) {
            issuedAtDate = new Date(cmd.issuedAt);
            if (isNaN(issuedAtDate.getTime())) {
              this.emitError(`Invalid 'issuedAt' timestamp: ${cmd.issuedAt}`);
              return;
            }
          } else {
            issuedAtDate = new Date();
          }

          const invocation: ConnectionInvocation = {
            id: randomUUID().toUpperCase(),
            schemaVersion: CONNECTION_INVOCATION_CURRENT_SCHEMA_VERSION,
            invocationId: cmd.invocationId ?? `agent-${randomUUID().slice(0, 8)}`,
            kind: cmd.kind as ConnectionKind,
            action: { name: cmd.action, arguments: argumentsTyped },
            issuedAt: dateToSwiftReference(issuedAtDate),
          };

          const codec = new ConnectionInvocationCodec();
          const encoded = codec.encode(invocation);
          const invocationMessageId = await conversation.send(encoded);

          this.emit({
            event: "sent",
            id: invocationMessageId,
            type: "connection-invoke",
            invocationId: invocation.invocationId,
            envelopeId: invocation.id,
            kind: invocation.kind,
            action: invocation.action.name,
            issuedAt: issuedAtDate.toISOString(),
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "capability-request": {
          if (!cmd.subject) {
            this.emitError("capability-request command requires 'subject' field");
            return;
          }
          if (!ALL_CAPABILITY_SUBJECTS.includes(cmd.subject as CapabilitySubject)) {
            this.emitError(
              `capability-request 'subject' must be one of: ${ALL_CAPABILITY_SUBJECTS.join(", ")}`,
              { subject: cmd.subject },
            );
            return;
          }
          if (!cmd.capability) {
            this.emitError("capability-request command requires 'capability' field");
            return;
          }
          if (!ALL_CONNECTION_CAPABILITIES.includes(cmd.capability as ConnectionCapability)) {
            this.emitError(
              `capability-request 'capability' must be one of: ${ALL_CONNECTION_CAPABILITIES.join(", ")}`,
              { capability: cmd.capability },
            );
            return;
          }
          if (typeof cmd.rationale !== "string" || cmd.rationale.length === 0) {
            this.emitError("capability-request command requires non-empty 'rationale' field");
            return;
          }
          let preferredProviders: string[] | undefined;
          if (cmd.preferredProviders !== undefined) {
            if (!Array.isArray(cmd.preferredProviders)) {
              this.emitError("capability-request 'preferredProviders' must be an array of strings");
              return;
            }
            for (const id of cmd.preferredProviders) {
              if (typeof id !== "string") {
                this.emitError("capability-request 'preferredProviders' entries must be strings");
                return;
              }
            }
            preferredProviders = cmd.preferredProviders;
          }

          const request: CapabilityRequest = {
            version: CAPABILITY_REQUEST_SUPPORTED_VERSION,
            requestId: cmd.requestId ?? `agent-${randomUUID().slice(0, 8)}`,
            askerInboxId: client.inboxId,
            subject: cmd.subject as CapabilitySubject,
            capability: cmd.capability as ConnectionCapability,
            rationale: cmd.rationale,
            ...(preferredProviders && { preferredProviders }),
          };

          const codec = new CapabilityRequestCodec();
          const encoded = codec.encode(request);
          const requestMessageId = await conversation.send(encoded);

          this.emit({
            event: "sent",
            id: requestMessageId,
            type: "capability-request",
            requestId: request.requestId,
            askerInboxId: request.askerInboxId,
            subject: request.subject,
            capability: request.capability,
            ...(request.preferredProviders && { preferredProviders: request.preferredProviders }),
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "cloud-connection-grant-request": {
          if (typeof cmd.service !== "string" || cmd.service.length === 0) {
            this.emitError("cloud-connection-grant-request command requires non-empty 'service' field");
            return;
          }
          if (typeof cmd.targetInboxId !== "string" || cmd.targetInboxId.length === 0) {
            this.emitError("cloud-connection-grant-request command requires non-empty 'targetInboxId' field");
            return;
          }
          if (typeof cmd.reason !== "string" || cmd.reason.length === 0) {
            this.emitError("cloud-connection-grant-request command requires non-empty 'reason' field");
            return;
          }
          if (cmd.requestedByInboxId !== undefined && typeof cmd.requestedByInboxId !== "string") {
            this.emitError("cloud-connection-grant-request 'requestedByInboxId' must be a string");
            return;
          }

          const request: CloudConnectionGrantRequest = {
            version: CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION,
            service: cmd.service,
            requestedByInboxId: cmd.requestedByInboxId ?? client.inboxId,
            targetInboxId: cmd.targetInboxId,
            reason: cmd.reason,
          };

          const codec = new CloudConnectionGrantRequestCodec();
          const encoded = codec.encode(request);
          const grantMessageId = await conversation.send(encoded);

          this.emit({
            event: "sent",
            id: grantMessageId,
            type: "cloud-connection-grant-request",
            service: request.service,
            requestedByInboxId: request.requestedByInboxId,
            targetInboxId: request.targetInboxId,
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "stop":
          this.shutdown();
          break;

        default:
          this.emitError(`Unknown command type: ${(cmd as any).type}`);
      }
    } catch (error) {
      this.emitError(
        `Command failed: ${error instanceof Error ? error.message : "unknown"}`,
        { command: cmd },
      );
    }
  }

  private startHeartbeat(intervalSeconds: number, conversationId: string): void {
    if (intervalSeconds <= 0) return;

    this.heartbeatInterval = setInterval(() => {
      this.emit({
        event: "heartbeat",
        conversationId,
        activeStreams: this.streams.length,
        timestamp: new Date().toISOString(),
      });
    }, intervalSeconds * 1000);

    this.heartbeatInterval.unref();
  }

  private shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    if (this.shutdownResolve) {
      this.shutdownResolve();
    }
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AgentServe);
    const config = this.getConvosConfig();

    const { identity, client } = await getIdentityAndClient(
      config,
      this.getConvosHome(),
    );

    let group: Group;
    let conversationId: string;
    let inviteUrl: string | undefined;
    let inviteSlug: string | undefined;
    let inviteTag: string | undefined;

    if (args.id) {
      // ─── Attach to existing conversation ───
      const conv = await client.conversations.getConversationById(args.id);
      if (!conv) {
        this.error(`Conversation not found: ${args.id}`);
      }
      group = requireGroup(conv);
      conversationId = args.id;

      // Generate invite unless --no-invite. In attach mode this must be read-only:
      // never create or rewrite appData metadata on an existing conversation.
      if (!flags["no-invite"]) {
        let appData = "";
        try {
          appData = group.appData ?? "";
        } catch {
          this.verboseWarn("Could not read conversation appData in agent attach mode; skipping invite generation");
        }
        if (!appData) {
          this.verboseLog("Conversation appData is empty in agent attach mode; skipping invite generation");
        }
        const metadata = parseAppData(appData);
        inviteTag = metadata.tag;

        if (!inviteTag) {
          this.verboseWarn("Conversation invite tag is missing in agent attach mode; skipping invite generation to avoid rewriting appData");
        } else {
          inviteSlug = await createInviteSlug(
            conversationId,
            client.inboxId,
            inviteTag,
            identity.walletKey,
            {
              name: group.name || undefined,
              description: group.description || undefined,
              emoji: metadata.emoji,
            },
          );

          const env = config.env ?? "dev";
          const baseUrl =
            env === "production"
              ? "https://popup.convos.org/v2"
              : "https://dev.convos.org/v2";
          inviteUrl = `${baseUrl}?i=${encodeURIComponent(inviteSlug)}`;
        }
      }

      // Publish a ProfileUpdate at startup so this agent's identity (name,
      // memberKind, attestation) is visible to other members without an
      // out-of-band `update-profile` stdin nudge. Attach mode previously
      // emitted nothing here, so --attestation* flags were silently ignored.
      try {
        const profileName = flags["profile-name"] ?? identity.profileName;
        const attestation = await resolveAttestationFromFlags(flags, client.inboxId);
        const attestationMetadata = attestation
          ? (attestationToProfileMetadata(attestation) as ProfileMetadata)
          : undefined;

        if (profileName || attestationMetadata) {
          await sendProfileUpdate(group, {
            ...(profileName && { name: profileName }),
            memberKind: MemberKind.Agent,
            ...(attestationMetadata && { metadata: attestationMetadata }),
          });
        }
      } catch (error) {
        this.verboseWarn(
          `Could not send startup ProfileUpdate (attach): ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    } else {
      // ─── Create new conversation ───
      const permissionsMap: Record<string, GroupPermissionsOptions> = {
        "all-members": GroupPermissionsOptions.Default,
        "admin-only": GroupPermissionsOptions.AdminOnly,
      };

      const options: CreateGroupOptions = {
        groupName: flags.name,
        groupDescription: flags.description,
        permissions: permissionsMap[flags.permissions],
      };

      group = await client.conversations.createGroup([], options);
      conversationId = group.id;

      inviteTag = randomAlphanumeric(10);
      const conversationEmoji = emojiForIdentifier(group.id);

      const metadata = {
        tag: inviteTag,
        profiles: [] as never[],
        emoji: conversationEmoji,
      };

      await group.updateAppData(serializeAppData(metadata));

      try {
        const profileName = flags["profile-name"] ?? identity.profileName;
        const attestation = await resolveAttestationFromFlags(flags, client.inboxId);
        const attestationMetadata = attestation
          ? (attestationToProfileMetadata(attestation) as ProfileMetadata)
          : undefined;

        await sendProfileUpdate(group, {
          ...(profileName && { name: profileName }),
          memberKind: MemberKind.Agent,
          ...(attestationMetadata && { metadata: attestationMetadata }),
        });
      } catch (error) {
        // Non-fatal — but surface the failure on stderr so a misconfigured
        // attestation flag set doesn't silently produce an empty profile.
        this.verboseWarn(
          `Could not send startup ProfileUpdate: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }

      inviteSlug = await createInviteSlug(
        conversationId,
        client.inboxId,
        inviteTag,
        identity.walletKey,
        {
          name: flags.name || undefined,
          description: flags.description || undefined,
          emoji: conversationEmoji,
        },
      );

      const env = config.env ?? "dev";
      const baseUrl =
        env === "production"
          ? "https://popup.convos.org/v2"
          : "https://dev.convos.org/v2";
      inviteUrl = `${baseUrl}?i=${encodeURIComponent(inviteSlug)}`;
    }

    let qrCodePath: string | undefined;
    if (inviteUrl) {
      qrCodePath = join(tmpdir(), `convos-invite-${conversationId}.png`);
      await QRCode.toFile(qrCodePath, inviteUrl, {
        type: "png",
        width: 512,
        margin: 2,
      });
      process.stderr.write(`QR code saved to: ${qrCodePath}\n`);
      process.stderr.write(`Invite URL: ${inviteUrl}\n`);
    }

    this.emit({
      event: "ready",
      conversationId,
      identityId: identity.id,
      inboxId: client.inboxId,
      address: getAccountAddress(identity.walletKey),
      name: group.name ?? "",
      ...(inviteUrl && { inviteUrl }),
      ...(inviteSlug && { inviteSlug }),
      ...(inviteTag && { inviteTag }),
      ...(qrCodePath && { qrCodePath }),
      timestamp: new Date().toISOString(),
    });

    await this.processPendingJoinRequests(client, identity, conversationId);

    await this.startMessageStream(group, client);
    await this.startJoinRequestStream(client, identity, conversationId);
    this.startStdinReader(group, client, identity);

    if (flags.heartbeat && flags.heartbeat > 0) {
      this.startHeartbeat(flags.heartbeat, conversationId);
    }

    await new Promise<void>((resolve) => {
      this.shutdownResolve = resolve;

      process.on("SIGINT", () => {
        process.stderr.write("\nShutting down...\n");
        resolve();
      });

      process.on("SIGTERM", () => {
        process.stderr.write("\nShutting down...\n");
        resolve();
      });
    });

    await Promise.all(
      this.streams.map((stream) =>
        stream.return().catch((error: unknown) => {
          this.emitError(
            `Stream shutdown failed: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }),
      ),
    );
  }
}
