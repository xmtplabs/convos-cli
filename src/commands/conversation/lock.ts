import { Args, Flags } from "@oclif/core";
import { requireGroup } from "../../utils/xmtp.js";
import { PermissionPolicy, PermissionUpdateType } from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationLock extends ConvosBaseCommand {
  static description = `Lock or unlock a conversation.

Locking prevents new members from joining by setting the XMTP
addMember permission to 'deny' (per ADR 006). This also
invalidates all existing invites.

Unlocking restores the ability to add members. Previously shared
invites remain invalid — generate new ones after unlocking.

Only super admins can lock/unlock.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "Lock a conversation",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id> --unlock",
      description: "Unlock a conversation",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    unlock: Flags.boolean({
      description: "Unlock instead of locking",
      default: false,
    }),
    force: Flags.boolean({
      char: "f",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationLock);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    if (!flags.unlock) {
      await this.confirmAction(
        "Locking prevents new members from joining and invalidates all existing invites.",
        flags.force,
      );
    }

    const client = await createClientForIdentity(identity, config);
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);

    if (flags.unlock) {
      await group.updatePermission(
        PermissionUpdateType.AddMember,
        PermissionPolicy.Admin,
      );
    } else {
      await group.updatePermission(
        PermissionUpdateType.AddMember,
        PermissionPolicy.Deny,
      );
    }

    const action = flags.unlock ? "unlocked" : "locked";
    this.output({
      success: true,
      conversationId: args.id,
      action,
      message: flags.unlock
        ? "Conversation unlocked. Generate new invites to allow members."
        : "Conversation locked. No new members can join.",
    });
  }
}
