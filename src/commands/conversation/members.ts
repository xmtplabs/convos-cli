import { Args } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

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
    const store = createIdentityStore(this.getConvosHome());

    const identity = store.getByConversationId(args.id);
    if (!identity) {
      this.error(`No identity found for conversation: ${args.id}`);
    }

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
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
