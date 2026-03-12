import { Args } from "@oclif/core";
import { type Reaction, ReactionAction, ReactionSchema } from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class ConversationSendReaction extends ConvosBaseCommand {
  static description = `Send a reaction to a message.`;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
    "message-id": Args.string({ description: "The message ID", required: true }),
    action: Args.string({ description: "add or remove", required: true, options: ["add", "remove"] }),
    emoji: Args.string({ description: "The reaction emoji", required: true }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationSendReaction);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    const identity = store.getByConversationId(args.id);
    if (!identity) this.error(`No identity found for conversation: ${args.id}`);

    const client = await createClientForIdentity(identity, config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const reaction: Reaction = {
      reference: args["message-id"],
      referenceInboxId: "",
      action: args.action === "add" ? ReactionAction.Added : ReactionAction.Removed,
      content: args.emoji,
      schema: ReactionSchema.Unicode,
    };
    const messageId = await conversation.sendReaction(reaction);

    this.output({
      success: true, messageId, conversationId: args.id,
      referenceMessageId: args["message-id"], action: args.action, emoji: args.emoji,
    });
  }
}
