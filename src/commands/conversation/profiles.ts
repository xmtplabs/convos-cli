import { Args } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { parseAppData } from "../../utils/metadata.js";

export default class Profiles extends ConvosBaseCommand {
  static description = `List member profiles in a conversation.

Shows display names and avatar URLs for all members who have set
a profile in this conversation. Profiles are stored in the group's
metadata and are visible to all members (ADR 005).

Members without a profile appear as anonymous with just their inbox ID.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "List all member profiles",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id> --json",
      description: "List profiles as JSON",
    },
  ];

  static args = {
    id: Args.string({
      description: "The conversation ID",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Profiles);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

    const identity = store.getByConversationId(args.id);
    if (!identity) {
      this.error(`No identity found for conversation ${args.id}`);
    }

    const client = await createClientForIdentity(identity, config);
    await client.conversations.sync();

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) {
      this.error(`Conversation ${args.id} not found`);
    }

    const group = requireGroup(conversation);

    // Parse metadata
    let appData = "";
    try {
      appData = group.appData ?? "";
    } catch {
      // No appData yet
    }

    const metadata = parseAppData(appData);

    // Get all members for completeness
    const members = await group.members();
    const memberInboxIds = members.map((m) => m.inboxId);

    // Build profile list — include all members, mark which have profiles
    const profileList = memberInboxIds.map((inboxId) => {
      const profile = metadata.profiles.find(
        (p) => p.inboxId.toLowerCase() === inboxId.toLowerCase(),
      );
      const isMe = inboxId === client.inboxId;
      return {
        inboxId,
        name: profile?.name ?? null,
        image: profile?.image ?? null,
        hasProfile: !!profile,
        isMe,
      };
    });

    this.output({
      conversationId: args.id,
      memberCount: memberInboxIds.length,
      profileCount: metadata.profiles.length,
      profiles: profileList,
    });
  }
}
