import { Flags } from "@oclif/core";
import { getAccountAddress } from "../../utils/xmtp.js";
import { GroupPermissionsOptions, type CreateGroupOptions } from "@xmtp/node-sdk";
import qrcode from "qrcode-terminal";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { createInviteSlug } from "../../utils/invite.js";
import { serializeAppData } from "../../utils/metadata.js";
import { sendProfileUpdate, MemberKind, type ProfileMetadata } from "../../utils/profileMessages.js";
import { randomAlphanumeric } from "../../utils/random.js";

export default class ConversationsCreate extends ConvosBaseCommand {
  static description = `Create a new Convos conversation.

Creates a new conversation with a fresh per-conversation identity.
Each conversation gets its own XMTP inbox for privacy isolation
(per ADR 002).

This command:
1. Creates a new identity (or uses an existing unlinked one)
2. Initializes the XMTP client for that identity
3. Creates a group conversation
4. Links the identity to the conversation

The creator becomes super admin. Others join via invite links.`;

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
        "<%= config.bin %> <%= command.id %> --identity <identity-id>",
      description: "Use a pre-created identity",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> --name "Private" --permissions admin-only --json',
      description: "Create admin-only group with JSON output",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> --name "Bot" --identity <id> --attestation <sig> --attestation-ts <iso8601> --attestation-kid <kid>',
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
    identity: Flags.string({
      description: "Use an existing unlinked identity ID",
      helpValue: "<id>",
    }),
    label: Flags.string({
      description: "Local label for the identity",
      helpValue: "<label>",
    }),
    "profile-name": Flags.string({
      description: "Profile display name for this conversation",
      helpValue: "<name>",
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
    const store = createIdentityStore(this.getConvosHome());

    // Get or create identity
    let identity;
    if (flags.identity) {
      identity = store.get(flags.identity);
      if (!identity) {
        this.error(`Identity not found: ${flags.identity}`);
      }
      if (identity.conversationId) {
        this.error(
          `Identity ${flags.identity} is already linked to conversation ${identity.conversationId}`,
        );
      }
    } else {
      identity = store.create({
        label: flags.label ?? flags.name,
        profileName: flags["profile-name"],
      });
    }

    const client = await createClientForIdentity(identity, config, this.getConvosHome());

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

    // Generate invite tag
    const inviteTag = randomAlphanumeric(10);

    store.update(identity.id, {
      conversationId: group.id,
      inboxId: client.inboxId,
      inviteTag,
      label: flags.label ?? flags.name ?? identity.label,
      profileName: flags["profile-name"] ?? identity.profileName,
    });

    // Store invite tag in appData (no profiles — profiles go via messages only
    // to avoid read-modify-write races that corrupt tags and erase profiles)
    const metadata = { tag: inviteTag, profiles: [] as never[] };
    await group.updateAppData(serializeAppData(metadata));

    // Send ProfileUpdate message (primary profile source)
    // Always send to set memberKind: Agent (and name if provided)
    try {
      const profileName = flags["profile-name"];

      // Merge attestation metadata if all three flags are present
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
        ...(attestationMeta && { metadata: attestationMeta }),
        memberKind: MemberKind.Agent,
      });
    } catch {
      // Non-fatal: profile will be visible once a ProfileUpdate is sent
    }

    // Generate invite slug and URL
    const slug = await createInviteSlug(
      group.id,
      client.inboxId,
      inviteTag,
      identity.walletKey,
      {
        name: flags.name || undefined,
        description: flags.description || undefined,
      },
    );

    const env = config.env ?? "dev";
    const baseUrl =
      env === "production"
        ? "https://popup.convos.org/v2"
        : "https://dev.convos.org/v2";
    const inviteUrl = `${baseUrl}?i=${encodeURIComponent(slug)}`;

    // Display QR code unless --json
    if (!flags.json) {
      this.log(""); // blank line before QR
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


