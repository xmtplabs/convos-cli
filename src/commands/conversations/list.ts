import { Flags } from "@oclif/core";
import { isGroup } from "../../utils/xmtp.js";
import { ConversationType, PermissionPolicy } from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationsList extends ConvosBaseCommand {
  static description = `List all Convos conversations.

Lists every group and DM this install's singleton XMTP inbox
participates in (per ADR 011).

Use --sync to fetch the latest state from the network first.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "List all conversations",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --sync",
      description: "Sync from network then list",
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

    const conversations = await client.conversations.list(
      flags["include-dms"]
        ? undefined
        : { conversationType: ConversationType.Group },
    );

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
