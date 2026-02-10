import { Flags } from "@oclif/core";
import { getAccountAddress } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationsList extends ConvosBaseCommand {
  static description = `List all Convos conversations.

Lists conversations across all per-conversation identities.
Each conversation is associated with its own XMTP identity.

Use --sync to fetch the latest state from the network.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "List all conversations",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --sync",
      description: "Sync from network then list",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --json",
      description: "Output as JSON",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    sync: Flags.boolean({
      description: "Sync each identity from network before listing",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConversationsList);
    const config = this.getConvosConfig();
    const store = createIdentityStore();
    const identities = store.list().filter((i) => i.conversationId);

    if (identities.length === 0) {
      this.output({
        message:
          "No conversations found. Create one with: convos conversations create",
        count: 0,
      });
      return;
    }

    const output = [];

    for (const identity of identities) {
      try {
        const client = await createClientForIdentity(identity, config);
        if (flags.sync) {
          await client.conversations.sync();
        }
        const conversations = await client.conversations.list();

        for (const conversation of conversations) {
          const members = await conversation.members();
          output.push({
            conversationId: conversation.id,
            identityId: identity.id,
            label: identity.label ?? "",
            profileName: identity.profileName ?? "",
            address: getAccountAddress(identity.walletKey),
            createdAt: conversation.createdAt.toISOString(),
            memberCount: members.length,
            isActive: conversation.isActive,
          });
        }
      } catch (error) {
        output.push({
          conversationId: identity.conversationId,
          identityId: identity.id,
          label: identity.label ?? "",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    this.output(output);
  }
}
