/**
 * Utilities extracted from @xmtp/cli that convos-cli needs.
 *
 * The published @xmtp/cli@0.1.0 only exports { run } — these small
 * helpers are inlined here so convos-cli can be used with the official
 * npm package instead of a local fork.
 */

import { stdout } from "node:process";
import {
  ContentType,
  Dm,
  Group,
  type DecodedMessage,
  type Conversation,
} from "@xmtp/node-sdk";
import type { GroupUpdated } from "@xmtp/node-bindings";
import { parseAppData } from "./metadata.js";
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

// ─── Message content normalization ───

/** Map of inboxId (lowercase) → display name. */
export type ProfileMap = Map<string, string>;

/**
 * Build a ProfileMap from a Group's appData.
 */
export function buildProfileMap(appData: string): ProfileMap {
  const metadata = parseAppData(appData);
  const map: ProfileMap = new Map();
  for (const p of metadata.profiles) {
    if (p.name) {
      map.set(p.inboxId.toLowerCase(), p.name);
    }
  }
  return map;
}

/**
 * Resolve an inbox ID to a display name, falling back to "Somebody".
 */
function resolveName(inboxId: string, profiles: ProfileMap): string {
  return profiles.get(inboxId.toLowerCase()) ?? "Somebody";
}

/**
 * Produce human-readable descriptions for a GroupUpdated event.
 */
function describeGroupUpdated(
  content: GroupUpdated,
  profiles: ProfileMap,
): string[] {
  const descriptions: string[] = [];
  const initiator = resolveName(content.initiatedByInboxId, profiles);

  for (const inbox of content.addedInboxes) {
    const added = resolveName(inbox.inboxId, profiles);
    if (inbox.inboxId.toLowerCase() === content.initiatedByInboxId.toLowerCase()) {
      descriptions.push(`${added} joined by invite`);
    } else {
      descriptions.push(`${initiator} added ${added}`);
    }
  }

  for (const inbox of content.removedInboxes) {
    const removed = resolveName(inbox.inboxId, profiles);
    descriptions.push(`${initiator} removed ${removed}`);
  }

  for (const inbox of content.leftInboxes) {
    const left = resolveName(inbox.inboxId, profiles);
    descriptions.push(`${left} left the group`);
  }

  for (const change of content.metadataFieldChanges) {
    const field = change.fieldName.replace(/_/g, " ");
    if (change.newValue) {
      descriptions.push(`${initiator} changed ${field} to "${change.newValue}"`);
    } else {
      descriptions.push(`${initiator} cleared ${field}`);
    }
  }

  for (const inbox of content.addedAdminInboxes) {
    const admin = resolveName(inbox.inboxId, profiles);
    descriptions.push(`${initiator} made ${admin} an admin`);
  }

  for (const inbox of content.removedAdminInboxes) {
    const admin = resolveName(inbox.inboxId, profiles);
    descriptions.push(`${initiator} removed ${admin} as admin`);
  }

  for (const inbox of content.addedSuperAdminInboxes) {
    const admin = resolveName(inbox.inboxId, profiles);
    descriptions.push(`${initiator} made ${admin} a super admin`);
  }

  for (const inbox of content.removedSuperAdminInboxes) {
    const admin = resolveName(inbox.inboxId, profiles);
    descriptions.push(`${initiator} removed ${admin} as super admin`);
  }

  if (descriptions.length === 0) {
    descriptions.push("Group updated");
  }

  return descriptions;
}

/**
 * Normalize a GroupUpdated NAPI object into a plain serializable object
 * with a human-readable description.
 */
function normalizeGroupUpdated(
  content: GroupUpdated,
  profiles: ProfileMap,
): Record<string, unknown> {
  return {
    description: describeGroupUpdated(content, profiles).join("; "),
    initiatedByInboxId: content.initiatedByInboxId,
    addedInboxes: content.addedInboxes.map((i) => ({ inboxId: i.inboxId })),
    removedInboxes: content.removedInboxes.map((i) => ({ inboxId: i.inboxId })),
    leftInboxes: content.leftInboxes.map((i) => ({ inboxId: i.inboxId })),
    metadataFieldChanges: content.metadataFieldChanges.map((c) => ({
      fieldName: c.fieldName,
      ...(c.oldValue !== undefined && { oldValue: c.oldValue }),
      ...(c.newValue !== undefined && { newValue: c.newValue }),
    })),
    addedAdminInboxes: content.addedAdminInboxes.map((i) => ({ inboxId: i.inboxId })),
    removedAdminInboxes: content.removedAdminInboxes.map((i) => ({ inboxId: i.inboxId })),
    addedSuperAdminInboxes: content.addedSuperAdminInboxes.map((i) => ({ inboxId: i.inboxId })),
    removedSuperAdminInboxes: content.removedSuperAdminInboxes.map((i) => ({ inboxId: i.inboxId })),
  };
}

/**
 * Content type IDs that we know how to display.
 * Everything else may be a NAPI object that serializes as `[object Object]`.
 */
const DISPLAYABLE_TYPE_IDS = new Set([
  "text",
  "markdown",
  "group_updated",
  "reaction",
  "reply",
]);

/**
 * Returns true if the message has a content type we know how to display.
 * Use this to filter out unknown/binary content types from streams.
 */
export function isDisplayableMessage(message: DecodedMessage): boolean {
  const ct = message.contentType;
  if (ct.authorityId !== "xmtp.org") return false;
  if (DISPLAYABLE_TYPE_IDS.has(ct.typeId)) return true;
  // Fallback: if content is already a string, it's safe to display
  return typeof message.content === "string";
}

/**
 * Normalize message content for serialization. NAPI-backed objects (like
 * GroupUpdated) don't have enumerable properties, so JSON.stringify produces
 * `{}` or they coerce to `[object Object]`. This function converts known
 * content types into plain objects with human-readable descriptions.
 *
 * @param profiles - optional ProfileMap for resolving inbox IDs to names.
 *   When omitted, unresolved members appear as "Somebody".
 */
export function normalizeMessageContent(
  message: DecodedMessage,
  profiles?: ProfileMap,
): unknown {
  const ct = message.contentType;
  if (
    ct.authorityId === "xmtp.org" &&
    ct.typeId === "group_updated" &&
    message.content != null &&
    typeof message.content === "object"
  ) {
    return normalizeGroupUpdated(
      message.content as GroupUpdated,
      profiles ?? new Map(),
    );
  }
  if (
    ct.authorityId === "xmtp.org" &&
    ct.typeId === "reaction" &&
    message.content != null &&
    typeof message.content === "object"
  ) {
    const r = message.content as {
      reference: string;
      referenceInboxId: string;
      action: number;
      content: string;
      schema: number;
    };
    return {
      reference: r.reference,
      referenceInboxId: r.referenceInboxId,
      action: r.action,
      content: r.content,
      schema: r.schema,
    };
  }
  if (
    ct.authorityId === "xmtp.org" &&
    ct.typeId === "reply" &&
    message.content != null &&
    typeof message.content === "object"
  ) {
    const r = message.content as {
      reference: string;
      referenceInboxId?: string;
      content: unknown;
    };
    return {
      reference: r.reference,
      referenceInboxId: r.referenceInboxId,
      content: r.content,
    };
  }
  return message.content;
}

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
