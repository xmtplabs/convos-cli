import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "convos-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("identity store (single-inbox, ADR 011)", () => {
  it("starts empty until loadOrUpsert is called", async () => {
    vi.stubEnv("CONVOS_HOME", testDir);
    const { createIdentityStore } = await import(
      "../../src/utils/identities.js"
    );
    const store = createIdentityStore(testDir);

    expect(store.exists()).toBe(false);
    expect(store.load()).toBeUndefined();

    const identity = store.loadOrUpsert({
      label: "test",
      profileName: "Alice",
    });
    expect(identity.id).toMatch(/^[a-f0-9]+$/);
    expect(identity.walletKey).toMatch(/^0x[a-f0-9]{64}$/);
    expect(identity.dbEncryptionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.label).toBe("test");
    expect(identity.profileName).toBe("Alice");

    expect(store.exists()).toBe(true);
    expect(store.load()?.id).toBe(identity.id);
  });

  it("loadOrUpsert returns the existing identity on subsequent calls", async () => {
    vi.stubEnv("CONVOS_HOME", testDir);
    const { createIdentityStore } = await import(
      "../../src/utils/identities.js"
    );
    const store = createIdentityStore(testDir);

    const first = store.loadOrUpsert({ label: "first" });
    const second = store.loadOrUpsert({ label: "second" });

    // Same identity, same keys — the second call just patched the label
    expect(second.id).toBe(first.id);
    expect(second.walletKey).toBe(first.walletKey);
    expect(second.label).toBe("second");
  });

  it("update merges fields onto the stored identity", async () => {
    vi.stubEnv("CONVOS_HOME", testDir);
    const { createIdentityStore } = await import(
      "../../src/utils/identities.js"
    );
    const store = createIdentityStore(testDir);

    const identity = store.loadOrUpsert({ label: "original" });
    const updated = store.update({
      inboxId: "inbox-abc",
      profileName: "Bob",
    });

    expect(updated.id).toBe(identity.id);
    expect(updated.inboxId).toBe("inbox-abc");
    expect(updated.profileName).toBe("Bob");
    expect(updated.label).toBe("original");
  });

  it("update throws when no identity exists", async () => {
    vi.stubEnv("CONVOS_HOME", testDir);
    const { createIdentityStore } = await import(
      "../../src/utils/identities.js"
    );
    const store = createIdentityStore(testDir);

    expect(() => store.update({ inboxId: "x" })).toThrow(
      /No identity exists/,
    );
  });

  it("delete wipes the identity and the db directory", async () => {
    vi.stubEnv("CONVOS_HOME", testDir);
    const { createIdentityStore } = await import(
      "../../src/utils/identities.js"
    );
    const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
    const store = createIdentityStore(testDir);

    store.loadOrUpsert({ label: "to-delete" });
    const dbPath = store.getDbPath("dev");
    mkdirSync(join(testDir, "db", "dev"), { recursive: true });
    writeFileSync(dbPath, "fake-db");

    expect(store.exists()).toBe(true);
    expect(existsSync(dbPath)).toBe(true);

    store.delete();

    expect(store.exists()).toBe(false);
    expect(existsSync(join(testDir, "db"))).toBe(false);
  });

  it("getDbPath is stable across calls for the same env", async () => {
    vi.stubEnv("CONVOS_HOME", testDir);
    const { createIdentityStore } = await import(
      "../../src/utils/identities.js"
    );
    const store = createIdentityStore(testDir);
    store.loadOrUpsert();

    const a = store.getDbPath("dev");
    const b = store.getDbPath("dev");
    expect(a).toBe(b);
  });
});
