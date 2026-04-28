import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { requireGroup } from "../../utils/xmtp.js";
import {
  ConnectionInvocationCodec,
  CONNECTION_INVOCATION_CURRENT_SCHEMA_VERSION,
  type ConnectionInvocation,
} from "../../utils/connectionInvocation.js";
import {
  ALL_CONNECTION_KINDS,
  assertArgumentValue,
  dateToSwiftReference,
  type ArgumentValue,
  type ConnectionKind,
} from "../../utils/connectionTypes.js";

export default class ConversationSendInvocation extends ConvosBaseCommand {
  static description = `Send a ConvosConnections invocation to a conversation.

Constructs a ConnectionInvocation envelope (convos.org/connection_invocation:1.0)
and sends it to the conversation. The receiving device replies asynchronously
with a ConnectionInvocationResult keyed on the same --invocation-id.

Arguments are provided as a JSON object mapping parameter names to
ArgumentValue tagged objects ({type, value}). Each value is validated
before sending — a malformed tag or value type fails fast rather than
producing a payload the device will reject.`;

  static examples = [
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --kind calendar --action create_event \\\n  --arguments \'{"title":{"type":"string","value":"Team sync"},"isAllDay":{"type":"bool","value":false}}\'',
      description: "Send a calendar create_event invocation",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> --kind health --action log_water --arguments-file ./water.json",
      description: "Read arguments JSON from a file",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> --kind contacts --action create_contact --invocation-id req-42 --arguments \'{}\' --json',
      description: "Pin a known invocation-id for correlating the reply",
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
    kind: Flags.option({
      options: ALL_CONNECTION_KINDS as unknown as readonly [ConnectionKind, ...ConnectionKind[]],
      description: "ConnectionKind raw value (e.g. calendar, health, home_kit)",
      required: true,
    })(),
    action: Flags.string({
      description: "Action name as defined by the iOS DataSink (e.g. create_event)",
      helpValue: "<name>",
      required: true,
    }),
    "invocation-id": Flags.string({
      description: "Caller-supplied correlation ID (default: random)",
      helpValue: "<id>",
    }),
    arguments: Flags.string({
      description:
        "JSON object mapping arg names to ArgumentValue tagged objects " +
        '(e.g. {"title":{"type":"string","value":"x"}}). Use {} for an empty arg list.',
      helpValue: "<json>",
      exclusive: ["arguments-file"],
    }),
    "arguments-file": Flags.string({
      description: "Path to a JSON file containing the arguments object",
      helpValue: "<path>",
      exclusive: ["arguments"],
    }),
    "issued-at": Flags.string({
      description: "Issued-at timestamp (ISO 8601, default: now)",
      helpValue: "<iso8601>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationSendInvocation);
    const config = this.getConvosConfig();

    if (!flags.arguments && !flags["arguments-file"]) {
      this.error("Provide --arguments or --arguments-file (use '{}' for an empty arg list)");
    }

    const argumentsJson = flags["arguments-file"]
      ? await readFile(flags["arguments-file"], "utf8")
      : (flags.arguments as string);

    let argumentsParsed: unknown;
    try {
      argumentsParsed = JSON.parse(argumentsJson);
    } catch (error) {
      this.error(
        `Could not parse arguments JSON: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    if (!argumentsParsed || typeof argumentsParsed !== "object" || Array.isArray(argumentsParsed)) {
      this.error("--arguments must be a JSON object mapping names to ArgumentValue tagged objects");
    }

    const argumentsTyped: Record<string, ArgumentValue> = {};
    for (const [key, value] of Object.entries(argumentsParsed as Record<string, unknown>)) {
      try {
        assertArgumentValue(value, `arguments.${key}`);
      } catch (error) {
        this.error(error instanceof Error ? error.message : `arguments.${key}: invalid`);
      }
      argumentsTyped[key] = value as ArgumentValue;
    }

    let issuedAt: Date;
    if (flags["issued-at"]) {
      issuedAt = new Date(flags["issued-at"]);
      if (isNaN(issuedAt.getTime())) {
        this.error(`Invalid --issued-at timestamp: ${flags["issued-at"]}`);
      }
    } else {
      issuedAt = new Date();
    }

    const invocation: ConnectionInvocation = {
      id: randomUUID().toUpperCase(),
      schemaVersion: CONNECTION_INVOCATION_CURRENT_SCHEMA_VERSION,
      invocationId: flags["invocation-id"] ?? `cli-${randomUUID().slice(0, 8)}`,
      kind: flags.kind,
      action: {
        name: flags.action,
        arguments: argumentsTyped,
      },
      issuedAt: dateToSwiftReference(issuedAt),
    };

    const client = await getClient(config, this.getConvosHome());
    await client.conversations.sync();

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);
    const group = requireGroup(conversation);

    const codec = new ConnectionInvocationCodec();
    const encoded = codec.encode(invocation);
    const messageId = await group.send(encoded);

    this.output({
      success: true,
      messageId,
      conversationId: args.id,
      invocationId: invocation.invocationId,
      envelopeId: invocation.id,
      kind: invocation.kind,
      action: invocation.action.name,
      issuedAt: issuedAt.toISOString(),
    });
  }
}
