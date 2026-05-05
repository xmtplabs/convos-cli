import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { requireGroup } from "../../utils/xmtp.js";
import {
  CloudConnectionGrantRequestCodec,
  CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION,
  type CloudConnectionGrantRequest,
} from "../../utils/cloudConnectionGrantRequest.js";

export default class ConversationSendCloudConnectionGrantRequest extends ConvosBaseCommand {
  static description = `Send a CloudConnectionGrantRequest to a conversation.

Prompts the user (via a card on the receiving iOS device) to link a
cloud provider (e.g. Strava, Google Calendar) over OAuth. The device
performs the OAuth flow itself; the resulting grant becomes visible
through the next \`profile.metadata\` update under the unified
\`connections\` key — there is no on-wire reply codec.

The codec is silent (\`shouldPush=false\`); it does not surface in the
chat stream and emits as a \`cloud_connection_grant_request\` event on
\`agent serve\` instead.`;

  static examples = [
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --service strava --target-inbox-id <inbox> --reason "To summarize this week\'s training"',
      description: "Ask the user to link Strava",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --service google_calendar --target-inbox-id <inbox> --reason "To pull your calendar for scheduling" --json',
      description: "Ask the user to link Google Calendar",
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
    service: Flags.string({
      description:
        "Cloud service identifier (e.g. \"strava\", \"google_calendar\"). Used by iOS to render a service-specific link card.",
      required: true,
    }),
    "target-inbox-id": Flags.string({
      description: "Inbox ID of the user expected to complete the OAuth flow.",
      required: true,
    }),
    reason: Flags.string({
      description:
        "Free-form reason rendered verbatim on the link card. Truncated at 500 chars on encode and decode.",
      required: true,
    }),
    "requested-by-inbox-id": Flags.string({
      description:
        "Inbox ID requesting the grant. Defaults to the agent's own inbox ID.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationSendCloudConnectionGrantRequest);
    const config = this.getConvosConfig();

    const client = await getClient(config, this.getConvosHome());
    await client.conversations.sync();

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);
    const group = requireGroup(conversation);

    const request: CloudConnectionGrantRequest = {
      version: CLOUD_CONNECTION_GRANT_REQUEST_SUPPORTED_VERSION,
      service: flags.service,
      requestedByInboxId: flags["requested-by-inbox-id"] ?? client.inboxId,
      targetInboxId: flags["target-inbox-id"],
      reason: flags.reason,
    };

    const codec = new CloudConnectionGrantRequestCodec();
    const encoded = codec.encode(request);
    const messageId = await group.send(encoded);

    this.output({
      success: true,
      messageId,
      conversationId: args.id,
      service: request.service,
      requestedByInboxId: request.requestedByInboxId,
      targetInboxId: request.targetInboxId,
      reason: request.reason,
    });
  }
}
