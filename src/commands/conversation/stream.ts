import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import {
  buildProfileMap,
  isDisplayableMessage,
  normalizeMessageContent,
  requireGroup,
} from "../../utils/xmtp.js";

export default class ConversationStream extends ConvosBaseCommand {
  static description = `Stream messages in a conversation.

Listens for new messages in real-time. The stream continues until timeout,
count limit, or Ctrl+C.`;

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
    const client = await getClient(config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) {
      this.error(`Conversation not found: ${args.id}`);
    }

    const group = requireGroup(conversation);

    let messageCount = 0;
    const stream = await conversation.stream();

    let timeoutId: NodeJS.Timeout | undefined;
    if (flags.timeout) {
      timeoutId = setTimeout(() => void stream.return(), flags.timeout * 1000);
    }

    try {
      for await (const message of stream) {
        if (!isDisplayableMessage(message)) continue;
        // Rebuild profiles each time so newly-joined members are resolved
        const profiles = buildProfileMap(group.appData ?? "");
        const content = normalizeMessageContent(message, profiles);
        if (!content) continue; // skip no-op group updates
        this.streamOutput({
          id: message.id,
          senderInboxId: message.senderInboxId,
          contentType: message.contentType,
          content,
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
