import { Args } from "@oclif/core";
import { getAccountAddress, isGroup, formatSections } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationInfo extends ConvosBaseCommand {
  static description = `Get detailed information about a conversation.

Resolves the per-conversation identity and shows full details
including members, permissions, metadata, and identity info.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "Get conversation details",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationInfo);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

    const identity = store.getByConversationId(args.id);
    if (!identity) {
      this.error(`No identity found for conversation: ${args.id}`);
    }

    const client = await createClientForIdentity(identity, config);
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) {
      this.error(`Conversation not found on network: ${args.id}`);
    }

    const metadata = await conversation.metadata();
    const members = await conversation.members();

    const convData: Record<string, unknown> = {
      id: conversation.id,
      createdAt: conversation.createdAt.toISOString(),
      consentState: conversation.consentState(),
      isActive: conversation.isActive,
      creatorInboxId: metadata.creatorInboxId,
      memberCount: members.length,
    };

    if (isGroup(conversation)) {
      convData.name = conversation.name;
      convData.description = conversation.description;
      convData.imageUrl = conversation.imageUrl;
    }

    const identityData = {
      identityId: identity.id,
      address: getAccountAddress(identity.walletKey),
      inboxId: client.inboxId,
      label: identity.label ?? "",
      profileName: identity.profileName ?? "",
    };

    const memberList = members.map((m) => ({
      inboxId: m.inboxId,
      accountIdentifiers: m.accountIdentifiers,
      permissionLevel: m.permissionLevel,
    }));

    if (this.jsonOutput) {
      this.output({
        conversation: convData,
        identity: identityData,
        members: memberList,
      });
    } else {
      this.log(
        formatSections(
          [
            { title: "Conversation", data: convData },
            { title: "Identity", data: identityData },
          ],
          2,
        ),
      );
      this.log("\nMembers\n");
      this.output(memberList);
    }
  }
}
