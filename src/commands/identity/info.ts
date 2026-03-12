import { Args } from "@oclif/core";
import { getAccountAddress, formatSections } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class IdentityInfo extends ConvosBaseCommand {
  static description = `Display detailed information about an identity.

Shows wallet address, XMTP inbox ID, linked conversation, profile
settings, and XMTP client details. Creates and registers the XMTP
client if not yet registered.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <identity-id>",
      description: "Show identity details",
    },
  ];

  static args = {
    id: Args.string({
      description: "The identity ID",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { args } = await this.parse(IdentityInfo);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    const identity = store.get(args.id);
    if (!identity) {
      this.error(`Identity not found: ${args.id}`);
    }

    const client = await createClientForIdentity(identity, config, this.getConvosHome());

    const properties = {
      id: identity.id,
      address: getAccountAddress(identity.walletKey),
      inboxId: client.inboxId,
      installationId: client.installationId,
      isRegistered: client.isRegistered,
      conversationId: identity.conversationId ?? "(unlinked)",
      label: identity.label ?? "",
      profileName: identity.profileName ?? "",
      createdAt: identity.createdAt,
    };

    const clientInfo = {
      env: config.env,
      libxmtpVersion: client.libxmtpVersion,
      appVersion: client.appVersion,
      disableDeviceSync: true,
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
