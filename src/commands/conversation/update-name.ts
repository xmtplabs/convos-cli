import { Args } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationUpdateName extends ConvosBaseCommand {
  static description = `Update the name of a conversation. Visible to all members.`;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
    name: Args.string({ description: "The new name", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationUpdateName);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);
    await group.updateName(args.name);
    store.update(identity.id, { label: args.name });

    this.output({ success: true, conversationId: args.id, name: args.name });
  }
}
