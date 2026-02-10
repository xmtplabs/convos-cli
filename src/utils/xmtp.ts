/**
 * Utilities extracted from @xmtp/cli that convos-cli needs.
 *
 * The published @xmtp/cli@0.1.0 only exports { run } — these small
 * helpers are inlined here so convos-cli can be used with the official
 * npm package instead of a local fork.
 */

import { stdout } from "node:process";
import { Dm, Group, type Conversation } from "@xmtp/node-sdk";
import { isHex, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ─── Conversation type guards ───

export function isGroup(conversation: Conversation): conversation is Group {
  return conversation instanceof Group;
}

export function isDm(conversation: Conversation): conversation is Dm {
  return conversation instanceof Dm;
}

export function requireGroup(conversation: Conversation): Group {
  if (!isGroup(conversation)) {
    throw new Error(
      "This command is only available for group conversations",
    );
  }
  return conversation;
}

export function requireDm(conversation: Conversation): Dm {
  if (!isDm(conversation)) {
    throw new Error("This command is only available for DM conversations");
  }
  return conversation;
}

// ─── Hex / key helpers ───

export function toHexBytes(hex: string): Uint8Array {
  const prefixedHex = hex.startsWith("0x") ? hex : `0x${hex}`;
  return hexToBytes(prefixedHex);
}

export function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(hex, { strict: true })) {
    throw new Error(`Invalid hex string: ${value}`);
  }
  return toBytes(hex);
}

export function getAccountAddress(walletKey: string): string {
  const account = privateKeyToAccount(walletKey as `0x${string}`);
  return account.address;
}

// ─── Config constants ───

export const VALID_ENVS = ["local", "dev", "production"] as const;

// ─── Output formatting ───

export function isTTY(): boolean {
  return stdout.isTTY ?? false;
}

export function jsonStringify(data: unknown, pretty = false): string {
  return JSON.stringify(
    data,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    pretty ? 2 : undefined,
  );
}

export function formatHuman(data: unknown, indent = 0): string {
  const prefix = " ".repeat(indent);

  if (data === null || data === undefined) return "";
  if (typeof data === "string") return prefix + data;
  if (
    typeof data === "number" ||
    typeof data === "boolean" ||
    typeof data === "bigint"
  )
    return prefix + String(data);

  if (Array.isArray(data)) {
    if (data.length === 0) return prefix + "(empty)";
    if (typeof data[0] === "object" && data[0] !== null)
      return formatTable(data, prefix);
    return data.map((item) => formatHuman(item, indent)).join("\n");
  }

  if (typeof data === "object")
    return formatObject(data as Record<string, unknown>, prefix);
  return prefix + jsonStringify(data);
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return String(value);
  return jsonStringify(value);
}

function formatTable(
  rows: Array<Record<string, unknown>>,
  prefix = "",
): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const widths = keys.map((key) =>
    Math.max(key.length, ...rows.map((row) => stringifyValue(row[key]).length)),
  );
  const header =
    prefix + keys.map((key, i) => key.padEnd(widths[i])).join("  ");
  const separator = prefix + widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map(
      (row) =>
        prefix +
        keys
          .map((key, i) => stringifyValue(row[key]).padEnd(widths[i]))
          .join("  "),
    )
    .join("\n");
  return `${header}\n${separator}\n${body}`;
}

function formatObject(
  obj: Record<string, unknown>,
  prefix = "",
  keyWidth?: number,
): string {
  const entries = Object.entries(obj).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  const maxKeyLen =
    keyWidth ?? Math.max(...entries.map(([k]) => k.length));
  return entries
    .map(
      ([key, value]) =>
        `${prefix}${key.padEnd(maxKeyLen)}  ${formatHuman(value)}`,
    )
    .join("\n");
}

export interface Section {
  title: string;
  data: Record<string, unknown>;
}

export function formatSections(sections: Section[], indent = 0): string {
  const prefix = " ".repeat(indent);
  const allKeys = sections.flatMap((s) =>
    Object.entries(s.data)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k]) => k),
  );
  const keyWidth =
    allKeys.length > 0 ? Math.max(...allKeys.map((k) => k.length)) : 0;
  return sections
    .map((s) => `${s.title}\n\n${formatObject(s.data, prefix, keyWidth)}`)
    .join("\n\n");
}
