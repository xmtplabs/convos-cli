import { randomUUID } from "node:crypto";
import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { requireGroup } from "../../utils/xmtp.js";
import {
  CapabilityRequestCodec,
  CAPABILITY_REQUEST_SUPPORTED_VERSION,
  type CapabilityRequest,
} from "../../utils/capabilityRequest.js";
import {
  ALL_CAPABILITY_SUBJECTS,
  type CapabilitySubject,
} from "../../utils/capabilityTypes.js";
import {
  ALL_CONNECTION_CAPABILITIES,
  type ConnectionCapability,
} from "../../utils/connectionTypes.js";

export default class ConversationSendCapabilityRequest extends ConvosBaseCommand {
  static description = `Send a CapabilityRequest to a conversation.

Asks the user (via the device's picker / confirmation card) for a
specific capability on a subject — calendar reads, fitness writes,
contacts deletes, etc. The device replies asynchronously with a
CapabilityRequestResult keyed on the same --request-id.

Subject vs. kind: 'subject' is the user-facing capability dimension
that may resolve to a device or cloud provider. iOS device kinds
\`health\` and \`home_kit\` correspond to subjects \`fitness\` and
\`home\`; \`motion\` has no subject (device-only telemetry).`;

  static examples = [
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --subject calendar --capability read --rationale "To summarize your week"',
      description: "Request calendar read access",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --subject fitness --capability read --rationale "To summarize training" --preferred-providers composio.strava,composio.fitbit',
      description: "Request fitness read with a federation hint (only fitness allows multi-provider reads)",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --subject contacts --capability write_create --rationale "To save the lead you mentioned" --request-id req-42 --json',
      description: "Pin a known requestId for correlating the eventual result",
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
    subject: Flags.option({
      options: ALL_CAPABILITY_SUBJECTS as unknown as readonly [CapabilitySubject, ...CapabilitySubject[]],
      description: "CapabilitySubject raw value (calendar, fitness, home, etc.)",
      required: true,
    })(),
    capability: Flags.option({
      options: ALL_CONNECTION_CAPABILITIES as unknown as readonly [ConnectionCapability, ...ConnectionCapability[]],
      description: "ConnectionCapability raw value (read, write_create, write_update, write_delete)",
      required: true,
    })(),
    rationale: Flags.string({
      description:
        "Free-form reason rendered verbatim on the picker card. Truncated at 500 chars on encode and decode.",
      helpValue: "<text>",
      required: true,
    }),
    "request-id": Flags.string({
      description: "Caller-supplied correlation ID (default: random)",
      helpValue: "<id>",
    }),
    "preferred-providers": Flags.string({
      description:
        "Comma-separated provider IDs the agent prefers the resolver default to " +
        "(e.g. composio.strava,composio.fitbit). Truncated to 16 entries.",
      helpValue: "<id1,id2,...>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationSendCapabilityRequest);
    const config = this.getConvosConfig();

    let preferredProviders: string[] | undefined;
    if (flags["preferred-providers"]) {
      preferredProviders = flags["preferred-providers"]
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      if (preferredProviders.length === 0) preferredProviders = undefined;
    }

    const client = await getClient(config, this.getConvosHome());
    await client.conversations.sync();

    const request: CapabilityRequest = {
      version: CAPABILITY_REQUEST_SUPPORTED_VERSION,
      requestId: flags["request-id"] ?? `cli-${randomUUID().slice(0, 8)}`,
      askerInboxId: client.inboxId,
      subject: flags.subject,
      capability: flags.capability,
      rationale: flags.rationale,
      ...(preferredProviders && { preferredProviders }),
    };

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);
    const group = requireGroup(conversation);

    const codec = new CapabilityRequestCodec();
    const encoded = codec.encode(request);
    const messageId = await group.send(encoded);

    this.output({
      success: true,
      messageId,
      conversationId: args.id,
      requestId: request.requestId,
      askerInboxId: request.askerInboxId,
      subject: request.subject,
      capability: request.capability,
      rationale: request.rationale,
      ...(request.preferredProviders && { preferredProviders: request.preferredProviders }),
    });
  }
}
