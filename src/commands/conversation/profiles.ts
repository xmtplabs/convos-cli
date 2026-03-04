import { Args } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { parseAppData } from "../../utils/metadata.js";
import { resolveProfilesFromMessages } from "../../utils/profileMessages.js";

export default class Profiles extends ConvosBaseCommand {
  static description = `List member profiles in a conversation.

Shows display names and avatar URLs for all members who have set
a profile in this conversation. Profiles are resolved from
ProfileUpdate/ProfileSnapshot messages (primary) with appData as
fallback for backward compatibility.

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

    // Get all members for completeness
    const members = await group.members();
    const memberInboxIds = members.map((m) => m.inboxId);

    // Resolve profiles from messages (primary source)
    const messageProfiles = await resolveProfilesFromMessages(group, memberInboxIds);

    // Parse appData profiles (fallback)
    let appData = "";
    try {
      appData = group.appData ?? "";
    } catch {
      // No appData yet
    }
    const metadata = parseAppData(appData);

    // Build profile list — message-sourced profiles take precedence over appData
    let profileCount = 0;
    const profileList = memberInboxIds.map((inboxId) => {
      const msgProfile = messageProfiles.get(inboxId.toLowerCase());
      const appDataProfile = metadata.profiles.find(
        (p) => p.inboxId.toLowerCase() === inboxId.toLowerCase(),
      );

      // Message profile takes precedence
      const name = msgProfile?.name ?? appDataProfile?.name ?? null;
      const image = msgProfile?.encryptedImage?.url ?? appDataProfile?.image ?? null;
      const hasProfile = !!(msgProfile || appDataProfile);
      const isMe = inboxId === client.inboxId;
      const source = msgProfile?.name ? "message" : appDataProfile?.name ? "appData" : null;

      if (hasProfile) profileCount++;

      return {
        inboxId,
        name,
        image,
        hasProfile,
        isMe,
        ...(source && { source }),
      };
    });

    this.output({
      conversationId: args.id,
      memberCount: memberInboxIds.length,
      profileCount,
      profiles: profileList,
    });
  }
}
