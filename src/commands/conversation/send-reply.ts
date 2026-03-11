import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Args, Flags } from "@oclif/core";
import {
  encodeAttachment,
  encodeRemoteAttachment,
  encryptAttachment,
  encodeText,
  type Reply,
} from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { getMimeType } from "../../utils/mime.js";
import {
  getUploadProvider,
  INLINE_ATTACHMENT_MAX_BYTES,
} from "../../utils/upload.js";

export default class ConversationSendReply extends ConvosBaseCommand {
  static description = `Send a reply to a message.

By default, sends a text reply. Use --file to reply with a file
attachment instead. Small files (≤1MB) are sent inline; large files
are automatically encrypted and uploaded via the configured upload
provider, then sent as a remote attachment.`;

  static examples = [
    {
      command:
        '<%= config.bin %> <%= command.id %> <conversation-id> <message-id> "Reply text"',
      description: "Reply with text",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> <message-id> --file ./photo.jpg",
      description: "Reply with a photo",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
    "message-id": Args.string({
      description: "The message ID to reply to",
      required: true,
    }),
    text: Args.string({ description: "The reply text" }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    file: Flags.string({
      char: "f",
      description: "Path to a file to send as the reply (instead of text)",
      helpValue: "<path>",
    }),
    "mime-type": Flags.string({
      description: "Override the auto-detected MIME type (with --file)",
      helpValue: "<type>",
    }),
    remote: Flags.boolean({
      description:
        "Force sending file as a remote attachment, even for small files",
      default: false,
    }),
    "upload-provider": Flags.string({
      description: "Upload provider for remote attachments",
      helpValue: "<provider>",
    }),
    "upload-provider-token": Flags.string({
      description: "Authentication token for the upload provider",
      helpValue: "<token>",
    }),
    "upload-provider-gateway": Flags.string({
      description: "Custom gateway URL for the upload provider",
      helpValue: "<url>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationSendReply);
    const config = {
      ...this.getConvosConfig(),
      ...(flags["upload-provider"] && {
        uploadProvider: flags["upload-provider"],
      }),
      ...(flags["upload-provider-token"] && {
        uploadProviderToken: flags["upload-provider-token"],
      }),
      ...(flags["upload-provider-gateway"] && {
        uploadProviderGateway: flags["upload-provider-gateway"],
      }),
    };
    const store = createIdentityStore();

    const identity = store.getByConversationId(args.id);
    if (!identity) {
      this.error(`No identity found for conversation: ${args.id}`);
    }

    const client = await createClientForIdentity(identity, config);
    const conversation = await client.conversations.getConversationById(
      args.id,
    );
    if (!conversation) {
      this.error(`Conversation not found: ${args.id}`);
    }

    if (flags.file) {
      await this.sendFileReply(args, flags, config, conversation);
    } else if (args.text) {
      await this.sendTextReply(args, conversation);
    } else {
      this.error(
        'No content provided. Pass reply text as an argument or use --file.',
      );
    }
  }

  private async sendTextReply(
    args: { id: string; "message-id": string; text?: string },
    conversation: Awaited<
      ReturnType<
        Awaited<
          ReturnType<typeof createClientForIdentity>
        >["conversations"]["getConversationById"]
      >
    >,
  ): Promise<void> {
    const reply: Reply = {
      reference: args["message-id"],
      content: encodeText(args.text!),
    };
    const messageId = await conversation!.sendReply(reply);

    this.output({
      success: true,
      messageId,
      conversationId: args.id,
      referenceMessageId: args["message-id"],
      text: args.text,
    });
  }

  private async sendFileReply(
    args: { id: string; "message-id": string },
    flags: {
      file?: string;
      "mime-type"?: string;
      remote: boolean;
    },
    config: { uploadProvider?: string; uploadProviderToken?: string; uploadProviderGateway?: string },
    conversation: Awaited<
      ReturnType<
        Awaited<
          ReturnType<typeof createClientForIdentity>
        >["conversations"]["getConversationById"]
      >
    >,
  ): Promise<void> {
    const filePath = flags.file!;
    const content = await readFile(filePath);
    const filename = basename(filePath);
    const mimeType = flags["mime-type"] ?? getMimeType(filePath);

    const attachment = { mimeType, content, filename };
    const needsRemote =
      flags.remote || content.length > INLINE_ATTACHMENT_MAX_BYTES;

    let encodedContent;
    let type: string;
    let url: string | undefined;
    let providerName: string | undefined;

    if (needsRemote) {
      const provider = getUploadProvider(config);
      if (!provider) {
        this.error(
          `File is ${content.length} bytes (>${INLINE_ATTACHMENT_MAX_BYTES}). ` +
            `Configure an upload provider to send large files.\n\n` +
            `Set in your .env:\n` +
            `  CONVOS_API_KEY=<your-agent-api-key>`,
        );
      }

      const encrypted = encryptAttachment(attachment);
      url = await provider.upload(encrypted.payload, filename, mimeType);
      providerName = provider.name;

      encodedContent = encodeRemoteAttachment({
        url,
        contentDigest: encrypted.contentDigest,
        secret: encrypted.secret,
        salt: encrypted.salt,
        nonce: encrypted.nonce,
        scheme: "https",
        contentLength: encrypted.payload.length,
        filename,
      });
      type = "remote";
    } else {
      encodedContent = encodeAttachment(attachment);
      type = "inline";
    }

    const reply: Reply = {
      reference: args["message-id"],
      content: encodedContent,
    };
    const messageId = await conversation!.sendReply(reply);

    this.output({
      success: true,
      messageId,
      conversationId: args.id,
      referenceMessageId: args["message-id"],
      filename,
      mimeType,
      size: content.length,
      type,
      ...(url && { url }),
      ...(providerName && { provider: providerName }),
    });
  }
}
