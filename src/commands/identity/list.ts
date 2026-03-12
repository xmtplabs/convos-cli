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
    const store = createIdentityStore(this.getConvosHome());
    const identities = store.list();

    if (identities.length === 0) {
      this.output({
        message:
          "No identities found. Create one with: convos identity create",
        count: 0,
      });
      return;
    }

    // Detect duplicate identities per conversation
    const convCounts = new Map<string, number>();
    for (const identity of identities) {
      if (identity.conversationId) {
        convCounts.set(
          identity.conversationId,
          (convCounts.get(identity.conversationId) ?? 0) + 1,
        );
      }
    }

    const output = identities.map((identity) => ({
      id: identity.id,
      address: getAccountAddress(identity.walletKey),
      inboxId: identity.inboxId ?? "(not yet registered)",
      conversationId: identity.conversationId ?? "(unlinked)",
      inviteTag: identity.inviteTag ?? "",
      label: identity.label ?? "",
      profileName: identity.profileName ?? "",
      createdAt: identity.createdAt,
      ...(identity.conversationId &&
      (convCounts.get(identity.conversationId) ?? 0) > 1
        ? { duplicate: true }
        : {}),
    }));

    this.output(output);
  }
}
