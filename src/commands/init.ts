import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Command, Errors, Flags } from "@oclif/core";
import { VALID_ENVS } from "../utils/xmtp.js";

const CONVOS_HOME = join(homedir(), ".convos");
const DEFAULT_ENV_PATH = join(CONVOS_HOME, ".env");

export default class Init extends Command {
  static description = `Initialize Convos CLI configuration.

Sets up the ~/.convos directory structure and default environment.
Unlike standard XMTP, Convos does NOT generate a single wallet key.
Each conversation creates its own identity (see 'convos identity create').

This command creates:
- The ~/.convos directory
- A .env file with default environment settings
- The identities storage directory`;

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
  ];

  static flags = {
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

    const envContent = `# Convos CLI Configuration
# Each conversation creates its own identity — no global wallet key needed.
CONVOS_ENV=${flags.env}
`;

    if (flags.stdout) {
      this.log(envContent);
      return;
    }

    const outputPath = resolve(flags.output ?? DEFAULT_ENV_PATH);
    await mkdir(dirname(outputPath), { recursive: true });
    await mkdir(join(CONVOS_HOME, "identities"), { recursive: true });

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
      `  convos identity list                           # See all identities`,
    );
  }
}
