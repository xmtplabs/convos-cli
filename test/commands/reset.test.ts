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

describe("reset", () => {
  it("removes all identities and database files", () => {
    const store = createIdentityStore(testDir);

    // Create some identities
    const id1 = store.create({ label: "conv-1" });
    const id2 = store.create({ label: "conv-2" });
    store.update(id1.id, { conversationId: "conv-aaa" });
    store.update(id2.id, { conversationId: "conv-bbb" });

    // Create fake db files
    const dbDir = join(testDir, "db", "dev");
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(join(dbDir, `${id1.id}.db3`), "fake-db");
    writeFileSync(join(dbDir, `${id2.id}.db3`), "fake-db");

    // Preserve a .env file
    writeFileSync(join(testDir, ".env"), "CONVOS_ENV=dev\n");

    // Verify setup
    expect(store.list()).toHaveLength(2);
    expect(existsSync(join(dbDir, `${id1.id}.db3`))).toBe(true);

    // Simulate reset: remove all identity files
    const identitiesDir = join(testDir, "identities");
    for (const identity of store.list()) {
      store.remove(identity.id);
    }

    // Remove db directory
    rmSync(join(testDir, "db"), { recursive: true, force: true });

    // Verify cleanup
    expect(store.list()).toHaveLength(0);
    expect(existsSync(join(testDir, "db"))).toBe(false);

    // .env is preserved
    expect(existsSync(join(testDir, ".env"))).toBe(true);
  });

  it("handles empty state gracefully", () => {
    const store = createIdentityStore(testDir);

    // No identities, no db files — nothing to do
    expect(store.list()).toHaveLength(0);
    expect(existsSync(join(testDir, "db"))).toBe(false);
  });
});
