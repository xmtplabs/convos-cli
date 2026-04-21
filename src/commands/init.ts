import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Command, Errors, Flags } from "@oclif/core";
import { VALID_ENVS } from "../utils/xmtp.js";

export default class Init extends Command {
  static description = `Initialize Convos CLI configuration.

Sets up the Convos data directory structure and writes a default .env file.
The single XMTP inbox identity for this install is created lazily on first use
(see 'convos identity create' to create it up-front).

This command creates:
- The data directory (default: ~/.convos, override with --home or $CONVOS_HOME)
- A .env file with default environment settings`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: `Initialize with default settings`,
    },
    {
      command: "<%= config.bin %> <%= command.id %> --env production",
      description: "Initialize with production environment",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --force",
      description: "Overwrite existing configuration",
    },
    {
      command: "<%= config.bin %> <%= command.id %> --home /tmp/agent1",
      description: "Initialize with a custom data directory",
    },
  ];

  static flags = {
    home: Flags.string({
      description:
        "Path to Convos data directory (default: $CONVOS_HOME or ~/.convos)",
      helpValue: "<path>",
      env: "CONVOS_HOME",
    }),
    stdout: Flags.boolean({
      description: "Output configuration to stdout instead of writing to file",
      default: false,
    }),
    output: Flags.string({
      char: "o",
      description: "Path to write .env file",
      helpValue: "<path>",
    }),
    env: Flags.option({
      options: [...VALID_ENVS],
      description: "XMTP environment",
      default: "dev",
    })(),
    force: Flags.boolean({
      char: "f",
      description: "Overwrite existing configuration",
      default: false,
    }),
  };

  catch(error: Error): never {
    if (error instanceof Errors.CLIError) {
      (error as Error & { showHelp?: boolean }).showHelp = false;
      throw error;
    }
    const cliError = new Errors.CLIError(error.message);
    (cliError as Error & { showHelp?: boolean }).showHelp = false;
    throw cliError;
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    const convosHome = flags.home ?? join(homedir(), ".convos");

    const envContent = `# Convos CLI Configuration
# One XMTP inbox identity per install (ADR 011), stored in this directory.
CONVOS_ENV=${flags.env}
`;

    if (flags.stdout) {
      this.log(envContent);
      return;
    }

    const defaultEnvPath = join(convosHome, ".env");
    const outputPath = resolve(flags.output ?? defaultEnvPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await mkdir(convosHome, { recursive: true });

    let fileExists = false;
    try {
      await access(outputPath);
      fileExists = true;
    } catch {}

    if (fileExists && !flags.force) {
      this.error(
        `File already exists: ${outputPath}\nUse --force to overwrite.`,
      );
    }

    await writeFile(outputPath, envContent, "utf-8");
    this.log(`Configuration written to ${outputPath}`);
    this.log(`\nNext steps:`);
    this.log(
      `  convos conversations create --name "My Group"  # Create a conversation`,
    );
    this.log(
      `  convos identity list                           # Show this install's identity`,
    );
  }
}
