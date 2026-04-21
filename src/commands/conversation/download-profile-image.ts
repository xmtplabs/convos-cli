import { writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cwd } from "node:process";
import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import {
  decryptImage,
  fetchImageData,
} from "../../utils/imageEncryption.js";
import { parseAppData } from "../../utils/metadata.js";
import { resolveProfilesFromMessages } from "../../utils/profileMessages.js";
import { requireGroup } from "../../utils/xmtp.js";

export default class ConversationDownloadProfileImage extends ConvosBaseCommand {
  static description = `Download and decrypt a member's profile image.

Profile images are encrypted end-to-end using the group's image encryption
key (stored in appData) plus a per-image salt and nonce (carried in each
member's ProfileUpdate). This command reads the member's resolved profile,
fetches the encrypted blob, and writes the decrypted bytes to disk.

Requires the group to have an imageEncryptionKey in appData and the member
to have sent a ProfileUpdate containing an encryptedImage ref.`;

  static examples = [
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> <inbox-id>",
      description: "Download to auto-generated filename in the current directory",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> <inbox-id> --output ./alice.jpg",
      description: "Download to a specific path",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <conversation-id> <inbox-id> --sync --json",
      description: "Sync first and output result as JSON",
    },
  ];

  static args = {
    id: Args.string({ description: "The conversation ID", required: true }),
    "inbox-id": Args.string({
      description: "The member's inbox ID",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    output: Flags.string({
      char: "o",
      description: "Output file path (default: ./<short-inbox-id>.bin)",
      helpValue: "<path>",
    }),
    sync: Flags.boolean({
      description: "Sync the conversation from network before reading",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationDownloadProfileImage);
    const config = this.getConvosConfig();
    const client = await getClient(config, this.getConvosHome());

    const conversation = await client.conversations.getConversationById(args.id);
    if (!conversation) this.error(`Conversation not found: ${args.id}`);

    const group = requireGroup(conversation);
    if (flags.sync) await group.sync();

    let appData = "";
    try {
      appData = group.appData ?? "";
    } catch {
      // no appData
    }
    const metadata = parseAppData(appData);
    if (!metadata.imageEncryptionKey || metadata.imageEncryptionKey.length === 0) {
      this.error(
        "This conversation has no imageEncryptionKey in appData. Cannot decrypt profile images.",
      );
    }
    const groupKey = metadata.imageEncryptionKey;

    const inboxId = args["inbox-id"].toLowerCase();
    const profiles = await resolveProfilesFromMessages(group);
    const profile = profiles.get(inboxId);
    if (!profile) {
      this.error(
        `No ProfileUpdate found for inbox ${args["inbox-id"]}. Try --sync or confirm the member has set a profile.`,
      );
    }
    const encryptedImage = profile.encryptedImage;
    if (!encryptedImage) {
      this.error(
        `Member ${args["inbox-id"]} has no encryptedImage in their profile.`,
      );
    }

    const ciphertext = await fetchImageData(encryptedImage.url);
    const plaintext = await decryptImage(
      ciphertext,
      groupKey,
      encryptedImage.salt,
      encryptedImage.nonce,
    );

    const defaultName = `${args["inbox-id"].slice(0, 16)}.bin`;
    const outputArg = flags.output ?? defaultName;
    const outputPath = isAbsolute(outputArg)
      ? outputArg
      : join(cwd(), outputArg);
    await mkdir(dirname(outputPath), { recursive: true });
    await fsWriteFile(outputPath, plaintext);

    this.output({
      success: true,
      conversationId: args.id,
      inboxId: args["inbox-id"],
      outputPath,
      size: plaintext.length,
      url: encryptedImage.url,
    });
  }
}

function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);
}
