import { Args } from "@oclif/core";
import { ConsentState } from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";

export default class ConversationUpdateConsent extends ConvosBaseCommand {
  static description = `Update the consent state of a conversation.`;

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
    state: Args.string({
      description: "The new consent state",
      required: true,
      options: ["allowed", "denied", "unknown"],
    }),
  };

  static flags = { ...ConvosBaseCommand.baseFlags };

  async run(): Promise<void> {
    const { args } = await this.parse(ConversationUpdateConsent);
    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const map: Record<string, ConsentState> = {
      allowed: ConsentState.Allowed,
      denied: ConsentState.Denied,
      unknown: ConsentState.Unknown,
    };
    conversation.updateConsentState(map[args.state]);

    this.output({ success: true, conversationId: args.id, consentState: args.state });
  }
}
