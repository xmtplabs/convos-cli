import { getAccountAddress } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class IdentityList extends ConvosBaseCommand {
  static description = `List all Convos identities.

Each Convos conversation uses its own XMTP identity (inbox) for privacy.
This command shows all identities, including which conversation each is
linked to.

Identities without a conversation ID are "unlinked" — available for
use with new conversations.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "List all identities",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --json",
      description: "Output as JSON",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const store = createIdentityStore();
    const identities = store.list();

    if (identities.length === 0) {
      this.output({
        message:
          "No identities found. Create one with: convos identity create",
        count: 0,
      });
      return;
    }

    const output = identities.map((identity) => ({
      id: identity.id,
      address: getAccountAddress(identity.walletKey),
      inboxId: identity.inboxId ?? "(not yet registered)",
      conversationId: identity.conversationId ?? "(unlinked)",
      label: identity.label ?? "",
      profileName: identity.profileName ?? "",
      createdAt: identity.createdAt,
    }));

    this.output(output);
  }
}
