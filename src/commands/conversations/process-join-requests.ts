import { Flags } from "@oclif/core";
import { ConsentState, ConversationType } from "@xmtp/node-sdk";
import type { AsyncStreamProxy, Client, DecodedMessage, Dm } from "@xmtp/node-sdk";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore, type Identity } from "../../utils/identities.js";
import { parseInvite, decryptConversationToken, verifyInvite, verifyInviteSignature } from "../../utils/invite.js";
import { parseAppData } from "../../utils/metadata.js";

export default class ProcessJoinRequests extends ConvosBaseCommand {
  static description = `Process pending join requests for all conversations.

Scans DMs for each identity looking for join requests (text messages
containing signed invite slugs). When a valid join request is found:

1. Verify the invite signature
2. Decrypt the conversation token to get the conversation ID
3. Verify the creator inbox ID matches
4. Add the requester to the conversation
5. Block invalid/spam requests

Without --watch, processes all pending DMs and exits.
With --watch, streams DM messages in real-time and processes
join requests as they arrive (recommended for always-on usage).`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "Process all pending join requests",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --watch",
      description: "Continuously stream and process join requests in real-time",
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

  /**
   * Attempt to process a single DM message as a join request.
   * Returns the result if successfully processed, or undefined.
   */
  private async processMessage(
    message: DecodedMessage,
    client: Client,
    identity: Identity,
  ): Promise<{ conversationId: string; joinerInboxId: string; identityId: string; tag: string } | undefined> {
    // Skip our own messages
    if (message.senderInboxId === client.inboxId) return;

    // Try to parse as invite
    const text = typeof message.content === "string" ? message.content : null;
    if (!text) return;

    let invite;
    try {
      invite = parseInvite(text);
    } catch {
      return; // Not an invite, skip
    }

    // Look up the DM conversation to manage consent
    const dmConversation = await client.conversations.getConversationById(message.conversationId) as Dm | undefined;

    // Step 1: Verify structural validity and signature recoverability
    if (!(await verifyInvite(invite))) {
      this.log(`Invalid invite structure/signature from ${message.senderInboxId} — blocking DM`);
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    // Step 2: Verify the signature was made by this identity's wallet key
    if (!(await verifyInviteSignature(invite, identity.walletKey))) {
      this.log(`Invite signature doesn't match our wallet key — blocking DM`);
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    // Step 3: Verify creator inbox ID matches us
    if (invite.creatorInboxId !== client.inboxId) {
      this.log(`Invite not for this inbox — blocking DM`);
      if (dmConversation) dmConversation.updateConsentState(ConsentState.Denied);
      return;
    }

    // Step 4: Check expiration
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      this.log(`Invite expired — skipping`);
      return;
    }

    // Step 5: Decrypt conversation token
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

    // Step 6: Verify conversation exists
    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) {
      this.log(`Conversation ${conversationId} not found — skipping`);
      return;
    }

    const group = requireGroup(conversation);

    // Step 7: Verify the invite tag matches the group's current tag
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

    // Step 8: Add the requester
    this.log(
      `Adding ${message.senderInboxId} to conversation ${conversationId}`,
    );
    await group.addMembers([message.senderInboxId]);

    // Mark DM as allowed so we don't re-process
    if (dmConversation) dmConversation.updateConsentState(ConsentState.Allowed);

    return {
      conversationId,
      joinerInboxId: message.senderInboxId,
      identityId: identity.id,
      tag: invite.tag,
    };
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ProcessJoinRequests);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

    const identities = flags.conversation
      ? [store.getByConversationId(flags.conversation)].filter(Boolean)
      : store.list().filter((i) => i.conversationId);

    if (identities.length === 0) {
      this.output({ message: "No linked identities found.", processed: 0 });
      return;
    }

    // ─── Batch mode: process all pending DMs ───

    const allResults = [];

    // Build clients for all identities (needed for both batch and watch)
    const clientMap = new Map<string, { client: Client; identity: Identity }>();

    for (const identity of identities) {
      if (!identity) continue;
      try {
        const client = await createClientForIdentity(identity, config);
        clientMap.set(identity.id, { client, identity });
      } catch (error) {
        this.log(
          `Error initializing identity ${identity.id}: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    for (const [, { client, identity }] of clientMap) {
      try {
        await client.conversations.sync();

        // List DMs with unknown consent (potential join requests)
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
                const result = await this.processMessage(message, client, identity);
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
      } catch (error) {
        this.log(
          `Error with identity ${identity.id}: ${error instanceof Error ? error.message : "unknown"}`,
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

    // Build an inboxId → { client, identity } lookup so we can route
    // streamed messages to the correct identity
    const inboxMap = new Map<string, { client: Client; identity: Identity }>();
    for (const [, entry] of clientMap) {
      inboxMap.set(entry.client.inboxId, entry);
    }

    // Start a DM message stream for each identity
    const streams: AsyncStreamProxy<DecodedMessage>[] = [];
    for (const [, { client, identity }] of clientMap) {
      try {
        const stream = await client.conversations.streamAllDmMessages();
        streams.push(stream);

        // Process messages from this stream in the background
        (async () => {
          try {
            for await (const message of stream) {
              try {
                const result = await this.processMessage(message, client, identity);
                if (result) {
                  this.streamOutput({
                    event: "join_request_accepted",
                    ...result,
                    timestamp: new Date().toISOString(),
                  });
                }
              } catch (error) {
                this.log(
                  `Error processing streamed message: ${error instanceof Error ? error.message : "unknown"}`,
                );
              }
            }
          } catch (error) {
            this.log(
              `Stream ended for identity ${identity.id}: ${error instanceof Error ? error.message : "unknown"}`,
            );
          }
        })();
      } catch (error) {
        this.log(
          `Failed to start stream for identity ${identity.id}: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    // Keep running until interrupted
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        this.log("\nStopping streams...");
        for (const stream of streams) {
          void stream.return();
        }
        resolve();
      });
    });
  }
}
