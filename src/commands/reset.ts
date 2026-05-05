import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../baseCommand.js";
import { createIdentityStore } from "../utils/identities.js";

export default class Reset extends ConvosBaseCommand {
  static description = `Reset Convos by deleting the install's identity and all data.

Permanently removes the identity, wallet key, database encryption
key, and every XMTP database file under this CONVOS_HOME. The .env
configuration file is preserved.

This is irreversible — all cryptographic keys will be destroyed and
conversations become unreadable on this install.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "Reset with confirmation prompt",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --force",
      description: "Reset without confirmation",
    },
  ];

  static flags = {
    ...ConvosBaseCommand.commonFlags,
    force: Flags.boolean({
      char: "f",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Reset);
    const convosHome = this.getConvosHome();
    const store = createIdentityStore(convosHome);
    const identity = store.load();

    const dbDir = join(convosHome, "db");
    let dbFileCount = 0;
    if (existsSync(dbDir)) {
      for (const envDir of readdirSync(dbDir)) {
        const envPath = join(dbDir, envDir);
        try {
          dbFileCount += readdirSync(envPath).length;
        } catch {
          // skip non-directories
        }
      }
    }

    // Count any files under identities/ so the confirmation and the result
    // accurately reflect what gets swept.
    const legacyIdentitiesDir = join(convosHome, "identities");
    let legacyIdentityCount = 0;
    if (existsSync(legacyIdentitiesDir)) {
      legacyIdentityCount = readdirSync(legacyIdentitiesDir).filter((f) =>
        f.endsWith(".json"),
      ).length;
    }

    if (!identity && dbFileCount === 0 && legacyIdentityCount === 0) {
      this.output({
        success: true,
        message: "Nothing to reset — no identity or databases found.",
      });
      return;
    }

    await this.confirmAction(
      `This will permanently delete:\n` +
        `  • ${identity ? "the install's identity" : "(no current identity)"}\n` +
        (legacyIdentityCount > 0
          ? `  • ${legacyIdentityCount} legacy per-conversation identity ${legacyIdentityCount === 1 ? "file" : "files"}\n`
          : "") +
        `  • ${dbFileCount} database ${dbFileCount === 1 ? "file" : "files"}\n\n` +
        `All cryptographic keys will be destroyed. This cannot be undone.`,
      flags.force,
    );

    if (identity) {
      store.delete();
    }

    if (existsSync(legacyIdentitiesDir)) {
      rmSync(legacyIdentitiesDir, { recursive: true, force: true });
    }

    if (existsSync(dbDir)) {
      rmSync(dbDir, { recursive: true, force: true });
    }

    this.output({
      success: true,
      identityRemoved: !!identity,
      legacyIdentitiesRemoved: legacyIdentityCount,
      dbFilesRemoved: dbFileCount,
      message:
        "Identity and conversation data have been destroyed. " +
        "Your .env configuration has been preserved.",
    });
  }
}
