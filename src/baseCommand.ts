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

/**
 * Extract a nested value from an object using dot-separated path.
 * e.g. getNestedValue({ a: { b: 1 } }, "a.b") → 1
 */
function getNestedValue(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Set a nested value on an object using dot-separated path.
 * e.g. setNestedValue({}, "a.b", 1) → { a: { b: 1 } }
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Apply a field mask to data, returning only the specified fields.
 * Supports dot notation for nested fields (e.g. "contentType.typeId").
 * If the data is an array, the mask is applied to each element.
 */
function applyFieldMask(data: unknown, fields: string[]): unknown {
  if (data == null) return data;

  if (Array.isArray(data)) {
    return data.map((item) => applyFieldMask(item, fields));
  }

  if (typeof data !== "object") return data;

  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = getNestedValue(data, field);
    if (value !== undefined) {
      setNestedValue(result, field, value);
    }
  }
  return result;
}

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
    fields: Flags.string({
      description:
        "Comma-separated list of fields to include in JSON output (supports nested paths with dot notation, e.g. id,content,contentType.typeId)",
      helpValue: "<fields>",
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
  #fields: string[] | undefined;

  async init(): Promise<void> {
    await super.init();
    const { flags } = await this.parse(
      this.constructor as typeof ConvosBaseCommand,
    );

    // Load config from .env file
    // Priority: explicit --env-file > .env in cwd > ~/.convos/.env
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
    } else {
      const { loadEnvFile } = await import("node:process");
      const { resolve, join } = await import("node:path");
      const { homedir } = await import("node:os");
      try {
        loadEnvFile(resolve(process.cwd(), ".env"));
      } catch {
        try {
          loadEnvFile(join(homedir(), ".convos", ".env"));
        } catch {
          // Silently ignore if neither file exists
        }
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
      uploadProvider: env.CONVOS_UPLOAD_PROVIDER,
      uploadProviderToken: env.CONVOS_UPLOAD_PROVIDER_TOKEN,
      uploadProviderGateway: env.CONVOS_UPLOAD_PROVIDER_GATEWAY,
    };

    this.jsonOutput = flags.json || env.CONVOS_JSON_OUTPUT === "true";
    this.verbose = flags.verbose || env.CONVOS_VERBOSE === "true";
    if (flags.fields) {
      this.#fields = flags.fields.split(",").map((f) => f.trim()).filter(Boolean);
      // --fields implies --json
      this.jsonOutput = true;
    }
  }

  output(data: unknown): void {
    const filtered = this.#fields ? applyFieldMask(data, this.#fields) : data;
    if (this.jsonOutput) {
      this.log(jsonStringify(filtered, true));
    } else {
      this.log(formatHuman(filtered));
    }
  }

  streamOutput(data: unknown): void {
    const filtered = this.#fields ? applyFieldMask(data, this.#fields) : data;
    if (this.jsonOutput) {
      this.log(jsonStringify(filtered));
    } else {
      this.log(formatHuman(filtered));
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
