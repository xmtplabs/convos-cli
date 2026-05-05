import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Args, Flags } from "@oclif/core";
import { encryptAttachment } from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { getMimeType } from "../../utils/mime.js";
import {
  getUploadProvider,
  INLINE_ATTACHMENT_MAX_BYTES,
} from "../../utils/upload.js";

export default class ConversationSendAttachment extends ConvosBaseCommand {
  static description = `Send a file attachment to a conversation.

Reads a file from disk and sends it as an attachment message. Small
files (≤1MB) are sent inline; large files are automatically encrypted
and uploaded via the configured upload provider, then sent as a remote
attachment.

To configure an upload provider for large files, add to your .env:

  CONVOS_API_KEY=<your-agent-api-key>

Or explicitly:

  CONVOS_UPLOAD_PROVIDER=convos-api
  CONVOS_API_KEY=<your-agent-api-key>

The MIME type is auto-detected from the file extension, or can be
specified manually with --mime-type.

Use --encrypt to only encrypt the file and output decryption keys
without sending (for manual upload workflows).`;

  static examples = [
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> ./photo.jpg",
      description: "Send a photo (auto-detects inline vs remote)",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> ./photo.jpg --remote",
      description: "Force remote upload even for small files",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> ./photo.jpg --encrypt",
      description:
        "Encrypt and output decryption keys (for manual upload)",
    },
  ];

  static args = {
    id: Args.string({
      description: "The conversation ID",
      required: true,
    }),
    file: Args.string({
      description: "Path to the file to send",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    "mime-type": Flags.string({
      description: "Override the auto-detected MIME type",
      helpValue: "<type>",
    }),
    encrypt: Flags.boolean({
      description:
        "Encrypt the attachment and output decryption keys instead of sending. Upload the payload yourself, then use 'send-remote-attachment' to send.",
      default: false,
    }),
    "encrypted-output": Flags.string({
      description:
        "When using --encrypt, write encrypted payload to this path (default: <file>.encrypted)",
      helpValue: "<path>",
      dependsOn: ["encrypt"],
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
    remote: Flags.boolean({
      description:
        "Force sending as a remote attachment (encrypt + upload), even for small files",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationSendAttachment);

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

    const content = await readFile(args.file);
    const filename = basename(args.file);
    const mimeType = flags["mime-type"] ?? getMimeType(args.file);

    const attachment = {
      mimeType,
      content,
      filename,
    };

    // --encrypt: just encrypt and output keys, don't send
    if (flags.encrypt) {
      const encrypted = encryptAttachment(attachment);
      const outputPath = flags["encrypted-output"] ?? `${args.file}.encrypted`;
      await writeFile(outputPath, encrypted.payload);

      this.output({
        encryptedFile: outputPath,
        filename,
        mimeType,
        contentDigest: encrypted.contentDigest,
        secret: Buffer.from(encrypted.secret).toString("base64"),
        salt: Buffer.from(encrypted.salt).toString("base64"),
        nonce: Buffer.from(encrypted.nonce).toString("base64"),
        contentLength: encrypted.payload.length,
        note: "Upload the encrypted file to a URL, then use 'conversation send-remote-attachment' to send it.",
      });
      return;
    }

    const client = await getClient(config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(
      args.id,
    );

    if (!conversation) {
      this.error(`Conversation not found: ${args.id}`);
    }

    const needsRemote =
      flags.remote || content.length > INLINE_ATTACHMENT_MAX_BYTES;

    if (needsRemote) {
      const provider = getUploadProvider(config);

      if (!provider) {
        this.error(
          `File is ${content.length} bytes (>${INLINE_ATTACHMENT_MAX_BYTES}). ` +
            `Configure an upload provider to send large files.\n\n` +
            `Set in your .env:\n` +
            `  CONVOS_API_KEY=<your-agent-api-key>\n\n` +
            `Or use --encrypt to manually encrypt and upload.`,
        );
      }

      const encrypted = encryptAttachment(attachment);
      const url = await provider.upload(encrypted.payload, filename, mimeType);

      const messageId = await conversation.sendRemoteAttachment(
        {
          url,
          contentDigest: encrypted.contentDigest,
          secret: encrypted.secret,
          salt: encrypted.salt,
          nonce: encrypted.nonce,
          scheme: "https",
          contentLength: encrypted.payload.length,
          filename,
        },
        false,
      );

      this.output({
        success: true,
        messageId,
        conversationId: args.id,
        filename,
        mimeType,
        size: content.length,
        type: "remote",
        provider: provider.name,
        url,
      });
    } else {
      const messageId = await conversation.sendAttachment(attachment, false);

      this.output({
        success: true,
        messageId,
        conversationId: args.id,
        filename,
        mimeType,
        size: content.length,
        type: "inline",
      });
    }
  }
}
