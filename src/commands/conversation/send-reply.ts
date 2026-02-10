import { Args } from "@oclif/core";
import { type Reply, encodeText } from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationSendReply extends ConvosBaseCommand {
  static description = `Send a reply to a message.`;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
    "message-id": Args.string({ description: "The message ID to reply to", required: true }),
    text: Args.string({ description: "The reply text", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationSendReply);
    const config = this.getConvosConfig();
    const store = createIdentityStore();

    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    const client = await createClientForIdentity(identity, config);
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const reply: Reply = { reference: args["message-id"], content: encodeText(args.text) };
    const messageId = await conversation.sendReply(reply);

    this.output({
      success: true, messageId, conversationId: args.id,
      referenceMessageId: args["message-id"], text: args.text,
    });
  }
}
