import { Args } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";

export default class ConversationUpdateDescription extends ConvosBaseCommand {
  static description = `Update the description of a conversation.`;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
    description: Args.string({ description: "The new description", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationUpdateDescription);
    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);
    await group.updateDescription(args.description);

    this.output({ success: true, conversationId: args.id, description: args.description });
  }
}
