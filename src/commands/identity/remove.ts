import { Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class IdentityRemove extends ConvosBaseCommand {
  static description = `Remove this install's identity and all associated data.

Permanently deletes the wallet key, database encryption key, and all
XMTP database files. Any conversations this install participated in
remain on the network but this install can no longer access them.

This is irreversible.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> --force",
      description: "Remove the identity",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    force: Flags.boolean({
      char: "f",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IdentityRemove);
    const store = createIdentityStore(this.getConvosHome());

    const identity = store.load();
    if (!identity) {
      this.error("No identity found.");
    }

    await this.confirmAction(
      `This will permanently delete identity ${identity.id}. ` +
        "All cryptographic keys will be destroyed and the XMTP database " +
        "will be removed. You will lose access to all conversations on " +
        "this install.",
      flags.force,
    );

    store.delete();

    this.output({
      success: true,
      removedIdentityId: identity.id,
    });
  }
}
