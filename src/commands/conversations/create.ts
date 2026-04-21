import { Flags } from "@oclif/core";
import { getAccountAddress } from "../../utils/xmtp.js";
import { GroupPermissionsOptions, type CreateGroupOptions } from "@xmtp/node-sdk";
import qrcode from "qrcode-terminal";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getIdentityAndClient } from "../../utils/client.js";
import { createInviteSlug } from "../../utils/invite.js";
import { serializeAppData } from "../../utils/metadata.js";
import { emojiForIdentifier } from "../../utils/emoji.js";
import { sendProfileUpdate, MemberKind, type ProfileMetadata } from "../../utils/profileMessages.js";
import { randomAlphanumeric } from "../../utils/random.js";

export default class ConversationsCreate extends ConvosBaseCommand {
  static description = `Create a new Convos conversation.

Creates an MLS group inside this install's singleton XMTP inbox
(per ADR 011). The creator becomes super admin. Others join via
invite links.

If no identity exists yet, one is created automatically.`;

  static examples = [
    {
      command: '<%= config.bin %> <%= command.id %> --name "Project Team"',
      description: "Create a named conversation",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> --name "Team" --description "Team discussion"',
      description: "Create with metadata",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> --name "Private" --permissions admin-only --json',
      description: "Create admin-only group with JSON output",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> --name "Bot" --attestation <sig> --attestation-ts <iso8601> --attestation-kid <kid>',
      description: "Create with pre-signed attestation metadata",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    name: Flags.string({
      description: "Conversation name",
      helpValue: "<name>",
    }),
    description: Flags.string({
      description: "Conversation description",
      helpValue: "<description>",
    }),
    "image-url": Flags.string({
      description: "Conversation image URL",
      helpValue: "<url>",
    }),
    permissions: Flags.option({
      options: ["all-members", "admin-only"] as const,
      description: "Permission preset",
      default: "all-members" as const,
    })(),
    "profile-name": Flags.string({
      description: "Profile display name to use in this conversation",
      helpValue: "<name>",
    }),
    "profile-image": Flags.string({
      description: "Profile image URL to use in this conversation",
      helpValue: "<url>",
    }),
    attestation: Flags.string({
      description: "Base64url-encoded Ed25519 attestation signature",
      helpValue: "<signature>",
      env: "CONVOS_ATTESTATION",
    }),
    "attestation-ts": Flags.string({
      description: "ISO 8601 timestamp used in the attestation",
      helpValue: "<iso8601>",
      env: "CONVOS_ATTESTATION_TS",
    }),
    "attestation-kid": Flags.string({
      description: "Key ID for the attestation",
      helpValue: "<kid>",
      env: "CONVOS_ATTESTATION_KID",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConversationsCreate);
    const config = this.getConvosConfig();

    const { identity, client } = await getIdentityAndClient(
      config,
      this.getConvosHome(),
    );

    const permissionsMap: Record<string, GroupPermissionsOptions> = {
      "all-members": GroupPermissionsOptions.Default,
      "admin-only": GroupPermissionsOptions.AdminOnly,
    };

    const options: CreateGroupOptions = {
      groupName: flags.name,
      groupDescription: flags.description,
      groupImageUrlSquare: flags["image-url"],
      permissions: permissionsMap[flags.permissions],
    };

    // Convos conversations start with just the creator
    const group = await client.conversations.createGroup([], options);

    const inviteTag = randomAlphanumeric(10);
    const conversationEmoji = emojiForIdentifier(group.id);

    // Store invite tag + emoji in appData (no profiles — profiles go via messages only
    // to avoid read-modify-write races that corrupt tags and erase profiles)
    const metadata = { tag: inviteTag, profiles: [] as never[], emoji: conversationEmoji };
    await group.updateAppData(serializeAppData(metadata));

    // Send ProfileUpdate message (primary profile source)
    // Always send to set memberKind: Agent (and name/image if provided)
    try {
      const profileName = flags["profile-name"] ?? identity.profileName;
      const profileImage = flags["profile-image"] ?? identity.profileImageUrl;

      let encryptedImage: import("../../utils/profileMessages.js").EncryptedProfileImageRef | undefined;
      if (profileImage) {
        try {
          const { getUploadProvider } = await import("../../utils/upload.js");
          const { encryptAndUploadProfileImage } = await import("../../utils/imageEncryption.js");

          const uploadProvider = getUploadProvider(config);
          if (uploadProvider) {
            encryptedImage = await encryptAndUploadProfileImage(
              profileImage,
              group,
              (data, filename, mimeType) => uploadProvider.upload(data, filename, mimeType),
            );
          } else {
            this.warn(
              "Image upload requires an upload provider. Set CONVOS_API_KEY or CONVOS_UPLOAD_PROVIDER. Skipping image.",
            );
          }
        } catch (imgError) {
          this.warn(
            `Could not encrypt/upload profile image: ${imgError instanceof Error ? imgError.message : "unknown"}`,
          );
        }
      }

      let attestationMeta: ProfileMetadata | undefined;
      if (flags.attestation && flags["attestation-ts"] && flags["attestation-kid"]) {
        attestationMeta = {
          attestation: { type: "string", value: flags.attestation },
          attestation_ts: { type: "string", value: flags["attestation-ts"] },
          attestation_kid: { type: "string", value: flags["attestation-kid"] },
        };
      }

      await sendProfileUpdate(group, {
        ...(profileName && { name: profileName }),
        ...(encryptedImage && { encryptedImage }),
        ...(attestationMeta && { metadata: attestationMeta }),
        memberKind: MemberKind.Agent,
      });
    } catch {
      // Non-fatal: profile will be visible once a ProfileUpdate is sent
    }

    const slug = await createInviteSlug(
      group.id,
      client.inboxId,
      inviteTag,
      identity.walletKey,
      {
        name: flags.name || undefined,
        description: flags.description || undefined,
        emoji: conversationEmoji,
      },
    );

    const env = config.env ?? "dev";
    const baseUrl =
      env === "production"
        ? "https://popup.convos.org/v2"
        : "https://dev.convos.org/v2";
    const inviteUrl = `${baseUrl}?i=${encodeURIComponent(slug)}`;

    if (!flags.json) {
      this.log("");
      await new Promise<void>((resolve) => {
        qrcode.generate(inviteUrl, { small: true }, (code: string) => {
          this.log(code);
          resolve();
        });
      });
      this.log(`  ${inviteUrl}\n`);
    }

    this.output({
      conversationId: group.id,
      identityId: identity.id,
      address: getAccountAddress(identity.walletKey),
      inboxId: client.inboxId,
      name: flags.name ?? "",
      description: flags.description ?? "",
      permissions: flags.permissions,
      createdAt: group.createdAt.toISOString(),
      invite: {
        slug,
        url: inviteUrl,
        tag: inviteTag,
      },
    });
  }
}
