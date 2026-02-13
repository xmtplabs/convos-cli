import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { XmtpEnv } from "@xmtp/node-sdk";
import { generatePrivateKey } from "viem/accounts";

const DEFAULT_CONVOS_HOME = join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".convos",
);

/**
 * A Convos identity represents a single XMTP inbox used for one conversation.
 * Following ADR 002: Per-Conversation Identity Model.
 *
 * Each identity has its own:
 *  - Wallet private key (secp256k1)
 *  - Database encryption key (32 bytes)
 *  - XMTP database (SQLite)
 *  - Conversation association (once linked)
 */
export interface Identity {
  /** Unique identifier for this identity (hex) */
  id: string;
  /** Wallet private key (hex with 0x prefix) */
  walletKey: string;
  /** Database encryption key (hex) */
  dbEncryptionKey: string;
  /** XMTP inbox ID (set after first client creation) */
  inboxId?: string;
  /** Conversation ID this identity is linked to */
  conversationId?: string;
  /** Invite tag used to join/create this conversation */
  inviteTag?: string;
  /** Human-readable label */
  label?: string;
  /** Profile name shared with conversation members */
  profileName?: string;
  /** Profile image URL */
  profileImageUrl?: string;
  /** Creation timestamp */
  createdAt: string;
}

export interface IdentityStore {
  list(): Identity[];
  get(id: string): Identity | undefined;
  getByConversationId(conversationId: string): Identity | undefined;
  getAllByConversationId(conversationId: string): Identity[];
  getByInviteTag(tag: string): Identity | undefined;
  getUnlinked(): Identity[];
  create(opts?: { label?: string; profileName?: string }): Identity;
  update(id: string, updates: Partial<Identity>): Identity;
  remove(id: string): void;
  getDbPath(id: string, env: XmtpEnv): string;
}

export function createIdentityStore(baseDir?: string): IdentityStore {
  const home = baseDir ?? DEFAULT_CONVOS_HOME;

  function identitiesDir(): string {
    const dir = join(home, "identities");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function identityPath(id: string): string {
    return join(identitiesDir(), `${id}.json`);
  }

  return {
    list(): Identity[] {
      const dir = identitiesDir();
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as Identity)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    },

    get(id: string): Identity | undefined {
      const path = identityPath(id);
      if (!existsSync(path)) return undefined;
      return JSON.parse(readFileSync(path, "utf-8")) as Identity;
    },

    getByConversationId(conversationId: string): Identity | undefined {
      // Return the oldest identity for this conversation (first-created = most likely original)
      const matches = this.list().filter(
        (i) => i.conversationId === conversationId,
      );
      return matches.length > 0
        ? matches[matches.length - 1] // list() sorts newest-first, so last = oldest
        : undefined;
    },

    getAllByConversationId(conversationId: string): Identity[] {
      return this.list().filter(
        (i) => i.conversationId === conversationId,
      );
    },

    getByInviteTag(tag: string): Identity | undefined {
      return this.list().find((i) => i.inviteTag === tag);
    },

    getUnlinked(): Identity[] {
      return this.list().filter((i) => !i.conversationId);
    },

    create(opts?: { label?: string; profileName?: string }): Identity {
      const id = randomBytes(16).toString("hex");
      const identity: Identity = {
        id,
        walletKey: generatePrivateKey(),
        dbEncryptionKey: randomBytes(32).toString("hex"),
        label: opts?.label,
        profileName: opts?.profileName,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(identityPath(id), JSON.stringify(identity, null, 2));
      return identity;
    },

    update(id: string, updates: Partial<Identity>): Identity {
      const existing = this.get(id);
      if (!existing) throw new Error(`Identity not found: ${id}`);
      const updated = { ...existing, ...updates, id: existing.id };
      writeFileSync(identityPath(id), JSON.stringify(updated, null, 2));
      return updated;
    },

    remove(id: string): void {
      const path = identityPath(id);
      if (existsSync(path)) rmSync(path);
      // Clean up XMTP database files
      const dbBaseDir = join(home, "db");
      if (existsSync(dbBaseDir)) {
        for (const envDir of readdirSync(dbBaseDir)) {
          const envPath = join(dbBaseDir, envDir);
          for (const file of readdirSync(envPath)) {
            if (file.startsWith(id)) {
              rmSync(join(envPath, file));
            }
          }
        }
      }
    },

    getDbPath(id: string, env: XmtpEnv): string {
      const dir = join(home, "db", env);
      mkdirSync(dir, { recursive: true });
      return join(dir, `${id}.db3`);
    },
  };
}
