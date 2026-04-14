import { Args, Flags } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import qrcode from "qrcode-terminal";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { createInviteSlug } from "../../utils/invite.js";
import { parseAppData, serializeAppData } from "../../utils/metadata.js";
import { randomAlphanumeric } from "../../utils/random.js";

export default class ConversationInvite extends ConvosBaseCommand {
  static description = `Generate an invite link for a conversation.

Creates a cryptographic invite slug that others can use to request
to join this conversation (per ADR 001).

The invite contains:
- An encrypted conversation ID (only the creator can decrypt)
- The creator's inbox ID (for routing the join request DM)
- An invite tag (for verification and revocation)
- Optional metadata (name, description)
- A secp256k1 ECDSA signature

Displays a QR code in the terminal that can be scanned by the
Convos app. The QR code encodes the full invite URL.

Invite URLs use the format:
- Dev:        dev.convos.org/v2?i=<slug>
- Production: popup.convos.org/v2?i=<slug>`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "Generate an invite with QR code (default)",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> --no-qr",
      description: "Generate an invite without QR code",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> --expires-in 3600",
      description: "Generate an invite that expires in 1 hour",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> --single-use --json",
      description: "Generate a single-use invite with JSON output",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    qr: Flags.boolean({
      description: "Display a QR code in the terminal",
      default: true,
      allowNo: true,
    }),
    "expires-in": Flags.integer({
      description: "Invite expires in N seconds from now",
      helpValue: "<seconds>",
    }),
    "single-use": Flags.boolean({
      description: "Invite expires after first use",
      default: false,
    }),
    "include-metadata": Flags.boolean({
      description: "Include conversation name/description in invite",
      default: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationInvite);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    const identity = store.getByConversationId(args.id);
    if (!identity) {
      this.error(`No identity found for conversation: ${args.id}`);
    }

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) {
      this.error(`Conversation not found: ${args.id}`);
    }

    const group = requireGroup(conversation);

    // Get or create invite tag from appData (using proper protobuf metadata)
    let appData = "";
    try {
      appData = group.appData ?? "";
    } catch {
      this.verboseWarn("Could not read conversation appData while generating invite; treating as empty");
    }

    if (!appData) {
      this.verboseLog("Conversation appData is empty while generating invite");
    }

    let metadata = parseAppData(appData);
    let inviteTag = metadata.tag;

    if (!inviteTag) {
      this.verboseWarn("Conversation invite tag is empty; generating a new invite tag");
      inviteTag = randomAlphanumeric(10);
      metadata = { ...metadata, tag: inviteTag };
      await group.updateAppData(serializeAppData(metadata));
    }

    const expiresAt = flags["expires-in"]
      ? new Date(Date.now() + flags["expires-in"] * 1000)
      : undefined;

    const slug = await createInviteSlug(
      args.id,
      client.inboxId,
      inviteTag,
      identity.walletKey,
      {
        name: flags["include-metadata"] ? group.name || undefined : undefined,
        description: flags["include-metadata"]
          ? group.description || undefined
          : undefined,
        emoji: metadata.emoji || undefined,
        expiresAt,
        expiresAfterUse: flags["single-use"],
      },
    );

    // Build invite URL based on environment
    const env = config.env ?? "dev";
    const baseUrl =
      env === "production"
        ? "https://popup.convos.org/v2"
        : "https://dev.convos.org/v2";
    const inviteUrl = `${baseUrl}?i=${encodeURIComponent(slug)}`;

    // Display QR code unless --no-qr or --json
    if (flags.qr && !flags.json) {
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
      conversationId: args.id,
      slug,
      url: inviteUrl,
      tag: inviteTag,
      env,
      expiresAt: expiresAt?.toISOString() ?? null,
      singleUse: flags["single-use"],
    });
  }
}


