import { Args, Flags } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationExplode extends ConvosBaseCommand {
  static description = `Explode (permanently destroy) a conversation.

Removes all members, then deletes the local identity including wallet
key, database encryption key, and XMTP database. This is IRREVERSIBLE.

Per ADR 004: destroying the per-conversation identity destroys the
cryptographic material needed to decrypt messages. Recovery is
impossible.

Steps:
1. Remove all other members from the XMTP group
2. Delete the local identity (private keys + database)

Only the conversation creator (super admin) should explode.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id> --force",
      description: "Explode a conversation",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    force: Flags.boolean({
      char: "f",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationExplode);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    await this.confirmAction(
      "This will PERMANENTLY DESTROY the conversation and delete all cryptographic keys.\n" +
        "All members will be removed. Messages cannot be recovered.",
      flags.force,
    );

    const client = await createClientForIdentity(identity, config);
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);
    const members = await group.members();
    const others = members.filter((m) => m.inboxId !== client.inboxId);

    if (others.length > 0) {
      await group.removeMembers(others.map((m) => m.inboxId));
    }

    store.remove(identity.id);

    this.output({
      success: true,
      conversationId: args.id,
      identityDestroyed: identity.id,
      membersRemoved: others.length,
      message: "Conversation exploded. All cryptographic keys destroyed.",
    });
  }
}
