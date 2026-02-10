/**
 * Base command for Convos CLI.
 *
 * Provides:
 *  - Common flags (--env, --json, --log-level, etc.)
 *  - output() and streamOutput() helpers
 *  - Config loading from .env files
 *
 * Convos adds: per-conversation identity resolution. Instead of a
 * single wallet key, each conversation has its own identity with
 * its own keys. Commands use getConvosConfig() + the identity store.
 */

import { env } from "node:process";
import { createInterface } from "node:readline";
import { Command, Errors, Flags } from "@oclif/core";
import {
  formatHuman,
  isTTY,
  jsonStringify,
  VALID_ENVS,
} from "./utils/xmtp.js";
import type { ConvosConfig } from "./utils/config.js";

export class ConvosBaseCommand extends Command {
  /** Flags shared by all commands. */
  static commonFlags = {
    "env-file": Flags.string({
      description: "Path to .env file",
      helpValue: "<path>",
    }),
    env: Flags.option({
      options: [...VALID_ENVS],
      description: "XMTP environment",
    })(),
    "gateway-host": Flags.string({
      description: "Custom gateway URL",
      helpValue: "<url>",
    }),
    json: Flags.boolean({
      description: "Format output as JSON",
    }),
    verbose: Flags.boolean({
      description: "Show additional diagnostic information",
      default: false,
    }),
  };

  /** Full flag set for commands that create a client. */
  static baseFlags = {
    ...ConvosBaseCommand.commonFlags,
    "log-level": Flags.option({
      options: ["off", "error", "warn", "info", "debug", "trace"] as const,
      description: "Logging level",
    })(),
    "structured-logging": Flags.boolean({
      description: "Enable structured JSON logging",
    }),
    "app-version": Flags.string({
      description: "App version string",
      helpValue: "<version>",
    }),
  };

  #config: ConvosConfig = {};
  jsonOutput = false;
  verbose = false;

  async init(): Promise<void> {
    await super.init();
    const { flags } = await this.parse(
      this.constructor as typeof ConvosBaseCommand,
    );

    // Load config from .env file
    const envFile = flags["env-file"];
    if (envFile) {
      try {
        const { loadEnvFile } = await import("node:process");
        const { resolve } = await import("node:path");
        loadEnvFile(resolve(envFile));
      } catch (error) {
        throw new Error(`Failed to load env file: ${envFile}`, {
          cause: error,
        });
      }
    }

    // Merge env vars with CLI flags (CLI flags take precedence)
    this.#config = {
      env:
        flags.env ??
        (VALID_ENVS.includes(env.CONVOS_ENV as any)
          ? (env.CONVOS_ENV as ConvosConfig["env"])
          : undefined) ??
        "dev",
      logLevel: flags["log-level"] ?? env.XMTP_LOG_LEVEL,
      structuredLogging:
        flags["structured-logging"] ??
        (env.XMTP_STRUCTURED_LOGGING === "true" ? true : undefined),
      gatewayHost: flags["gateway-host"] ?? env.XMTP_GATEWAY_HOST,
      appVersion: flags["app-version"] ?? env.XMTP_APP_VERSION,
    };

    this.jsonOutput = flags.json || env.CONVOS_JSON_OUTPUT === "true";
    this.verbose = flags.verbose || env.CONVOS_VERBOSE === "true";
  }

  output(data: unknown): void {
    if (this.jsonOutput) {
      this.log(jsonStringify(data, true));
    } else {
      this.log(formatHuman(data));
    }
  }

  streamOutput(data: unknown): void {
    if (this.jsonOutput) {
      this.log(jsonStringify(data));
    } else {
      this.log(formatHuman(data));
    }
  }

  parseBigInt(value: string | undefined, flagName: string): bigint | undefined {
    if (value === undefined) return undefined;
    try {
      return BigInt(value);
    } catch {
      this.error(`Invalid value for --${flagName}: must be a numeric string`);
    }
  }

  async confirmAction(message: string, force?: boolean): Promise<void> {
    if (force) return;
    if (!isTTY()) {
      this.error(
        "Cannot confirm in non-interactive terminal. Use --force to skip confirmation.",
      );
    }
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`WARNING: ${message}\nAre you sure? (y/N) `, resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== "y") {
      this.error("Operation cancelled");
    }
  }

  getConvosConfig(): ConvosConfig {
    return this.#config;
  }

  async run(): Promise<void> {
    // Override in subclasses
  }

  catch(error: Error): never {
    if (error instanceof Errors.CLIError) {
      (error as any).showHelp = false;
      throw error;
    }
    const cliError = new Errors.CLIError(error.message);
    (cliError as any).showHelp = true;
    (cliError as any).parse = { input: { argv: this.argv } };
    throw cliError;
  }
}
