/**
 * Schema introspection command.
 *
 * Outputs machine-readable JSON describing all commands, their arguments,
 * flags, descriptions, and examples. Designed for AI agents to discover
 * tool capabilities at runtime without relying on pre-loaded documentation.
 *
 * Usage:
 *   convos schema                     — list all commands with summaries
 *   convos schema <command>           — detailed schema for a specific command
 *   convos schema --topic agent       — list commands in a topic
 */

import { Args, Command, Flags } from "@oclif/core";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Common flags that appear on every command — listed once, not repeated. */
const COMMON_FLAG_NAMES = new Set([
  "env-file",
  "env",
  "gateway-host",
  "json",
  "fields",
  "verbose",
  "log-level",
  "structured-logging",
  "app-version",
]);

interface ManifestFlag {
  name: string;
  description?: string;
  type: "boolean" | "option";
  char?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  helpValue?: string;
  multiple?: boolean;
  allowNo?: boolean;
}

interface ManifestArg {
  name: string;
  description?: string;
  required?: boolean;
  options?: string[];
  default?: unknown;
}

interface ManifestCommand {
  id: string;
  description?: string;
  aliases?: string[];
  args?: Record<string, ManifestArg>;
  flags?: Record<string, ManifestFlag>;
  examples?: Array<{ command: string; description: string } | string>;
  strict?: boolean;
}

function loadManifest(): Record<string, ManifestCommand> {
  // The manifest is generated at build time by `oclif manifest`
  // and bundled with the package. Look relative to the commands dir.
  const manifestPath = join(__dirname, "..", "..", "oclif.manifest.json");
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    return manifest.commands ?? {};
  } catch {
    // Fallback: try from cwd (development)
    try {
      const raw = readFileSync(
        join(process.cwd(), "oclif.manifest.json"),
        "utf-8",
      );
      const manifest = JSON.parse(raw);
      return manifest.commands ?? {};
    } catch {
      return {};
    }
  }
}

function cleanFlag(flag: ManifestFlag): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: flag.type,
  };
  if (flag.char) result.char = flag.char;
  if (flag.description) result.description = flag.description;
  if (flag.required) result.required = true;
  if (flag.default !== undefined) result.default = flag.default;
  if (flag.options) result.options = flag.options;
  if (flag.helpValue) result.helpValue = flag.helpValue;
  if (flag.type === "boolean" && flag.allowNo) result.allowNo = true;
  return result;
}

function cleanArg(arg: ManifestArg): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (arg.description) result.description = arg.description;
  if (arg.required) result.required = true;
  if (arg.options) result.options = arg.options;
  if (arg.default !== undefined) result.default = arg.default;
  return result;
}

function cleanExamples(
  cmd: ManifestCommand,
  examples: Array<{ command: string; description: string } | string>,
): Array<{ command: string; description?: string }> {
  const cmdName = cmd.id.replace(/:/g, " ");
  return examples.map((ex) => {
    if (typeof ex === "string") {
      return {
        command: ex
          .replace(/<%= config\.bin %>/g, "convos")
          .replace(/<%= command\.id %>/g, cmdName),
      };
    }
    return {
      command: ex.command
        .replace(/<%= config\.bin %>/g, "convos")
        .replace(/<%= command\.id %>/g, cmdName),
      ...(ex.description && { description: ex.description }),
    };
  });
}

function commandUsage(cmd: ManifestCommand): string {
  const parts = ["convos", cmd.id.replace(/:/g, " ")];
  const args = Object.values(cmd.args ?? {});
  for (const arg of args) {
    if (arg.required) {
      parts.push(`<${arg.name}>`);
    } else {
      parts.push(`[${arg.name}]`);
    }
  }
  return parts.join(" ");
}

