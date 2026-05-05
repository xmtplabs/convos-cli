import { Args } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";

export default class ConversationRemoveMembers extends ConvosBaseCommand {
  static description = `Remove members from a conversation. Requires super admin permissions.`;

  static strict = false;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, argv } = await this.parse(ConversationRemoveMembers);
    const inboxIds = (argv as string[]).slice(1);
    if (inboxIds.length === 0) this.error("At least one inbox ID is required");

    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);
    await group.removeMembers(inboxIds);

    this.output({
      success: true,
      conversationId: args.id,
      removedInboxIds: inboxIds,
      count: inboxIds.length,
    });
  }
}
