import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { requireGroup } from "../../utils/xmtp.js";
import {
  TypingIndicatorCodec,
  type TypingIndicatorContent,
} from "../../utils/typingIndicator.js";

export default class ConversationSendTypingIndicator extends ConvosBaseCommand {
  static description = `Send a typing indicator to a conversation.

Notifies other members that you are currently typing (or stopped
typing). Typing indicators are silent — they do not appear as
messages in the conversation and do not trigger push notifications.

The iOS app auto-expires typing indicators after 15 seconds, so
you should send isTyping=true periodically while actively typing,
and isTyping=false when done.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "Send a typing indicator (isTyping=true)",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id> --stop",
      description: "Send a stop-typing indicator (isTyping=false)",
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
    stop: Flags.boolean({
      description: "Send isTyping=false (stop typing) instead of isTyping=true",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationSendTypingIndicator);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
    await client.conversations.sync();

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);

    const isTyping = !flags.stop;
    const content: TypingIndicatorContent = { isTyping };
    const codec = new TypingIndicatorCodec();
    const encoded = codec.encode(content);
    const messageId = await group.send(encoded);

    this.output({
      success: true,
      messageId,
      conversationId: args.id,
      isTyping,
    });
  }
}
