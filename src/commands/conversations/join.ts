import { Args, Flags } from "@oclif/core";
import { getAccountAddress, isGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { parseInvite, verifyInvite, inviteToSlug } from "../../utils/invite.js";
import {
  parseAppData,
  serializeAppData,
  upsertProfile,
} from "../../utils/metadata.js";

export default class ConversationsJoin extends ConvosBaseCommand {
  static description = `Join a conversation using an invite slug or URL.

Implements the Convos join flow (per ADR 001):

1. Parse and validate the invite (verify signature, check expiration)
2. Create a new per-conversation identity for this conversation
3. Send the invite slug as a DM to the creator's inbox
4. Wait for the creator's client to process the join request and
   add this identity to the conversation
5. Link the identity to the conversation once joined

The creator's client (iOS app or another CLI instance running
'convos conversations process-join-requests') must be online to
process the join request.

Accepts either a raw invite slug or a full URL containing the
slug as query parameter 'i'.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <invite-slug>",
      description: "Join using a raw invite slug",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> "https://convos.org/v2?i=<slug>"',
      description: "Join using a full invite URL",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <slug> --no-wait",
      description: "Send join request without waiting for acceptance",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <slug> --timeout 120 --json",
      description: "Wait up to 2 minutes for acceptance",
    },
  ];

  static args = {
    invite: Args.string({
      description: "Invite slug or URL",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    "no-wait": Flags.boolean({
      description:
        "Send the join request but don't wait for the creator to accept",
      default: false,
    }),
    timeout: Flags.integer({
      description: "Seconds to wait for acceptance (default: 60)",
      helpValue: "<seconds>",
      default: 60,
    }),
    label: Flags.string({
      description: "Local label for the new identity",
      helpValue: "<label>",
    }),
    "profile-name": Flags.string({
      description: "Profile display name for this conversation",
      helpValue: "<name>",
    }),
    identity: Flags.string({
      description: "Use an existing unlinked identity instead of creating one",
      helpValue: "<id>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationsJoin);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

    // Step 1: Parse invite
    const invite = parseInvite(args.invite);

    // Validate
    if (!(await verifyInvite(invite))) {
      this.error("Invalid invite signature");
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      this.error("Invite has expired");
    }

    if (invite.conversationExpiresAt && invite.conversationExpiresAt < new Date()) {
      this.error("Conversation has expired");
    }

    this.log(
      `Invite parsed: tag=${invite.tag}` +
        (invite.name ? ` name="${invite.name}"` : "") +
        ` creator=${invite.creatorInboxId.slice(0, 12)}...`,
    );

    // Step 2: Get or create identity
    let identity;
    if (flags.identity) {
      identity = store.get(flags.identity);
      if (!identity) this.error(`Identity not found: ${flags.identity}`);
      if (identity.conversationId) {
        this.error(`Identity already linked to conversation ${identity.conversationId}`);
      }
    } else {
      identity = store.create({
        label: flags.label ?? invite.name,
        profileName: flags["profile-name"],
      });
    }

    // Step 3: Create XMTP client and send DM to creator
    const client = await createClientForIdentity(identity, config);

    this.log(`Created identity ${identity.id.slice(0, 12)}... (${getAccountAddress(identity.walletKey)})`);
    this.log(`Sending join request to creator inbox ${invite.creatorInboxId.slice(0, 12)}...`);

    // Create DM with creator using their XMTP inbox ID
    const dm = await client.conversations.createDm(invite.creatorInboxId);

    // Send the invite slug as the join request
    const slug = inviteToSlug(invite);
    await dm.sendText(slug);

    this.log("Join request sent.");

    if (flags["no-wait"]) {
      this.output({
        status: "request_sent",
        identityId: identity.id,
        address: getAccountAddress(identity.walletKey),
        inboxId: client.inboxId,
        creatorInboxId: invite.creatorInboxId,
        tag: invite.tag,
        name: invite.name ?? null,
        message:
          "Join request sent. The creator must accept it. " +
          "Run 'convos conversations list --sync' to check if you've been added.",
      });
      return;
    }

    // Step 4: Wait for acceptance (poll for new group conversations)
    this.log(`Waiting for acceptance (timeout: ${flags.timeout}s)...`);

    const startTime = Date.now();
    const timeoutMs = flags.timeout * 1000;
    let conversationId: string | undefined;

    while (Date.now() - startTime < timeoutMs) {
      await client.conversations.sync();
      const conversations = await client.conversations.list();

      // Look for a new group conversation (not the DM we created)
      for (const conv of conversations) {
        if (conv.id !== dm.id) {
          conversationId = conv.id;
          break;
        }
      }

      if (conversationId) break;

      // Poll every 2 seconds
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!conversationId) {
      this.log("Timed out waiting for acceptance.");
      this.output({
        status: "timeout",
        identityId: identity.id,
        address: getAccountAddress(identity.walletKey),
        inboxId: client.inboxId,
        tag: invite.tag,
        message:
          "The creator has not yet accepted the join request. " +
          "Run 'convos conversations list --sync' later to check.",
      });
      return;
    }

    // Step 5: Verify the group's invite tag matches the invite we used (ADR 001)
    // This protects against being added to a different conversation than requested.
    try {
      const conv = await client.conversations.getConversationById(conversationId);
      if (conv && isGroup(conv)) {
        const appData = conv.appData ?? "";
        const metadata = parseAppData(appData);
        if (metadata.tag && metadata.tag !== invite.tag) {
          this.warn(
            `Invite tag mismatch: expected "${invite.tag}" but group has "${metadata.tag}". ` +
            "You may have been added to a different conversation than expected.",
          );
        }

        // Step 5b: Write joiner's profile to shared metadata
        const profileName = flags["profile-name"];
        if (profileName) {
          const updated = upsertProfile(metadata, {
            inboxId: client.inboxId,
            name: profileName,
          });
          await conv.updateAppData(serializeAppData(updated));
        }
      }
    } catch {
      // Non-fatal: tag verification + profile write are best-effort
    }

    // Step 6: Link identity to conversation
    store.update(identity.id, {
      conversationId,
      inboxId: client.inboxId,
      label: flags.label ?? invite.name ?? identity.label,
      profileName: flags["profile-name"] ?? identity.profileName,
    });

    this.output({
      status: "joined",
      conversationId,
      identityId: identity.id,
      address: getAccountAddress(identity.walletKey),
      inboxId: client.inboxId,
      tag: invite.tag,
      name: invite.name ?? null,
    });
  }
}
