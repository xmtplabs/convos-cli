import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createIdentityStore } from "../../utils/identities.js";

export default class IdentityRemove extends ConvosBaseCommand {
  static description = `Remove an identity and all associated data.

Permanently deletes the identity's wallet key, database encryption key,
XMTP database files, and all local data. This is irreversible.

Per ADR 002 and ADR 004: destroying an identity destroys the
cryptographic material needed to participate in its conversation.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <identity-id> --force",
      description: "Remove an identity",
    },
  ];

  static args = {
    id: Args.string({
      description: "The identity ID to remove",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    force: Flags.boolean({
      char: "f",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(IdentityRemove);
    const store = createIdentityStore();

    const identity = store.get(args.id);
    if (!identity) {
      this.error(`Identity not found: ${args.id}`);
    }

    await this.confirmAction(
      `This will permanently delete identity ${args.id}` +
        (identity.conversationId
          ? ` and its conversation ${identity.conversationId}`
          : "") +
        ". All cryptographic keys will be destroyed.",
      flags.force,
    );

    store.remove(args.id);

    this.output({
      success: true,
      removedIdentityId: args.id,
      removedConversationId: identity.conversationId ?? null,
    });
  }
}
