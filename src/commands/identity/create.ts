import { Flags } from "@oclif/core";
import { getAccountAddress } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class IdentityCreate extends ConvosBaseCommand {
  static description = `Create a new Convos identity.

Generates a new wallet key and database encryption key for use with
a single conversation. Each conversation gets its own identity for
maximum privacy (per ADR 002).

You can optionally set a label (local-only) and profile name (shared
with conversation members per ADR 005).`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "Create a new identity",
    },
    {
      command: '<%= config.bin %> <%= command.id %> --label "Work Chat"',
      description: "Create with a local label",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> --label "Team" --profile-name "Alice"',
      description: "Create with label and profile name",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    label: Flags.string({
      description: "Local label for this identity (not shared)",
      helpValue: "<label>",
    }),
    "profile-name": Flags.string({
      description: "Profile display name (shared with conversation members)",
      helpValue: "<name>",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IdentityCreate);
    const store = createIdentityStore();
    const identity = store.create({
      label: flags.label,
      profileName: flags["profile-name"],
    });

    this.output({
      id: identity.id,
      address: getAccountAddress(identity.walletKey),
      label: identity.label ?? "",
      profileName: identity.profileName ?? "",
      createdAt: identity.createdAt,
      message:
        "Identity created. Use it with: convos conversations create --identity " +
        identity.id,
    });
  }
}
