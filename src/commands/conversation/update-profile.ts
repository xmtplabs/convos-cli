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
import { sendProfileUpdate } from "../../utils/profileMessages.js";

export default class UpdateProfile extends ConvosBaseCommand {
  static description = `Set your display name and avatar in a conversation.

Profiles are per-conversation — you can be a different person in
each conversation (ADR 005).

Updates are sent as ProfileUpdate messages to the group (primary)
and also written to appData for backward compatibility with older
clients. Profile messages take precedence over appData.`;

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

    // Serialize and push to appData (dual-write for backward compatibility)
    try {
      const newAppData = serializeAppData(metadata);
      await group.updateAppData(newAppData);
    } catch (error) {
      this.warn(
        `Failed to write profile to appData (best-effort): ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    // Send ProfileUpdate message (primary)
    try {
      await sendProfileUpdate(group, {
        name: profile.name,
      });
    } catch (error) {
      this.warn(
        `Failed to send ProfileUpdate message: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

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
