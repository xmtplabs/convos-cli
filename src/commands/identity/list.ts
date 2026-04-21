import { getAccountAddress } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class IdentityList extends ConvosBaseCommand {
  static description = `List the Convos identity for this install.

Per ADR 011, each CLI install has a single XMTP inbox shared across
all conversations. This command returns zero or one entries — to run
multiple independent agents, use separate CONVOS_HOME directories.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "Show the identity",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --json",
      description: "Output as JSON",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const store = createIdentityStore(this.getConvosHome());
    const identity = store.load();

    if (!identity) {
      this.output({
        message:
          "No identity found. Create one with: convos identity create",
        count: 0,
      });
      return;
    }

    this.output([
      {
        id: identity.id,
        address: getAccountAddress(identity.walletKey),
        inboxId: identity.inboxId ?? "(not yet registered)",
        label: identity.label ?? "",
        profileName: identity.profileName ?? "",
        createdAt: identity.createdAt,
      },
    ]);
  }
}
