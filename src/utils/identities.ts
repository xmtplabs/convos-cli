import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { XmtpEnv } from "@xmtp/node-sdk";
import { generatePrivateKey } from "viem/accounts";

export const DEFAULT_CONVOS_HOME =
  process.env.CONVOS_HOME ??
  join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".convos");

/**
 * A Convos identity — one per CLI install, shared across all conversations
 * (per ADR 011: Single-Inbox Identity Model).
 *
 * Backed by a single XMTP inbox. All groups and DMs this install participates
 * in share this identity. To run multiple independent agents on one machine,
 * point each at a different CONVOS_HOME.
 */
export interface Identity {
  /** Local identifier for this identity (hex) — not the XMTP inbox ID. */
  id: string;
  /** Wallet private key (hex with 0x prefix). Signs XMTP and invites. */
  walletKey: string;
  /** Database encryption key (hex). */
  dbEncryptionKey: string;
  /** XMTP inbox ID — populated after first client registration. */
  inboxId?: string;
  /** Human-readable label for this agent/install. */
  label?: string;
  /** Default profile display name used when creating/joining conversations. */
  profileName?: string;
  /** Default profile image URL. */
  profileImageUrl?: string;
  /** Creation timestamp. */
  createdAt: string;
}

export interface IdentityStore {
  /** Returns the identity if one exists, else undefined. */
  load(): Identity | undefined;
  /**
   * Returns the existing identity, or creates one if none exists.
   * If an identity exists and `opts.label` or `opts.profileName` differ from
   * the stored values, those fields are overwritten. Pass `undefined` (or
   * omit the field) to leave a field unchanged.
   */
  loadOrUpsert(opts?: { label?: string; profileName?: string }): Identity;
  /** Returns true if an identity exists. */
  exists(): boolean;
  /** Merges updates onto the stored identity. Throws if none exists. */
  update(updates: Partial<Identity>): Identity;
  /** Deletes the identity file and all XMTP database files for this install. */
  delete(): void;
  /** Path where the XMTP database for this identity lives. */
  getDbPath(env: XmtpEnv): string;
}

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;

function sleepSync(ms: number): void {
  // Atomics.wait blocks without burning CPU. SharedArrayBuffer is required.
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, ms);
}

/**
 * Advisory lock around read-modify-write of identity.json. Prevents two CLI
 * processes running against the same CONVOS_HOME from losing updates.
 *
 * Uses `openSync(..., 'wx')` as the atomic primitive. On stale locks (lockfile
 * older than LOCK_STALE_MS) we break and retry. On persistent contention we
 * throw after LOCK_TIMEOUT_MS so an operator isn't waiting forever.
 */
function withLock<T>(lockPath: string, fn: () => T): T {
  const start = Date.now();
  while (true) {
    let fd: number | undefined;
    try {
      fd = openSync(lockPath, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const stats = statSync(lockPath);
        if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // Lock disappeared between openSync and statSync — retry.
        continue;
      }
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error(
          `Could not acquire identity lock at ${lockPath} after ${LOCK_TIMEOUT_MS}ms. ` +
            `Another CLI process may be running against this CONVOS_HOME. ` +
            `If you're sure no other process is active, remove the lock file manually.`,
        );
      }
      sleepSync(LOCK_RETRY_MS);
      continue;
    }
    try {
      return fn();
    } finally {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
      try {
        rmSync(lockPath, { force: true });
      } catch {
        // best-effort
      }
    }
  }
}

export function createIdentityStore(baseDir?: string): IdentityStore {
  const home = baseDir ?? DEFAULT_CONVOS_HOME;

  function identityPath(): string {
    mkdirSync(home, { recursive: true });
    return join(home, "identity.json");
  }

  function lockPath(): string {
    mkdirSync(home, { recursive: true });
    return join(home, "identity.json.lock");
  }

  function readIdentity(): Identity | undefined {
    const path = identityPath();
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf-8")) as Identity;
  }

  function writeIdentity(identity: Identity): void {
    // Write to a temp file then rename. Rename is atomic on POSIX and
    // same-volume on Windows, so readers never see a truncated identity.json.
    const path = identityPath();
    const tmpPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(identity, null, 2));
    renameSync(tmpPath, path);
  }

  return {
    load(): Identity | undefined {
      return readIdentity();
    },

    loadOrUpsert(opts?: { label?: string; profileName?: string }): Identity {
      return withLock(lockPath(), () => {
        const existing = readIdentity();
        if (existing) {
          const patch: Partial<Identity> = {};
          if (opts?.label !== undefined && existing.label !== opts.label) {
            patch.label = opts.label;
          }
          if (
            opts?.profileName !== undefined &&
            existing.profileName !== opts.profileName
          ) {
            patch.profileName = opts.profileName;
          }
          if (Object.keys(patch).length > 0) {
            const updated = { ...existing, ...patch };
            writeIdentity(updated);
            return updated;
          }
          return existing;
        }

        const identity: Identity = {
          id: randomBytes(16).toString("hex"),
          walletKey: generatePrivateKey(),
          dbEncryptionKey: randomBytes(32).toString("hex"),
          label: opts?.label,
          profileName: opts?.profileName,
          createdAt: new Date().toISOString(),
        };
        writeIdentity(identity);
        return identity;
      });
    },

    exists(): boolean {
      return existsSync(identityPath());
    },

    update(updates: Partial<Identity>): Identity {
      return withLock(lockPath(), () => {
        const existing = readIdentity();
        if (!existing) throw new Error("No identity exists to update");
        const updated = { ...existing, ...updates, id: existing.id };
        writeIdentity(updated);
        return updated;
      });
    },

    delete(): void {
      withLock(lockPath(), () => {
        const path = identityPath();
        if (existsSync(path)) rmSync(path);
        const dbBaseDir = join(home, "db");
        if (existsSync(dbBaseDir)) {
          rmSync(dbBaseDir, { recursive: true, force: true });
        }
      });
    },

    getDbPath(env: XmtpEnv): string {
      const dir = join(home, "db", env);
      mkdirSync(dir, { recursive: true });
      return join(dir, "main.db3");
    },
  };
}
