import { Args, Flags } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { sendProfileUpdate, MemberKind, type ProfileMetadataValue, type ProfileMetadata, type EncryptedProfileImageRef } from "../../utils/profileMessages.js";
import { encryptImage, fetchImageData, generateGroupKey } from "../../utils/imageEncryption.js";
import { parseAppDataForWrite, serializeAppData } from "../../utils/metadata.js";
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

    // Parse metadata flags into typed ProfileMetadata
    let parsedMetadata: ProfileMetadata | undefined;
    if (flags.metadata && flags.metadata.length > 0) {
      parsedMetadata = {};
      for (const entry of flags.metadata) {
        const eqIdx = entry.indexOf("=");
        if (eqIdx === -1) {
          this.error(`Invalid metadata format: "${entry}". Expected key=value`);
        }
        const key = entry.slice(0, eqIdx);
        const rawValue = entry.slice(eqIdx + 1);

        if (!key) {
          this.error(`Empty metadata key in "${entry}"`);
        }

        // Auto-type the value: bool → number → string
        if (rawValue === "true" || rawValue === "false") {
          parsedMetadata[key] = { type: "bool", value: rawValue === "true" };
        } else if (rawValue !== "" && !isNaN(Number(rawValue))) {
          parsedMetadata[key] = { type: "number", value: Number(rawValue) };
        } else {
          parsedMetadata[key] = { type: "string", value: rawValue };
        }
      }
    }

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

        // Get or generate the group's image encryption key from appData
        await group.sync();
        const appData = group.appData ?? "";
        const metadata = parseAppDataForWrite(appData);
        let groupKey = metadata.imageEncryptionKey;

        if (!groupKey || groupKey.length === 0) {
          // Generate a new key and persist it in appData
          groupKey = generateGroupKey();
          metadata.imageEncryptionKey = groupKey;
          await group.updateAppData(serializeAppData(metadata));
          this.log("Generated new image encryption key for this conversation");
        }

        // Download the image
        this.log(`Downloading image from ${flags.image}...`);
        const imageData = await fetchImageData(flags.image);

        // Encrypt
        const payload = await encryptImage(imageData, groupKey);

        // Upload the encrypted blob
        const filename = `ep-${Date.now()}.enc`;
        this.log(`Uploading encrypted image (${payload.ciphertext.length} bytes)...`);
        const assetUrl = await uploadProvider.upload(
          payload.ciphertext,
          filename,
          "application/octet-stream",
        );

        encryptedImage = {
          url: assetUrl,
          salt: payload.salt,
          nonce: payload.nonce,
        };
        this.log(`Encrypted image uploaded: ${assetUrl}`);
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
