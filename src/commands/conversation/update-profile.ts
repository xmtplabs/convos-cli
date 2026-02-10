import { Args, Flags } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import {
  parseAppData,
  serializeAppData,
  upsertProfile,
} from "../../utils/metadata.js";

export default class UpdateProfile extends ConvosBaseCommand {
  static description = `Set your display name and avatar in a conversation.

Profiles are stored in the group's metadata (appData) and visible
to all members. Each conversation has independent profiles — you
can be a different person in each conversation (ADR 005).

Updates are synced to all members via XMTP's group metadata.
The profile is stored as a compressed protobuf in the group's
appData field (max 8KB shared across all profiles and metadata).`;

  static examples = [
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --name "Alice"',
      description: "Set your display name",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --name "Alice" --image "https://example.com/avatar.jpg"',
      description: "Set display name and avatar",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --name "" --image ""',
      description: "Clear your profile (go anonymous)",
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
    name: Flags.string({
      description: "Display name (empty string to clear)",
      helpValue: "<name>",
    }),
    image: Flags.string({
      description: "Avatar image URL (empty string to clear)",
      helpValue: "<url>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(UpdateProfile);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

    if (flags.name === undefined && flags.image === undefined) {
      this.error("At least one of --name or --image must be provided");
    }

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

    // Parse current metadata
    let appData = "";
    try {
      appData = group.appData ?? "";
    } catch {
      // No appData yet
    }

    let metadata = parseAppData(appData);

    // Build profile update
    const profile = {
      inboxId: client.inboxId,
      ...(flags.name !== undefined ? { name: flags.name || undefined } : {}),
      ...(flags.image !== undefined ? { image: flags.image || undefined } : {}),
    };

    metadata = upsertProfile(metadata, profile);

    // Serialize and push
    const newAppData = serializeAppData(metadata);
    await group.updateAppData(newAppData);

    // Also update local identity store
    if (flags.name !== undefined) {
      store.update(identity.id, { profileName: flags.name || undefined });
    }

    this.output({
      conversationId: args.id,
      inboxId: client.inboxId,
      name: flags.name ?? "(unchanged)",
      image: flags.image ?? "(unchanged)",
      message: "Profile updated",
    });
  }
}
