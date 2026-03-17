import { Args } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { parseInvite, verifyInvite } from "../../utils/invite.js";

export default class ConversationsInspectInvite extends ConvosBaseCommand {
  static description = `Decode and inspect an invite slug or URL without joining.

Parses the invite, verifies its cryptographic signature, and displays
all embedded metadata. Useful for debugging invite issues.

Does NOT create an identity, send a join request, or modify any state.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <invite-slug>",
      description: "Inspect a raw invite slug",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> "https://dev.convos.org/v2?i=<slug>"',
      description: "Inspect a full invite URL",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <slug> --json",
      description: "Output as JSON for scripting",
    },
  ];

  static args = {
    invite: Args.string({
      description: "Invite slug or URL to inspect",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.commonFlags,
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationsInspectInvite);

    // Parse
    let invite;
    try {
      invite = parseInvite(args.invite);
    } catch (error) {
      this.error(
        `Failed to parse invite: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    // Verify signature
    const signatureValid = await verifyInvite(invite);

    // Check expiration
    const now = new Date();
    const inviteExpired = invite.expiresAt ? invite.expiresAt < now : false;
    const conversationExpired = invite.conversationExpiresAt
      ? invite.conversationExpiresAt < now
      : false;

    this.output({
      tag: invite.tag,
      creatorInboxId: invite.creatorInboxId,
      name: invite.name ?? null,
      description: invite.description ?? null,
      imageUrl: invite.imageUrl ?? null,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      expiresAfterUse: invite.expiresAfterUse,
      conversationExpiresAt: invite.conversationExpiresAt?.toISOString() ?? null,
      signatureValid,
      inviteExpired,
      conversationExpired,
      conversationTokenBytes: invite.conversationToken.length,
    });
  }
}
