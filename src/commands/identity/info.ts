import { getAccountAddress, formatSections } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getClient } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class IdentityInfo extends ConvosBaseCommand {
  static description = `Display detailed information about this install's identity.

Shows wallet address, XMTP inbox ID, default profile settings, and
XMTP client details. Creates and registers the XMTP client if not
yet registered.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "Show identity details",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    if (!store.exists()) {
      this.error(
        "No identity found. Create one with: convos identity create",
      );
    }

    const client = await getClient(config, this.getConvosHome());
    const identity = store.load()!;

    const properties = {
      id: identity.id,
      address: getAccountAddress(identity.walletKey),
      inboxId: client.inboxId,
      installationId: client.installationId,
      isRegistered: client.isRegistered,
      label: identity.label ?? "",
      profileName: identity.profileName ?? "",
      createdAt: identity.createdAt,
    };

    const clientInfo = {
      env: config.env,
      libxmtpVersion: client.libxmtpVersion,
      appVersion: client.appVersion,
    };

    if (this.jsonOutput) {
      this.output({ properties, client: clientInfo });
    } else {
      this.log(
        formatSections(
          [
            { title: "Identity", data: properties },
            { title: "Client", data: clientInfo },
          ],
          2,
        ),
      );
    }
  }
}
