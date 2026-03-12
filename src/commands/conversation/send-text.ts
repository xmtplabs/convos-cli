import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationSendText extends ConvosBaseCommand {
  static description = `Send a text message to a conversation.

Automatically resolves the per-conversation identity and sends
the message using the correct XMTP client.

The text can be provided as a positional argument or via --text.
Use --text to avoid shell quoting issues (e.g. smart quotes on macOS).`;

  static examples = [
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> "Hello!"',
      description: "Send a text message",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --text "Hello!"',
      description: "Send using --text flag (avoids shell quoting issues)",
    },
  ];

  static strict = false;

  static args = {
    id: Args.string({
      description: "The conversation ID",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    text: Flags.string({
      char: "t",
      description: "The text message to send",
      helpValue: "<message>",
    }),
  };

  async run(): Promise<void> {
    const { args, argv, flags } = await this.parse(ConversationSendText);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    // Text can come from --text flag or remaining positional args
    const text = flags.text ?? (argv as string[]).slice(1).join(" ");

    if (!text) {
      this.error(
        "No message provided. Pass text as an argument or use --text.",
      );
    }

    const identity = store.getByConversationId(args.id);
    if (!identity) {
      this.error(
        `No identity found for conversation: ${args.id}\nUse 'convos conversations list' to see available conversations.`,
      );
    }

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) {
      this.error(`Conversation not found: ${args.id}`);
    }

    const messageId = await conversation.sendText(text);

    this.output({
      success: true,
      messageId,
      conversationId: args.id,
      text,
    });
  }
}
