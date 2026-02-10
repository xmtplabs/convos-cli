import { Args, Flags } from "@oclif/core";
import {
  ContentType,
  DeliveryStatus,
  GroupMessageKind,
  SortDirection,
  type ListMessagesOptions,
} from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

const contentTypeOptions = [
  "actions", "attachment", "custom", "group-membership-change",
  "group-updated", "intent", "leave-request", "markdown",
  "multi-remote-attachment", "reaction", "read-receipt",
  "remote-attachment", "reply", "text", "transaction-reference",
  "wallet-send-calls",
] as const;

const contentTypeMap: Record<string, ContentType> = {
  actions: ContentType.Actions, attachment: ContentType.Attachment,
  custom: ContentType.Custom,
  "group-membership-change": ContentType.GroupMembershipChange,
  "group-updated": ContentType.GroupUpdated, intent: ContentType.Intent,
  "leave-request": ContentType.LeaveRequest, markdown: ContentType.Markdown,
  "multi-remote-attachment": ContentType.MultiRemoteAttachment,
  reaction: ContentType.Reaction, "read-receipt": ContentType.ReadReceipt,
  "remote-attachment": ContentType.RemoteAttachment, reply: ContentType.Reply,
  text: ContentType.Text,
  "transaction-reference": ContentType.TransactionReference,
  "wallet-send-calls": ContentType.WalletSendCalls,
};

export default class ConversationMessages extends ConvosBaseCommand {
  static description = `List messages in a conversation.

Retrieves messages using the per-conversation identity.
Supports filtering, pagination, and sorting.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <conversation-id>",
      description: "List messages",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> --sync --limit 10",
      description: "Sync and show last 10 messages",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    sync: Flags.boolean({
      description: "Sync from network before listing",
      default: false,
    }),
    limit: Flags.integer({
      description: "Maximum number of messages",
      helpValue: "<number>",
    }),
    direction: Flags.option({
      options: ["ascending", "descending"] as const,
      description: "Sort direction",
      default: "descending" as const,
    })(),
    "sent-before": Flags.string({
      description: "Only messages sent before this timestamp (nanoseconds)",
      helpValue: "<ns>",
    }),
    "sent-after": Flags.string({
      description: "Only messages sent after this timestamp (nanoseconds)",
      helpValue: "<ns>",
    }),
    "delivery-status": Flags.option({
      options: ["unpublished", "published", "failed"] as const,
      description: "Filter by delivery status",
    })(),
    kind: Flags.option({
      options: ["application", "membership-change"] as const,
      description: "Filter by message kind",
    })(),
    "content-type": Flags.option({
      options: contentTypeOptions,
      description: "Filter by content type (repeatable)",
      multiple: true,
    })(),
    "exclude-content-type": Flags.option({
      options: contentTypeOptions,
      description: "Exclude content type (repeatable)",
      multiple: true,
    })(),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationMessages);
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

    if (flags.sync) await conversation.sync();

    const options: ListMessagesOptions = {};
    if (flags.limit !== undefined) options.limit = flags.limit;
    options.direction = flags.direction === "ascending"
      ? SortDirection.Ascending : SortDirection.Descending;
    options.sentBeforeNs = this.parseBigInt(flags["sent-before"], "sent-before");
    options.sentAfterNs = this.parseBigInt(flags["sent-after"], "sent-after");

    if (flags["delivery-status"]) {
      const map: Record<string, DeliveryStatus> = {
        unpublished: DeliveryStatus.Unpublished,
        published: DeliveryStatus.Published,
        failed: DeliveryStatus.Failed,
      };
      options.deliveryStatus = map[flags["delivery-status"]];
    }
    if (flags.kind) {
      const map: Record<string, GroupMessageKind> = {
        application: GroupMessageKind.Application,
        "membership-change": GroupMessageKind.MembershipChange,
      };
      options.kind = map[flags.kind];
    }
    if (flags["content-type"]?.length) {
      options.contentTypes = flags["content-type"].map((ct) => contentTypeMap[ct]);
    }
    if (flags["exclude-content-type"]?.length) {
      options.excludeContentTypes = flags["exclude-content-type"].map((ct) => contentTypeMap[ct]);
    }

    const messages = await conversation.messages(options);
    this.output(
      messages.map((m) => ({
        id: m.id,
        senderInboxId: m.senderInboxId,
        contentType: m.contentType,
        content: m.content,
        sentAt: m.sentAt.toISOString(),
        deliveryStatus: m.deliveryStatus,
      })),
    );
  }
}
