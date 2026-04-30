import { Args } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationAddAdmin extends ConvosBaseCommand {
  static description = `Promote members to admin by inbox ID. Requires super admin permissions.`;

  static strict = false;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args, argv } = await this.parse(ConversationAddAdmin);
    const inboxIds = (argv as string[]).slice(1);
    if (inboxIds.length === 0) this.error("At least one inbox ID is required");

    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());
    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);

    const promoted: string[] = [];
    for (const inboxId of inboxIds) {
      await group.addAdmin(inboxId);
      promoted.push(inboxId);
    }

    this.output({
      success: true,
      conversationId: args.id,
      promotedInboxIds: promoted,
      count: promoted.length,
      admins: group.listAdmins(),
      superAdmins: group.listSuperAdmins(),
    });
  }
}
