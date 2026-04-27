import { Args, Flags } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import {
  sendProfileUpdate,
  MemberKind,
  parseMetadataFlags,
  type ProfileMetadata,
  type EncryptedProfileImageRef,
} from "../../utils/profileMessages.js";
import { encryptAndUploadProfileImage } from "../../utils/imageEncryption.js";
import { getUploadProvider } from "../../utils/upload.js";

export default class UpdateProfile extends ConvosBaseCommand {
  static description = `Set your display name and avatar in a conversation.

Profiles are per-conversation — you can be a different person in
each conversation (ADR 005).

Updates are sent as ProfileUpdate messages to the group. Both iOS
and CLI clients read profiles from these messages (with appData as
a legacy fallback). Profile messages are the primary source of truth.`;

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
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --metadata credits=75 --metadata verified=true',
      description: "Set custom metadata fields",
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
    metadata: Flags.string({
      description: 'Set a metadata field (key=value). Value is auto-typed: "true"/"false" → bool, numeric → number, else string. Repeat for multiple fields.',
      helpValue: "<key=value>",
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(UpdateProfile);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    if (flags.name === undefined && flags.image === undefined && (!flags.metadata || flags.metadata.length === 0)) {
      this.error("At least one of --name, --image, or --metadata must be provided");
    }

    const parsedMetadata = parseMetadataFlags(flags.metadata, (msg) => this.error(msg))
      ?.parsedMetadata;

    const identity = store.getByConversationId(args.id);
    if (!identity) {
      this.error(`No identity found for conversation ${args.id}`);
    }

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
    await client.conversations.sync();

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) {
      this.error(`Conversation ${args.id} not found`);
    }

    const group = requireGroup(conversation);

    // Merge with existing profile so partial updates don't clear fields.
    // e.g. `--name "Alice"` should keep existing image, not erase it.
    const { resolveProfilesFromMessages } = await import("../../utils/profileMessages.js");
    const existingProfiles = await resolveProfilesFromMessages(group);
    const existing = existingProfiles.get(client.inboxId.toLowerCase());

    const profileName = flags.name !== undefined
      ? (flags.name || undefined)  // empty string → clear
      : existing?.name;            // preserve existing

    // Handle image: encrypt + upload if a URL is provided, preserve existing, or clear
    let encryptedImage: EncryptedProfileImageRef | undefined;
    if (flags.image !== undefined) {
      if (flags.image === "") {
        // Empty string → clear the image
        encryptedImage = undefined;
      } else {
        // New image URL — download, encrypt, upload
        const uploadProvider = getUploadProvider(config);
        if (!uploadProvider) {
          this.error(
            "Image upload requires an upload provider. Set CONVOS_API_KEY=<key> or CONVOS_UPLOAD_PROVIDER=convos-api with CONVOS_API_KEY.",
          );
        }

        encryptedImage = await encryptAndUploadProfileImage(
          flags.image,
          group,
          (data, filename, mimeType) => uploadProvider.upload(data, filename, mimeType),
          { log: (m) => this.log(m), verboseLog: (m) => this.verboseLog(m) },
        );
      }
    } else {
      // Preserve existing encrypted image
      encryptedImage = existing?.encryptedImage;
    }

    // Merge metadata: existing + new (new keys overwrite existing)
    const mergedMetadata: ProfileMetadata | undefined = parsedMetadata
      ? { ...(existing?.metadata ?? {}), ...parsedMetadata }
      : existing?.metadata;

    // Send ProfileUpdate message — this is the primary source of truth.
    // We intentionally do NOT write profiles to appData to avoid the
    // read-modify-write race that can corrupt invite tags and erase
    // other members' profiles (see convos-ios PR #552 for context).
    // Preserve memberKind from existing profile, defaulting to Agent for CLI
    const memberKind = existing?.memberKind ?? MemberKind.Agent;

    await sendProfileUpdate(group, {
      name: profileName,
      memberKind,
      ...(encryptedImage && { encryptedImage }),
      ...(mergedMetadata && Object.keys(mergedMetadata).length > 0 && { metadata: mergedMetadata }),
    });

    // Also update local identity store
    if (flags.name !== undefined) {
      store.update(identity.id, { profileName: flags.name || undefined });
    }

    this.output({
      conversationId: args.id,
      inboxId: client.inboxId,
      name: flags.name ?? "(unchanged)",
      image: flags.image ?? "(unchanged)",
      ...(parsedMetadata && { metadata: parsedMetadata }),
      message: "Profile updated",
    });
  }
}