export default class Schema extends Command {
  static description = `Introspect CLI command schemas.

Outputs machine-readable JSON describing commands, arguments, flags,
and examples. Designed for AI agents to discover tool capabilities
at runtime without pre-loaded documentation.

With no arguments, lists all commands with summaries.
With a command name, shows the full schema for that command.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %>",
      description: "List all commands",
    },
    {
      command: "<%= config.bin %> <%= command.id %> conversation:send-text",
      description: "Show schema for send-text",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> --topic conversation',
      description: "List conversation commands",
    },
  ];

  static strict = false;

  static args = {
    command: Args.string({
      description:
        "Command to describe (e.g. conversation:send-text or 'conversation send-text')",
      required: false,
    }),
  };

  static flags = {
    topic: Flags.string({
      description: "Filter commands by topic",
      helpValue: "<topic>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags, argv } = await this.parse(Schema);
    const commands = loadManifest();

    if (Object.keys(commands).length === 0) {
      this.error(
        "Command schema not available. Run `npx oclif manifest` to generate it.",
      );
    }

    // Resolve command name — support both "conversation:send-text" and "conversation send-text"
    // With strict:false, args.command gets the first positional and argv gets ALL positionals.
    // So for `convos schema conversation send-text`:
    //   args.command = "conversation", argv = ["conversation", "send-text"]
    // For `convos schema conversation:send-text`:
    //   args.command = "conversation:send-text", argv = ["conversation:send-text"]
    const rawCommand = (argv as string[]).length > 0
      ? (argv as string[]).join(":")
      : args.command;
    const commandName = rawCommand?.replace(/\s+/g, ":");

    if (commandName) {
      // Detail view for a single command
      const cmd = commands[commandName];
      if (!cmd) {
        const available = Object.keys(commands)
          .filter((k) =>
            k.toLowerCase().includes(commandName.toLowerCase()),
          )
          .slice(0, 5);
        this.error(
          `Unknown command: ${commandName}` +
            (available.length
              ? `\n\nDid you mean?\n  ${available.join("\n  ")}`
              : ""),
        );
      }

      this.outputSchema(cmd);
    } else {
      // List view
      const topic = flags.topic;
      const filtered = Object.values(commands).filter((cmd) => {
        if (cmd.id === "schema") return false; // Don't list ourselves
        if (topic) return cmd.id.startsWith(topic + ":");
        return true;
      });

      const summary = {
        version: this.config.version,
        commandCount: filtered.length,
        commonFlags: this.buildCommonFlags(commands),
        commands: filtered
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((cmd) => ({
            id: cmd.id,
            usage: commandUsage(cmd),
            description: cmd.description?.split("\n")[0] ?? "",
          })),
      };
      this.log(JSON.stringify(summary, null, 2));
    }
  }

  private outputSchema(cmd: ManifestCommand): void {
    // Separate command-specific flags from common flags
    const commandFlags: Record<string, Record<string, unknown>> = {};
    for (const [name, flag] of Object.entries(cmd.flags ?? {})) {
      if (!COMMON_FLAG_NAMES.has(name)) {
        commandFlags[name] = cleanFlag(flag);
      }
    }

    const args: Record<string, Record<string, unknown>> = {};
    for (const [name, arg] of Object.entries(cmd.args ?? {})) {
      args[name] = cleanArg(arg);
    }

    // Include common flags that this command actually has
    const hasCommonFlags = Object.keys(cmd.flags ?? {}).some((f) =>
      COMMON_FLAG_NAMES.has(f),
    );

    const schema: Record<string, unknown> = {
      id: cmd.id,
      usage: commandUsage(cmd),
      description: cmd.description ?? "",
      args: Object.keys(args).length > 0 ? args : undefined,
      flags: Object.keys(commandFlags).length > 0 ? commandFlags : undefined,
      ...(hasCommonFlags && {
        commonFlags:
          "All commands also accept: --json, --fields, --env, --env-file, --gateway-host, --verbose, --log-level, --structured-logging, --app-version",
      }),
      examples: cmd.examples ? cleanExamples(cmd, cmd.examples) : undefined,
    };

    // Remove undefined fields
    for (const key of Object.keys(schema)) {
      if (schema[key] === undefined) delete schema[key];
    }

    this.log(JSON.stringify(schema, null, 2));
  }

  private buildCommonFlags(
    commands: Record<string, ManifestCommand>,
  ): Record<string, Record<string, unknown>> {
    // Extract common flags from any command that has them
    const sample = Object.values(commands).find(
      (c) => c.flags && "json" in c.flags,
    );
    if (!sample?.flags) return {};

    const result: Record<string, Record<string, unknown>> = {};
    for (const name of COMMON_FLAG_NAMES) {
      const flag = sample.flags[name];
      if (flag) {
        result[name] = cleanFlag(flag);
      }
    }
    return result;
  }
}
