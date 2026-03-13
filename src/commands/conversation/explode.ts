import { Args, Flags } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { parseAppData, serializeAppData } from "../../utils/metadata.js";
import type { EncodedContent } from "@xmtp/node-bindings";

/**
 * Encode an ExplodeSettings message matching the iOS content type.
 *
 * Content type: convos.org/explode_settings:1.0
 * Payload: JSON-encoded { expiresAt: ISO8601 string }
 * Fallback: "Conversation expires at {date}"
 */
function encodeExplodeSettings(expiresAt: Date): EncodedContent {
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

export default class ConversationExplode extends ConvosBaseCommand {
  static description = `Explode (permanently destroy) a conversation.

Sends an ExplodeSettings message to notify all members, updates the
group metadata with the expiration timestamp, removes all members,
then deletes the local identity including wallet key, database
encryption key, and XMTP database. This is irreversible.

Per ADR 004: destroying the per-conversation identity destroys the
cryptographic material needed to decrypt messages. Recovery is
impossible.

Steps:
1. Send ExplodeSettings message (notifies iOS/other clients)
2. Update group metadata with expiresAtUnix
3. Remove all other members from the XMTP group
4. Delete the local identity (private keys + database)

Only the conversation creator (super admin) should explode.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id> --force",
      description: "Explode a conversation immediately",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --scheduled "2025-03-01T00:00:00Z"',
      description: "Schedule a conversation to explode at a specific time",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    force: Flags.boolean({
      char: "f",
      description: "Skip confirmation prompt",
      default: false,
    }),
    scheduled: Flags.string({
      description:
        "Schedule explosion for a future date (ISO8601). If omitted, explodes immediately.",
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationExplode);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    // Determine expiration time
    let expiresAt: Date;
    if (flags.scheduled) {
      expiresAt = new Date(flags.scheduled);
      if (isNaN(expiresAt.getTime())) {
        this.error(`Invalid date: ${flags.scheduled}`);
      }
      if (expiresAt <= new Date()) {
        this.error("Scheduled date must be in the future");
      }
    } else {
      expiresAt = new Date();
    }

    const isImmediate = !flags.scheduled;
    const confirmMessage = isImmediate
      ? "This will permanently destroy the conversation and delete all cryptographic keys.\n" +
        "All members will be removed. Messages cannot be recovered."
      : `This will schedule the conversation to explode at ${expiresAt.toISOString()}.\n` +
        "All members will be notified. When the time arrives, clients will destroy their local data.";

    await this.confirmAction(confirmMessage, flags.force);

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(
      args.id,
    );
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);

    // Step 1: Send ExplodeSettings message (must happen before removing members)
    const encodedContent = encodeExplodeSettings(expiresAt);
    await group.send(encodedContent, { shouldPush: true });

    // Step 2: Update group metadata with expiresAtUnix
    try {
      let appData = "";
      try {
        appData = group.appData ?? "";
      } catch {
        // No appData yet
      }
      const metadata = parseAppData(appData);
      metadata.expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
      const newAppData = serializeAppData(metadata);
      await group.updateAppData(newAppData);
    } catch {
      // Non-fatal: metadata update is secondary to the message
    }

    if (isImmediate) {
      // Step 3: Remove all other members
      const members = await group.members();
      const others = members.filter((m) => m.inboxId !== client.inboxId);
      if (others.length > 0) {
        await group.removeMembers(others.map((m) => m.inboxId));
      }

      // Step 4: Delete local identity
      store.remove(identity.id);

      this.output({
        success: true,
        conversationId: args.id,
        identityDestroyed: identity.id,
        membersRemoved: others.length,
        expiresAt: expiresAt.toISOString(),
        message: "Conversation exploded. All cryptographic keys destroyed.",
      });
    } else {
      // Scheduled: don't remove members or destroy identity yet
      this.output({
        success: true,
        conversationId: args.id,
        scheduled: true,
        expiresAt: expiresAt.toISOString(),
        message: `Conversation scheduled to explode at ${expiresAt.toISOString()}. All members have been notified.`,
      });
    }
  }
}
