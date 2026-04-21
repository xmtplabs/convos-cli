import { Args } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";

export default class ConversationMembers extends ConvosBaseCommand {
  static description = `List members of a conversation.

Shows all members with their inbox IDs, identifiers, and permission levels.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "List members",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationMembers);
    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) {
      this.error(`Conversation not found: ${args.id}`);
    }

    const members = await conversation.members();
    this.output(
      members.map((m) => ({
        inboxId: m.inboxId,
        accountIdentifiers: m.accountIdentifiers,
        permissionLevel: m.permissionLevel,
      })),
    );
  }
}
