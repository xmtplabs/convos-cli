import { Flags } from "@oclif/core";
import { getAccountAddress } from "../../utils/xmtp.js";
import { GroupPermissionsOptions, type CreateGroupOptions } from "@xmtp/node-sdk";
import qrcode from "qrcode-terminal";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { createInviteSlug } from "../../utils/invite.js";
import { parseAppData, serializeAppData, upsertProfile } from "../../utils/metadata.js";
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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConversationsCreate);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

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

    const client = await createClientForIdentity(identity, config);

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

    // Store invite tag in appData
    let metadata = { tag: inviteTag, profiles: [] as { inboxId: string; name?: string }[] };

    // Write creator's profile to shared metadata so other members can see it
    const profileName = flags["profile-name"];
    if (profileName) {
      metadata = upsertProfile(metadata, {
        inboxId: client.inboxId,
        name: profileName,
      });
    }

    await group.updateAppData(serializeAppData(metadata));

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
        : "https://dev.popup.convos.org/v2";
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


