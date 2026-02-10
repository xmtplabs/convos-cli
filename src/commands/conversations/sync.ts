import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationsSync extends ConvosBaseCommand {
  static description = `Sync all conversations from the network.

Synchronizes every linked identity with the XMTP network.
Fetches new messages and membership changes for all conversations.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "Sync all conversations",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const config = this.getConvosConfig();
    const store = createIdentityStore();
    const identities = store.list().filter((i) => i.conversationId);

    const results = [];
    for (const identity of identities) {
      try {
        const client = await createClientForIdentity(identity, config);
        await client.conversations.sync();
        results.push({
          identityId: identity.id,
          conversationId: identity.conversationId,
          label: identity.label ?? "",
          success: true,
        });
      } catch (error) {
        results.push({
          identityId: identity.id,
          conversationId: identity.conversationId,
          label: identity.label ?? "",
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    this.output({
      synced: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  }
}
