import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { requireGroup } from "../../utils/xmtp.js";

export default class ConversationLastReadTimes extends ConvosBaseCommand {
  static description = `Show the last read times for each member of a conversation.

Queries the XMTP SDK for the last read receipt timestamp per member.
Timestamps are in nanoseconds since epoch. Members who have never
sent a read receipt will not appear in the output.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "Show last read times",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id> --json",
      description: "Output as JSON for scripting",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id> --sync",
      description: "Sync from network before querying",
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
    sync: Flags.boolean({
      description: "Sync conversation from network before querying",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationLastReadTimes);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
    await client.conversations.sync();

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);

    if (flags.sync) {
      await group.sync();
    }

    const readTimes = await group.lastReadTimes();

    this.output({ readTimes });
  }
}
