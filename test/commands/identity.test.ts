import { describe, expect, it } from "vitest";
import { parseJsonOutput, runCommand } from "../helpers.js";

describe("identity commands", () => {
  it("identity create → list → info → remove lifecycle", async () => {
    // Create
    const createResult = await runCommand([
      "identity",
      "create",
      "--label",
      "test-identity",
      "--profile-name",
      "TestUser",
      "--json",
    ]);
    expect(createResult.exitCode).toBe(0);

    const created = parseJsonOutput<{
      id: string;
      label: string;
      profileName: string;
      address: string;
    }>(createResult.stdout);
    expect(created.id).toBeDefined();
    expect(created.id).toMatch(/^[a-f0-9]+$/);
    expect(created.label).toBe("test-identity");
    expect(created.profileName).toBe("TestUser");
    expect(created.address).toMatch(/^0x/);

    // List
    const listResult = await runCommand(["identity", "list", "--json"]);
    expect(listResult.exitCode).toBe(0);

    const list = parseJsonOutput<Array<{ id: string }>>(listResult.stdout);
    expect(list.some((i) => i.id === created.id)).toBe(true);

    // Remove (--force to skip confirmation prompt)
    const removeResult = await runCommand([
      "identity",
      "remove",
      created.id,
      "--force",
      "--json",
    ]);
    expect(removeResult.exitCode).toBe(0);

    // Verify removed
    const listAfter = await runCommand(["identity", "list", "--json"]);
    const afterList = parseJsonOutput<Array<{ id: string }>>(
      listAfter.stdout,
    );
    expect(afterList.some((i) => i.id === created.id)).toBe(false);
  });
});
