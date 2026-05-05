import { Flags } from "@oclif/core";
import { ConsentState, ConversationType, SortDirection } from "@xmtp/node-sdk";
import type { Client, DecodedMessage, Dm } from "@xmtp/node-sdk";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getIdentityAndClient } from "../../utils/client.js";
import type { Identity } from "../../utils/identities.js";
import { parseInvite, decryptConversationToken, verifyInvite, verifyInviteSignature } from "../../utils/invite.js";
import { parseAppData } from "../../utils/metadata.js";
import { sendProfileSnapshot } from "../../utils/profileMessages.js";
import {
  isJoinRequestMessage,
  getJoinRequestContent,
  type JoinRequestProfile,
} from "../../utils/joinRequest.js";

export default class ProcessJoinRequests extends ConvosBaseCommand {
  /** Timestamp (ns) of the last DM message we processed — used for onRestart catchup. */
  private lastDmTimestampNs: bigint = 0n;
  private isCatchingUp = false;
  private isCatchupPending = false;
  /** IDs of DM messages we've already fully processed — prevents the batch
   *  pass and the live stream from double-firing for the same invite. */
  private processedMessageIds: Set<string> = new Set();
  private static readonly MAX_PROCESSED_IDS = 1000;

  /** Returns true the first time we see `id`; false on duplicate. */
  private markProcessed(id: string): boolean {
    if (this.processedMessageIds.has(id)) return false;
    this.processedMessageIds.add(id);
    if (this.processedMessageIds.size > ProcessJoinRequests.MAX_PROCESSED_IDS) {
      const oldest = this.processedMessageIds.values().next().value!;
      this.processedMessageIds.delete(oldest);
    }
    return true;
  }

