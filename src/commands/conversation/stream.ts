import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationStream extends ConvosBaseCommand {
  static description = `Stream messages in a conversation.

Listens for new messages in real-time using the per-conversation identity.

The stream continues until timeout, count limit, or Ctrl+C.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "Stream messages indefinitely",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> --timeout 60",
      description: "Stream for 60 seconds",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    timeout: Flags.integer({
      description: "Stop streaming after N seconds",
      helpValue: "<seconds>",
    }),
    count: Flags.integer({
      description: "Stop after receiving N messages",
      helpValue: "<number>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationStream);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

    const identity = store.getByConversationId(args.id);
    if (!identity) {
      this.error(`No identity found for conversation: ${args.id}`);
    }

    const client = await createClientForIdentity(identity, config);
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) {
      this.error(`Conversation not found: ${args.id}`);
    }

    let messageCount = 0;
    const stream = await conversation.stream();

    let timeoutId: NodeJS.Timeout | undefined;
    if (flags.timeout) {
      timeoutId = setTimeout(() => void stream.return(), flags.timeout * 1000);
    }

    try {
      for await (const message of stream) {
        this.streamOutput({
          id: message.id,
          senderInboxId: message.senderInboxId,
          contentType: message.contentType,
          content: message.content,
          sentAt: message.sentAt.toISOString(),
          deliveryStatus: message.deliveryStatus,
        });
        messageCount++;
        if (flags.count && messageCount >= flags.count) break;
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      await stream.return();
    }
  }
}
