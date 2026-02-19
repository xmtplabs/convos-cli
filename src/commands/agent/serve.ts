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
import type { EncodedContent } from "@xmtp/node-bindings";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore, type Identity } from "../../utils/identities.js";
import {
  createInviteSlug,
  decryptConversationToken,
  parseInvite,
  verifyInvite,
  verifyInviteSignature,
} from "../../utils/invite.js";
import { getMimeType } from "../../utils/mime.js";
import { parseAppData, serializeAppData, upsertProfile } from "../../utils/metadata.js";
import { randomAlphanumeric } from "../../utils/random.js";
import {
  getUploadProvider,
  INLINE_ATTACHMENT_MAX_BYTES,
} from "../../utils/upload.js";
import {
  buildProfileMap,
  getAccountAddress,
  isDisplayableMessage,
  jsonStringify,
  normalizeMessageContent,
  requireGroup,
} from "../../utils/xmtp.js";

/**
 * Stdin command types the agent can send.
 */
interface SendCommand {
  type: "send";
  text: string;
  replyTo?: string;
}

interface ReactCommand {
  type: "react";
  messageId: string;
  emoji: string;
  action?: "add" | "remove";
}

interface AttachCommand {
  type: "attach";
  file: string;
  mimeType?: string;
  replyTo?: string;
}

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

interface RenameCommand {
  type: "rename";
  name: string;
}

interface LockCommand {
  type: "lock";
}

interface UnlockCommand {
  type: "unlock";
}

interface ExplodeCommand {
  type: "explode";
  scheduled?: string;
}

interface StopCommand {
  type: "stop";
}

export type AgentCommand = SendCommand | ReactCommand | AttachCommand | RemoteAttachCommand | RenameCommand | LockCommand | UnlockCommand | ExplodeCommand | StopCommand;

/**
 * Encode an ExplodeSettings message matching the iOS content type.
 *
 * Content type: convos.org/explode_settings:1.0
 * Payload: JSON-encoded { expiresAt: ISO8601 string }
 * Fallback: "Conversation expires at {date}"
 */
export function encodeExplodeSettings(expiresAt: Date): EncodedContent {
  const payload = JSON.stringify({
    expiresAt: expiresAt.toISOString(),
  });

  return {
    type: {
      authorityId: "convos.org",
      typeId: "explode_settings",
      versionMajor: 1,
      versionMinor: 0,
    },
    parameters: {},
    fallback: `Conversation expires at ${expiresAt.toISOString()}`,
    content: new TextEncoder().encode(payload),
  };
}

