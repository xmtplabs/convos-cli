import { Flags } from "@oclif/core";
import { isGroup } from "../../utils/xmtp.js";
import { ConversationType, PermissionPolicy } from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationsList extends ConvosBaseCommand {
  static description = `List all Convos conversations.

Lists every group this install's singleton XMTP inbox participates in
(per ADR 011).

Inactive conversations (the install has been removed, or the group
exploded from another client) are hidden by default. Pass --include-inactive
to see them.

Use --sync to fetch the latest state from the network first.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "List active groups",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --sync",
      description: "Sync from network then list",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --include-inactive",
      description: "Include conversations this install is no longer a member of",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --json",
      description: "Output as JSON",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    sync: Flags.boolean({
      description: "Sync from network before listing",
      default: false,
    }),
    "include-dms": Flags.boolean({
      description: "Include DMs in the output (default: groups only)",
      default: false,
    }),
    "include-inactive": Flags.boolean({
      description:
        "Include conversations where isActive=false (default: hide exploded / removed groups)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConversationsList);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    if (!store.exists()) {
      this.output({
        message:
          "No identity found. Create a conversation to initialize: convos conversations create",
        count: 0,
      });
      return;
    }

    const client = await getClient(config, this.getConvosHome());
    if (flags.sync) {
      await client.conversations.sync();
    }

    const allConversations = await client.conversations.list(
      flags["include-dms"]
        ? undefined
        : { conversationType: ConversationType.Group },
    );
    const conversations = flags["include-inactive"]
      ? allConversations
      : allConversations.filter((c) => c.isActive);

    if (conversations.length === 0) {
      this.output({
        message:
          "No conversations found. Create one with: convos conversations create",
        count: 0,
      });
      return;
    }

    const output = [];
    for (const conversation of conversations) {
      const members = await conversation.members();
      let isLocked = false;
      if (isGroup(conversation)) {
        const { policySet } = conversation.permissions();
        isLocked = policySet.addMemberPolicy === PermissionPolicy.Deny;
      }
      output.push({
        conversationId: conversation.id,
        kind: isGroup(conversation) ? "group" : "dm",
        name: isGroup(conversation) ? (conversation.name ?? "") : "",
        createdAt: conversation.createdAt.toISOString(),
        memberCount: members.length,
        isActive: conversation.isActive,
        isLocked,
      });
    }

    this.output(output);
  }
}
