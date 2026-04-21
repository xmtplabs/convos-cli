import { Flags } from "@oclif/core";
import { getAccountAddress } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class IdentityCreate extends ConvosBaseCommand {
  static description = `Create the Convos identity for this install.

Generates a wallet key and database encryption key for the single
XMTP inbox shared across all conversations on this install
(per ADR 011: Single-Inbox Identity Model).

Errors if an identity already exists. To run multiple independent
agents on one machine, point each at its own CONVOS_HOME.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "Create the identity",
    },
    {
      command: '<%= config.bin %> <%= command.id %> --label "My Bot"',
      description: "Create with a local label",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> --label "Agent" --profile-name "Assistant"',
      description: "Create with label and default profile name",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    label: Flags.string({
      description: "Local label for this identity (not shared)",
      helpValue: "<label>",
    }),
    "profile-name": Flags.string({
      description: "Default profile display name for this install",
      helpValue: "<name>",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IdentityCreate);
    const store = createIdentityStore(this.getConvosHome());

    if (store.exists()) {
      this.error(
        "An identity already exists for this install. " +
          "Use 'convos identity info' to view it, or 'convos identity remove' to replace it.",
      );
    }

    const identity = store.loadOrUpsert({
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
        "Identity created. Start using it with: convos conversations create",
    });
  }
}
