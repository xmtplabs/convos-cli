import { Args, Flags } from "@oclif/core";
import { SortDirection } from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import {
  getExplodeSettingsContent,
  isExplodeSettingsMessage,
} from "../../utils/explodeSettings.js";
import { parseAppData } from "../../utils/metadata.js";
import { requireGroup } from "../../utils/xmtp.js";

export default class ConversationExplodeStatus extends ConvosBaseCommand {
  static description = `Show the explode status of a conversation.

Dumps the expiration timestamp from group metadata and the most recent
ExplodeSettings message (if any). Useful for verifying that a scheduled
or immediate explode was recorded correctly, and for interop tests that
need to confirm what a peer observed.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "Show explode state (appData + most recent ExplodeSettings)",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> --sync --json",
      description: "Sync from network first; machine-readable output",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    sync: Flags.boolean({
      description: "Sync the conversation from network before reading",
      default: false,
    }),
    limit: Flags.integer({
      description: "Max messages to scan for ExplodeSettings (default 50)",
      default: 50,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationExplodeStatus);
    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    if (flags.sync) await conversation.sync();

    const group = requireGroup(conversation);

    let expiresAtUnix: number | undefined;
    try {
      const appData = group.appData ?? "";
      const metadata = parseAppData(appData);
      expiresAtUnix = metadata.expiresAtUnix;
    } catch {
      // no appData
    }

    const messages = await group.messages({
      direction: SortDirection.Descending,
      limit: flags.limit,
    });

    let mostRecent:
      | {
          messageId: string;
          senderInboxId: string;
          expiresAt: string;
          sentAt: string;
        }
      | undefined;
    for (const message of messages) {
      if (!isExplodeSettingsMessage(message)) continue;
      const content = getExplodeSettingsContent(message);
      if (!content) continue;
      mostRecent = {
        messageId: message.id,
        senderInboxId: message.senderInboxId,
        expiresAt: content.expiresAt,
        sentAt: message.sentAt.toISOString(),
      };
      break; // messages are descending → first match is most recent
    }

    const now = new Date();
    const appDataExpiresAt =
      expiresAtUnix != null ? new Date(expiresAtUnix * 1000) : undefined;
    const messageExpiresAt = mostRecent
      ? new Date(mostRecent.expiresAt)
      : undefined;
    const effectiveExpiresAt = messageExpiresAt ?? appDataExpiresAt;

    this.output({
      conversationId: args.id,
      isActive: conversation.isActive,
      appData: {
        expiresAtUnix: expiresAtUnix ?? null,
        expiresAt: appDataExpiresAt?.toISOString() ?? null,
      },
      mostRecentExplodeSettings: mostRecent ?? null,
      effectiveExpiresAt: effectiveExpiresAt?.toISOString() ?? null,
      expired:
        effectiveExpiresAt != null && effectiveExpiresAt <= now ? true : false,
      scannedMessages: messages.length,
    });
  }
}
