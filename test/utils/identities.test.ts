import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to mock the identities dir before importing
let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "convos-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("identity store", () => {
  it("creates, lists, and removes identities", async () => {
    // Dynamic import after setting env
    vi.stubEnv("CONVOS_HOME", testDir);
    const { createIdentityStore } = await import(
      "../../src/utils/identities.js"
    );
    const store = createIdentityStore(testDir);

    // Start empty
    expect(store.list()).toHaveLength(0);

    // Create
    const id1 = store.create({ label: "test-1", profileName: "Alice" });
    expect(id1.id).toBeDefined();
    expect(id1.walletKey).toMatch(/^0x[a-f0-9]{64}$/);
    expect(id1.dbEncryptionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(id1.profileName).toBe("Alice");

    // List
    expect(store.list()).toHaveLength(1);

    // Get by ID
    const fetched = store.get(id1.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(id1.id);

    // Create another
    const id2 = store.create({ label: "test-2" });
    expect(store.list()).toHaveLength(2);

    // Update
    const updated = store.update(id1.id, {
      conversationId: "conv-123",
      profileName: "Alice Smith",
    });
    expect(updated.conversationId).toBe("conv-123");
    expect(updated.profileName).toBe("Alice Smith");

    // Get by conversation ID
    const byConv = store.getByConversationId("conv-123");
    expect(byConv).toBeDefined();
    expect(byConv!.id).toBe(id1.id);

    // Remove
    store.remove(id2.id);
    expect(store.list()).toHaveLength(1);

    // Remove last
    store.remove(id1.id);
    expect(store.list()).toHaveLength(0);
  });
});
