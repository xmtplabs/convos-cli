import { Args } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationAddMembers extends ConvosBaseCommand {
  static description = `Add members to a conversation by inbox ID.

Low-level member addition. In Convos, members typically join via
invite links instead. Requires super admin permissions.`;

  static strict = false;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, argv } = await this.parse(ConversationAddMembers);
    const inboxIds = (argv as string[]).slice(1);
    if (inboxIds.length === 0) this.error("At least one inbox ID is required");

    const config = this.getConvosConfig();
    const store = createIdentityStore();
    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    const client = await createClientForIdentity(identity, config);
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);
    await group.addMembers(inboxIds);

    this.output({
      success: true,
      conversationId: args.id,
      addedInboxIds: inboxIds,
      count: inboxIds.length,
    });
  }
}