  static description = `Process pending join requests for this install's conversations.

Scans DMs addressed to this install's singleton inbox for signed
invite slugs. When a valid join request is found:

1. Verify the invite signature
2. Decrypt the conversation token to get the conversation ID
3. Verify the creator inbox ID matches this install
4. Add the requester to the conversation
5. Send a ProfileSnapshot so the joiner has everyone's profile
6. Block invalid/spam requests

Without --watch, processes all pending DMs and exits.
With --watch, streams DM messages in real-time (recommended for
always-on usage).`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "Process all pending join requests",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --watch",
      description: "Continuously stream and process join requests",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> --conversation <id>",
      description: "Process join requests for a specific conversation only",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    watch: Flags.boolean({
      description: "Stream DM messages in real-time and process join requests as they arrive",
      default: false,
    }),
    conversation: Flags.string({
      description: "Only process requests for this conversation ID",
      helpValue: "<id>",
    }),
  };

  private async processMessage(
    message: DecodedMessage,
    client: Client,
    identity: Identity,
    filterConversationId?: string,
  ): Promise<{
    conversationId: string;
    joinerInboxId: string;
    tag: string;
    profile?: JoinRequestProfile;
    metadata?: Record<string, string>;
  } | undefined> {
    if (message.senderInboxId === client.inboxId) return;
    if (!this.markProcessed(message.id)) return;

    let slug: string | undefined;
    let joinProfile: JoinRequestProfile | undefined;
    let joinMetadata: Record<string, string> | undefined;

    if (isJoinRequestMessage(message)) {
      const joinRequest = getJoinRequestContent(message);
      if (joinRequest) {
        slug = joinRequest.inviteSlug;
        joinProfile = joinRequest.profile;
        joinMetadata = joinRequest.metadata;
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

    const dmConversation = await client.conversations.getConversationById(message.conversationId) as Dm | undefined;

    if (!(await verifyInvite(invite))) {
      this.log(`Invalid invite structure/signature from ${message.senderInboxId} — blocking DM`);
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    if (!(await verifyInviteSignature(invite, identity.walletKey))) {
      this.log(`Invite signature doesn't match our wallet key — blocking DM`);
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    if (invite.creatorInboxId !== client.inboxId) {
      this.log(`Invite not for this inbox — blocking DM`);
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      this.log(`Invite expired — skipping`);
      return;
    }

    let conversationId: string;
    try {
      conversationId = decryptConversationToken(
        invite.conversationToken,
        client.inboxId,
        Buffer.from(identity.walletKey.replace("0x", ""), "hex"),
      );
    } catch {
      this.log(`Failed to decrypt conversation token — blocking DM`);
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    if (filterConversationId && conversationId !== filterConversationId) {
      return;
    }

    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) {
      this.log(`Conversation ${conversationId} not found — skipping`);
      return;
    }

    const group = requireGroup(conversation);

    try {
      const appData = group.appData ?? "";
      const metadata = parseAppData(appData);
      if (metadata.tag && invite.tag !== metadata.tag) {
        this.log(`Invite tag mismatch (invite=${invite.tag}, group=${metadata.tag}) — rejecting`);
        return;
      }
    } catch {
      // If we can't read appData, skip tag check but continue
    }

    this.log(`Adding ${message.senderInboxId} to conversation ${conversationId}`);
    await group.addMembers([message.senderInboxId]);

    try {
      const allMembers = await group.members();
      const allMemberInboxIds = allMembers.map((m) => m.inboxId);
      await sendProfileSnapshot(group, allMemberInboxIds);
      this.log(`Sent ProfileSnapshot after adding member to ${conversationId}`);
    } catch (error) {
      this.log(
        `Warning: Failed to send ProfileSnapshot: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    if (dmConversation) dmConversation.updateConsentState(ConsentState.Allowed);

    return {
      conversationId,
      joinerInboxId: message.senderInboxId,
      tag: invite.tag,
      ...(joinProfile && { profile: joinProfile }),
      ...(joinMetadata && { metadata: joinMetadata }),
    };
  }

  /**
   * Schedule a DM catchup after a stream restart. Coalesces concurrent restarts:
   * a call during an in-flight catchup sets a pending flag so one more pass runs
   * after the current one completes.
   */
  private scheduleCatchup(
    client: Client,
    identity: Identity,
    filterConversationId: string | undefined,
  ): void {
    if (this.isCatchingUp) {
      this.isCatchupPending = true;
      return;
    }
    this.isCatchingUp = true;
    void (async () => {
      try {
        do {
          this.isCatchupPending = false;
          await this.catchUp(client, identity, filterConversationId, this.lastDmTimestampNs);
        } while (this.isCatchupPending);
      } finally {
        this.isCatchingUp = false;
      }
    })();
  }

  private async catchUp(
    client: Client,
    identity: Identity,
    filterConversationId: string | undefined,
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
              // Advance the watermark before processMessage so a window full
              // of invalid invites (filtered, malformed, duplicates) doesn't
              // get re-queried on every reconnect — `processedMessageIds` is
              // capped at 1000 and would eventually evict, risking duplicate
              // processing. Mirrors the batch/stream paths below.
              const sentAtNs = message.sentAtNs;
              if (sentAtNs > this.lastDmTimestampNs) {
                this.lastDmTimestampNs = sentAtNs;
              }
              const result = await this.processMessage(
                message,
                client,
                identity,
                filterConversationId,
              );
              if (result) {
                this.streamOutput({
                  event: "join_request_accepted",
                  ...result,
                  timestamp: new Date().toISOString(),
                  catchup: true,
                });
                break;
              }
            } catch (error) {
              this.log(
                `Error processing catchup message: ${error instanceof Error ? error.message : "unknown"}`,
              );
            }
          }
        } catch (error) {
          this.log(
            `Error processing catchup DM: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }
    } catch (error) {
      this.log(
        `Failed to catch up join requests: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ProcessJoinRequests);
    const config = this.getConvosConfig();

    const { identity, client } = await getIdentityAndClient(
      config,
      this.getConvosHome(),
    );

    // ─── Batch mode: process all pending DMs ───

    const allResults = [];
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
            // Track the batch high-water mark so an onRestart fired before
            // any live-stream message arrives still has a non-zero sinceNs
            // for catchup to work against.
            const sentAtNs = message.sentAtNs;
            if (sentAtNs > this.lastDmTimestampNs) {
              this.lastDmTimestampNs = sentAtNs;
            }
            const result = await this.processMessage(
              message,
              client,
              identity,
              flags.conversation,
            );
            if (result) {
              allResults.push(result);
              break; // Only process first valid invite per DM
            }
          } catch (error) {
            this.log(
              `Error processing message: ${error instanceof Error ? error.message : "unknown"}`,
            );
          }
        }
      } catch (error) {
        this.log(
          `Error processing DM: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    if (!flags.watch) {
      this.output({
        processed: allResults.length,
        results: allResults,
      });
      return;
    }

    // ─── Watch mode: stream DM messages in real-time ───

    if (allResults.length > 0) {
      this.log(`\nProcessed ${allResults.length} pending request(s).`);
    }

    this.log("\nStreaming DM messages for join requests (Ctrl+C to stop)...\n");
    this.streamOutput({
      event: "stream_started",
      timestamp: new Date().toISOString(),
    });

    const stream = await client.conversations.streamAllDmMessages({
      onRestart: () => {
        this.streamOutput({
          event: "stream_restarted",
          timestamp: new Date().toISOString(),
        });
        this.scheduleCatchup(client, identity, flags.conversation);
      },
    });

    (async () => {
      try {
        for await (const message of stream) {
          try {
            const sentAtNs = message.sentAtNs;
            if (sentAtNs > this.lastDmTimestampNs) {
              this.lastDmTimestampNs = sentAtNs;
            }
            this.verboseLog(
              `DM received: id=${message.id} from=${message.senderInboxId} contentType=${message.contentType.authorityId}/${message.contentType.typeId}`,
            );
            const result = await this.processMessage(
              message,
              client,
              identity,
              flags.conversation,
            );
            if (result) {
              this.streamOutput({
                event: "join_request_accepted",
                ...result,
                timestamp: new Date().toISOString(),
              });
            }
          } catch (error) {
            this.streamOutput({
              event: "error",
              message: `Error processing streamed message: ${error instanceof Error ? error.message : "unknown"}`,
              messageId: message.id,
              timestamp: new Date().toISOString(),
            });
          }
        }
        this.streamOutput({
          event: "stream_ended",
          reason: "iterator_exhausted",
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        this.streamOutput({
          event: "stream_ended",
          reason: error instanceof Error ? error.message : "unknown",
          timestamp: new Date().toISOString(),
        });
      }
    })();

    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        this.log("\nStopping stream...");
        resolve();
      });
    });

    try {
      await stream.return();
    } catch (error) {
      this.log(
        `Stream shutdown failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
}
