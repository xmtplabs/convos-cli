import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";

export default class ConversationSendRemoteAttachment extends ConvosBaseCommand {
  static description = `Send a remote attachment message to a conversation.

Sends a reference to an encrypted file that has been uploaded to a URL.
The recipient downloads and decrypts the file using the provided keys.

Use 'conversation send-attachment --encrypt' to encrypt a file and get
the required keys, then upload the encrypted payload and use this
command to send the message.`;

  static examples = [
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> https://example.com/file.enc --content-digest abc123 --secret <base64> --salt <base64> --nonce <base64> --content-length 12345",
      description: "Send a remote attachment",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> https://example.com/photo.enc --content-digest abc123 --secret <base64> --salt <base64> --nonce <base64> --content-length 12345 --filename photo.jpg",
      description: "Send with original filename",
    },
  ];

  static args = {
    id: Args.string({
      description: "The conversation ID",
      required: true,
    }),
    url: Args.string({
      description: "URL where the encrypted file is hosted",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    "content-digest": Flags.string({
      description: "SHA-256 digest of the encrypted payload (hex)",
      required: true,
    }),
    secret: Flags.string({
      description: "Decryption secret key (base64)",
      required: true,
    }),
    salt: Flags.string({
      description: "Encryption salt (base64)",
      required: true,
    }),
    nonce: Flags.string({
      description: "Encryption nonce (base64)",
      required: true,
    }),
    scheme: Flags.string({
      description: "URL scheme",
      default: "https",
    }),
    "content-length": Flags.integer({
      description: "Size of the encrypted payload in bytes",
      required: true,
    }),
    filename: Flags.string({
      description: "Original filename",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(
      ConversationSendRemoteAttachment,
    );
    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());
    const conversation = await client.conversations.getConversationById(
      args.id,
    );

    if (!conversation) {
      this.error(`Conversation not found: ${args.id}`);
    }

    const remoteAttachment = {
      url: args.url,
      contentDigest: flags["content-digest"],
      secret: new Uint8Array(Buffer.from(flags.secret, "base64")),
      salt: new Uint8Array(Buffer.from(flags.salt, "base64")),
      nonce: new Uint8Array(Buffer.from(flags.nonce, "base64")),
      scheme: flags.scheme,
      contentLength: flags["content-length"],
      filename: flags.filename,
    };

    const messageId = await conversation.sendRemoteAttachment(
      remoteAttachment,
      false,
    );

    this.output({
      success: true,
      messageId,
      conversationId: args.id,
      url: args.url,
      filename: flags.filename,
    });
  }
}