export default class AgentServe extends ConvosBaseCommand {
  static description = `Run an agent server for a conversation.

Starts a long-running process that combines message streaming,
join request processing, and stdin command handling into a single
session — ideal for AI agents and bots.

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
      description: "Profile display name for this conversation",
      helpValue: "<name>",
    }),
    identity: Flags.string({
      description: "Use an existing unlinked identity ID (when creating new)",
      helpValue: "<id>",
    }),
    label: Flags.string({
      description: "Local label for the identity",
      helpValue: "<label>",
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
  };

  private streams: AsyncStreamProxy<DecodedMessage>[] = [];
  private shutdownResolve?: () => void;
  private heartbeatInterval?: NodeJS.Timeout;
  /** Timestamp (ns) of the last message we emitted — used for catchup on reconnect. */
  private lastMessageTimestampNs: bigint = 0n;
  /** Timestamp (ns) of the last DM message we processed — used for catchup on reconnect. */
  private lastDmTimestampNs: bigint = 0n;
  /** IDs of recently emitted messages — used to deduplicate catchup vs live stream. */
  private recentMessageIds: Set<string> = new Set();
  /** Guards against concurrent catchup operations during connection flapping. */
  private isCatchingUpMessages = false;
  private isCatchingUpDms = false;
  /** Serializes command execution to prevent concurrent appData read-modify-write. */
  private commandQueue: Promise<void> = Promise.resolve();

  private static readonly MAX_RECENT_IDS = 1000;

  /**
   * Emit a JSON event to stdout (one line).
   */
  private emit(event: Record<string, unknown>): void {
    process.stdout.write(jsonStringify(event) + "\n");
  }

  /**
   * Emit an error event.
   */
  private emitError(message: string, details?: Record<string, unknown>): void {
    this.emit({ event: "error", message, ...details });
  }

  /**
   * Track a message ID as emitted. Returns false if already seen (duplicate).
   */
  private trackMessageId(id: string): boolean {
    if (this.recentMessageIds.has(id)) return false;
    this.recentMessageIds.add(id);
    // Evict oldest entries when the set grows too large
    if (this.recentMessageIds.size > AgentServe.MAX_RECENT_IDS) {
      const first = this.recentMessageIds.values().next().value!;
      this.recentMessageIds.delete(first);
    }
    return true;
  }

  /**
   * Process a single DM message as a potential join request.
   */
  private async processJoinMessage(
    message: DecodedMessage,
    client: Client,
    identity: Identity,
  ): Promise<{ conversationId: string; joinerInboxId: string } | undefined> {
    if (message.senderInboxId === client.inboxId) return;

    const text = typeof message.content === "string" ? message.content : null;
    if (!text) return;

    let invite;
    try {
      invite = parseInvite(text);
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
    if (dmConversation) dmConversation.updateConsentState(ConsentState.Allowed);

    return { conversationId, joinerInboxId: message.senderInboxId };
  }

  /**
   * Process any pending DM join requests (batch, on startup).
   */
  private async processPendingJoinRequests(
    client: Client,
    identity: Identity,
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
              const result = await this.processJoinMessage(message, client, identity);
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
   * Catch up on DM join requests that may have arrived while disconnected.
   * Guarded against concurrent invocations during connection flapping.
   */
  private async catchUpDmJoinRequests(
    client: Client,
    identity: Identity,
    sinceNs: bigint,
  ): Promise<void> {
    if (sinceNs === 0n) return;
    if (this.isCatchingUpDms) return;
    this.isCatchingUpDms = true;

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
              const sentAtNs = BigInt(message.sentAt.getTime()) * 1_000_000n;
              const result = await this.processJoinMessage(message, client, identity);
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
    } finally {
      this.isCatchingUpDms = false;
    }
  }

  /**
   * Start streaming DM messages for join request processing.
   */
  private async startJoinRequestStream(
    client: Client,
    identity: Identity,
  ): Promise<void> {
    try {
      const stream = await client.conversations.streamAllDmMessages({
        onRestart: () => {
          void this.catchUpDmJoinRequests(
            client,
            identity,
            this.lastDmTimestampNs,
          );
        },
      });
      this.streams.push(stream);

      (async () => {
        try {
          for await (const message of stream) {
            try {
              // Track last DM timestamp for catchup on reconnect
              const sentAtNs = BigInt(message.sentAt.getTime()) * 1_000_000n;
              if (sentAtNs > this.lastDmTimestampNs) {
                this.lastDmTimestampNs = sentAtNs;
              }

              const result = await this.processJoinMessage(message, client, identity);
              if (result) {
                this.emit({
                  event: "member_joined",
                  inboxId: result.joinerInboxId,
                  conversationId: result.conversationId,
                  timestamp: new Date().toISOString(),
                });
              }
            } catch {
              // skip individual message errors
            }
          }
        } catch {
          // stream ended
        }
      })();
    } catch (error) {
      this.emitError(
        `Failed to start join request stream: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /**
   * Fetch and emit any messages that arrived while the stream was disconnected.
   * Guarded against concurrent invocations during connection flapping.
   */
  private async catchUpMessages(
    conversation: Group,
    client: Client,
    sinceNs: bigint,
  ): Promise<void> {
    if (sinceNs === 0n) return;
    if (this.isCatchingUpMessages) return;
    this.isCatchingUpMessages = true;

    try {
      await conversation.sync();
      const missed = await conversation.messages({
        sentAfterNs: sinceNs,
        direction: SortDirection.Ascending,
      });

      for (const message of missed) {
        if (message.senderInboxId === client.inboxId) continue;
        if (!isDisplayableMessage(message)) continue;
        if (!this.trackMessageId(message.id)) continue;

        const sentAtNs = BigInt(message.sentAt.getTime()) * 1_000_000n;
        if (sentAtNs > this.lastMessageTimestampNs) {
          this.lastMessageTimestampNs = sentAtNs;
        }

        const profiles = buildProfileMap(conversation.appData ?? "");
        this.emit({
          event: "message",
          id: message.id,
          senderInboxId: message.senderInboxId,
          contentType: message.contentType,
          content: normalizeMessageContent(message, profiles),
          sentAt: message.sentAt.toISOString(),
          deliveryStatus: message.deliveryStatus,
          catchup: true,
        });
      }
    } catch (error) {
      this.emitError(
        `Failed to catch up messages: ${error instanceof Error ? error.message : "unknown"}`,
      );
    } finally {
      this.isCatchingUpMessages = false;
    }
  }

