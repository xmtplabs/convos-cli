import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityStore } from "../../src/utils/identities.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "convos-reset-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("reset (single-inbox, ADR 011)", () => {
  it("removes the identity and database files", () => {
    const store = createIdentityStore(testDir);

    const identity = store.loadOrUpsert({ label: "install-1" });
    expect(store.exists()).toBe(true);

    // Simulate existing db files
    const dbDir = join(testDir, "db", "dev");
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(join(dbDir, "main.db3"), "fake-db");

    // Preserve a .env file
    writeFileSync(join(testDir, ".env"), "CONVOS_ENV=dev\n");

    expect(existsSync(join(dbDir, "main.db3"))).toBe(true);
    expect(identity.id).toBeDefined();

    // delete() should wipe both the identity and the db dir
    store.delete();

    expect(store.exists()).toBe(false);
    expect(existsSync(join(testDir, "db"))).toBe(false);

    // .env is preserved
    expect(existsSync(join(testDir, ".env"))).toBe(true);
  });

  it("handles empty state gracefully", () => {
    const store = createIdentityStore(testDir);

    expect(store.exists()).toBe(false);
    expect(store.load()).toBeUndefined();
    expect(existsSync(join(testDir, "db"))).toBe(false);

    // delete on empty state is a no-op
    expect(() => store.delete()).not.toThrow();
  });
});
