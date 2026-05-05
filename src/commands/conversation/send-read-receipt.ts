import { Args } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { requireGroup } from "../../utils/xmtp.js";

export default class ConversationSendReadReceipt extends ConvosBaseCommand {
  static description = `Send a read receipt to a conversation.

Notifies other members that you have read the latest messages.
Read receipts are silent — they do not appear as messages in the
conversation and do not trigger push notifications.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "Send a read receipt",
    },
  ];

  static args = {
    id: Args.string({
      description: "The conversation ID",
      required: true,
    }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationSendReadReceipt);
    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());
    await client.conversations.sync();

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);
    const messageId = await group.sendReadReceipt();

    this.output({
      success: true,
      messageId,
      conversationId: args.id,
    });
  }
}
