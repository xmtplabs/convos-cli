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

/** Sender profile info included in agent message events. */
export interface SenderProfile {
  name?: string;
  image?: string;
}

/**
 * Look up a sender's profile from the group's appData.
 * Returns a SenderProfile with whatever fields are available, or
 * undefined if no profile exists for the given inbox ID.
 */
export function getSenderProfile(
  appData: string,
  senderInboxId: string,
): SenderProfile | undefined {
  const metadata = parseAppData(appData);
  const profile = metadata.profiles.find(
    (p) => p.inboxId.toLowerCase() === senderInboxId.toLowerCase(),
  );
  if (!profile) return undefined;
  if (!profile.name && !profile.image) return undefined;
  return {
    ...(profile.name && { name: profile.name }),
    ...(profile.image && { image: profile.image }),
  };
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
 * Content type IDs that we know how to display.
 * Everything else may be a NAPI object that serializes as `[object Object]`.
 */
const DISPLAYABLE_TYPE_IDS = new Set([
  "text",
  "markdown",
  "group_updated",
  "reaction",
  "reply",
  "attachment",
  "remoteStaticAttachment",
  "multiRemoteStaticAttachment",
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
 * Normalize message content to a string for display. NAPI-backed objects
 * (like GroupUpdated) don't have enumerable properties, so JSON.stringify
 * produces `{}` or they coerce to `[object Object]`. This function always
 * returns a string safe for display.
 *
 * @param profiles - optional ProfileMap for resolving inbox IDs to names.
 *   When omitted, unresolved members appear as "Somebody".
 */
export function normalizeMessageContent(
  message: DecodedMessage,
  profiles?: ProfileMap,
): string {
  const ct = message.contentType;

  // Text / markdown — already a string
  if (typeof message.content === "string") {
    return message.content;
  }

  // GroupUpdated — human-readable description
  if (
    ct.authorityId === "xmtp.org" &&
    ct.typeId === "group_updated" &&
    message.content != null &&
    typeof message.content === "object"
  ) {
    return describeGroupUpdated(
      message.content as GroupUpdated,
      profiles ?? new Map(),
    ).join("; ");
  }

  // Reaction — e.g. "reacted 👍 to <msgId>"
  if (
    ct.authorityId === "xmtp.org" &&
    ct.typeId === "reaction" &&
    message.content != null &&
    typeof message.content === "object"
  ) {
    const r = message.content as {
      reference: string;
      action: number;
      content: string;
    };
    const verb = r.action === 2 ? "removed" : "reacted";
    return `${verb} ${r.content} to ${r.reference}`;
  }

  // Reply — extract text content if possible
  if (
    ct.authorityId === "xmtp.org" &&
    ct.typeId === "reply" &&
    message.content != null &&
    typeof message.content === "object"
  ) {
    const r = message.content as {
      reference: string;
      content: unknown;
    };
    const text = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
    return `reply to ${r.reference}: ${text}`;
  }

  // Inline attachment — filename and mime type
  if (
    ct.authorityId === "xmtp.org" &&
    ct.typeId === "attachment" &&
    message.content != null &&
    typeof message.content === "object"
  ) {
    const a = message.content as { filename?: string; mimeType: string };
    const name = a.filename || "unnamed";
    return `[attachment: ${name} (${a.mimeType})]`;
  }

  // Remote attachment — URL, filename, mime info
  if (
    ct.authorityId === "xmtp.org" &&
    ct.typeId === "remoteStaticAttachment" &&
    message.content != null &&
    typeof message.content === "object"
  ) {
    const a = message.content as { url: string; filename?: string; contentLength: number };
    const name = a.filename || "unnamed";
    return `[remote attachment: ${name} (${a.contentLength} bytes) ${a.url}]`;
  }

  // Multi remote attachment
  if (
    ct.authorityId === "xmtp.org" &&
    ct.typeId === "multiRemoteStaticAttachment" &&
    message.content != null &&
    typeof message.content === "object"
  ) {
    const m = message.content as {
      attachments: Array<{ filename?: string; url: string; contentLength?: number }>;
    };
    const count = m.attachments?.length ?? 0;
    const names = m.attachments?.map((a) => a.filename || "unnamed").join(", ") ?? "";
    return `[${count} attachments: ${names}]`;
  }

  // Fallback — stringify safely
  try {
    const str = JSON.stringify(message.content);
    return str !== undefined ? str : "";
  } catch {
    return "";
  }
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
