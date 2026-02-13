import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../baseCommand.js";
import { createIdentityStore } from "../utils/identities.js";

const CONVOS_HOME = join(homedir(), ".convos");

export default class Reset extends ConvosBaseCommand {
  static description = `Reset Convos by deleting all identities and conversation data.

Permanently removes all per-conversation identities (wallet keys,
database encryption keys) and all XMTP databases. The .env
configuration file is preserved.

This is irreversible — all cryptographic keys will be destroyed
and conversations cannot be recovered.`;

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
    const store = createIdentityStore();
    const identities = store.list();

    const identitiesDir = join(CONVOS_HOME, "identities");
    const dbDir = join(CONVOS_HOME, "db");

    // Count what will be deleted
    const identityCount = identities.length;
    const conversationCount = identities.filter(
      (i) => i.conversationId,
    ).length;

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

    if (identityCount === 0 && dbFileCount === 0) {
      this.output({
        success: true,
        message: "Nothing to reset — no identities or databases found.",
      });
      return;
    }

    await this.confirmAction(
      `This will permanently delete:\n` +
        `  • ${identityCount} ${identityCount === 1 ? "identity" : "identities"}\n` +
        `  • ${conversationCount} linked ${conversationCount === 1 ? "conversation" : "conversations"}\n` +
        `  • ${dbFileCount} database ${dbFileCount === 1 ? "file" : "files"}\n\n` +
        `All cryptographic keys will be destroyed. This cannot be undone.`,
      flags.force,
    );

    // Delete all identity files
    let identitiesRemoved = 0;
    if (existsSync(identitiesDir)) {
      for (const file of readdirSync(identitiesDir)) {
        if (file.endsWith(".json")) {
          rmSync(join(identitiesDir, file));
          identitiesRemoved++;
        }
      }
    }

    // Delete all database files
    let dbFilesRemoved = 0;
    if (existsSync(dbDir)) {
      rmSync(dbDir, { recursive: true, force: true });
      dbFilesRemoved = dbFileCount;
    }

    this.output({
      success: true,
      identitiesRemoved,
      conversationsRemoved: conversationCount,
      dbFilesRemoved,
      message:
        "All identities and conversation data have been destroyed. " +
        "Your .env configuration has been preserved.",
    });
  }
}
