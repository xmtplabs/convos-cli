import { Args } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";

export default class ConversationPermissions extends ConvosBaseCommand {
  static description = `View permissions for a conversation.`;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationPermissions);
    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);
    const permissions = group.permissions();

    this.output({
      conversationId: args.id,
      policyType: permissions.policyType,
      policySet: permissions.policySet,
      admins: group.listAdmins(),
      superAdmins: group.listSuperAdmins(),
    });
  }
}
