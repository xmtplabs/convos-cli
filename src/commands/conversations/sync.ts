import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationsSync extends ConvosBaseCommand {
  static description = `Sync all conversations from the network.

Fetches new messages and membership changes for every conversation
in this install's singleton XMTP inbox (per ADR 011).`;

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
    const store = createIdentityStore(this.getConvosHome());

    if (!store.exists()) {
      this.output({
        message: "No identity found. Nothing to sync.",
        synced: 0,
      });
      return;
    }

    const client = await getClient(config, this.getConvosHome());
    await client.conversations.sync();
    const conversations = await client.conversations.list();

    this.output({
      synced: conversations.length,
      inboxId: client.inboxId,
    });
  }
}
