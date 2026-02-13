import { Flags } from "@oclif/core";
import { getAccountAddress, isGroup } from "../../utils/xmtp.js";
import { PermissionPolicy } from "@xmtp/node-bindings";
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
    const allLinked = store.list().filter((i) => i.conversationId);

    // Deduplicate: only use the oldest identity per conversation ID
    const seen = new Map<string, boolean>();
    const identities = [];
    // list() is sorted newest-first, so iterate in reverse to pick oldest first
    for (let i = allLinked.length - 1; i >= 0; i--) {
      const identity = allLinked[i];
      const convId = identity.conversationId!;
      if (!seen.has(convId)) {
        seen.set(convId, true);
        identities.push(identity);
      }
    }

    // Warn about duplicate identities for the same conversation
    const duplicates = new Map<string, number>();
    for (const identity of allLinked) {
      const convId = identity.conversationId!;
      duplicates.set(convId, (duplicates.get(convId) ?? 0) + 1);
    }
    for (const [convId, count] of duplicates) {
      if (count > 1) {
        this.warn(
          `${count} identities found for conversation ${convId}. ` +
            `Run 'convos identity list' to review and remove duplicates.`,
        );
      }
    }

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
          let isLocked = false;
          if (isGroup(conversation)) {
            const { policySet } = conversation.permissions();
            isLocked = policySet.addMemberPolicy === PermissionPolicy.Deny;
          }
          output.push({
            conversationId: conversation.id,
            identityId: identity.id,
            label: identity.label ?? "",
            profileName: identity.profileName ?? "",
            address: getAccountAddress(identity.walletKey),
            createdAt: conversation.createdAt.toISOString(),
            memberCount: members.length,
            isActive: conversation.isActive,
            isLocked,
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