  /**
   * Start streaming conversation messages with reconnection catchup.
   */
  private async startMessageStream(
    conversation: Group,
    client: Client,
  ): Promise<void> {
    try {
      const stream = await conversation.stream({
        onRestart: () => {
          // On reconnect, fetch missed messages
          void this.catchUpMessages(
            conversation,
            client,
            this.lastMessageTimestampNs,
          );
        },
      });
      this.streams.push(stream);

      (async () => {
        try {
          for await (const message of stream) {
            // Skip our own messages (they get a "sent" event instead)
            if (message.senderInboxId === client.inboxId) continue;
            // Skip content types we can't display cleanly
            if (!isDisplayableMessage(message)) continue;
            // Skip if already emitted by catchup
            if (!this.trackMessageId(message.id)) continue;

            // Track last message timestamp for catchup on reconnect
            const sentAtNs = BigInt(message.sentAt.getTime()) * 1_000_000n;
            if (sentAtNs > this.lastMessageTimestampNs) {
              this.lastMessageTimestampNs = sentAtNs;
            }

            // Rebuild profiles each time so newly-joined members are resolved
            const profiles = buildProfileMap(conversation.appData ?? "");

            this.emit({
              event: "message",
              id: message.id,
              senderInboxId: message.senderInboxId,
              contentType: message.contentType,
              content: normalizeMessageContent(message, profiles),
              sentAt: message.sentAt.toISOString(),
              deliveryStatus: message.deliveryStatus,
            });
          }
        } catch {
          // stream ended
        }
      })();
    } catch (error) {
      this.emitError(
        `Failed to start message stream: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /**
   * Read and process stdin commands.
   */
  private async startStdinReader(
    conversation: Group,
    client: Client,
    identity: Identity,
  ): Promise<void> {
    // If stdin is a TTY, skip the reader (no piped input)
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

      // Serialize commands to prevent concurrent appData read-modify-write
      this.commandQueue = this.commandQueue.then(() =>
        this.handleCommand(cmd, conversation, client, identity),
      );
    });

    rl.on("close", () => {
      // stdin closed — trigger shutdown
      this.shutdown();
    });
  }

  /**
   * Handle a parsed stdin command.
   */
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

          // Also update the identity store label
          const store = createIdentityStore();
          store.update(identity.id, { label: cmd.name });

          this.emit({
            event: "sent",
            type: "rename",
            name: cmd.name,
            conversationId: conversation.id,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "lock": {
          // Step 1: Rotate the invite tag to invalidate all existing invites
          let appData = "";
          try {
            appData = conversation.appData ?? "";
          } catch {
            // no appData
          }
          const lockMetadata = parseAppData(appData);
          lockMetadata.tag = randomAlphanumeric(10);
          await conversation.updateAppData(serializeAppData(lockMetadata));

          // Step 2: Set addMember permission to deny
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
          // Rotate invite tag first
          let appData = "";
          try {
            appData = conversation.appData ?? "";
          } catch {
            // no appData
          }
          const unlockMetadata = parseAppData(appData);
          unlockMetadata.tag = randomAlphanumeric(10);
          await conversation.updateAppData(serializeAppData(unlockMetadata));

          // Restore addMember permission
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
          // Determine expiration time
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

          // Step 1: Send ExplodeSettings message
          const encodedContent = encodeExplodeSettings(expiresAt);
          await conversation.send(encodedContent, { shouldPush: true });

          // Step 2: Update group metadata with expiresAtUnix
          try {
            let appData = "";
            try {
              appData = conversation.appData ?? "";
            } catch {
              // no appData
            }
            const explodeMetadata = parseAppData(appData);
            explodeMetadata.expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
            await conversation.updateAppData(serializeAppData(explodeMetadata));
          } catch {
            // Non-fatal: metadata update is secondary to the message
          }

          if (isImmediate) {
            // Step 3: Remove all other members
            const members = await conversation.members();
            const others = members.filter((m) => m.inboxId !== client.inboxId);
            if (others.length > 0) {
              await conversation.removeMembers(others.map((m) => m.inboxId));
            }

            // Step 4: Delete local identity
            const store = createIdentityStore();
            store.remove(identity.id);

            this.emit({
              event: "sent",
              type: "explode",
              conversationId: conversation.id,
              identityDestroyed: identity.id,
              membersRemoved: others.length,
              expiresAt: expiresAt.toISOString(),
              timestamp: new Date().toISOString(),
            });

            // Explode triggers shutdown
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

  /**
   * Start emitting periodic heartbeat events.
   */
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

    // Don't let the heartbeat timer keep the process alive on its own
    this.heartbeatInterval.unref();
  }

  /**
   * Trigger graceful shutdown.
   */
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
    const store = createIdentityStore();

    let identity: Identity;
    let client: Client;
    let group: Group;
    let conversationId: string;
    let inviteUrl: string | undefined;
    let inviteSlug: string | undefined;
    let inviteTag: string | undefined;

    if (args.id) {
      // ─── Attach to existing conversation ───
      const existing = store.getByConversationId(args.id);
      if (!existing) {
        this.error(`No identity found for conversation: ${args.id}`);
      }
      identity = existing;
      client = await createClientForIdentity(identity, config);

      const conv = await client.conversations.getConversationById(args.id);
      if (!conv) {
        this.error(`Conversation not found: ${args.id}`);
      }
      group = requireGroup(conv);
      conversationId = args.id;

      // Generate invite unless --no-invite
      if (!flags["no-invite"]) {
        let appData = "";
        try {
          appData = group.appData ?? "";
        } catch {
          // no appData
        }
        let metadata = parseAppData(appData);
        inviteTag = metadata.tag;

        if (!inviteTag) {
          inviteTag = randomAlphanumeric(10);
          metadata = { ...metadata, tag: inviteTag };
          await group.updateAppData(serializeAppData(metadata));
        }

        inviteSlug = await createInviteSlug(
          conversationId,
          client.inboxId,
          inviteTag,
          identity.walletKey,
          {
            name: group.name || undefined,
            description: group.description || undefined,
          },
        );

        const env = config.env ?? "dev";
        const baseUrl =
          env === "production"
            ? "https://popup.convos.org/v2"
            : "https://dev.convos.org/v2";
        inviteUrl = `${baseUrl}?i=${encodeURIComponent(inviteSlug)}`;
      }
    } else {
      // ─── Create new conversation ───
      if (flags.identity) {
        const existing = store.get(flags.identity);
        if (!existing) this.error(`Identity not found: ${flags.identity}`);
        if (existing.conversationId) {
          this.error(
            `Identity ${flags.identity} is already linked to conversation ${existing.conversationId}`,
          );
        }
        identity = existing;
      } else {
        identity = store.create({
          label: flags.label ?? flags.name,
          profileName: flags["profile-name"],
        });
      }

      client = await createClientForIdentity(identity, config);

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

      store.update(identity.id, {
        conversationId,
        inboxId: client.inboxId,
        inviteTag,
        label: flags.label ?? flags.name ?? identity.label,
        profileName: flags["profile-name"] ?? identity.profileName,
      });

      // Store invite tag + profile in appData
      let metadata = {
        tag: inviteTag,
        profiles: [] as { inboxId: string; name?: string }[],
      };

      const profileName = flags["profile-name"];
      if (profileName) {
        metadata = upsertProfile(metadata, {
          inboxId: client.inboxId,
          name: profileName,
        });
      }

      await group.updateAppData(serializeAppData(metadata));

      // Generate invite
      inviteSlug = await createInviteSlug(
        conversationId,
        client.inboxId,
        inviteTag,
        identity.walletKey,
        {
          name: flags.name || undefined,
          description: flags.description || undefined,
        },
      );

      const env = config.env ?? "dev";
      const baseUrl =
        env === "production"
          ? "https://popup.convos.org/v2"
          : "https://dev.convos.org/v2";
      inviteUrl = `${baseUrl}?i=${encodeURIComponent(inviteSlug)}`;
    }

    // Generate QR code image (PNG) so agents can display it instantly
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

    // Emit ready event
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

    // Process any pending join requests from before we started
    await this.processPendingJoinRequests(client, identity);

    // Start all concurrent streams
    await this.startMessageStream(group, client);
    await this.startJoinRequestStream(client, identity);
    this.startStdinReader(group, client, identity);

    // Start heartbeat if configured
    if (flags.heartbeat && flags.heartbeat > 0) {
      this.startHeartbeat(flags.heartbeat, conversationId);
    }

    // Keep running until shutdown
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

    // Clean up streams
    for (const stream of this.streams) {
      void stream.return();
    }
  }
}
