import { Args, Flags } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { encodeExplodeSettings } from "../../utils/explodeSettings.js";
import { parseAppDataForWrite, serializeAppData } from "../../utils/metadata.js";

export default class ConversationExplode extends ConvosBaseCommand {
  static description = `Explode (permanently destroy) a conversation.

Sends an ExplodeSettings message to notify all members, updates the
group metadata with the expiration timestamp, and removes every other
member from the MLS group (per ADR 011 / ADR 004 C9 amendment).

Receiving clients drop the conversation locally on whichever arrives
first: the ExplodeSettings message or the MLS remove commit.

The install's identity is NOT destroyed — one identity now covers
every conversation on this install.

Only the conversation creator (super admin) can explode.`;

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
      ? "This will send ExplodeSettings and remove all other members from the group. " +
        "Members drop the conversation locally on whichever arrives first: the MLS " +
        "remove commit or the ExplodeSettings message. This install's identity is " +
        "preserved; the CLI cannot leave the group itself (node-sdk limitation)."
      : `This will schedule the conversation to explode at ${expiresAt.toISOString()}.\n` +
        "All members will be notified. When the time arrives, clients will destroy their local data.";

    await this.confirmAction(confirmMessage, flags.force);

    const client = await getClient(config, this.getConvosHome());
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
        this.verboseWarn("Could not read conversation appData during explode; treating as empty");
      }
      if (!appData) {
        this.verboseLog("Conversation appData is empty during explode metadata update");
      }
      const metadata = parseAppDataForWrite(appData);
      metadata.expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
      const newAppData = serializeAppData(metadata);
      await group.updateAppData(newAppData);
    } catch (error) {
      this.verboseWarn(
        `Skipping explode appData update: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    if (isImmediate) {
      // Step 3: Remove all other members
      const members = await group.members();
      const others = members.filter((m) => m.inboxId !== client.inboxId);
      if (others.length > 0) {
        await group.removeMembers(others.map((m) => m.inboxId));
      }

      this.output({
        success: true,
        conversationId: args.id,
        membersRemoved: others.length,
        expiresAt: expiresAt.toISOString(),
        message:
          "Conversation exploded. All other members removed. " +
          "This install's identity is preserved.",
      });
    } else {
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
