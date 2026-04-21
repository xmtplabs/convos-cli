import { Args } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";

export default class ConversationSync extends ConvosBaseCommand {
  static description = `Sync a specific conversation from the network.`;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationSync);
    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    await conversation.sync();
    this.output({ success: true, conversationId: args.id });
  }
}
